"""Shared collector helpers: titles, links, fingerprints and the reading of rate-limit answers."""

import pytest

from src.core.http import UpstreamError
from src.dashboards.collectors.base import (
    MAX_PAUSE_SECONDS,
    MIN_PAUSE_SECONDS,
    clean_title,
    fingerprint,
    pause_seconds,
    safe_url,
)

NOW = 1_800_000_000
SOON = str(NOW + 600)
PAST = str(NOW - 50)


def test_a_title_is_one_printable_line_within_the_limit():
    assert clean_title("PR #1: ", "  Fix\n  the\ttitle  ") == "PR #1: Fix the title"
    assert clean_title("PR #1: ", "bell\x07 and ‮ bidi") == "PR #1: bell and  bidi"
    assert clean_title("PR #1: ", None) == "PR #1: "
    assert len(clean_title("PR #1: ", "x" * 1000)) == 300


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("https://example.com/a/b?c=d", "https://example.com/a/b?c=d"),
        ("http://example.com/a", None),
        ("javascript:alert(1)", None),
        ("https://user:pw@example.com/a", None),
        ("https://example.com/é", None),
        ("https://example.com/" + "a" * 2000, None),
        (None, None),
        (5, None),
    ],
)
def test_only_plain_https_links_are_kept(value, expected):
    assert safe_url(value) == expected


def test_the_fingerprint_follows_title_and_link():
    base = fingerprint("T", "https://example.com/1")

    assert base == fingerprint("T", "https://example.com/1")
    assert base != fingerprint("T2", "https://example.com/1")
    assert base != fingerprint("T", "https://example.com/2")
    assert base != fingerprint("T", None)
    assert len(base) == 64


@pytest.mark.parametrize(
    ("status", "headers", "expected"),
    [
        (429, {"retry-after": "120"}, 120),
        (403, {"retry-after": "5"}, MIN_PAUSE_SECONDS),
        (403, {"retry-after": "999999"}, MAX_PAUSE_SECONDS),
        (403, {"x-ratelimit-remaining": "0", "x-ratelimit-reset": SOON}, 600),
        (403, {"x-ratelimit-remaining": "0"}, 300),
        (403, {"x-ratelimit-remaining": "0", "x-ratelimit-reset": PAST}, MIN_PAUSE_SECONDS),
        (429, {}, 300),
        (403, {"x-ratelimit-remaining": "42"}, None),
        (403, {}, None),
        (401, {"retry-after": "30"}, None),
        (500, {}, None),
        (None, {}, None),
    ],
)
def test_rate_limit_answers_become_a_bounded_pause(status, headers, expected):
    error = UpstreamError("rate_limited", status, headers)

    assert pause_seconds(error, NOW) == expected
