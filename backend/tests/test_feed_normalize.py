"""normalize_draft(): allow-list, permalink patterns, text rules, caps and fail-closed drops."""

from datetime import UTC, datetime

import pytest

from src.feed.normalize import (
    MAX_PART_CHARS,
    MAX_PARTS,
    clean_text,
    normalize_draft,
    parse_summary,
    parse_time,
)
from tests.feed_factory import draft, li_post, summary_row, x_post


def item_of(raw, **kw):
    result = normalize_draft(raw, **kw)
    assert result.item is not None, result.reason
    return result.item


def test_thread_and_linkedin_become_one_item_with_two_variants():
    raw = draft(
        1,
        x=[x_post("one"), x_post("two", media_ids=["m"]), x_post("three")],
        linkedin=[li_post("long form")],
    )

    item = item_of(raw)

    assert item.id == "x:1001"
    assert item.origin == "typefully"
    assert item.has_media is True
    assert item.variants["x"].parts == ("one", "two", "three")
    assert item.variants["x"].url == "https://x.com/YuriODev/status/1001"
    assert item.variants["linkedin"].id == "li:share:7001"
    assert item.variants["linkedin"].parts == ("long form",)
    # the earliest variant time, whole seconds, UTC
    assert item.published_at == datetime(2026, 9, 20, 9, 0, 1, tzinfo=UTC)
    assert item.variants["x"].published_at == datetime(2026, 9, 20, 9, 0, 5, tzinfo=UTC)


def test_linkedin_only_uses_the_linkedin_id():
    item = item_of(draft(2, linkedin=[li_post("only here")]))

    assert item.id == "li:share:7002"
    assert list(item.variants) == ["linkedin"]
    assert item.has_media is False


def test_x_only():
    item = item_of(draft(3, x=[x_post("only x")]))

    assert list(item.variants) == ["x"]


def test_a_disabled_platform_is_ignored_even_with_posts_and_url():
    raw = draft(4, x=[x_post("x text")], linkedin=[li_post("li text")])
    raw["platforms"]["linkedin"]["enabled"] = False

    assert list(item_of(raw).variants) == ["x"]


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "https://evil.example/YuriODev/status/1",
        "http://x.com/YuriODev/status/1",
        "https://x.com/YuriODev/status/1/photo/1",
        "https://x.com/YuriODev/status/1?ref=a",
        "https://x.com/a_handle_that_is_too_long/status/1",
        "https://twitter.com/YuriODev/status/1",
    ],
)
def test_bad_x_permalinks_are_rejected(url):
    result = normalize_draft(draft(5, x=[x_post("t")], x_link=url))

    assert result.item is None
    assert result.reason == "bad_url"


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://www.linkedin.com/feed/update/urn:li:share:123", "li:share:123"),
        ("https://www.linkedin.com/feed/update/urn:li:activity:123/", "li:activity:123"),
        ("https://www.linkedin.com/feed/update/urn:li:ugcPost:123", "li:ugcPost:123"),
    ],
)
def test_linkedin_permalink_forms(url, expected):
    assert item_of(draft(6, linkedin=[li_post("t")], li_link=url)).id == expected


@pytest.mark.parametrize(
    "url",
    [
        "https://linkedin.com/feed/update/urn:li:share:1",
        "https://www.linkedin.com/posts/someone_123",
        "https://www.linkedin.com/feed/update/urn:li:comment:1",
    ],
)
def test_bad_linkedin_permalinks_are_rejected(url):
    assert normalize_draft(draft(7, linkedin=[li_post("t")], li_link=url)).reason == "bad_url"


def test_a_missing_permalink_is_no_valid_variant():
    assert normalize_draft(draft(8, x=[x_post("t")], x_link=None)).reason == "no_valid_variant"


def test_one_bad_variant_does_not_drop_the_good_one():
    raw = draft(9, x=[x_post("x")], linkedin=[li_post("li")], x_link="https://evil.example/")

    assert list(item_of(raw).variants) == ["linkedin"]


def test_styled_unicode_and_emoji_sequences_are_kept_byte_for_byte():
    styled = (
        "\U0001d5e8\U0001d600\U0001d5f2 \U0001d602\U0001d601"
        " \U0001f468\u200d\U0001f469\u200d\U0001f467 \u2714\ufe0f"
    )

    assert item_of(draft(10, x=[x_post(styled)])).variants["x"].parts == (styled,)


def test_controls_bidi_and_comment_markup_are_removed_newlines_kept():
    text = (
        "a\r\nb\x07c\u202eevil\u202c\u2066d\u2069"
        ' <typ:comment-thread id="1">e</typ:comment-thread>\x85'
    )

    assert clean_text(text) == "a\nbcevild e"


def test_javascript_in_text_stays_text():
    part = item_of(draft(11, x=[x_post("see javascript:alert(1) <b>x</b>")])).variants["x"].parts[0]

    assert part == "see javascript:alert(1) <b>x</b>"


def test_caps_set_truncated():
    long = "x" * (MAX_PART_CHARS + 10)
    raw = draft(12, x=[x_post(long)] + [x_post(f"p{i}") for i in range(MAX_PARTS + 3)])

    variant = item_of(raw).variants["x"]

    assert len(variant.parts) == MAX_PARTS
    assert len(variant.parts[0]) == MAX_PART_CHARS
    assert variant.truncated is True


