"""What every collector shares: the item shape, text hygiene and rate-limit reading.

An external item is only ever described by its id, title, link and optional due date. Anything
else the source sends is dropped at parse time, and nothing here is ever logged.
"""

import hashlib
from dataclasses import dataclass
from datetime import date, datetime
from typing import Protocol

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.core.http import UpstreamError

MAX_TITLE = 300  # the task title limit
MAX_URL = 2000
PAGE_SIZE = 100
MAX_PAGES = 10  # a source with more pages than this is treated as incomplete, never as closed
MIN_PAUSE_SECONDS = 60
MAX_PAUSE_SECONDS = 3600
DEFAULT_RATE_LIMIT_PAUSE = 300


@dataclass(frozen=True)
class ExternalItem:
    """One open item on the source: `external_id` is stable and unique per source."""

    external_id: str
    title: str
    url: str | None
    due_date: date | None = None
    # A grouping label the collector owns (not part of the tombstone fingerprint).
    stage: str | None = None


@dataclass(frozen=True)
class CalendarItem:
    """One calendar event occurrence, already in UTC. `external_id` is stable across polls."""

    external_id: str
    title: str
    starts_at: datetime
    ends_at: datetime
    busy_only: bool


class Collector(Protocol):
    """One source the manager polls. `collect` fetches, writes to the database and returns the
    counts to log (numbers only), or raises. A failed or cut-off fetch must change nothing."""

    name: str  # the name in logs and settings

    async def collect(
        self,
        client: httpx.AsyncClient,
        sessions: async_sessionmaker[AsyncSession],
        now: datetime,
    ) -> dict[str, int]: ...


def fingerprint(title: str, url: str | None) -> str:
    """What "the external item is unchanged" means for a deleted task: same title, same link."""
    return hashlib.sha256(f"{title}\n{url or ''}".encode()).hexdigest()


def clean_title(prefix: str, title: object) -> str:
    """`prefix` + the source's title on one printable line, cut to the task title limit."""
    text = title if isinstance(title, str) else ""
    body = " ".join(text.split())
    body = "".join(ch for ch in body if ch.isprintable())
    return (prefix + body)[:MAX_TITLE]


def safe_url(value: object) -> str | None:
    """An https link without credentials, or None: the page renders it as a link."""
    if not isinstance(value, str) or len(value) > MAX_URL or not value.isascii():
        return None
    if not value.startswith("https://") or "@" in value.split("/", 3)[2]:
        return None
    return value


def pause_seconds(error: UpstreamError, now_epoch: int) -> int | None:
    """How long to leave a source alone after a rate-limit answer, or None if this is not one.

    GitHub answers 403 or 429 with `retry-after`, or with `x-ratelimit-remaining: 0` and the
    reset time; Linear answers 429. The wait is kept between one minute and one hour.
    """
    if error.status not in (403, 429):
        return None
    wait: int | None = None
    retry_after = error.headers.get("retry-after", "")
    reset = error.headers.get("x-ratelimit-reset", "")
    if retry_after.isdigit():
        wait = int(retry_after)
    elif error.headers.get("x-ratelimit-remaining") == "0" and reset.isdigit():
        wait = int(reset) - now_epoch
    elif error.status == 429 or error.headers.get("x-ratelimit-remaining") == "0":
        wait = DEFAULT_RATE_LIMIT_PAUSE
    if wait is None:
        return None
    return max(MIN_PAUSE_SECONDS, min(wait, MAX_PAUSE_SECONDS))
