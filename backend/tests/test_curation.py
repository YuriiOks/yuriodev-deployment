"""posts.toml: the shipped file parses strictly; overrides and native posts behave."""

from datetime import UTC, datetime

import pytest

from src.feed.curation import CURATION_PATH, Curation, CurationError, load_curation, parse_curation
from src.feed.schemas import FeedItem, PostVariant

WHEN = datetime(2026, 1, 15, 9, 0, tzinfo=UTC)


def imported(item_id="x:1", li=None):
    variants = {
        "x": PostVariant(
            id=item_id,
            url="https://x.com/YuriODev/status/1",
            published_at=WHEN,
            parts=("a",),
            truncated=False,
        )
    }
    if li:
        variants["linkedin"] = PostVariant(
            id=li,
            url="https://www.linkedin.com/feed/update/urn:li:share:2",
            published_at=WHEN,
            parts=("b",),
            truncated=False,
        )
    return FeedItem(
        id=item_id,
        published_at=WHEN,
        origin="typefully",
        pinned=False,
        featured=False,
        has_media=False,
        variants=variants,
    )


def test_the_shipped_file_parses_and_is_empty():
    curation = load_curation()

    assert CURATION_PATH.name == "posts.toml"
    assert curation == Curation()


def test_the_commented_examples_in_the_shipped_file_are_valid(tmp_path):
    # Below the marker, "##" lines are prose and "#" lines are commented-out TOML.
    lines = CURATION_PATH.read_text().splitlines()
    start = lines.index("# ---- examples ----")
    uncommented = "\n".join(
        line.removeprefix("# ").removeprefix("#")
        for line in lines[start + 1 :]
        if not line.startswith("##")
    )
    path = tmp_path / "posts.toml"
    path.write_text(uncommented)

    curation = load_curation(path)

    assert set(curation.overrides) == {"x:1234567890123456789", "li:share:1234567890123456789"}
    (native,) = curation.native
    assert native.origin == "curated"
    assert native.pinned is True
    assert native.variants["x"].parts == ("First post of the thread.", "Second post of the thread.")
    assert native.variants["linkedin"].parts == ("The LinkedIn text.\n\nParagraphs are kept.",)


def test_native_post_with_its_own_variant_time():
    curation = parse_curation(
        {
            "native": [
                {
                    "published_at": WHEN,
                    "x": {
                        "url": "https://x.com/YuriODev/status/9",
                        "parts": ["t\u202e"],
                        "published_at": datetime(2026, 1, 1, tzinfo=UTC),
                    },
                }
            ]
        }
    )

    (item,) = curation.native
    assert item.id == "x:9"
    assert item.published_at == datetime(2026, 1, 1, tzinfo=UTC)
    assert item.variants["x"].parts == ("t",)
    assert item.pinned is False


def test_overrides_match_by_item_or_variant_id():
    curation = parse_curation(
        {
            "override": [
                {"id": "li:share:2", "pin": 3, "featured": True},
                {"id": "x:5", "hide": True},
            ]
        }
    )

    item = curation.apply(imported("x:1", li="li:share:2"))
    assert item.pinned is True
    assert item.featured is True
    assert curation.pin_of(item) == 3
    assert curation.hidden(imported("x:5")) is True
    assert curation.hidden(item) is False
    untouched = imported("x:7")
    assert curation.apply(untouched) is untouched


def test_featured_false_overrides_and_pin_absent_keeps_unpinned():
    curation = parse_curation({"override": [{"id": "x:1", "featured": False}]})

    item = curation.apply(imported("x:1").model_copy(update={"featured": True}))

    assert item.featured is False
    assert item.pinned is False


@pytest.mark.parametrize(
    "data",
    [
        {"override": [{"id": "nope"}]},
        {"override": [{"id": "x:1", "colour": "red"}]},
        {"override": [{"id": "x:1", "pin": 0}]},
        {"unknown": []},
        {
            "native": [
                {
                    "published_at": datetime(2026, 1, 1),  # noqa: DTZ001 - naive on purpose
                    "x": {"url": "https://x.com/a/status/1", "parts": ["t"]},
                }
            ]
        },
        {"native": [{"published_at": WHEN}]},
        {"native": [{"published_at": WHEN, "x": {"url": "https://evil.example/", "parts": ["t"]}}]},
        {"native": [{"published_at": WHEN, "x": {"url": "https://x.com/a/status/1", "parts": []}}]},
        {
            "native": [
                {"published_at": WHEN, "x": {"url": "https://x.com/a/status/1", "parts": ["\x07"]}}
            ]
        },
        {
            "native": [
                {"published_at": WHEN, "x": {"url": "https://x.com/a/status/1", "parts": ["a"]}},
                {"published_at": WHEN, "x": {"url": "https://x.com/b/status/1", "parts": ["b"]}},
            ]
        },
    ],
)
def test_invalid_curation_is_rejected(data):
    with pytest.raises(CurationError):
        parse_curation(data)


def test_errors_never_echo_the_text():
    with pytest.raises(CurationError) as info:
        parse_curation({"override": [{"id": "PRIVATE-TEXT"}]})

    assert "PRIVATE-TEXT" not in str(info.value)


def test_unreadable_and_non_toml_files_are_rejected(tmp_path):
    with pytest.raises(CurationError):
        load_curation(tmp_path / "missing.toml")

    bad = tmp_path / "bad.toml"
    bad.write_text("this is = = not toml")
    with pytest.raises(CurationError):
        load_curation(bad)
