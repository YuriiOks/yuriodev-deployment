"""Parsing helpers shared by the providers: money is exact, text is one printable line.

A malformed answer is `UpstreamError("bad_json")` and changes nothing; no error carries any of the
payload.
"""

import re
from datetime import UTC, datetime

from src.core.http import UpstreamError

ID_CHARS = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")
MAX_ID = 64


def bad() -> UpstreamError:
    return UpstreamError("bad_json", 200)


def whole(value: object) -> int:
    """An integer from the answer, never a float or a bool: money is exact."""
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    raise bad()


def text(value: object, limit: int) -> str | None:
    """One printable line, cut to `limit`; None when nothing is left."""
    if not isinstance(value, str):
        return None
    line = " ".join(value.split())
    line = "".join(ch for ch in line if ch.isprintable())[:limit].strip()
    return line or None


def safe_id(value: object) -> str:
    """An identifier that can go into a URL path: letters, digits, underscore, hyphen."""
    if (
        not isinstance(value, str)
        or not 0 < len(value) <= MAX_ID
        or not set(value) <= ID_CHARS
    ):
        raise bad()
    return value


def iso_code(value: object) -> str:
    """An ISO 4217 alpha code: three capital letters."""
    if isinstance(value, str) and re.fullmatch(r"[A-Z]{3}", value):
        return value
    raise bad()


def parse_time(value: object) -> datetime:
    """An RFC 3339 timestamp with a zone, as UTC."""
    if not isinstance(value, str):
        raise bad()
    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        raise bad() from None
    if moment.tzinfo is None:
        raise bad()
    return moment.astimezone(UTC)
