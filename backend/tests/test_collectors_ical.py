"""Reading iCal feeds: series, exceptions, all-day, zones, privacy and HTTP (no database)."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
import pytest
from pydantic import SecretStr

from src.core.http import UpstreamError, is_calendar, request_capped
from src.dashboards.collectors.ical import (
    MAX_EVENTS_PER_FEED,
    parse_events,
    split_feeds,
    usable_feed,
    window,
)
from tests.calendar_support import (
    ALL_DAY_PRIVATE,
    CANCELLED,
    DECLINED,
    FEED_URL,
    FLOATING,
    NO_END,
    UTC_EVENT,
    WEEKLY,
    WEEKLY_CANCELLED,
    WEEKLY_MOVED,
    calendar,
    ics_response,
)
from tests.collectors_support import client_for

LONDON = ZoneInfo("Europe/London")
NOW = datetime(2026, 11, 22, 12, 0, tzinfo=UTC)
START, END = window(NOW, LONDON)
NO_OWNERS = frozenset()


def parse(body, zone=LONDON, owners=NO_OWNERS, space="work-1"):
    return parse_events(body, space, START, END, zone, owners)


def when(item):
    return item.starts_at.isoformat(), item.ends_at.isoformat()


def test_the_window_is_a_week_back_and_sixty_days_ahead_in_the_local_zone():
    assert START == datetime(2026, 11, 15, 0, 0, tzinfo=UTC)
    assert END == datetime(2027, 1, 22, 0, 0, tzinfo=UTC)
    berlin_start, berlin_end = window(NOW, ZoneInfo("Europe/Berlin"))
    assert berlin_start == datetime(2026, 11, 14, 23, 0, tzinfo=UTC)
    assert berlin_end == datetime(2027, 1, 21, 23, 0, tzinfo=UTC)
    # 12:00 UTC on the 22nd is already the 23rd in Auckland, so its window starts on the 16th.
    auckland_start, _ = window(NOW, ZoneInfo("Pacific/Auckland"))
    assert auckland_start == datetime(2026, 11, 16, 0, 0, tzinfo=ZoneInfo("Pacific/Auckland"))


def test_a_weekly_series_keeps_its_exception_and_drops_the_excluded_and_cancelled_ones():
    items = parse(calendar(WEEKLY, WEEKLY_MOVED, WEEKLY_CANCELLED))

    by_title = {item.title: item for item in items}
    assert sorted(item.title for item in items) == [
        "Weekly sync",
        "Weekly sync",
        "Weekly sync (moved)",
    ]
    moved = by_title["Weekly sync (moved)"]
    assert when(moved) == ("2026-11-30T16:00:00+00:00", "2026-11-30T16:30:00+00:00")
    starts = sorted(item.starts_at.isoformat() for item in items if item.title == "Weekly sync")
    assert starts == ["2026-11-16T14:00:00+00:00", "2026-12-14T14:00:00+00:00"]


def test_an_instance_is_named_by_its_original_start_so_moving_it_keeps_its_identity():
    moved = {item.external_id for item in parse(calendar(WEEKLY, WEEKLY_MOVED))}
    unmoved = {item.external_id for item in parse(calendar(WEEKLY))}

    assert "work-1|weekly@example.test|2026-11-30T14:00:00+00:00" in moved
    assert moved == unmoved  # the moved instance still has the id of the slot it replaced


def test_a_single_event_is_named_by_its_uid_alone_and_a_series_instance_by_uid_and_slot():
    single = parse(calendar(UTC_EVENT))[0].external_id
    series = {item.external_id for item in parse(calendar(WEEKLY))}

    assert single == "work-1|utc@example.test"
    assert series == {
        "work-1|weekly@example.test|2026-11-16T14:00:00+00:00",
        "work-1|weekly@example.test|2026-11-30T14:00:00+00:00",
        "work-1|weekly@example.test|2026-12-07T14:00:00+00:00",
        "work-1|weekly@example.test|2026-12-14T14:00:00+00:00",
    }


def test_the_space_is_part_of_the_id():
    personal = parse(calendar(UTC_EVENT), space="personal")
    work = parse(calendar(UTC_EVENT), space="work-1")

    assert personal[0].external_id == "personal|utc@example.test"
    assert work[0].external_id == "work-1|utc@example.test"


@pytest.mark.parametrize(
    ("zone", "start", "end"),
    [
        ("Europe/London", "2026-11-24T00:00:00+00:00", "2026-11-25T00:00:00+00:00"),
        ("Pacific/Auckland", "2026-11-23T11:00:00+00:00", "2026-11-24T11:00:00+00:00"),
        ("America/Los_Angeles", "2026-11-24T08:00:00+00:00", "2026-11-25T08:00:00+00:00"),
    ],
)
def test_an_all_day_event_covers_the_local_day_and_a_private_one_is_busy_only(zone, start, end):
    (item,) = parse(calendar(ALL_DAY_PRIVATE), ZoneInfo(zone))

    assert when(item) == (start, end)
    assert item.busy_only is True
    assert item.title == "Day off"


@pytest.mark.parametrize(
    ("zone", "start"),
    [
        ("Europe/London", "2026-11-26T10:00:00+00:00"),
        ("Europe/Berlin", "2026-11-26T09:00:00+00:00"),
        ("Asia/Tokyo", "2026-11-26T01:00:00+00:00"),
    ],
)
def test_a_floating_time_is_read_in_the_configured_zone(zone, start):
    (item,) = parse(calendar(FLOATING), ZoneInfo(zone))

    assert item.starts_at.isoformat() == start
    assert item.ends_at - item.starts_at == timedelta(hours=1)


def test_a_zone_in_the_feed_wins_over_the_configured_one():
    (item,) = parse(calendar(UTC_EVENT), ZoneInfo("Asia/Tokyo"))

    assert item.starts_at.isoformat() == "2026-11-27T15:00:00+00:00"
    assert item.busy_only is False


def test_cancelled_events_are_skipped():
    assert parse(calendar(CANCELLED)) == []


def test_a_declined_event_is_skipped_only_when_the_owner_is_known():
    body = calendar(DECLINED, UTC_EVENT)

    assert sorted(i.title for i in parse(body)) == ["Not going", "Planning"]
    owner = frozenset({"owner@example.test"})
    assert [i.title for i in parse(body, owners=owner)] == ["Planning"]
    other = frozenset({"colleague@example.test"})
    assert sorted(i.title for i in parse(body, owners=other)) == ["Not going", "Planning"]


def test_an_event_without_an_end_gets_a_short_default_length():
    (item,) = parse(calendar(NO_END))

    assert when(item) == ("2026-11-29T10:00:00+00:00", "2026-11-29T10:30:00+00:00")


def test_a_blank_title_and_a_missing_uid():
    blank = ["UID:blank@example.test", "DTSTART:20261127T150000Z", "DTEND:20261127T160000Z"]
    no_uid = ["DTSTART:20261127T150000Z", "DTEND:20261127T160000Z", "SUMMARY:No id"]

    assert [i.title for i in parse(calendar(blank, no_uid))] == ["(no title)"]


def test_the_same_event_twice_in_one_feed_is_one_item():
    items = parse(calendar(UTC_EVENT, UTC_EVENT))

    assert len(items) == 1


def test_events_outside_the_window_are_left_out():
    old = ["UID:old@example.test", "DTSTART:20260101T100000Z", "DTEND:20260101T110000Z"]
    far = ["UID:far@example.test", "DTSTART:20270601T100000Z", "DTEND:20270601T110000Z"]

    items = parse(calendar(old, far, UTC_EVENT))

    assert [item.title for item in items] == ["Planning"]


@pytest.mark.parametrize(
    "body",
    [b"", b"not a calendar at all", b"BEGIN:VCALENDAR\nBEGIN:VEVENT\n", b"<html>log in</html>"],
)
def test_a_body_that_is_not_a_calendar_is_bad_ics_and_quotes_nothing(body):
    with pytest.raises(UpstreamError) as raised:
        parse(body)

    assert raised.value.kind == "bad_ics"
    assert str(raised.value) == "bad_ics"
    assert raised.value.__cause__ is None


def test_an_absurd_number_of_occurrences_is_refused():
    burst = [
        "UID:burst@example.test",
        "DTSTART:20261116T100000Z",
        "DTEND:20261116T100001Z",
        f"RRULE:FREQ=SECONDLY;COUNT={MAX_EVENTS_PER_FEED + 10}",
    ]
    body = calendar(burst)

    with pytest.raises(UpstreamError) as raised:
        parse(body)

    assert raised.value.kind == "too_many"


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (FEED_URL, True),
        ("  https://calendar.example.test/a.ics  ", True),
        ("http://calendar.example.test/a.ics", False),
        ("https://user:pw@calendar.example.test/a.ics", False),
        ("https://calendar.example.test/a b.ics", False),
        ("https://calendar.example.test/é.ics", False),
        ("webcal://calendar.example.test/a.ics", False),
        ("", False),
    ],
)
def test_only_plain_https_addresses_are_feeds(value, expected):
    assert usable_feed(value) is expected


def test_a_comma_separated_setting_becomes_a_list_of_usable_feeds():
    second = "https://calendar.example.test/b.ics"
    value = SecretStr(f" {FEED_URL} , http://bad.example.test/x.ics,, {second}")

    assert split_feeds(value) == [FEED_URL, second]
    assert split_feeds(None) == []
    assert split_feeds(SecretStr("")) == []


@pytest.mark.anyio
async def test_a_calendar_answer_is_read_and_a_304_is_returned_when_asked_for():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.headers.get("if-none-match") == '"v1"':
            return httpx.Response(304)
        return ics_response(b"BODY", headers={"etag": '"v1"'})

    async with client_for(handler) as client:
        first = await request_capped(client, "GET", FEED_URL, headers={}, accepts=is_calendar)
        again = await request_capped(
            client,
            "GET",
            FEED_URL,
            headers={"If-None-Match": '"v1"'},
            accepts=is_calendar,
            not_modified_ok=True,
        )
        with pytest.raises(UpstreamError) as refused:
            await request_capped(
                client, "GET", FEED_URL, headers={"If-None-Match": '"v1"'}, accepts=is_calendar
            )

    assert (first[0], first[1], first[2]["etag"]) == (200, b"BODY", '"v1"')
    assert again[:2] == (304, b"")
    assert refused.value.kind == "bad_status"
    assert FEED_URL not in str(refused.value)


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("response", "kind"),
    [
        (httpx.Response(200, json={"a": 1}), "bad_content_type"),
        (httpx.Response(404), "not_found"),
        (httpx.Response(500), "http_5xx"),
        (ics_response(b"x" * 100), "too_large"),
    ],
)
async def test_a_bad_feed_answer_is_a_kind_without_the_address(response, kind):
    async with client_for(lambda request: response) as client:
        with pytest.raises(UpstreamError) as raised:
            await request_capped(
                client, "GET", FEED_URL, headers={}, accepts=is_calendar, max_bytes=50
            )

    assert raised.value.kind == kind
    assert "FEED-SECRET" not in str(raised.value)
    assert "FEED-SECRET" not in repr(raised.value.__dict__)
