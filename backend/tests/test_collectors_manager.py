"""The collector loop: isolation, the cross-process lock, rate-limit pauses, logs and wiring."""

import asyncio
import contextlib
import logging
from datetime import timedelta

import httpx
import pytest
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from src.core.http import UpstreamError
from src.dashboards.collectors.base import ExternalItem
from src.dashboards.collectors.manager import LOCK, CollectorManager, build_collectors
from src.dashboards.collectors.sync import TaskCollector
from src.dashboards.db import to_async_url
from tests.collectors_support import REPO, issue, issues_page, json_response, pr, search_page
from tests.dashboards_support import AUTH, CRED, running

pytestmark = pytest.mark.anyio

BASE = "/api/dashboards/v1"
GH_KEY = "gh-test-key"  # a name without "token": ruff S106 reads it as a password
LIN_KEY = "lin-test-key"
SENTINEL_TITLE = "TITLE-SENTINEL-6120"
SENTINEL_URL = "https://example.test/URL-SENTINEL-6120?token=QUERY-SENTINEL-6120"


class FakeCollector(TaskCollector):
    """A collector that returns canned items, or raises what it is told to."""

    def __init__(self, name, items=(), error=None, source=None, space="work-1"):
        self.name = name
        self.source = source or name
        self.space = space
        self.items = list(items)
        self.error = error
        self.calls = 0

    async def fetch(self, client):
        self.calls += 1
        if self.error is not None:
            raise self.error
        return list(self.items)


def make_item(number, title=SENTINEL_TITLE):
    return ExternalItem(f"ref-{number}", title, SENTINEL_URL)


def manager_for(app, collectors, clock, **kwargs):
    kwargs.setdefault("interval", 1)
    return CollectorManager(app.state.dashboards, collectors, httpx.AsyncClient(), clock, **kwargs)


async def titles(client, space="work-1"):
    response = await client.get(f"{BASE}/spaces/{space}/tasks", params={"status": "all"})
    return [task["title"] for task in response.json()["tasks"]]


def records(caplog, event):
    return [r for r in caplog.records if getattr(r, "event", "") == event]


async def test_a_tick_syncs_every_collector(db_url, make_dashboards_app, clock, caplog):
    caplog.set_level(logging.DEBUG)
    app = make_dashboards_app(db_url)
    first = FakeCollector("github", [make_item(1, "First one")], source="github")
    second_items = [make_item(2, "Second one")]
    second = FakeCollector("linear", second_items, source="linear", space="personal")
    async with running(app, AUTH) as client:
        manager = manager_for(app, [first, second], clock)
        await manager.tick()
        work = await titles(client)
        personal = await titles(client, "personal")

    assert work == ["First one"]
    assert personal == ["Second one"]
    assert manager.ticks == 1
    synced = records(caplog, "collector.synced")
    assert [(r.collector, r.fetched, r.added, r.closed) for r in synced] == [
        ("github", 1, 1, 0),
        ("linear", 1, 1, 0),
    ]


async def test_one_failing_collector_does_not_stop_the_others(
    db_url, make_dashboards_app, clock, caplog
):
    caplog.set_level(logging.DEBUG)
    app = make_dashboards_app(db_url)
    broken = FakeCollector("github", error=RuntimeError(f"bug mentioning {SENTINEL_TITLE}"))
    upstream = FakeCollector("linear", error=UpstreamError("http_5xx", 502))
    healthy = FakeCollector("third", [make_item(3, "Still here")], source="github")
    async with running(app, AUTH) as client:
        manager = manager_for(app, [broken, upstream, healthy], clock)
        await manager.tick()
        listed = await titles(client)

    assert listed == ["Still here"]
    (failed,) = records(caplog, "collector.failed")
    assert (failed.collector, failed.error) == ("github", "RuntimeError")
    (refused,) = records(caplog, "collector.upstream_error")
    assert (refused.collector, refused.kind, refused.status) == ("linear", "http_5xx", 502)
    assert SENTINEL_TITLE not in "\n".join([caplog.text, str([vars(r) for r in caplog.records])])


