"""FeedService: incremental fetch, status machine, stale guard, drift guard, ordering, snapshot."""

import logging
import os
from datetime import timedelta

import httpx
import pytest
from pydantic import SecretStr

from src.core.http import build_http_client
from src.core.refresh import CycleOutcome
from src.feed.curation import parse_curation
from src.feed.normalize import parse_summary
from src.feed.providers.base import ProviderError
from src.feed.providers.typefully import TypefullyProvider
from src.feed.service import FeedConfig, FeedService
from tests.feed_factory import (
    T0,
    StreamingMockTransport,
    draft,
    li_post,
    simple,
    summary_row,
    x_post,
)

pytestmark = pytest.mark.anyio


class Clock:
    def __init__(self, now=T0):
        self.now = now

    def __call__(self):
        return self.now

    def advance(self, **kw):
        self.now += timedelta(**kw)


class FakeProvider:
    name = "typefully"
    polls = True

    def __init__(self, drafts=()):
        self.drafts = {d["id"]: d for d in drafts}
        self.fetched = []
        self.list_error = None
        self.draft_errors = {}
        self.defer = False

    def set(self, *drafts):
        self.drafts = {d["id"]: d for d in drafts}

    async def list_published(self):
        if self.list_error:
            raise self.list_error
        return [parse_summary(summary_row(d)) for d in self.drafts.values()]

    async def get_draft(self, draft_id):
        self.fetched.append(draft_id)
        if draft_id in self.draft_errors:
            raise self.draft_errors[draft_id]
        return self.drafts[draft_id]

    def should_defer(self):
        return self.defer


def make_feed(provider=None, clock=None, curation=None, **config):
    config.setdefault("enabled", True)
    return FeedService(
        FeedConfig(**config),
        provider if provider is not None else FakeProvider(),
        provider_name="typefully",
        curation=curation,
        clock=clock or Clock(),
    )


def ids(feed):
    return [item.id for item in feed.items(feed.status())]


async def test_first_cycle_fetches_every_draft_and_serves_them_newest_first():
    provider = FakeProvider([simple(1, published="2026-09-01T00:00:00Z", x_at=None), simple(2)])
    feed = make_feed(provider)

    assert (await feed.refresh_once()).outcome is CycleOutcome.OK

    assert sorted(provider.fetched) == [1, 2]
    assert ids(feed) == ["x:1002", "x:1001"]
    assert feed.status() == "fresh"


async def test_unchanged_drafts_are_not_fetched_again_and_changed_ones_are():
    provider = FakeProvider([simple(1), simple(2)])
    feed = make_feed(provider)
    await feed.refresh_once()
    provider.fetched.clear()

    await feed.refresh_once()
    assert provider.fetched == []

    provider.set(simple(1, text="edited", updated="2026-09-21T00:00:00Z"), simple(2))
    await feed.refresh_once()
    assert provider.fetched == [1]
    by_id = {item.id: item for item in feed.items("fresh")}
    assert by_id["x:1001"].variants["x"].parts == ("edited",)


async def test_drafts_missing_from_the_listing_are_dropped():
    provider = FakeProvider([simple(1), simple(2)])
    feed = make_feed(provider)
    await feed.refresh_once()

    provider.set(simple(2))
    await feed.refresh_once()

    assert ids(feed) == ["x:1002"]


async def test_the_exclude_tag_in_the_listing_costs_no_fetch():
    provider = FakeProvider([simple(1, tags=["hide-from-site"]), simple(2)])
    feed = make_feed(provider)

    await feed.refresh_once()

    assert provider.fetched == [2]
    assert ids(feed) == ["x:1002"]


async def test_a_deleted_draft_between_listing_and_fetch_is_skipped():
    provider = FakeProvider([simple(1), simple(2)])
    provider.draft_errors[1] = ProviderError("not_found")
    feed = make_feed(provider)

    assert (await feed.refresh_once()).outcome is CycleOutcome.OK
    assert ids(feed) == ["x:1002"]


