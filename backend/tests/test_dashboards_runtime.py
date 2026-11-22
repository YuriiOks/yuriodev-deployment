"""The database seam: URL handling, migration retries, readiness and a rejected URL."""

import logging

import pytest

from src.core.errors import AppError
from src.dashboards.db import to_async_url
from src.dashboards.runtime import DashboardsRuntime, session_scope
from tests.dashboards_support import UNREACHABLE_URL

SUMMARY = "/api/dashboards/v1/summary"


def test_postgres_urls_become_asyncpg_urls():
    for url in (
        "postgresql://u:p@h:5432/d",
        "postgres://u:p@h:5432/d",
        "postgresql+asyncpg://u:p@h:5432/d",
    ):
        parsed = to_async_url(url)

        assert parsed.drivername == "postgresql+asyncpg"
        assert (parsed.host, parsed.port, parsed.database) == ("h", 5432, "d")
        assert parsed.password == "p"


def test_other_urls_are_refused_without_quoting_them():
    with pytest.raises(ValueError, match="postgresql") as raised:
        to_async_url("mysql://user:hunter2-password@host/db")

    assert "hunter2" not in str(raised.value)


@pytest.mark.anyio
async def test_migrations_are_retried_with_growing_delays_until_one_works(caplog):
    caplog.set_level(logging.DEBUG)
    calls = []
    sleeps = []

    def migrate(url):
        calls.append(url)
        if len(calls) <= 7:
            raise ConnectionRefusedError("refused for user dashboards password pw-unreachable")

    async def sleep(delay):
        sleeps.append(delay)

    runtime = DashboardsRuntime(UNREACHABLE_URL, migrate=migrate, sleep=sleep)
    try:
        assert not runtime.ready.is_set()
        await runtime.migrate_until_ready()

        assert runtime.ready.is_set()
        assert len(calls) == 8
        assert sleeps == [1.0, 2.0, 4.0, 8.0, 16.0, 30.0, 30.0]
    finally:
        await runtime.close()

    failures = [r for r in caplog.records if getattr(r, "event", "") == "dashboards.migrate_failed"]
    assert len(failures) == 7
    assert {r.error for r in failures} == {"ConnectionRefusedError"}
    assert [r.attempt for r in failures] == [1, 2, 3, 4, 5, 6, 7]
    assert any(getattr(r, "event", "") == "dashboards.ready" for r in caplog.records)
    # Only the class is logged: a driver message can hold the host, user or password.
    assert "pw-unreachable" not in " ".join(str(vars(r)) for r in caplog.records)


async def open_session(runtime):
    async with session_scope(runtime):
        pass


@pytest.mark.anyio
async def test_a_session_is_refused_until_the_schema_is_ready():
    runtime = DashboardsRuntime(UNREACHABLE_URL)
    try:
        with pytest.raises(AppError) as raised:
            await open_session(runtime)
        assert (raised.value.status, raised.value.code) == (503, "dashboards_unavailable")

        with pytest.raises(AppError):
            await open_session(None)

        runtime.ready.set()
        await open_session(runtime)  # opening a session does not connect yet
    finally:
        await runtime.close()


def test_a_rejected_url_leaves_the_api_unavailable_and_is_never_logged(make_client, caplog):
    caplog.set_level(logging.DEBUG)
    client = make_client(
        database_url="mysql://user:hunter2-password@host/db", dashboards_trust_proxy_auth=True
    )

    assert client.get("/health").status_code == 200
    for path in (SUMMARY, "/api/dashboards/v1/bootstrap"):
        response = client.get(path)
        assert response.status_code == 503
        assert response.json()["error"] == "dashboards_unavailable"
    assert client.post("/api/mcp").status_code == 503
    events = [getattr(r, "event", "") for r in caplog.records]
    assert "dashboards.misconfigured" in events
    assert "hunter2" not in " ".join(str(vars(r)) for r in caplog.records)
