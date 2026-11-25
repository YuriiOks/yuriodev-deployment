"""The streak of cleared queues: what a day's looks add up to, and what /today returns."""

import json
import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from mcp import Client
from sqlalchemy import select

from src.dashboards.models import QueueDay, Task
from src.dashboards.streak import record, state_of
from tests.dashboards_support import AUTH, running
from tests.finance_support import seed

pytestmark = pytest.mark.anyio

BASE = "/api/dashboards/v1"
WED = datetime(2026, 11, 18, 12, 0, tzinfo=UTC)
TODAY = WED.date()


def row(opened, cleared, empty, day=TODAY):
    return QueueDay(
        scope="personal", day=day, opened=opened, cleared_after_open=cleared, empty_now=empty
    )


def test_a_day_is_cleared_when_it_emptied_after_being_full_or_was_empty_at_every_look():
    assert state_of(None, TODAY, TODAY) == "no_data"
    assert state_of(None, TODAY + timedelta(days=1), TODAY) == "future"
    assert state_of(row(False, False, True), TODAY, TODAY) == "cleared"  # empty all day
    assert state_of(row(True, True, True), TODAY, TODAY) == "cleared"  # emptied
    assert state_of(row(True, True, False), TODAY, TODAY) == "cleared"  # emptied, then refilled
    assert state_of(row(True, False, False), TODAY, TODAY) == "open"


async def stored(app, scope="personal", day=TODAY):
    async with app.state.dashboards.sessions() as session:
        return await session.scalar(
            select(QueueDay).where(QueueDay.scope == scope, QueueDay.day == day)
        )


async def test_looks_at_the_queue_add_up_and_a_second_look_changes_nothing(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), app.state.dashboards.sessions() as session:
        await record(session, "personal", TODAY, 0, WED)
        first = await stored(app)
        first = (first.opened, first.cleared_after_open, first.empty_now)
        await record(session, "personal", TODAY, 0, WED)
        again = await stored(app)
        again = (again.opened, again.cleared_after_open, again.empty_now)
        await record(session, "personal", TODAY, 2, WED)
        full = await stored(app)
        full = (full.opened, full.cleared_after_open, full.empty_now)
        await record(session, "personal", TODAY, 0, WED)
        empty = await stored(app)
        empty = (empty.opened, empty.cleared_after_open, empty.empty_now)

    assert first == again == (False, False, True)  # empty at every look so far
    assert full == (True, False, False)  # a new item: open again
    assert empty == (True, True, True)  # emptied after having been full


def task(title, **extra):
    values = {"space_id": "personal", "title": title, "status": "open", "priority": False}
    return Task(id=uuid.uuid4(), created_at=WED - timedelta(days=3), **{**values, **extra})


async def page(client, scope="personal"):
    return (await client.get(f"{BASE}/today?scope={scope}")).json()


async def test_completing_the_last_item_clears_the_day_and_the_streak_counts_it(
    db_url, make_dashboards_app, clock
):
    clock.now = WED
    app = make_dashboards_app(db_url)
    mon, tue = TODAY - timedelta(days=2), TODAY - timedelta(days=1)
    async with running(app, AUTH) as client:
        async with app.state.dashboards.sessions() as session, session.begin():
            session.add_all(
                [
                    row(False, False, True, mon),
                    row(True, True, True, tue),
                    task("Late", due_date=TODAY - timedelta(days=1)),
                ]
            )
        before = await page(client)
        late_id = before["queue"][0]["subject"]["id"]
        done = await client.patch(f"{BASE}/tasks/{late_id}", json={"status": "done"})
        row_now = await stored(app)
        after = await page(client)

    assert before["streak"]["count"] == 2  # Monday and Tuesday; today is still open
    assert [d["state"] for d in before["streak"]["days"]] == [
        "cleared",
        "cleared",
        "open",
        "future",
        "future",
        "future",
        "future",
    ]
    assert done.status_code == 200
    assert (row_now.opened, row_now.cleared_after_open) == (True, True)  # written by the PATCH
    assert after["streak"]["count"] == 3
    assert after["streak"]["days"][2]["state"] == "cleared"
    assert after["queue_total"] == 0


async def test_a_day_nobody_looked_at_breaks_the_run_and_is_not_filled_in(
    db_url, make_dashboards_app, clock
):
    clock.now = WED
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        async with app.state.dashboards.sessions() as session, session.begin():
            session.add(row(True, True, True, TODAY - timedelta(days=2)))  # Monday only
        body = await page(client)  # nothing to do today: cleared

    states = [d["state"] for d in body["streak"]["days"]]
    assert states[:3] == ["cleared", "no_data", "cleared"]  # Tuesday: no look, nothing claimed
    assert body["streak"]["count"] == 1


async def test_every_page_has_a_streak_and_work_2_keeps_its_own(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        bodies = {scope: await page(client, scope) for scope in ("personal", "work-1", "work-2")}
        money = await page(client, "money")

    assert {b["streak"]["count"] for b in bodies.values()} == {1}
    assert money["streak"]["days"][6]["state"] in {"future", "cleared", "open"}


async def test_completing_a_task_through_mcp_records_the_day_too(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        async with app.state.dashboards.sessions() as session, session.begin():
            session.add(task("Late", due_date=TODAY - timedelta(days=30)))
        await page(client)
        late = (await page(client))["queue"][0]["subject"]["id"]
        async with Client(app.state.mcp) as mcp:
            result = await mcp.call_tool("complete_task", {"id": late})
        recorded = await stored(app, "personal", app.state.clock().date())

    assert json.loads(result.content[0].text)["status"] == "done"
    assert recorded is not None
    assert recorded.cleared_after_open is True


async def test_deciding_an_attention_item_looks_at_the_money_queue_again(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        first = await page(client, "money")
        keys = [item["key"] for item in first["queue"]]
        if keys:
            await client.post(
                f"{BASE}/finance/attention/bulk", json={"keys": keys, "action": "dismiss"}
            )
        later = await page(client, "money")

    assert later["queue_total"] <= first["queue_total"]
    assert first["date"] == later["date"] == str(date(2026, 11, 22))