async def test_a_low_rate_budget_defers_fetches_and_keeps_old_versions():
    provider = FakeProvider([simple(1)])
    feed = make_feed(provider)
    await feed.refresh_once()

    provider.defer = True
    provider.set(simple(1, text="edited", updated="2026-09-22T00:00:00Z"), simple(2))
    provider.fetched.clear()
    await feed.refresh_once()

    assert provider.fetched == []
    assert ids(feed) == ["x:1001"]
    assert feed.items("fresh")[0].variants["x"].parts == ("post 1",)


# failures and status


@pytest.mark.parametrize(
    ("error", "outcome"),
    [
        (ProviderError("transient"), CycleOutcome.TRANSIENT),
        (ProviderError("rate_limited", retry_after=30), CycleOutcome.RATE_LIMITED),
    ],
)
async def test_upstream_errors_keep_the_snapshot_and_go_stale(error, outcome):
    clock = Clock()
    provider = FakeProvider([simple(1)])
    feed = make_feed(provider, clock, refresh_seconds=1800)
    await feed.refresh_once()

    provider.list_error = error
    clock.advance(minutes=61)
    result = await feed.refresh_once()

    assert result.outcome is outcome
    assert feed.status() == "stale"
    assert ids(feed) == ["x:1001"]
    if outcome is CycleOutcome.RATE_LIMITED:
        assert result.retry_after == 30


async def test_a_get_draft_failure_aborts_the_cycle_without_a_partial_swap():
    provider = FakeProvider([simple(1)])
    feed = make_feed(provider)
    await feed.refresh_once()
    provider.set(simple(1), simple(2))
    provider.draft_errors[2] = ProviderError("transient")

    assert (await feed.refresh_once()).outcome is CycleOutcome.TRANSIENT
    assert ids(feed) == ["x:1001"]


async def test_fresh_within_two_intervals_then_stale():
    clock = Clock()
    feed = make_feed(FakeProvider([simple(1)]), clock, refresh_seconds=1800)
    await feed.refresh_once()

    clock.advance(minutes=60)
    assert feed.status() == "fresh"
    clock.advance(seconds=1)
    assert feed.status() == "stale"


async def test_after_72_hours_without_success_imported_posts_are_withheld_curated_kept():
    clock = Clock()
    curation = parse_curation(
        {
            "native": [
                {
                    "published_at": T0 - timedelta(days=30),
                    "x": {"url": "https://x.com/YuriODev/status/555", "parts": ["curated"]},
                }
            ]
        }
    )
    provider = FakeProvider([simple(1)])
    feed = make_feed(provider, clock, curation=curation)
    await feed.refresh_once()
    provider.list_error = ProviderError("transient")

    clock.advance(hours=72)
    assert feed.status() == "stale"
    assert ids(feed) == ["x:1001", "x:555"]

    clock.advance(seconds=1)
    await feed.refresh_once()
    assert feed.status() == "error"
    assert ids(feed) == ["x:555"]


async def test_no_success_since_start_is_stale_then_error():
    clock = Clock()
    provider = FakeProvider()
    provider.list_error = ProviderError("transient")
    feed = make_feed(provider, clock)
    await feed.refresh_once()

    assert feed.status() == "stale"
    assert feed.state.last_success_at is None
    clock.advance(hours=73)
    assert feed.status() == "error"


@pytest.mark.parametrize("kind", ["auth", "not_found"])
async def test_rejected_credentials_stop_polling_and_report_error(kind, caplog):
    provider = FakeProvider([simple(1)])
    feed = make_feed(provider)
    await feed.refresh_once()
    provider.list_error = ProviderError(kind)

    result = await feed.refresh_once()

    assert result.outcome is CycleOutcome.AUTH
    assert feed.status() == "error"
    assert feed.items("error") == ()
    assert any(r.levelno == logging.ERROR for r in caplog.records)


async def test_a_get_draft_auth_failure_is_an_auth_outcome():
    provider = FakeProvider([simple(1)])
    provider.draft_errors[1] = ProviderError("auth")

    assert (await make_feed(provider).refresh_once()).outcome is CycleOutcome.AUTH


