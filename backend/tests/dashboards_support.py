"""Helpers of the dashboards tests: a real Postgres, a fixed clock and a running app."""

import asyncio
import contextlib
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import httpx
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from src.dashboards.db import to_async_url
from src.dashboards.gate import ACCESS_HEADER

TEST_DB_ENV = "DASHBOARDS_TEST_DATABASE_URL"
# A value no log line or response may ever contain (see test_dashboards_logs.py).
CRED = "dash-cred-7f3a91c2e4b8d605a1f9"
AUTH = {ACCESS_HEADER: CRED}
# Nothing listens on port 1: a URL for tests that never need a database to answer.
RUNNING_TIMEOUT = 90  # seconds for one app run in a test, startup to shutdown
UNREACHABLE_URL = "postgresql://dashboards:pw-unreachable@127.0.0.1:1/dashboards"


class FakeClock:
    """The app's clock, settable by a test."""

    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


def fixed_clock() -> FakeClock:
    return FakeClock(datetime(2026, 11, 22, 12, 0, tzinfo=UTC))


def new_database_name() -> str:
    return f"dashboards_test_{uuid.uuid4().hex[:12]}"


def url_for(server_url: str, database: str) -> str:
    return make_url(server_url).set(database=database).render_as_string(hide_password=False)


async def execute(url: str, *statements: str) -> None:
    """Run statements outside a transaction (CREATE/DROP DATABASE need that)."""
    engine = create_async_engine(
        to_async_url(url),
        isolation_level="AUTOCOMMIT",
        poolclass=NullPool,
        connect_args={"timeout": 10},
    )
    try:
        async with asyncio.timeout(30), engine.connect() as connection:
            # A lock held by a leaked transaction must fail the test, not hang it.
            await connection.execute(text("SET lock_timeout = '15s'"))
            for statement in statements:
                await connection.execute(text(statement))
    finally:
        await engine.dispose()


async def scalar(url: str, statement: str) -> object:
    engine = create_async_engine(
        to_async_url(url), poolclass=NullPool, connect_args={"timeout": 10}
    )
    try:
        async with asyncio.timeout(30), engine.connect() as connection:
            return (await connection.execute(text(statement))).scalar_one()
    finally:
        await engine.dispose()


@contextlib.asynccontextmanager
async def running(
    app: FastAPI, headers: dict[str, str] | None = None, wait: bool = True
) -> AsyncIterator[httpx.AsyncClient]:
    """The app with its lifespan started (and, by default, its database migrated), and a client.

    The whole block, shutdown included, is bounded: a stuck await fails the test with a
    TimeoutError instead of holding the CI job.
    """
    async with asyncio.timeout(RUNNING_TIMEOUT), app.router.lifespan_context(app):
        if wait:
            await asyncio.wait_for(app.state.dashboards.ready.wait(), timeout=30)
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test", headers=headers
        ) as client:
            yield client
