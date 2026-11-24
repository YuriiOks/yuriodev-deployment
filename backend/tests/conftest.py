"""Shared fixtures.

Every test builds its own Settings and app (no module singleton), with the Settings
variables of the surrounding environment removed, so the suite gives the same result with
no env file and inside a container started from any env/<env>.env.
"""

import asyncio
import logging
import os
from collections.abc import Callable, Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from src.app import create_app
from src.core.config import Settings, get_settings
from src.dashboards.db import run_migrations
from tests.dashboards_support import (
    CRED,
    TEST_DB_ENV,
    FakeClock,
    execute,
    fixed_clock,
    new_database_name,
    url_for,
)

# Projects keep their tasks in schemas of their own, which the app never drops; the tests do.
DROP_PROJECT_SCHEMAS = (
    "DO $$ DECLARE name text; BEGIN "
    "FOR name IN SELECT schema_name FROM information_schema.schemata "
    "WHERE schema_name LIKE 'project\\_%' LOOP "
    "EXECUTE format('DROP SCHEMA %I CASCADE', name); END LOOP; END $$"
)
SETTINGS_ENV_VARS = tuple(name.upper() for name in Settings.model_fields)
_LOGGERS = (
    "",
    "uvicorn",
    "uvicorn.error",
    "uvicorn.access",
    "httpx",
    "httpcore",
    "sqlalchemy",
    "mcp",
)


@pytest.fixture(autouse=True)
def _restore_global_state() -> Iterator[None]:
    """create_app() configures process-wide logging; put it back after each test."""
    saved = {
        name: (
            logging.getLogger(name).handlers[:],
            logging.getLogger(name).level,
            logging.getLogger(name).propagate,
        )
        for name in _LOGGERS
    }
    yield
    for name, (handlers, level, propagate) in saved.items():
        logger = logging.getLogger(name)
        logger.handlers[:] = handlers
        logger.setLevel(level)
        logger.propagate = propagate
    get_settings.cache_clear()


@pytest.fixture
def clean_env(tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    """No Settings variable from the surrounding environment reaches the test."""
    monkeypatch.chdir(tmp_path)
    for name in SETTINGS_ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


@pytest.fixture
def make_settings(clean_env: pytest.MonkeyPatch) -> Callable[..., Settings]:
    def _make(**overrides: Any) -> Settings:
        return Settings(_env_file=None, **overrides)

    return _make


@pytest.fixture
def make_client(make_settings: Callable[..., Settings]) -> Iterator[Callable[..., TestClient]]:
    """Build a started TestClient (lifespan run) for an app with the given settings."""
    clients: list[TestClient] = []

    def _make(**overrides: Any) -> TestClient:
        client = TestClient(create_app(make_settings(**overrides)))
        client.__enter__()
        clients.append(client)
        return client

    yield _make
    for client in clients:
        client.__exit__(None, None, None)


@pytest.fixture
def client(make_client: Callable[..., TestClient]) -> TestClient:
    return make_client(environment="test", revision="abc1234")


@pytest.fixture
def anyio_backend() -> str:
    """Async tests run on asyncio only (anyio's pytest plugin ships with starlette)."""
    return "asyncio"


# Dashboards: a real Postgres, named by DASHBOARDS_TEST_DATABASE_URL (CI starts one as a service
# container). Without it these tests skip. Each test run gets its own database, migrated once
# with the app's own migration runner; every test starts with empty task and event tables.


@pytest.fixture(scope="session")
def pg_server_url() -> str:
    url = os.environ.get(TEST_DB_ENV, "").strip()
    if not url:
        pytest.skip(f"{TEST_DB_ENV} is not set: no Postgres for the dashboards tests")
    return url


@pytest.fixture(scope="session")
def migrated_db_url(pg_server_url: str) -> Iterator[str]:
    name = new_database_name()
    asyncio.run(execute(pg_server_url, f'CREATE DATABASE "{name}"'))
    url = url_for(pg_server_url, name)
    try:
        run_migrations(url)
        yield url
    finally:
        asyncio.run(execute(pg_server_url, f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))


@pytest.fixture
def db_url(migrated_db_url: str) -> str:
    # DELETE, not TRUNCATE: it does not wait for readers, so a leaked transaction cannot hang it.
    statements = (
        "DELETE FROM finance.attention_state",
        "DELETE FROM finance.recurring",
        "DELETE FROM finance.transaction",
        "DELETE FROM finance.account",
        "DELETE FROM finance.fx_rate",
        "DELETE FROM finance.monzo_token",
        "DELETE FROM finance.monzo_oauth_state",
        "DELETE FROM finance.connection",
        "DELETE FROM task",
        "DELETE FROM task_tombstone",
        "DELETE FROM event",
        DROP_PROJECT_SCHEMAS,
        "DELETE FROM project",
    )
    asyncio.run(execute(migrated_db_url, *statements))
    return migrated_db_url


@pytest.fixture
def clock() -> FakeClock:
    return fixed_clock()


async def fake_public_resolver(host: str) -> list[str]:
    """Every name is a public address (no test makes a DNS query)."""
    return ["93.184.216.34"]


@pytest.fixture
def make_dashboards_app(
    make_settings: Callable[..., Settings], clock: FakeClock
) -> Callable[..., Any]:
    """create_app() with the dashboards API on, a token configured and a fixed clock."""

    def _make(database_url: str, **overrides: Any) -> Any:
        values = {"database_url": database_url, "dashboards_api_token": CRED, **overrides}
        app = create_app(make_settings(**values), clock=clock)
        # No test reaches a real site: the icon fetch after a write meets a fake that has no icon.
        app.state.icon_transport = httpx.MockTransport(lambda request: httpx.Response(404))
        app.state.icon_resolver = fake_public_resolver
        app.state.icon_autostart = False  # the tests drain the worker by hand
        app.state.icons._pause = 0.0  # no waiting between payments in a test
        return app

    return _make