# schema-drift guard


def broken(n):
    raw = simple(n)
    raw["platforms"] = "changed upstream"
    return raw


async def test_drift_guard_keeps_the_previous_snapshot_when_most_drafts_are_invalid(caplog):
    provider = FakeProvider([simple(1)])
    feed = make_feed(provider)
    await feed.refresh_once()
    generation = feed.state.generation

    provider.set(simple(1), broken(2), broken(3), broken(4), simple(5))
    result = await feed.refresh_once()

    assert result.outcome is CycleOutcome.DRIFT
    assert feed.state.generation == generation
    assert ids(feed) == ["x:1001"]
    assert any(getattr(r, "event", "") == "feed.drift" for r in caplog.records)


async def test_with_few_drafts_an_invalid_one_is_just_skipped_and_cached():
    provider = FakeProvider([broken(1), simple(2)])
    feed = make_feed(provider)

    assert (await feed.refresh_once()).outcome is CycleOutcome.OK
    assert ids(feed) == ["x:1002"]
    assert feed.state.entries[1].reason == "schema"

    provider.fetched.clear()
    await feed.refresh_once()
    assert provider.fetched == []  # the invalid draft is not refetched until it changes


async def test_intentional_drops_do_not_count_as_drift():
    drafts = [draft(n, x=[x_post("paid", paid_partnership=True)]) for n in range(1, 5)] + [
        simple(9)
    ]
    feed = make_feed(FakeProvider(drafts))

    assert (await feed.refresh_once()).outcome is CycleOutcome.OK
    assert ids(feed) == ["x:1009"]


@pytest.mark.parametrize("error", [ValueError, OverflowError, KeyError, AttributeError])
async def test_an_unexpected_normaliser_exception_counts_as_schema(monkeypatch, error):
    def boom(*args, **kwargs):
        raise error("unexpected")

    monkeypatch.setattr("src.feed.service.normalize_draft", boom)
    feed = make_feed(FakeProvider([simple(1)]))

    assert (await feed.refresh_once()).outcome is CycleOutcome.OK
    assert feed.state.entries[1].reason == "schema"


def renamed_url(n):
    raw = simple(n)
    raw["x_permalink"] = raw.pop("x_published_url")
    return raw


def renamed_enabled(n):
    raw = simple(n)
    raw["platforms"]["x"]["is_enabled"] = raw["platforms"]["x"].pop("enabled")
    return raw


def renamed_text(n):
    raw = simple(n)
    for post in raw["platforms"]["x"]["posts"]:
        post["body"] = post.pop("text")
    return raw


@pytest.mark.parametrize("rename", [renamed_url, renamed_enabled, renamed_text])
async def test_a_renamed_upstream_field_trips_the_drift_guard(rename):
    provider = FakeProvider([simple(n) for n in range(1, 7)])
    feed = make_feed(provider)
    await feed.refresh_once()
    before = ids(feed)

    provider.set(*(rename(n) for n in range(1, 7)))
    for d in provider.drafts.values():
        d["updated_at"] = "2026-09-21T00:00:00Z"
    result = await feed.refresh_once()

    assert result.outcome is CycleOutcome.DRIFT
    assert ids(feed) == before
    assert feed.status() == "fresh"


async def test_a_draft_that_claims_no_platform_is_an_intentional_drop():
    drafts = [draft(n) for n in range(1, 5)] + [simple(9)]  # nothing enabled, no permalinks

    feed = make_feed(FakeProvider(drafts))

    assert (await feed.refresh_once()).outcome is CycleOutcome.OK
    assert ids(feed) == ["x:1009"]
    assert feed.state.entries[1].reason == "no_valid_variant"


