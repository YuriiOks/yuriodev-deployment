"""Lifespan: the feed is wired in without ever blocking or crashing startup."""

import asyncio
import logging

import pytest

from src.app import _log_task_exit
from src.feed.service import FeedService


def test_a_failing_fixture_load_does_not_stop_startup(make_client, monkeypatch, caplog):
    async def boom(self):
        raise RuntimeError("fixture broken")

    monkeypatch.setattr(FeedService, "refresh_once", boom)
    client = make_client(social_feed_enabled=True)

    assert client.get("/health").status_code == 200
    assert client.get("/api/posts").json()["source"]["status"] == "error"
    assert any(getattr(r, "event", "") == "feed.crash" for r in caplog.records)


def test_the_feed_is_on_app_state_and_no_http_client_without_polling(make_client):
    client = make_client(social_feed_enabled=True)

    assert client.app.state.http is None
    assert client.app.state.feed.provider_name == "fixture"


@pytest.mark.anyio
async def test_a_dead_background_task_is_logged(caplog):
    async def die():
        raise RuntimeError("poller crashed")

    task = asyncio.ensure_future(die())
    with pytest.raises(RuntimeError):
        await task
    _log_task_exit(task)

    (record,) = [r for r in caplog.records if getattr(r, "event", "") == "task.died"]
    assert record.levelno == logging.ERROR


@pytest.mark.anyio
async def test_a_cancelled_task_is_not_logged(caplog):
    task = asyncio.ensure_future(asyncio.sleep(10))
    await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    _log_task_exit(task)

    assert not [r for r in caplog.records if getattr(r, "event", "") == "task.died"]
