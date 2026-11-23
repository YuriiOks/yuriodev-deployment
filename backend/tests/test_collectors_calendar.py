"""The calendar collector end to end: a fake feed server, a real Postgres, the events API."""

import logging
from datetime import timedelta
from zoneinfo import ZoneInfo

import httpx
import pytest
from sqlalchemy.exc import IntegrityError

from src.core.http import UpstreamError
from src.dashboards.collectors.ical import CalendarCollector
from src.dashboards.collectors.manager import build_collectors
from tests.calendar_support import (
    ALL_DAY_PRIVATE,
    CANCELLED,
    DECLINED,
    FEED_URL,
    FLOATING,
    UTC_EVENT,
    WEEKLY,
    WEEKLY_CANCELLED,
    WEEKLY_MOVED,
    calendar,
    ics_response,
)
from tests.collectors_support import client_for
from tests.dashboards_support import AUTH, execute, running, scalar

pytestmark = pytest.mark.anyio

BASE = "/api/dashboards/v1"
LONDON = ZoneInfo("Europe/London")
SECOND_URL = "https://calendar.example.test/ical/OTHER-SECRET-8820/basic.ics"
FULL_FEED = calendar(
    WEEKLY, WEEKLY_MOVED, WEEKLY_CANCELLED, ALL_DAY_PRIVATE, FLOATING, UTC_EVENT, CANCELLED
)


def serving(body, **kwargs):
    return lambda request: ics_response(body, **kwargs)


async def poll(app, collector, handler, clock):
    async with client_for(handler) as http:
        return await collector.collect(http, app.state.dashboards.sessions, clock())


async def listed(client, start="2026-11-15", end="2026-12-31"):
    response = await client.get(f"{BASE}/events", params={"from": start, "to": end})
    return response.json()["events"]


def titles(events):
    return sorted(event["title"] for event in events)


async def test_a_feed_becomes_events_in_its_space(db_url, make_dashboards_app, clock):
    app = make_dashboards_app(db_url)
    collector = CalendarCollector("work-1", [FEED_URL], LONDON)
    async with running(app, AUTH) as client:
        counts = await poll(app, collector, serving(FULL_FEED), clock)
        events = await listed(client)

    expected = {"feeds": 1, "failed": 0, "fetched": 6, "created": 6, "updated": 0, "deleted": 0}
    assert counts == expected
    assert titles(events) == [
        "Day off",
        "Floating lunch",
        "Planning",
        "Weekly sync",
        "Weekly sync",
        "Weekly sync (moved)",
    ]
    assert {event["space_id"] for event in events} == {"work-1"}
    assert {event["source"] for event in events} == {"calendar"}
    day_off = next(event for event in events if event["title"] == "Day off")
    assert day_off["busy_only"] is True
    assert day_off["starts_at"] == "2026-11-24T00:00:00Z"
    assert day_off["ends_at"] == "2026-11-25T00:00:00Z"
    assert all(event["busy_only"] is False for event in events if event["title"] != "Day off")


async def test_polling_again_changes_nothing_and_an_edit_updates_in_place(
    db_url, make_dashboards_app, clock
):
    app = make_dashboards_app(db_url)
    collector = CalendarCollector("work-1", [FEED_URL], LONDON)
    async with running(app, AUTH) as client:
        await poll(app, collector, serving(calendar(UTC_EVENT)), clock)
        (before,) = await listed(client)
        clock.now += timedelta(hours=1)
        same = await poll(app, collector, serving(calendar(UTC_EVENT)), clock)
        renamed = [line.replace("Planning", "Planning, renamed") for line in UTC_EVENT]
        later = [line.replace("T150000Z", "T163000Z") for line in renamed]
        later = [line.replace("T160000Z", "T173000Z") for line in later]
        edit = await poll(app, collector, serving(calendar(later)), clock)
        (after,) = await listed(client)

    assert (same["created"], same["updated"], same["deleted"]) == (0, 0, 0)
    assert (edit["created"], edit["updated"], edit["deleted"]) == (0, 1, 0)
    assert after["id"] == before["id"]
    assert after["title"] == "Planning, renamed"
    assert after["starts_at"] == "2026-11-27T16:30:00Z"


