"""The loop that runs the collectors: one tick every interval, each collector on its own.

- One tick = take the cross-process lock, then for every collector: fetch, then sync. A failure
  of one (any exception, a rate limit, a timeout) is logged and the next collector still runs; the
  loop itself never dies of a collector.
- Only one process polls at a time: a Postgres session-level advisory lock (non-blocking) is held
  on a dedicated connection for the tick. A process that does not get it skips the tick.
- A collector that was rate limited is left alone until the time the source asked for.
- Every outbound call has the shared client's timeouts and a 20 s deadline (`core/http.py`), and a
  whole collector run is capped at 120 s.
- Logs carry the collector name, counts and an error class or upstream kind. Never a URL, a
  token, a title or a response body.
"""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
from pydantic import SecretStr
from sqlalchemy import BigInteger, bindparam, text

from src.core.clock import Clock
from src.core.config import Settings
from src.core.http import UpstreamError
from src.dashboards.collectors.base import Collector, pause_seconds
from src.dashboards.collectors.github import GitHubCollector
from src.dashboards.collectors.ical import CalendarCollector, split_feeds
from src.dashboards.collectors.linear import LinearCollector
from src.dashboards.runtime import DashboardsRuntime

logger = logging.getLogger("yuriodev.collectors")

ADVISORY_LOCK_KEY = 5_194_021_734  # not the migration lock's key
COLLECTOR_TIMEOUT_SECONDS = 120
LOCK = text("SELECT pg_try_advisory_lock(:key)").bindparams(
    bindparam("key", ADVISORY_LOCK_KEY, type_=BigInteger)
)
UNLOCK = text("SELECT pg_advisory_unlock(:key)").bindparams(
    bindparam("key", ADVISORY_LOCK_KEY, type_=BigInteger)
)


class CollectorManager:
    def __init__(
        self,
        runtime: DashboardsRuntime,
        collectors: list[Collector],
        client: httpx.AsyncClient,
        clock: Clock,
        *,
        interval: float,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._runtime = runtime
        self._collectors = collectors
        self._client = client
        self._clock = clock
        self._interval = interval
        self._sleep = sleep
        self._paused_until: dict[str, datetime] = {}
        self.ticks = 0  # completed ticks (also those that found the lock taken)
        self.ticked = asyncio.Event()  # set once the first tick has completed

    def describe(self) -> list[str]:
        return [collector.name for collector in self._collectors]

    async def run_forever(self) -> None:
        """Wait for the schema, then tick every interval until cancelled."""
        await self._runtime.ready.wait()
        while True:
            try:
                await self.tick()
            except Exception as exc:  # never let one bad tick end the loop
                logger.error(
                    "collector tick failed",
                    extra={"event": "collectors.tick_failed", "error": type(exc).__name__},
                )
            await self._sleep(self._interval)

    async def tick(self) -> None:
        async with self._advisory_lock() as acquired:
            if not acquired:
                logger.info("collectors skipped", extra={"event": "collectors.skipped"})
            else:
                for collector in self._collectors:
                    await self._run_one(collector)
        self.ticks += 1
        self.ticked.set()

    @asynccontextmanager
    async def _advisory_lock(self) -> AsyncIterator[bool]:
        """The cross-process lock, held on one connection for the whole tick."""
        async with self._runtime.engine.connect() as connection:
            await connection.execution_options(isolation_level="AUTOCOMMIT")
            acquired = bool((await connection.execute(LOCK)).scalar_one())
            try:
                yield acquired
            finally:
                if acquired:
                    try:
                        await connection.execute(UNLOCK)
                    except Exception:
                        # A lock that might still be held must not go back to the pool with
                        # its connection: closing the connection frees it.
                        with contextlib.suppress(Exception):
                            await connection.invalidate()

    async def _run_one(self, collector: Collector) -> None:
        now = self._clock()
        paused = self._paused_until.get(collector.name)
        if paused is not None and now < paused:
            logger.info(
                "collector paused",
                extra={"event": "collector.paused", "collector": collector.name},
            )
            return
        try:
            async with asyncio.timeout(COLLECTOR_TIMEOUT_SECONDS):
                counts = await collector.collect(self._client, self._runtime.sessions, now)
        except UpstreamError as exc:
            self._log_upstream_error(collector, exc, now)
        except Exception as exc:
            logger.warning(
                "collector failed",
                extra={
                    "event": "collector.failed",
                    "collector": collector.name,
                    "error": type(exc).__name__,
                },
            )
        else:
            self._paused_until.pop(collector.name, None)
            logger.info(
                "collector synced",
                extra={"event": "collector.synced", "collector": collector.name, **counts},
            )

    def _log_upstream_error(
        self, collector: Collector, error: UpstreamError, now: datetime
    ) -> None:
        wait = pause_seconds(error, int(now.timestamp()))
        if wait is not None:
            self._paused_until[collector.name] = now + timedelta(seconds=wait)
        logger.warning(
            "collector upstream error",
            extra={
                "event": "collector.upstream_error",
                "collector": collector.name,
                "kind": error.kind,
                "status": error.status,
                "paused_s": wait,
            },
        )


def build_collectors(settings: Settings, zone: ZoneInfo | None = None) -> list[Collector]:
    """The collectors whose credential is set (none when no token is configured)."""
    collectors: list[Collector] = []
    if settings.github_token is not None:
        github = GitHubCollector(
            settings.github_token, settings.github_space, settings.github_search_scope
        )
        collectors.append(github)
    if settings.linear_api_key is not None:
        collectors.append(LinearCollector(settings.linear_api_key, settings.linear_space))
    zone = zone or ZoneInfo(settings.dashboards_timezone)
    owners = _addresses(settings.calendar_owner_emails)
    for space, setting in (
        ("personal", settings.calendar_ics_personal),
        ("work-1", settings.calendar_ics_work_1),
    ):
        feeds = split_feeds(setting)
        if feeds:
            collectors.append(CalendarCollector(space, feeds, zone, owners))
    return collectors


def _addresses(value: SecretStr | None) -> frozenset[str]:
    if value is None:
        return frozenset()
    cleaned = (part.strip().lower().removeprefix("mailto:") for part in _split(value))
    return frozenset(part for part in cleaned if part)


def _split(value: SecretStr) -> list[str]:
    return value.get_secret_value().split(",")
