"""Shared fixtures.

Every test builds its own Settings and app (no module singleton), with the Settings
variables of the surrounding environment removed, so the suite gives the same result with
no env file and inside a container started from any env/<env>.env.
"""

import logging
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from src.app import create_app
from src.core.config import Settings, get_settings

SETTINGS_ENV_VARS = tuple(name.upper() for name in Settings.model_fields)
_LOGGERS = ("", "uvicorn", "uvicorn.error", "uvicorn.access", "httpx", "httpcore")


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