async def test_one_unreadable_draft_is_skipped_not_the_whole_cycle():
    provider = FakeProvider([simple(1), simple(2), simple(3)])
    provider.draft_errors[3] = ProviderError("bad_response")
    feed = make_feed(provider)

    for _ in range(2):
        assert (await feed.refresh_once()).outcome is CycleOutcome.OK
    assert sorted(ids(feed)) == ["x:1001", "x:1002"]
    assert feed.state.entries[3].reason == "fetch_failed"
    assert provider.fetched.count(3) == 1  # not retried until the draft changes

    del provider.draft_errors[3]
    provider.set(simple(1), simple(2), simple(3, updated="2026-09-21T00:00:00Z"))
    await feed.refresh_once()
    assert "x:1003" in ids(feed)


async def test_many_unreadable_drafts_count_as_drift():
    provider = FakeProvider([simple(1)])
    feed = make_feed(provider)
    await feed.refresh_once()

    provider.set(*(simple(n) for n in range(1, 6)))
    provider.drafts[1]["updated_at"] = "2026-09-21T00:00:00Z"
    for n in range(1, 5):
        provider.draft_errors[n] = ProviderError("bad_response")

    assert (await feed.refresh_once()).outcome is CycleOutcome.DRIFT
    assert ids(feed) == ["x:1001"]


async def test_an_out_of_range_publish_time_falls_back_instead_of_crashing():
    raw = simple(1, x_at="9999-12-31T23:59:59-01:00")
    feed = make_feed(FakeProvider([raw]))

    assert (await feed.refresh_once()).outcome is CycleOutcome.OK
    (item,) = feed.items("fresh")
    assert item.variants["x"].published_at == T0


# ordering, curation, caps


async def test_pinned_first_by_pin_then_newest_and_capped():
    drafts = [simple(n, x_at=f"2026-09-{n:02d}T09:00:00Z") for n in range(1, 8)]
    curation = parse_curation(
        {"override": [{"id": "x:1002", "pin": 2}, {"id": "x:1001", "pin": 1, "featured": True}]}
    )
    feed = make_feed(FakeProvider(drafts), curation=curation, max_items=4)
    await feed.refresh_once()

    items = feed.items("fresh")

    assert [i.id for i in items] == ["x:1001", "x:1002", "x:1007", "x:1006"]
    assert items[0].pinned
    assert items[0].featured
    assert items[1].pinned
    assert not items[1].featured
    assert not items[2].pinned


async def test_hide_by_variant_id_and_native_duplicates_lose_to_imported():
    raw = draft(1, x=[x_post("x")], linkedin=[li_post("li")])
    curation = parse_curation(
        {
            "override": [{"id": "li:share:7002", "hide": True}],
            "native": [
                {
                    "published_at": T0,
                    "x": {"url": "https://x.com/YuriODev/status/1001", "parts": ["dup"]},
                },
                {
                    "published_at": T0,
                    "linkedin": {
                        "url": "https://www.linkedin.com/feed/update/urn:li:share:9",
                        "parts": ["native"],
                    },
                },
            ],
        }
    )
    provider = FakeProvider([raw, draft(2, linkedin=[li_post("hidden")])])
    feed = make_feed(provider, curation=curation)
    await feed.refresh_once()

    items = feed.items("fresh")

    assert [i.id for i in items] == ["x:1001", "li:share:9"]
    assert items[0].origin == "typefully"
    assert items[0].variants["x"].parts == ("x",)
    assert items[1].origin == "curated"


# views and ETags


async def test_view_is_cached_and_the_etag_changes_when_the_status_changes():
    clock = Clock()
    feed = make_feed(FakeProvider([simple(1)]), clock)
    await feed.refresh_once()

    first = feed.view()
    assert feed.view() is first
    assert first.etag.startswith('W/"')
    assert len(first.etag) == 20

    clock.advance(hours=2)
    stale = feed.view()
    assert stale.status == "stale"
    assert stale.etag != first.etag


async def test_a_new_generation_with_the_same_items_keeps_the_etag():
    clock = Clock()
    feed = make_feed(FakeProvider([simple(1)]), clock)
    await feed.refresh_once()
    first = feed.view()

    clock.advance(minutes=30)
    await feed.refresh_once()
    second = feed.view()

    assert second is not first
    assert second.etag == first.etag
    assert second.body != first.body  # generated_at and last_success_at moved


