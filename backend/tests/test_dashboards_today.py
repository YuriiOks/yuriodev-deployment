"""The Today view of each page: queue rules, soon, stats, breakdown, today's rows. Invented data."""

import json
import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from mcp import Client

from src.dashboards.finance.models import Account, Connection
from src.dashboards.models import Event, Task
from src.dashboards.today import (
    QUEUE_MAX,
    meeting_minutes,
    personal_queue,
    week_start,
    work1_queue,
    work2_queue,
)
from tests.dashboards_support import AUTH, execute, running
from tests.finance_support import seed, seed_rates

pytestmark = pytest.mark.anyio

BASE = "/api/dashboards/v1"
NOW = datetime(2026, 11, 22, 12, 0, tzinfo=UTC)  # a Sunday
TODAY = date(2026, 11, 22)


def task(title, space="personal", **extra):
    values = {
        "space_id": space,
        "title": title,
        "created_at": NOW - timedelta(days=10),
        "status": "open",  # what the database would fill in
        "priority": False,
        "draft": False,
        "source": "web",
    }
    return Task(id=uuid.uuid4(), **{**values, **extra})


def event(title, start, minutes, space="personal"):
    return Event(
        id=uuid.uuid4(),
        space_id=space,
        title=title,
        starts_at=start,
        ends_at=start + timedelta(minutes=minutes),
    )


async def add(app, *rows):
    async with app.state.dashboards.sessions() as session, session.begin():
        session.add_all(rows)


async def page(client, scope):
    response = await client.get(f"{BASE}/today?scope={scope}")
    assert response.status_code == 200, response.text
    return response.json()


def titles(items):
    return [item["subject"]["name"] for item in items]


def names(items):
    return [item.subject.name for item in items]


# ---- the pure rules ---------------------------------------------------------------------------


def test_the_personal_queue_is_overdue_then_today_then_priority_then_soon():
    tasks = [
        task("Far", due_date=TODAY + timedelta(days=9)),
        task("Soon", due_date=TODAY + timedelta(days=2)),
        task("Priority", priority=True),
        task("Today", due_date=TODAY),
        task("Late", due_date=TODAY - timedelta(days=5)),
        task("Later", due_date=TODAY - timedelta(days=1)),
        task("Undated"),
        task("Done", status="done", due_date=TODAY),
    ]

    queue, total = personal_queue(tasks, TODAY, NOW)

    assert names(queue) == ["Late", "Later", "Today"]  # three at most, in that order
    assert total == 5  # Late, Later, Today, Priority and Soon qualify: only three are shown
    assert [i.facts["reason"] for i in queue] == ["overdue", "overdue", "due_today"]
    assert queue[0].facts["days_overdue"] == 5


def test_a_task_counts_once_under_the_first_rule_that_takes_it():
    tasks = [task("Both", priority=True, due_date=TODAY), task("Plain")]

    queue, total = personal_queue(tasks, TODAY, NOW)

    assert (names(queue), total) == (["Both"], 1)
    assert queue[0].facts["reason"] == "due_today"


def test_work_2_takes_only_its_priority_tasks_and_those_due_today():
    tasks = [
        task("Late", "work-2", due_date=TODAY - timedelta(days=2)),
        task("Tomorrow", "work-2", due_date=TODAY + timedelta(days=1)),
        task("Today", "work-2", due_date=TODAY),
        task("Key", "work-2", priority=True),
    ]

    queue, total = work2_queue(tasks, TODAY, NOW)

    assert (names(queue), total) == (["Today", "Key"], 2)


def pr(title, hours, **extra):
    values = {"source": "github", "stage": "review", "url": "https://example.test/pr/1"}
    return task(title, "work-1", created_at=NOW - timedelta(hours=hours), **{**values, **extra})


def issue(title, priority, idle_days, stage="started"):
    return task(
        title,
        "work-1",
        source="linear",
        stage=stage,
        source_priority=priority,
        source_updated_at=NOW - timedelta(days=idle_days),
        url="https://example.test/issue/1",
    )


def test_work_1_puts_the_longest_waiting_review_first_then_stuck_urgent_issues():
    tasks = [
        pr("New review", 5),
        pr("Old review", 60),
        pr("A draft", 90, draft=True),
        issue("Stuck urgent", "urgent", 6),
        issue("Moving urgent", "urgent", 1),
        issue("Stuck medium", "medium", 9),
        issue("Stuck high", "high", 4),
        task("Mine", "work-1", priority=True),
    ]

    queue, total = work1_queue(tasks, TODAY, NOW)

    assert names(queue) == ["Old review", "New review", "Stuck urgent"]
    assert total == 5  # two reviews, two stuck issues (urgent first), one priority task
    assert [i.kind for i in queue] == ["pull_request", "pull_request", "issue"]
    assert queue[0].primary == "open_external"
    assert queue[0].link.url == "https://example.test/pr/1"


