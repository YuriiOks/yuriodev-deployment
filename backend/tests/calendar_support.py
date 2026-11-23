"""Hand-written iCal feeds for the calendar collector tests. Every name is invented."""

import httpx

FEED_URL = "https://calendar.example.test/ical/FEED-SECRET-5531/basic.ics"

WEEKLY = [
    "UID:weekly@example.test",
    "DTSTART;TZID=America/New_York:20261116T090000",
    "DTEND;TZID=America/New_York:20261116T093000",
    "RRULE:FREQ=WEEKLY;COUNT=5",
    "EXDATE;TZID=America/New_York:20261123T090000",
    "SUMMARY:Weekly sync",
]
WEEKLY_MOVED = [
    "UID:weekly@example.test",
    "RECURRENCE-ID;TZID=America/New_York:20261130T090000",
    "DTSTART;TZID=America/New_York:20261130T110000",
    "DTEND;TZID=America/New_York:20261130T113000",
    "SUMMARY:Weekly sync (moved)",
]
WEEKLY_CANCELLED = [
    "UID:weekly@example.test",
    "RECURRENCE-ID;TZID=America/New_York:20261207T090000",
    "DTSTART;TZID=America/New_York:20261207T090000",
    "DTEND;TZID=America/New_York:20261207T093000",
    "STATUS:CANCELLED",
    "SUMMARY:Weekly sync",
]
ALL_DAY_PRIVATE = [
    "UID:allday@example.test",
    "DTSTART;VALUE=DATE:20261124",
    "DTEND;VALUE=DATE:20261125",
    "CLASS:PRIVATE",
    "SUMMARY:Day off",
]
FLOATING = [
    "UID:floating@example.test",
    "DTSTART:20261126T100000",
    "DTEND:20261126T110000",
    "SUMMARY:Floating lunch",
]
UTC_EVENT = [
    "UID:utc@example.test",
    "DTSTART:20261127T150000Z",
    "DTEND:20261127T160000Z",
    "SUMMARY:Planning",
]
CANCELLED = [
    "UID:cancelled@example.test",
    "DTSTART:20261125T100000Z",
    "DTEND:20261125T110000Z",
    "STATUS:CANCELLED",
    "SUMMARY:Called off",
]
DECLINED = [
    "UID:declined@example.test",
    "DTSTART:20261128T100000Z",
    "DTEND:20261128T110000Z",
    "ATTENDEE;PARTSTAT=DECLINED:mailto:Owner@Example.test",
    "ATTENDEE;PARTSTAT=ACCEPTED:mailto:colleague@example.test",
    "SUMMARY:Not going",
]
NO_END = [
    "UID:noend@example.test",
    "DTSTART:20261129T100000Z",
    "SUMMARY:Open ended",
]


def calendar(*events: list[str]) -> bytes:
    """A VCALENDAR with one VEVENT per list of property lines."""
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Example//Tests//EN"]
    for event in events:
        lines += ["BEGIN:VEVENT", "DTSTAMP:20261101T000000Z", *event, "END:VEVENT"]
    lines.append("END:VCALENDAR")
    return ("\n".join(lines) + "\n").encode()


def ics_response(
    body: bytes, status: int = 200, headers: dict[str, str] | None = None
) -> httpx.Response:
    merged = {"content-type": "text/calendar; charset=utf-8", **(headers or {})}
    return httpx.Response(status, content=body, headers=merged)