async def test_logs_carry_names_and_counts_only(db_url, make_dashboards_app, clock, caplog):
    caplog.set_level(logging.DEBUG)
    app = make_dashboards_app(db_url, log_level="DEBUG")
    collector = FakeCollector("github", [make_item(1)], source="github")
    async with running(app, AUTH):
        await manager_for(app, [collector], clock).tick()

    logged = "\n".join([caplog.text, str([vars(r) for r in caplog.records])])
    assert "collector.synced" in logged
    for secret in (SENTINEL_TITLE, "URL-SENTINEL", "QUERY-SENTINEL", CRED):
        assert secret not in logged, secret


async def test_a_rate_limited_collector_is_left_alone_until_the_time_it_asked_for(
    db_url, make_dashboards_app, clock, caplog
):
    caplog.set_level(logging.DEBUG)
    app = make_dashboards_app(db_url)
    limited = UpstreamError("rate_limited", 429, {"retry-after": "600"})
    collector = FakeCollector("github", [make_item(1)], error=limited, source="github")
    async with running(app, AUTH) as client:
        manager = manager_for(app, [collector], clock)
        await manager.tick()
        await manager.tick()
        clock.now += timedelta(seconds=599)
        await manager.tick()
        during = collector.calls
        collector.error = None
        clock.now += timedelta(seconds=2)
        await manager.tick()
        listed = await titles(client)
        await manager.tick()

    assert during == 1
    assert collector.calls == 3
    assert listed == [SENTINEL_TITLE]
    (limited_log,) = records(caplog, "collector.upstream_error")
    assert limited_log.paused_s == 600
    assert len(records(caplog, "collector.paused")) == 2


async def test_a_collector_that_runs_closes_what_is_no_longer_open(
    db_url, make_dashboards_app, clock
):
    app = make_dashboards_app(db_url)
    collector = FakeCollector("github", [make_item(1, "One"), make_item(2, "Two")], source="github")
    async with running(app, AUTH) as client:
        manager = manager_for(app, [collector], clock)
        await manager.tick()
        collector.items = [make_item(2, "Two")]
        await manager.tick()
        response = await client.get(f"{BASE}/spaces/work-1/tasks", params={"status": "done"})

    assert [task["title"] for task in response.json()["tasks"]] == ["One"]


async def hold_lock(url):
    """A second 'process': a connection that holds the collectors' advisory lock."""
    engine = create_async_engine(to_async_url(url), poolclass=NullPool)
    connection = await engine.connect()
    assert (await connection.execute(LOCK)).scalar_one() is True
    return engine, connection


async def test_only_one_process_polls_at_a_time(db_url, make_dashboards_app, clock, caplog):
    caplog.set_level(logging.DEBUG)
    app = make_dashboards_app(db_url)
    collector = FakeCollector("github", [make_item(1)], source="github")
    async with running(app, AUTH) as client:
        manager = manager_for(app, [collector], clock)
        engine, connection = await hold_lock(db_url)
        try:
            await manager.tick()
            skipped_calls = collector.calls
            skipped_titles = await titles(client)
        finally:
            await connection.close()
            await engine.dispose()
        await manager.tick()

    assert skipped_calls == 0
    assert skipped_titles == []
    assert collector.calls == 1
    assert len(records(caplog, "collectors.skipped")) == 1
    assert manager.ticks == 2


async def test_the_lock_is_released_after_every_tick(db_url, make_dashboards_app, clock):
    app = make_dashboards_app(db_url)
    collector = FakeCollector("github", error=RuntimeError("boom"), source="github")
    async with running(app, AUTH):
        manager = manager_for(app, [collector], clock)
        await manager.tick()
        await manager.tick()
        engine, connection = await hold_lock(db_url)  # fails the assert if the lock is still held
        await connection.close()
        await engine.dispose()

    assert collector.calls == 2


