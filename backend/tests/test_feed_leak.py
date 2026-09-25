"""Private draft fields never reach the HTTP body or the snapshot file.

A real draft's `scratchpad_text` holds private notes, so this is load-bearing: every private
field in the synthetic drafts carries a sentinel string, and none may appear in the output.
"""

import json

import httpx
import pytest
from pydantic import SecretStr

from src.core.http import build_http_client
from src.feed.providers.fixture import FixtureProvider
from src.feed.providers.typefully import TypefullyProvider
from src.feed.service import FeedConfig, FeedService
from tests.feed_factory import (
    FORBIDDEN_KEYS,
    SENTINELS,
    draft,
    li_post,
    simple,
    summary_row,
    x_post,
)

pytestmark = pytest.mark.anyio

FIXTURE_SENTINEL_WORDS = ("SENTINEL",)


def all_keys(value):
    if isinstance(value, dict):
        for key, child in value.items():
            yield key
            yield from all_keys(child)
    elif isinstance(value, list):
        for child in value:
            yield from all_keys(child)


# The snapshot file keeps provider bookkeeping (internal, not secret); the HTTP body does not.
SNAPSHOT_KEYS = {"draft_id", "social_set_id"}


def assert_clean(text, sentinels, allowed=frozenset()):
    for sentinel in sentinels:
        assert sentinel not in text
    leaked = set(all_keys(json.loads(text))) & (set(FORBIDDEN_KEYS) - set(allowed))
    assert not leaked


async def test_typefully_path_leaks_nothing_to_body_or_snapshot(tmp_path, make_settings):
    drafts = [
        simple(1),
        draft(2, x=[x_post("a"), x_post("b")], linkedin=[li_post("c", media_ids=["m"])]),
    ]

    def handler(request):
        if request.url.path.endswith("/drafts"):
            return httpx.Response(200, json={"results": [summary_row(d) for d in drafts]})
        draft_id = int(request.url.path.rsplit("/", 1)[1])
        return httpx.Response(200, json=next(d for d in drafts if d["id"] == draft_id))

    snapshot = tmp_path / "snap.json"
    settings = make_settings()
    async with build_http_client(settings, httpx.MockTransport(handler)) as client:
        provider = TypefullyProvider(client, SecretStr("k"), 1, call_gap=0)
        feed = FeedService(
            FeedConfig(enabled=True, social_set_id=1, snapshot_path=str(snapshot)),
            provider,
            provider_name="typefully",
        )
        await feed.refresh_once()

    body = feed.view().body.decode()
    assert len(json.loads(body)["items"]) == 2
    assert_clean(body, SENTINELS)
    assert_clean(snapshot.read_text(), SENTINELS, SNAPSHOT_KEYS)


async def test_the_bundled_fixture_leaks_nothing(tmp_path):
    snapshot = tmp_path / "snap.json"
    feed = FeedService(
        FeedConfig(enabled=True, snapshot_path=str(snapshot)),
        FixtureProvider(),
        provider_name="fixture",
    )
    await feed.refresh_once()

    body = feed.view().body.decode()
    assert json.loads(body)["items"], "the fixture should produce visible posts"
    assert_clean(body, FIXTURE_SENTINEL_WORDS)
    assert_clean(snapshot.read_text(), FIXTURE_SENTINEL_WORDS, SNAPSHOT_KEYS)
    raw = FixtureProvider().path.read_text()
    assert "FIXTURE-PRIVATE-SENTINEL" in raw  # the sentinel really is in the input
