"""Calendar: read-only secret iCal addresses become `event` rows.

One collector per space (`personal`, `work-1`; `work-2` stays manual), each with the feeds the
owner listed for it. Every poll, per feed: a conditional GET (ETag / Last-Modified when the server
offers them; the last good body is kept in memory so a 304 still re-expands the window), a size
cap, then the series are expanded for the window "today minus 7 days to today plus 60 days" in
`DASHBOARDS_TIMEZONE`, and the result is upserted (`sync_events`).

What the page needs is kept: title, start, end, and `busy_only` when the feed marks the event
PRIVATE or CONFIDENTIAL. Cancelled instances are skipped, and so are events the owner declined
(only detectable when CALENDAR_OWNER_EMAILS names the owner's address). All-day and floating
(zone-less) events are read in `DASHBOARDS_TIMEZONE`; everything is stored in UTC.

A feed URL is a credential. It is held in a `SecretStr`, never logged (feeds are named by their
position), never part of an exception message (`UpstreamError` messages are kinds), and never in
an API answer. A feed that fails leaves its events alone: with some feeds down the poll still
adds and updates but deletes nothing.
"""

import asyncio
import contextlib
import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import icalendar
import recurring_ical_events
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.core.http import UpstreamError, is_calendar, request_capped
from src.dashboards.collectors.base import CalendarItem, clean_title
from src.dashboards.collectors.sync import sync_events

logger = logging.getLogger("yuriodev.collectors")

WINDOW_PAST_DAYS = 7
WINDOW_FUTURE_DAYS = 60
MAX_FEED_BYTES = 5 * 1024 * 1024
MAX_EVENTS_PER_FEED = 5000
DEFAULT_LENGTH = timedelta(minutes=30)  # an event with no usable end
NO_TITLE = "(no title)"
PRIVATE_CLASSES = ("PRIVATE", "CONFIDENTIAL")


@dataclass
class FeedCache:
    """What the server told us about the last good copy of one feed."""

    etag: str | None
    last_modified: str | None
    body: bytes


def usable_feed(value: str) -> bool:
    """An https address: no spaces, plain ASCII, no credentials in the authority."""
    value = value.strip()
    if not value.startswith("https://") or not value.isascii() or len(value.split()) != 1:
        return False
    return "@" not in value.split("/", 3)[2]


def split_feeds(value: SecretStr | None) -> list[str]:
    """The usable addresses of a comma-separated setting (unusable ones are dropped, unseen)."""
    if value is None:
        return []
    parts = [part.strip() for part in value.get_secret_value().split(",")]
    return [part for part in parts if usable_feed(part)]


def window(now: datetime, zone: ZoneInfo) -> tuple[datetime, datetime]:
    """[today - 7 days, today + 60 days] as UTC instants: local midnight to local midnight."""
    today = now.astimezone(zone).date()
    start = datetime.combine(today - timedelta(days=WINDOW_PAST_DAYS), time.min, tzinfo=zone)
    end = datetime.combine(today + timedelta(days=WINDOW_FUTURE_DAYS + 1), time.min, tzinfo=zone)
    return start.astimezone(UTC), end.astimezone(UTC)


def to_utc(value: date | datetime, zone: ZoneInfo) -> datetime:
    """A feed time as a UTC instant. A date (all-day) and a zone-less time mean `zone`."""
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=zone)
        return value.astimezone(UTC)
    return datetime.combine(value, time.min, tzinfo=zone).astimezone(UTC)


def _occurrence_key(value: date | datetime, zone: ZoneInfo) -> str:
    """The original start of an occurrence, the same string however the feed spells the zone."""
    return to_utc(value, zone).isoformat()


def _declined(event: Any, owners: frozenset[str]) -> bool:
    if not owners:
        return False
    attendees = event.get("ATTENDEE")
    if attendees is None:
        return False
    for attendee in attendees if isinstance(attendees, list) else [attendees]:
        address = str(attendee).strip().lower().removeprefix("mailto:")
        partstat = str(attendee.params.get("PARTSTAT", "")).upper()
        if partstat == "DECLINED" and address in owners:
            return True
    return False


def parse_events(
    body: bytes,
    space: str,
    start: datetime,
    end: datetime,
    zone: ZoneInfo,
    owners: frozenset[str],
) -> list[CalendarItem]:
    """The events of one feed that fall in the window, series expanded. Raises
    UpstreamError("bad_ics") for a body that is not a calendar and ("too_many") for a window with
    an absurd number of occurrences. Nothing of the body is put in the error."""
    failed = False
    occurrences: list[Any] = []
    recurring: set[str] = set()
    try:
        calendar = icalendar.Calendar.from_ical(body)
        occurrences = recurring_ical_events.of(calendar).between(start, end)
        events = calendar.walk("VEVENT")
        recurring = {str(event.get("UID", "")) for event in events if _in_series(event)}
    except Exception:  # the parser's messages quote the feed
        failed = True
    if failed:
        raise UpstreamError("bad_ics")
    if len(occurrences) > MAX_EVENTS_PER_FEED:
        raise UpstreamError("too_many")
    items: dict[str, CalendarItem] = {}
    for event in occurrences:
        item = None
        with contextlib.suppress(Exception):  # one malformed event must not hide the others
            item = _item(event, space, zone, owners, recurring)
        if item is not None:
            items.setdefault(item.external_id, item)
    return list(items.values())