async def test_the_loop_ticks_every_interval_and_survives_a_failed_tick(
    db_url, make_dashboards_app, clock, caplog, monkeypatch
):
    caplog.set_level(logging.DEBUG)
    app = make_dashboards_app(db_url)
    collector = FakeCollector("github", [make_item(1)], source="github")
    sleeps = []

    class Stop(BaseException):
        pass

    async def sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) == 3:
            raise Stop

    async with running(app, AUTH):
        manager = manager_for(app, [collector], clock, interval=42, sleep=sleep)
        real_tick = manager.tick
        outcomes = iter([RuntimeError("tick bug"), None, None])

        async def flaky_tick():
            outcome = next(outcomes)
            if outcome is not None:
                raise outcome
            await real_tick()

        monkeypatch.setattr(manager, "tick", flaky_tick)
        with pytest.raises(Stop):
            await manager.run_forever()

    assert sleeps == [42, 42, 42]
    assert collector.calls == 2
    (failed,) = records(caplog, "collectors.tick_failed")
    assert failed.error == "RuntimeError"
    assert "tick bug" not in caplog.text


async def test_the_loop_waits_for_the_schema(db_url, make_dashboards_app, clock):
    app = make_dashboards_app(db_url)
    collector = FakeCollector("github", [make_item(1)], source="github")
    async with running(app, AUTH):
        manager = manager_for(app, [collector], clock)
        app.state.dashboards.ready.clear()
        task = asyncio.create_task(manager.run_forever())
        await asyncio.sleep(0.2)
        before = collector.calls
        app.state.dashboards.ready.set()
        await asyncio.wait_for(manager.ticked.wait(), timeout=30)
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    assert before == 0
    assert manager.describe() == ["github"]


def upstream(request: httpx.Request) -> httpx.Response:
    """Canned answers for both services, by host."""
    if request.url.host == "api.github.com":
        if request.url.path == "/user/teams":
            return json_response([])
        query = request.url.params["q"]
        if "reviewed-by" in query:
            return search_page([])
        return search_page([pr(11, "Mine")] if "author:@me" in query else [pr(12, "Theirs")])
    if request.url.host == "api.linear.app":
        return issues_page([issue(5, "Assigned", due="2026-12-24")])
    return json_response({}, 404)


async def test_the_app_starts_the_collectors_when_tokens_are_set(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url, github_token=GH_KEY, linear_api_key=LIN_KEY)
    app.state.collector_transport = httpx.MockTransport(upstream)
    async with running(app, AUTH) as client:
        assert app.state.collectors.describe() == ["github", "linear"]
        await asyncio.wait_for(app.state.collectors.ticked.wait(), timeout=30)
        listed = (await client.get(f"{BASE}/spaces/work-1/tasks")).json()["tasks"]

    by_title = {task["title"]: task for task in listed}
    assert sorted(by_title) == ["ENG-5: Assigned", "PR #11: Mine", "Review PR #12: Theirs"]
    assert by_title["PR #11: Mine"]["url"] == f"https://github.com/{REPO}/pull/11"
    assert by_title["PR #11: Mine"]["source"] == "github"
    assert by_title["ENG-5: Assigned"]["due_date"] == "2026-12-24"
    assert by_title["ENG-5: Assigned"]["source"] == "linear"


async def test_a_collector_without_its_credential_is_not_started(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url, linear_api_key=LIN_KEY, linear_space="personal")
    app.state.collector_transport = httpx.MockTransport(upstream)
    async with running(app, AUTH) as client:
        assert app.state.collectors.describe() == ["linear"]
        await asyncio.wait_for(app.state.collectors.ticked.wait(), timeout=30)
        personal = (await client.get(f"{BASE}/spaces/personal/tasks")).json()["tasks"]
        work = (await client.get(f"{BASE}/spaces/work-1/tasks")).json()["tasks"]

    assert [task["title"] for task in personal] == ["ENG-5: Assigned"]
    assert work == []


async def test_no_collectors_without_credentials(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH):
        assert app.state.collectors is None


def test_no_collectors_without_a_database(make_client):
    client = make_client(github_token=GH_KEY, linear_api_key=LIN_KEY)

    assert client.app.state.collectors is None
    assert client.app.state.dashboards is None


def test_the_collectors_follow_the_credentials_that_are_set(make_settings):
    both = build_collectors(make_settings(github_token=GH_KEY, linear_api_key=LIN_KEY))
    only_linear = build_collectors(make_settings(linear_api_key=LIN_KEY))

    assert [collector.name for collector in both] == ["github", "linear"]
    assert [collector.name for collector in only_linear] == ["linear"]
    assert build_collectors(make_settings()) == []