# snapshot persistence


async def test_snapshot_round_trip(tmp_path):
    path = tmp_path / "snap.json"
    feed = make_feed(FakeProvider([simple(1), broken(2)]), social_set_id=5, snapshot_path=str(path))
    await feed.refresh_once()
    assert path.exists()

    restarted = make_feed(FakeProvider(), social_set_id=5, snapshot_path=str(path))
    assert restarted.load_snapshot() is True

    assert ids(restarted) == ["x:1001"]
    assert restarted.state.last_success_at == T0
    assert restarted.state.entries[2].reason == "schema"


@pytest.mark.parametrize(
    ("find", "replace"),
    [
        ("https://x.com/YuriODev/status/1001", "javascript:alert(1)"),
        ("https://x.com/YuriODev/status/1001", "https://x.com/YuriODev/status/1002"),
        ('"id":"x:1001"', '"id":"x:9"'),
    ],
)
async def test_a_snapshot_with_a_bad_permalink_is_not_loaded(tmp_path, find, replace):
    path = tmp_path / "snap.json"
    await make_feed(
        FakeProvider([simple(1)]), social_set_id=5, snapshot_path=str(path)
    ).refresh_once()
    text = path.read_text()
    assert find in text
    path.write_text(text.replace(find, replace))

    restarted = make_feed(FakeProvider(), social_set_id=5, snapshot_path=str(path))

    assert restarted.load_snapshot() is False
    assert ids(restarted) == []


@pytest.mark.parametrize("other", [{"social_set_id": 6}, {"enabled": False}])
async def test_a_snapshot_for_another_set_or_a_disabled_feed_is_not_loaded(tmp_path, other):
    path = tmp_path / "snap.json"
    await make_feed(
        FakeProvider([simple(1)]), social_set_id=5, snapshot_path=str(path)
    ).refresh_once()

    config = {"social_set_id": 5, "snapshot_path": str(path)} | other
    assert make_feed(FakeProvider(), **config).load_snapshot() is False


async def test_a_snapshot_from_another_provider_is_not_loaded(tmp_path):
    path = tmp_path / "snap.json"
    await make_feed(FakeProvider([simple(1)]), snapshot_path=str(path)).refresh_once()
    fixture_feed = FeedService(
        FeedConfig(enabled=True, snapshot_path=str(path)), FakeProvider(), provider_name="fixture"
    )

    assert fixture_feed.load_snapshot() is False