async def test_an_event_that_left_the_feed_is_deleted_and_hand_made_ones_are_not(
    db_url, make_dashboards_app, clock
):
    app = make_dashboards_app(db_url)
    collector = CalendarCollector("work-1", [FEED_URL], LONDON)
    async with running(app, AUTH) as client:
        by_hand = {"title": "by hand", "starts_at": "2026-11-27T15:00:00Z"}
        by_hand["ends_at"] = "2026-11-27T16:00:00Z"
        await client.post(f"{BASE}/spaces/work-1/events", json=by_hand)
        await poll(app, collector, serving(calendar(UTC_EVENT, FLOATING)), clock)
        counts = await poll(app, collector, serving(calendar(UTC_EVENT)), clock)
        events = await listed(client)

    assert counts["deleted"] == 1
    assert titles(events) == ["Planning", "by hand"]
    assert {event["source"] for event in events} == {"calendar", "web"}


async def test_events_outside_the_window_and_in_other_spaces_are_left_alone(
    db_url, make_dashboards_app, clock
):
    app = make_dashboards_app(db_url)
    old = (
        "INSERT INTO event (id, space_id, title, starts_at, ends_at, source, source_ref) "
        "VALUES (gen_random_uuid(), 'work-1', 'old meeting', '2026-01-05T10:00:00Z', "
        "'2026-01-05T11:00:00Z', 'calendar', 'work-1|old@example.test|2026-01-05T10:00:00+00:00')"
    )
    personal = CalendarCollector("personal", [FEED_URL], LONDON)
    work = CalendarCollector("work-1", [FEED_URL], LONDON)
    async with running(app, AUTH) as client:
        await execute(db_url, old)
        await poll(app, personal, serving(calendar(UTC_EVENT)), clock)
        await poll(app, work, serving(calendar(UTC_EVENT)), clock)
        await poll(app, work, serving(calendar()), clock)
        mine = await listed(client)
        january = await listed(client, "2026-01-01", "2026-01-31")

    assert [(event["space_id"], event["title"]) for event in mine] == [("personal", "Planning")]
    assert titles(january) == ["old meeting"]


async def test_a_declined_event_is_skipped_when_the_owner_is_named(
    db_url, make_dashboards_app, clock
):
    app = make_dashboards_app(db_url)
    collector = CalendarCollector("work-1", [FEED_URL], LONDON, frozenset({"owner@example.test"}))
    async with running(app, AUTH) as client:
        await poll(app, collector, serving(calendar(DECLINED, UTC_EVENT)), clock)
        events = await listed(client)

    assert titles(events) == ["Planning"]


async def test_a_feed_that_fails_changes_nothing_and_says_why(
    db_url, make_dashboards_app, clock, caplog
):
    caplog.set_level(logging.DEBUG)
    app = make_dashboards_app(db_url)
    collector = CalendarCollector("work-1", [FEED_URL], LONDON)
    async with running(app, AUTH) as client:
        await poll(app, collector, serving(calendar(UTC_EVENT)), clock)
        with pytest.raises(UpstreamError) as raised:
            await poll(app, collector, lambda request: httpx.Response(503), clock)
        with pytest.raises(UpstreamError) as garbage:
            await poll(app, collector, serving(b"<html>sign in</html>"), clock)
        events = await listed(client)

    assert (raised.value.kind, raised.value.status) == ("http_5xx", 503)
    assert garbage.value.kind == "bad_ics"
    assert titles(events) == ["Planning"]
    failures = [r for r in caplog.records if getattr(r, "event", "") == "calendar.feed_failed"]
    assert [(r.feed, r.kind) for r in failures] == [(0, "http_5xx"), (0, "bad_ics")]
    assert "FEED-SECRET" not in caplog.text + str([vars(r) for r in caplog.records])