def _in_series(event: Any) -> bool:
    """Whether this VEVENT belongs to a recurring series (the rule itself, extra dates, or an
    override of one occurrence)."""
    return bool(event.get("RRULE") or event.get("RDATE") or event.get("RECURRENCE-ID"))


def _item(
    event: Any, space: str, zone: ZoneInfo, owners: frozenset[str], recurring: set[str]
) -> CalendarItem | None:
    uid = str(event.get("UID", "")).strip()
    if not uid or str(event.get("STATUS", "")).upper() == "CANCELLED":
        return None
    if _declined(event, owners):
        return None
    first = event.start
    starts_at = to_utc(first, zone)
    ends_at = to_utc(event.end, zone)
    if ends_at <= starts_at:
        ends_at = starts_at + DEFAULT_LENGTH
    # A single event is named by its UID, so moving it keeps its row. An occurrence of a series
    # is named by the UID and the occurrence's ORIGINAL start (the RECURRENCE-ID), so moving one
    # instance keeps its row too.
    external_id = f"{space}|{uid}"
    if uid in recurring:
        recurrence = event.get("RECURRENCE-ID")
        original = recurrence.dt if recurrence is not None else first
        external_id = f"{external_id}|{_occurrence_key(original, zone)}"
    return CalendarItem(
        external_id=external_id,
        title=clean_title("", event.get("SUMMARY")) or NO_TITLE,
        starts_at=starts_at,
        ends_at=ends_at,
        busy_only=str(event.get("CLASS", "")).upper() in PRIVATE_CLASSES,
    )


class CalendarCollector:
    name: str  # "calendar-<space>": one collector per space, each with its own pause and logs

    def __init__(
        self,
        space: str,
        feeds: list[str],
        zone: ZoneInfo,
        owners: frozenset[str] = frozenset(),
    ) -> None:
        self.name = f"calendar-{space}"
        self.space = space
        self._feeds = feeds
        self._zone = zone
        self._owners = owners
        self._caches: dict[int, FeedCache] = {}

    async def collect(
        self,
        client: httpx.AsyncClient,
        sessions: async_sessionmaker[AsyncSession],
        now: datetime,
    ) -> dict[str, int]:
        start, end = window(now, self._zone)
        items: dict[str, CalendarItem] = {}
        failed = 0
        last_error: UpstreamError | None = None
        for index, url in enumerate(self._feeds):
            try:
                body = await self._download(client, index, url)
                parsed = await asyncio.to_thread(
                    parse_events, body, self.space, start, end, self._zone, self._owners
                )
            except UpstreamError as exc:
                failed += 1
                last_error = exc
                logger.warning(
                    "calendar feed failed",
                    extra={
                        "event": "calendar.feed_failed",
                        "collector": self.name,
                        "space": self.space,
                        "feed": index,
                        "kind": exc.kind,
                        "status": exc.status,
                    },
                )
                continue
            for item in parsed:
                items.setdefault(item.external_id, item)
        if last_error is not None and failed == len(self._feeds):
            raise last_error  # nothing was read: the manager logs it and applies any pause
        async with sessions() as session:
            counts = await sync_events(
                session, self.space, list(items.values()), (start, end), now, failed == 0
            )
        return {
            "feeds": len(self._feeds),
            "failed": failed,
            "fetched": len(items),
            "created": counts.created,
            "updated": counts.updated,
            "deleted": counts.deleted,
        }

    async def _download(self, client: httpx.AsyncClient, index: int, url: str) -> bytes:
        cache = self._caches.get(index)
        headers = {"Accept": "text/calendar, text/plain;q=0.5"}
        if cache is not None and cache.etag:
            headers["If-None-Match"] = cache.etag
        if cache is not None and cache.last_modified:
            headers["If-Modified-Since"] = cache.last_modified
        status, body, response_headers = await request_capped(
            client,
            "GET",
            url,
            headers=headers,
            max_bytes=MAX_FEED_BYTES,
            accepts=is_calendar,
            not_modified_ok=True,
        )
        if status == 304 and cache is not None:
            return cache.body
        if status == 304:  # a 304 to a request that was not conditional
            raise UpstreamError("bad_status", 304)
        self._caches[index] = FeedCache(
            etag=response_headers.get("etag"),
            last_modified=response_headers.get("last-modified"),
            body=body,
        )
        return body