def test_meeting_minutes_split_an_event_over_midnight():
    zone = UTC
    late = event("Late", datetime(2026, 11, 17, 23, 0, tzinfo=UTC), 120)

    minutes = meeting_minutes([late], [date(2026, 11, 17), date(2026, 11, 18)], zone)

    assert minutes == {date(2026, 11, 17): 60, date(2026, 11, 18): 60}
    assert week_start(TODAY) == date(2026, 11, 16)
    assert QUEUE_MAX == 3


# ---- the pages --------------------------------------------------------------------------------


async def test_the_personal_page_has_every_part(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await add(
            app,
            task("Late", due_date=TODAY - timedelta(days=3), area_id="money"),
            task("Today", due_date=TODAY, area_id="money"),
            task("Key", priority=True, area_id="health-sport"),
            task("Soon", due_date=TODAY + timedelta(days=2)),
            task("Next", due_date=TODAY + timedelta(days=20)),
            task("Old A", area_id="health-sport", created_at=NOW - timedelta(days=60)),
            task("Old B", area_id="health-sport", created_at=NOW - timedelta(days=50)),
            task("Old C", area_id="health-sport", created_at=NOW - timedelta(days=40)),
            task("Done now", status="done", done_at=NOW - timedelta(days=1)),
            task("Done before", status="done", done_at=NOW - timedelta(days=2)),
            task("Done last week", status="done", done_at=NOW - timedelta(days=8)),
            event("Lesson", NOW + timedelta(hours=5), 60),
        )
        body = await page(client, "personal")

    assert (body["scope"], body["date"]) == ("personal", "2026-11-22")
    assert body["summary"]["code"] == "personal"
    assert body["summary"]["facts"]["open"] == 8
    assert body["summary"]["facts"]["next_event"]["title"] == "Lesson"
    assert titles(body["queue"]) == ["Late", "Today", "Key"]
    assert body["queue_total"] == 4
    assert titles(body["soon"]) == ["Soon", "Next"]  # not the ones already in the queue
    opened, closed = body["stats"]
    assert (opened["code"], opened["value"], opened["facts"]["priority"]) == ("open_tasks", 8, 1)
    assert opened["facts"]["without_date"] == 4
    assert (closed["code"], closed["value"]) == ("closed_this_week", 2)
    assert closed["compare"] == {"code": "closed_last_week", "value": 1}
    rows = body["breakdown"]["rows"]
    assert body["breakdown"]["code"] == "open_by_area"
    assert (rows[0]["key"], rows[0]["value"]) == ("health-sport", 4)
    assert rows[0]["label"]["en"] == "Health and sport"
    assert body["breakdown"]["insight"] == {
        "code": "stale_area",
        "facts": {"area_id": "health-sport", "count": 3, "older_than_days": 30},
    }
    assert [r["subject"]["name"] for r in body["today"]] == ["Lesson"]
    assert body["assistant"] == {"enabled": False}
    assert "queue_title" not in body  # no sentence anywhere: only codes and facts


async def test_work_1_counts_reviews_and_issues_by_stage(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await add(
            app,
            pr("Review A", 50),
            pr("Review B", 3),
            pr("Review C", 2),
            pr("Review D", 1),
            issue("Urgent", "urgent", 5),
            issue("High", "high", 1),
            issue("Next", "medium", 1, stage="unstarted"),
            issue("Later", "low", 1, stage="backlog"),
            task(
                "Mine",
                "work-1",
                source="github",
                stage="mine",
                source_updated_at=NOW - timedelta(days=3),
            ),
            event("Standup", NOW + timedelta(hours=1), 15, "work-1"),
        )
        body = await page(client, "work-1")

    reviews, progress = body["stats"]
    assert (reviews["code"], reviews["value"], reviews["facts"]["oldest_hours"]) == (
        "review_waiting",
        4,
        50,
    )
    assert (progress["value"], progress["facts"]["by_priority"]) == (2, {"urgent": 1, "high": 1})
    assert titles(body["queue"]) == ["Review A", "Review B", "Review C"]
    assert titles(body["soon"]) == ["Review D"]  # the other review requests
    assert [(r["key"], r["value"]) for r in body["breakdown"]["rows"]] == [
        ("started", 2),
        ("unstarted", 1),
        ("backlog", 1),
    ]
    assert body["breakdown"]["insight"] == {
        "code": "stalled_pull_requests",
        "facts": {"count": 1, "oldest_days": 3},
    }
    assert body["summary"]["facts"]["urgent"] == 1
    assert [r["subject"]["name"] for r in body["today"]] == ["Standup"]


async def test_work_2_is_manual_and_shows_the_week_in_meeting_minutes(db_url, make_dashboards_app):
    monday = datetime(2026, 11, 16, 10, 0, tzinfo=UTC)
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await add(
            app,
            task("Key", "work-2", priority=True),
            task("Today", "work-2", due_date=TODAY),
            task("Other space", "personal", priority=True),
            event("Monday sync", monday, 90, "work-2"),
            event("Friday sync", monday + timedelta(days=4), 30, "work-2"),
            event("Not mine", monday + timedelta(days=1), 600, "work-1"),
        )
        body = await page(client, "work-2")

    assert titles(body["queue"]) == ["Today", "Key"]
    assert body["breakdown"]["code"] == "meeting_minutes_by_day"
    assert [(r["key"], r["value"]) for r in body["breakdown"]["rows"]] == [
        ("2026-11-16", 90),
        ("2026-11-17", 0),
        ("2026-11-18", 0),
        ("2026-11-19", 0),
        ("2026-11-20", 30),
    ]
    assert body["assistant"] == {"enabled": False}
    # Sunday: no working day is left in the week, so there is no freest day to point to.
    assert body["breakdown"]["insight"] is None


async def test_the_freest_day_is_looked_for_among_the_days_still_ahead(
    db_url, make_dashboards_app, clock
):
    monday = datetime(2026, 11, 16, 10, 0, tzinfo=UTC)
    app = make_dashboards_app(db_url)
    clock.now = datetime(2026, 11, 18, 9, 0, tzinfo=UTC)  # a Wednesday
    async with running(app, AUTH) as client:
        await add(
            app,
            event("Mon", monday, 10, "work-2"),
            event("Wed", monday + timedelta(days=2), 120, "work-2"),
            event("Thu", monday + timedelta(days=3), 60, "work-2"),
        )
        body = await page(client, "work-2")

    assert body["breakdown"]["insight"] == {
        "code": "freest_day",
        "facts": {"date": "2026-11-20", "minutes": 0},
    }


async def test_the_money_page_is_the_attention_items_the_next_payments_and_the_banks(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await seed_rates(app)
        await client.post(
            f"{BASE}/finance/recurring",
            json={
                "name": "Big Rent",
                "amount": 500_000,
                "currency": "UAH",
                "next_payment_date": "2026-11-25",
                "account_id": "00000000-0000-0000-0000-00000000000a",
            },
        )
        body = await page(client, "money")

    summary = body["summary"]
    assert summary["code"] == "money"
    assert summary["facts"]["currency"] == "GBP"
    assert summary["facts"]["large_payment"]["name"] == "Big Rent"
    assert summary["facts"]["days_to_large_payment"] == 3
    assert body["queue_total"] == summary["facts"]["queue_total"]
    assert len(body["queue"]) <= 3
    assert titles(body["soon"]) == ["Big Rent"]
    spent, due = body["stats"]
    assert (spent["code"], spent["compare"]["code"]) == ("spent_month_to_date", "previous_to_date")
    assert (due["code"], due["facts"]["count"]) == ("due_in_14_days", 1)
    assert body["breakdown"]["code"] == "spent_by_category"
    assert len(body["breakdown"]["rows"]) <= 4
    assert {r["kind"] for r in body["today"]} == {"connection"}
    assert body["today"][0]["facts"]["balances"]


async def test_money_queue_items_carry_action_codes_and_a_link(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await client.post(
            f"{BASE}/finance/recurring",
            json={
                "name": "Gym",
                "amount": 1_000,
                "currency": "UAH",
                "next_payment_date": "2026-11-18",
                "account_id": "00000000-0000-0000-0000-00000000000a",
            },
        )
        body = await page(client, "money")

    missed = next(i for i in body["queue"] if i["kind"] == "missed_payment")
    assert (missed["primary"], missed["secondary"]) == ("mark_paid", "open_payment")
    assert missed["link"]["kind"] == "payment"
    assert missed["subject"]["name"] == "Gym"
    assert set(missed) == {"key", "kind", "subject", "facts", "primary", "secondary", "link"}


async def test_an_unknown_scope_is_refused_and_the_page_is_behind_the_gate(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        unknown = await client.get(f"{BASE}/today?scope=work-3")
        missing = await client.get(f"{BASE}/today")
        wrong = {"X-Dashboards-Token": "no"}
        anonymous = await client.get(f"{BASE}/today?scope=money", headers=wrong)

    assert (unknown.status_code, missing.status_code, anonymous.status_code) == (422, 422, 401)
    assert unknown.json()["fields"] == ["scope"]


async def test_the_same_page_comes_from_the_mcp_tool(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as http:
        await add(app, task("Late", due_date=TODAY - timedelta(days=1)))
        async with Client(app.state.mcp) as mcp:
            result = await mcp.call_tool("today", {"scope_name": "personal"})
            old = await mcp.call_tool("today", {"space": "personal"})
        rest = await page(http, "personal")

    answer = json.loads(result.content[0].text)
    assert titles(answer["queue"]) == titles(rest["queue"]) == ["Late"]
    assert "spaces" in json.loads(old.content[0].text)  # the older call is unchanged


async def test_the_owner_name_is_in_the_bootstrap_and_every_headline_when_set(
    db_url, make_dashboards_app
):
    named = make_dashboards_app(db_url, dashboards_owner_name="  Sam \n Example  ")
    async with running(named, AUTH) as client:
        bootstrap = (await client.get(f"{BASE}/bootstrap")).json()
        facts = {s: (await page(client, s))["summary"]["facts"] for s in ("personal", "money")}

    assert bootstrap["owner_name"] == "Sam Example"
    assert {f["owner_name"] for f in facts.values()} == {"Sam Example"}


async def test_without_an_owner_name_the_field_is_null(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        bootstrap = (await client.get(f"{BASE}/bootstrap")).json()
        body = await page(client, "work-1")

    assert bootstrap["owner_name"] is None
    assert body["summary"]["facts"]["owner_name"] is None


def test_the_owner_name_is_one_short_printable_line(make_settings):
    assert make_settings(dashboards_owner_name="  ").owner_name is None
    assert make_settings().owner_name is None
    assert make_settings(dashboards_owner_name="A\x07B" + "x" * 80).owner_name == "AB" + "x" * 58


async def bank(app, name, ref, manual=False, status="ok", read=None, balance_at=NOW):
    link = Connection(
        id=uuid.uuid4(),
        provider="sample",
        ref=ref,
        status=status,
        last_ok_at=read,
        manual=manual,
        display_name=name,
    )
    held = Account(
        id=uuid.uuid4(),
        connection_id=link.id,
        provider="sample",
        external_id=ref,
        name=name,
        currency="GBP",
        balance=100,
        balance_at=balance_at,
        created_at=NOW,
    )
    async with app.state.dashboards.sessions() as session, session.begin():
        session.add(link)
        await session.flush()
        session.add(held)


async def test_the_banks_are_ordered_by_need_then_by_when_they_were_read_or_entered(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    hours = timedelta(hours=1)
    async with running(app, AUTH) as client:
        await bank(app, "Zed Manual Old", "m1", manual=True, balance_at=NOW - 10 * hours)
        await bank(app, "Amy Manual New", "m2", manual=True, balance_at=NOW - hours)
        await bank(app, "Bank Two Hours", "a", read=NOW - 2 * hours)
        await bank(app, "Bank One Hour", "b", read=NOW - hours)
        await bank(app, "Broken", "f", status="paused", read=NOW - 30 * hours)
        top = await page(client, "money")

        await execute(db_url, "DELETE FROM finance.account", "DELETE FROM finance.connection")
        await bank(app, "Zed Manual Old", "m1", manual=True, balance_at=NOW - 10 * hours)
        await bank(app, "Amy Manual New", "m2", manual=True, balance_at=NOW - hours)
        await bank(app, "Bank Two Hours", "a", read=NOW - 2 * hours)
        few = await page(client, "money")

    assert [r["subject"]["name"] for r in top["today"]] == [
        "Broken",
        "Bank One Hour",
        "Bank Two Hours",
    ]
    assert top["today_total"] == 5
    assert [r["subject"]["name"] for r in few["today"]] == [
        "Bank Two Hours",
        "Amy Manual New",
        "Zed Manual Old",
    ]
    assert few["today_total"] == 3