async def test_with_one_feed_down_the_other_still_updates_but_nothing_is_deleted(
    db_url, make_dashboards_app, clock
):
    app = make_dashboards_app(db_url)
    collector = CalendarCollector("work-1", [FEED_URL, SECOND_URL], LONDON)
    healthy = {FEED_URL: calendar(UTC_EVENT), SECOND_URL: calendar(FLOATING)}

    def one_down(request: httpx.Request) -> httpx.Response:
        if str(request.url) == SECOND_URL:
            return httpx.Response(500)
        return ics_response(healthy[FEED_URL])

    async with running(app, AUTH) as client:
        first = await poll(app, collector, lambda r: ics_response(healthy[str(r.url)]), clock)
        partial = await poll(app, collector, one_down, clock)
        events = await listed(client)

    assert (first["created"], first["failed"]) == (2, 0)
    assert (partial["failed"], partial["deleted"]) == (1, 0)
    assert titles(events) == ["Floating lunch", "Planning"]


async def test_the_same_event_in_two_feeds_of_a_space_is_one_event(
    db_url, make_dashboards_app, clock
):
    app = make_dashboards_app(db_url)
    collector = CalendarCollector("work-1", [FEED_URL, SECOND_URL], LONDON)
    async with running(app, AUTH) as client:
        counts = await poll(app, collector, serving(calendar(UTC_EVENT)), clock)
        events = await listed(client)

    assert (counts["fetched"], counts["created"]) == (1, 1)
    assert titles(events) == ["Planning"]


async def test_the_server_is_asked_conditionally_and_a_304_reuses_the_last_copy(
    db_url, make_dashboards_app, clock
):
    app = make_dashboards_app(db_url)
    collector = CalendarCollector("work-1", [FEED_URL], LONDON)
    seen = []
    stamps = {"etag": '"v7"', "last-modified": "Sun, 22 Nov 2026 10:00:00 GMT"}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.headers.get("if-none-match") == '"v7"':
            return httpx.Response(304)
        return ics_response(calendar(UTC_EVENT), headers=stamps)

    async with running(app, AUTH) as client:
        await poll(app, collector, handler, clock)
        clock.now += timedelta(minutes=5)
        again = await poll(app, collector, handler, clock)
        events = await listed(client)

    assert "if-none-match" not in seen[0].headers
    assert seen[1].headers["if-none-match"] == '"v7"'
    assert seen[1].headers["if-modified-since"] == "Sun, 22 Nov 2026 10:00:00 GMT"
    assert (again["fetched"], again["created"], again["updated"], again["deleted"]) == (1, 0, 0, 0)
    assert titles(events) == ["Planning"]


async def test_the_address_never_reaches_the_log_or_the_api(
    db_url, make_dashboards_app, clock, caplog
):
    caplog.set_level(logging.DEBUG)
    app = make_dashboards_app(db_url, log_level="DEBUG")
    collector = CalendarCollector("work-1", [FEED_URL], LONDON)
    async with running(app, AUTH) as client:
        await poll(app, collector, serving(calendar(UTC_EVENT)), clock)
        window = {"from": "2026-11-15", "to": "2026-12-31"}
        response = await client.get(f"{BASE}/events", params=window)
        events = response.text
        tasks = (await client.get(f"{BASE}/spaces/work-1/tasks")).text

    everything = caplog.text + str([vars(r) for r in caplog.records]) + events + tasks
    assert "FEED-SECRET" not in everything
    assert "calendar.example.test" not in everything


async def test_the_database_keeps_one_row_per_collected_event(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    row = (
        "INSERT INTO event (id, space_id, title, starts_at, ends_at, source, source_ref) "
        "VALUES (gen_random_uuid(), 'work-1', 'a', now(), now() + interval '1 hour', "
        "'calendar', 'work-1|x|y')"
    )
    async with running(app, AUTH):
        await execute(db_url, row)
        with pytest.raises(IntegrityError):
            await execute(db_url, row)
        assert await scalar(db_url, "SELECT count(*) FROM event") == 1


def test_calendar_collectors_are_built_per_space_with_usable_feeds_only(make_settings):
    settings = make_settings(
        calendar_ics_personal=f"{FEED_URL},http://not-https.example.test/a.ics",
        calendar_ics_work_1="http://only-bad.example.test/a.ics",
        calendar_owner_emails=" Owner@Example.test ,, mailto:Me@Example.test ",
    )

    built = build_collectors(settings)

    assert [collector.name for collector in built] == ["calendar-personal"]
    assert built[0]._owners == frozenset({"owner@example.test", "me@example.test"})
    assert built[0]._feeds == [FEED_URL]
    assert build_collectors(make_settings()) == []