def test_short_text_is_not_truncated():
    assert item_of(draft(13, x=[x_post("short")])).variants["x"].truncated is False


def test_empty_parts_are_skipped_and_an_all_empty_variant_is_dropped():
    raw = draft(14, x=[x_post("  "), x_post("\x07")], linkedin=[li_post("kept")])

    assert list(item_of(raw).variants) == ["linkedin"]


def test_variant_time_falls_back_to_the_draft_published_at():
    raw = draft(15, x=[x_post("t")], x_at=None)

    assert item_of(raw).variants["x"].published_at == datetime(2026, 9, 20, 9, 0, tzinfo=UTC)


def test_variant_time_falls_back_to_the_listing_when_the_draft_has_none():
    raw = draft(16, x=[x_post("t")], x_at=None, published=None)
    summary = parse_summary(summary_row(draft(16, x=[x_post("t")])))

    item = item_of(raw, summary=summary)

    assert item.published_at == datetime(2026, 9, 20, 9, 0, tzinfo=UTC)


def test_no_time_at_all_drops_the_variant():
    raw = draft(17, x=[x_post("t")], x_at=None, published=None)

    assert normalize_draft(raw).reason == "no_valid_variant"


# fail-closed rules


def test_paid_partnership_drops_the_whole_draft():
    raw = draft(20, x=[x_post("a"), x_post("b", paid_partnership=True)], linkedin=[li_post("c")])

    assert normalize_draft(raw).reason == "paid_partnership"


def test_subscribers_only_drops_only_the_x_variant():
    raw = draft(21, x=[x_post("a", subscribers_only=True)], linkedin=[li_post("public")])

    result = normalize_draft(raw)

    assert list(result.item.variants) == ["linkedin"]
    assert result.skipped == ("x:subscribers_only",)


def test_an_unexpected_flag_value_fails_closed():
    raw = draft(22, x=[x_post("a", subscribers_only="yes")])

    assert normalize_draft(raw).item is None


def test_a_linkedin_reshare_drops_the_linkedin_variant():
    raw = draft(
        23,
        x=[x_post("mine")],
        linkedin=[li_post("commentary", linkedin_reshare_urn="urn:li:share:9")],
    )

    result = normalize_draft(raw)

    assert list(result.item.variants) == ["x"]
    assert result.skipped == ("linkedin:reshare",)


def test_an_x_article_only_draft_is_skipped():
    raw = draft(24, x_article={"title": "t", "content_markdown": "body"})

    assert normalize_draft(raw).reason == "x_article"


def test_the_exclude_tag_on_the_full_draft_drops_it():
    raw = draft(25, x=[x_post("t")], tags=["hide-from-site"])

    assert normalize_draft(raw, exclude_tag="hide-from-site").reason == "excluded"
    assert normalize_draft(raw).item is not None


def test_a_draft_that_is_not_published_is_dropped():
    assert normalize_draft(draft(26, x=[x_post("t")], status="scheduled")).reason == "not_published"


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.pop("platforms"),
        lambda d: d.update(id="26"),
        lambda d: d.update(id=True),
        lambda d: d["platforms"].update(x="nope"),
        lambda d: d["platforms"]["x"].update(posts="nope"),
        lambda d: d["platforms"]["x"].update(posts=["nope"]),
    ],
)
def test_malformed_drafts_are_schema_errors(mutate):
    raw = draft(27, x=[x_post("t")])
    mutate(raw)

    assert normalize_draft(raw).reason == "schema"


def test_a_non_mapping_is_a_schema_error():
    assert normalize_draft(["not", "a", "draft"]).reason == "schema"


def test_a_post_without_text_is_skipped():
    raw = draft(28, x=[{"media_ids": ["m"]}, x_post("real")])

    assert item_of(raw).variants["x"].parts == ("real",)


# listing rows and timestamps


def test_parse_summary_reads_id_update_time_and_tags():
    summary = parse_summary(summary_row(draft(30, x=[x_post("t")], tags=["a", 5, "b"])))

    assert summary.draft_id == 30
    assert summary.updated_at == datetime(2026, 9, 20, 8, 30, tzinfo=UTC)
    assert summary.tags == ("a", "b")


@pytest.mark.parametrize(
    "row",
    [
        "nope",
        {"id": "1", "updated_at": "2026-09-20T08:30:00Z"},
        {"id": 0, "updated_at": "2026-09-20T08:30:00Z"},
        {"id": 1, "updated_at": "yesterday"},
        {"id": 1},
    ],
)
def test_parse_summary_rejects_unusable_rows(row):
    assert parse_summary(row) is None


def test_parse_summary_tolerates_missing_tags():
    assert parse_summary({"id": 1, "updated_at": "2026-09-20T08:30:00Z"}).tags == ()


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("2026-09-23T08:17:18.290Z", datetime(2026, 9, 23, 8, 17, 18, tzinfo=UTC)),
        ("2026-09-23T10:17:18+02:00", datetime(2026, 9, 23, 8, 17, 18, tzinfo=UTC)),
        ("2026-09-23T08:17:18", None),  # no zone
        ("not a time", None),
        (None, None),
        (1695000000, None),
    ],
)
def test_parse_time(value, expected):
    assert parse_time(value) == expected
