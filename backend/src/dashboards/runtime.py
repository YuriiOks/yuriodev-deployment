"""The database seam of a running app: engine, session factory and the "migrated" flag.

Created in the app lifespan, only when DATABASE_URL is set. Startup never waits on the database:
a background task runs `alembic upgrade head` (retrying with a growing delay while the database
is not reachable yet) and sets `ready`; until then every request answers 503
`dashboards_unavailable`.
"""

import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import Request
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from src.core.errors import AppError
from src.dashboards.db import run_migrations, to_async_url

logger = logging.getLogger("yuriodev.dashboards")

MIGRATE_FIRST_DELAY = 1.0
MIGRATE_MAX_DELAY = 30.0


class DashboardsRuntime:
    """Engine + sessions for one app. `ready` is set once the schema is at head."""

    def __init__(
        self,
        url: str,
        *,
        migrate: Callable[[str], None] = run_migrations,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._url = url
        self._migrate = migrate
        self._sleep = sleep
        self.engine: AsyncEngine = create_async_engine(
            to_async_url(url),
            # A small pool: the backend container has 192-256 MB and one caller.
            pool_size=3,
            max_overflow=2,
            pool_pre_ping=True,
            pool_recycle=1800,
            connect_args={"timeout": 10, "command_timeout": 15},
        )
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        self.ready = asyncio.Event()

    async def migrate_until_ready(self) -> None:
        """Run the migrations until one attempt succeeds, then set `ready`.

        Only the exception class is logged: a driver message can hold the host and user.
        """
        delay = MIGRATE_FIRST_DELAY
        attempt = 0
        while True:
            attempt += 1
            try:
                await asyncio.to_thread(self._migrate, self._url)
            except Exception as exc:
                logger.warning(
                    "dashboards migration failed, retrying",
                    extra={
                        "event": "dashboards.migrate_failed",
                        "attempt": attempt,
                        "error": type(exc).__name__,
                        "retry_in_s": delay,
                    },
                )
                await self._sleep(delay)
                delay = min(delay * 2, MIGRATE_MAX_DELAY)
            else:
                self.ready.set()
                logger.info(
                    "dashboards database ready",
                    extra={"event": "dashboards.ready", "attempts": attempt},
                )
                return

    async def close(self) -> None:
        await self.engine.dispose()


def get_runtime(request: Request) -> DashboardsRuntime | None:
    """The running app's runtime, or None when the API is off or its URL was rejected."""
    runtime: DashboardsRuntime | None = request.app.state.dashboards
    return runtime


def unavailable() -> AppError:
    return AppError(503, "dashboards_unavailable", "Dashboards data is not available")


@asynccontextmanager
async def session_scope(runtime: DashboardsRuntime | None) -> AsyncIterator[AsyncSession]:
    """A session on the migrated database, or 503 `dashboards_unavailable`."""
    if runtime is None or not runtime.ready.is_set():
        raise unavailable()
    async with runtime.sessions() as session:
        yield session
