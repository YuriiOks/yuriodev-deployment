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
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.sql.elements import TextClause

from src.core.clock import Clock
from src.core.config import Settings
from src.core.http import UpstreamError
from src.dashboards.collectors.base import Collector, pause_seconds
from src.dashboards.collectors.github import GitHubCollector
from src.dashboards.collectors.ical import CalendarCollector, split_feeds
from src.dashboards.collectors.linear import LinearCollector
from src.dashboards.finance.base import FinanceCollector
from src.dashboards.finance.fx import FxCollector
from src.dashboards.finance.icons import IconCollector
from src.dashboards.finance.monobank import MonobankProvider
from src.dashboards.finance.monzo import MonzoProvider
from src.dashboards.runtime import DashboardsRuntime

logger = logging.getLogger("yuriodev.collectors")

ADVISORY_LOCK_KEY = 5_194_021_734  # not the migration lock's key
FINANCE_LOCK_KEY = 5_194_021_736  # the finance loop's own: it never holds up the task loop
COLLECTOR_TIMEOUT_SECONDS = 120


def lock_statements(key: int) -> tuple[TextClause, TextClause]:
    """The try-lock and unlock statements for one advisory lock key (bound as bigint)."""
    lock = text("SELECT pg_try_advisory_lock(:key)")
    unlock = text("SELECT pg_advisory_unlock(:key)")
    return (
        lock.bindparams(bindparam("key", key, type_=BigInteger)),
        unlock.bindparams(bindparam("key", key, type_=BigInteger)),
    )


LOCK, UNLOCK = lock_statements(ADVISORY_LOCK_KEY)


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
        lock_key: int = ADVISORY_LOCK_KEY,
    ) -> None:
        self._runtime = runtime
        self._collectors = collectors
        self._client = client
        self._clock = clock
        self._interval = interval
        self._sleep = sleep
        self._lock, self._unlock = lock_statements(lock_key)
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
            acquired = bool((await connection.execute(self._lock)).scalar_one())
            try:
                yield acquired
            finally:
                if acquired:
                    try:
                        await connection.execute(self._unlock)
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
            # A collector that made no request this tick (finance: nothing was due) says so quietly.
            level = logging.DEBUG if counts.get("calls", 1) == 0 else logging.INFO
            logger.log(
                level,
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


def build_finance_collectors(
    settings: Settings,
    sessions: async_sessionmaker[AsyncSession] | None = None,
    clock: Clock | None = None,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> list[Collector]:
    """The finance collectors whose credential is set (none without one). Monzo reads its tokens
    from the database, so it needs the sessions and the clock."""
    collectors: list[Collector] = []
    months = settings.finance_backfill_months
    if settings.monobank_token is not None:
        provider = MonobankProvider(settings.monobank_token)
        collectors.append(FinanceCollector(provider, months, sleep))
    client_id, secret = settings.monzo_client_id, settings.monzo_client_secret
    if settings.monzo_enabled and sessions and clock and client_id and secret:
        monzo = MonzoProvider(client_id, secret, sessions, clock, sleep)
        collectors.append(FinanceCollector(monzo, months, sleep))
    if collectors:  # the rates are only fetched when there is something to convert
        collectors.append(FxCollector())
        collectors.append(IconCollector())
    return collectors


def _addresses(value: SecretStr | None) -> frozenset[str]:
    if value is None:
        return frozenset()
    cleaned = (part.strip().lower().removeprefix("mailto:") for part in _split(value))
    return frozenset(part for part in cleaned if part)


def _split(value: SecretStr) -> list[str]:
    return value.get_secret_value().split(",")
