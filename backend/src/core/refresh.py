"""Background refresh loop: interval with jitter, exponential backoff, crash containment.

It knows nothing about any provider: a cycle returns a CycleResult and the loop decides how long
to sleep. `sleep` and `rng` are injected, so tests drive the whole state machine instantly.
"""

import asyncio
import enum
import logging
import random
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

logger = logging.getLogger("yuriodev.refresh")

JITTER = 0.10
BACKOFF_BASE_SECONDS = 300.0  # 5 min
BACKOFF_CAP_SECONDS = 7200.0  # 2 h
RATE_LIMIT_MIN_SECONDS = 60.0
RATE_LIMIT_MAX_SECONDS = 7200.0
AUTH_REMINDER_SECONDS = 3600.0

Sleep = Callable[[float], Awaitable[None]]


class CycleOutcome(enum.Enum):
    OK = "ok"
    TRANSIENT = "transient"  # timeout, 5xx, bad response: back off and retry
    DRIFT = "drift"  # too many drafts failed validation: previous snapshot kept, back off
    RATE_LIMITED = "rate_limited"  # wait for the provider's reset hint
    AUTH = "auth"  # rejected credentials or a misconfiguration: stop calling upstream


@dataclass(frozen=True)
class CycleResult:
    outcome: CycleOutcome
    retry_after: float | None = None  # seconds, from rate-limit headers


@dataclass
class Backoff:
    base: float = BACKOFF_BASE_SECONDS
    cap: float = BACKOFF_CAP_SECONDS
    failures: int = 0

    def next_delay(self, rng: random.Random) -> float:
        delay = min(self.cap, self.base * (2**self.failures))
        self.failures += 1
        return jittered(delay, rng)

    def reset(self) -> None:
        self.failures = 0


def jittered(seconds: float, rng: random.Random) -> float:
    return seconds * rng.uniform(1 - JITTER, 1 + JITTER)


class PeriodicRefresher:
    """Runs `cycle` now, then again after every sleep, until cancelled."""

    def __init__(
        self,
        cycle: Callable[[], Awaitable[CycleResult]],
        interval: float,
        *,
        name: str,
        sleep: Sleep = asyncio.sleep,
        rng: random.Random | None = None,
    ) -> None:
        self.cycle = cycle
        self.interval = interval
        self.name = name
        self.sleep = sleep
        self.rng = rng or random.Random()  # noqa: S311 - scheduling jitter, not cryptography
        self.backoff = Backoff()

    def delay_after(self, result: CycleResult) -> float | None:
        """Seconds until the next cycle; None means stop calling upstream."""
        if result.outcome is CycleOutcome.OK:
            self.backoff.reset()
            return jittered(self.interval, self.rng)
        if result.outcome is CycleOutcome.RATE_LIMITED:
            wait = result.retry_after if result.retry_after is not None else self.interval
            wait = min(RATE_LIMIT_MAX_SECONDS, max(RATE_LIMIT_MIN_SECONDS, wait))
            return wait + self.rng.uniform(0, RATE_LIMIT_MIN_SECONDS)
        if result.outcome is CycleOutcome.AUTH:
            return None
        return self.backoff.next_delay(self.rng)

    async def run_forever(self) -> None:
        while True:
            try:
                result = await self.cycle()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("refresh cycle crashed", extra={"event": f"{self.name}.crash"})
                result = CycleResult(CycleOutcome.TRANSIENT)
            delay = self.delay_after(result)
            if delay is None:
                await self._stopped()
                return  # pragma: no cover - _stopped only ends by cancellation
            if result.outcome is not CycleOutcome.OK:
                logger.warning(
                    "refresh backing off",
                    extra={
                        "event": f"{self.name}.backoff",
                        "reason": result.outcome.value,
                        "attempt": self.backoff.failures,
                        "next_in_s": round(delay),
                    },
                )
            await self.sleep(delay)

    async def _stopped(self) -> None:
        """Upstream rejected us: no more calls until a restart, one ERROR reminder an hour."""
        while True:
            logger.error(
                "refresh stopped until restart: upstream rejected the credentials or config",
                extra={"event": f"{self.name}.stopped"},
            )
            await self.sleep(AUTH_REMINDER_SECONDS)