async def test_without_a_path_nothing_is_written(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    feed = make_feed(FakeProvider([simple(1)]))
    await feed.refresh_once()

    assert os.listdir(tmp_path) == []
    assert feed.describe()["persistent"] is False
    assert feed.load_snapshot() is False


async def test_an_unwritable_directory_falls_back_to_memory_only(tmp_path, caplog):
    feed = make_feed(FakeProvider([simple(1)]), snapshot_path=str(tmp_path / "missing" / "s.json"))

    await feed.refresh_once()
    await feed.refresh_once()

    assert ids(feed) == ["x:1001"]
    events = [getattr(r, "event", "") for r in caplog.records]
    assert events.count("snapshot.write_disabled") == 1


# the real TypefullyProvider through the service (MockTransport)


async def test_publish_times_come_from_get_draft_not_the_listing(make_settings):
    full = draft(
        10, x=[x_post("t")], x_at="2026-09-23T08:17:18.290Z", published="2026-09-23T08:17:30Z"
    )
    seen = []

    def handler(request):
        seen.append(request.url.path)
        if request.url.path.endswith("/drafts"):
            row = summary_row(full)
            assert row["x_post_published_at"] is None
            return httpx.Response(200, json={"results": [row], "next": None})
        return httpx.Response(200, json=full)

    async with build_http_client(make_settings(), StreamingMockTransport(handler)) as client:
        provider = TypefullyProvider(client, SecretStr("k"), 1, call_gap=0)
        feed = make_feed(provider)
        assert (await feed.refresh_once()).outcome is CycleOutcome.OK
        await feed.refresh_once()

    (item,) = feed.items("fresh")
    assert item.variants["x"].published_at.isoformat() == "2026-09-23T08:17:18+00:00"
    assert seen == [
        "/v2/social-sets/1/drafts",
        "/v2/social-sets/1/drafts/10",
        "/v2/social-sets/1/drafts",
    ]


# construction from settings


def test_disabled_by_default(make_settings):
    feed = FeedService.from_settings(make_settings())

    assert feed.enabled is False
    assert feed.provider_name == "none"
    assert feed.status() == "disabled"
    assert feed.items("disabled") == ()
    assert feed.polls is False
    assert feed.is_static is False


async def test_fixture_mode(make_settings):
    feed = FeedService.from_settings(make_settings(social_feed_enabled=True))

    assert feed.provider_name == "fixture"
    assert feed.is_static
    assert not feed.polls
    assert feed.status() == "error"  # nothing loaded yet
    await feed.refresh_once()
    assert feed.status() == "fresh"
    assert len(feed.items("fresh")) == 5


@pytest.mark.parametrize(
    "overrides",
    [
        {},
        {"typefully_api_key": "k"},
        {"typefully_social_set_id": 1},
    ],
)
def test_typefully_without_key_or_set_id_is_misconfigured(make_settings, caplog, overrides):
    settings = make_settings(
        social_feed_enabled=True, social_feed_provider="typefully", **overrides
    )

    feed = FeedService.from_settings(settings, http=object())

    assert feed.misconfigured is True
    assert feed.polls is False
    assert feed.status() == "error"
    (record,) = [r for r in caplog.records if getattr(r, "event", "") == "feed.misconfigured"]
    assert record.levelno == logging.ERROR
    assert set(record.missing) <= {"TYPEFULLY_API_KEY", "TYPEFULLY_SOCIAL_SET_ID"}
    assert record.missing


@pytest.mark.parametrize(
    "key",
    ["tf-key\nsecond-line", "tf key", "tf-k\u00e9y", "tf-key\x00"],
)
def test_a_malformed_key_is_misconfiguration_not_an_outage(make_settings, caplog, key):
    settings = make_settings(
        social_feed_enabled=True,
        social_feed_provider="typefully",
        typefully_api_key=key,
        typefully_social_set_id=1,
    )

    feed = FeedService.from_settings(settings, http=object())

    assert feed.misconfigured is True
    assert feed.polls is False
    assert feed.status() == "error"
    (record,) = [r for r in caplog.records if getattr(r, "event", "") == "feed.misconfigured"]
    assert record.malformed == ["TYPEFULLY_API_KEY"]
    assert record.missing == []
    assert "tf" not in caplog.text


async def test_misconfigured_refresh_is_a_no_op_that_stops(make_settings):
    settings = make_settings(social_feed_enabled=True, social_feed_provider="typefully")

    assert (await FeedService.from_settings(settings).refresh_once()).outcome is CycleOutcome.AUTH


async def test_typefully_configured_polls_and_warns_outside_prod(make_settings, caplog):
    settings = make_settings(
        social_feed_enabled=True,
        social_feed_provider="typefully",
        typefully_api_key="secret-value",
        typefully_social_set_id=334563,
        environment="stage",
    )
    async with build_http_client(settings) as client:
        feed = FeedService.from_settings(settings, client)

    assert feed.polls is True
    assert feed.provider_name == "typefully"
    assert any(getattr(r, "event", "") == "feed.non_prod_poller" for r in caplog.records)
    assert "secret-value" not in caplog.text


def test_a_bad_curation_file_is_logged_and_ignored(make_settings, tmp_path, caplog):
    bad = tmp_path / "posts.toml"
    bad.write_text("[[override]]\nid = 'not-an-id'\n")

    feed = FeedService.from_settings(make_settings(social_feed_enabled=True), curation_path=bad)

    assert feed.curation.overrides == {}
    assert any(getattr(r, "event", "") == "feed.curation_invalid" for r in caplog.records)
