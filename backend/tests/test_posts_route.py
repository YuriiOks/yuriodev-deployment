"""GET|HEAD /api/posts: contract, caching headers, 304s, modes, and a non-blocking startup."""

import asyncio
import time

import httpx
import pytest

import src.core.http
from src.deps import get_feed_service
from src.feed.providers.base import ProviderError
from src.feed.service import FeedConfig, FeedService
from src.routes.posts import etag_matches
from tests.feed_factory import StreamingMockTransport, simple, summary_row


def test_disabled_by_default_returns_the_empty_contract(client):
    response = client.get("/api/posts")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.headers["cache-control"] == "public, max-age=300"
    assert response.headers["etag"].startswith('W/"')
    body = response.json()
    assert set(body) == {"version", "enabled", "generated_at", "source", "items"}
    assert body["version"] == 1
    assert body["enabled"] is False
    assert body["generated_at"].endswith("Z")
    assert body["source"] == {"provider": "none", "status": "disabled", "last_success_at": None}
    assert body["items"] == []


def test_head_returns_headers_without_a_body(client):
    response = client.head("/api/posts")

    assert response.status_code == 200
    assert response.content == b""
    assert response.headers["etag"] == client.get("/api/posts").headers["etag"]
    assert response.headers["cache-control"] == "public, max-age=300"


def test_query_parameters_are_ignored(client):
    plain = client.get("/api/posts")
    with_query = client.get("/api/posts?limit=1&provider=typefully&x=%00")

    assert with_query.status_code == 200
    assert with_query.content == plain.content


@pytest.mark.parametrize("method", ["POST", "PUT", "DELETE"])
def test_write_methods_are_not_allowed(client, method):
    assert client.request(method, "/api/posts").status_code == 405


def test_if_none_match_gives_304(client):
    etag = client.get("/api/posts").headers["etag"]

    for header in (etag, etag.removeprefix("W/"), f'"other", {etag}', "*"):
        response = client.get("/api/posts", headers={"If-None-Match": header})
        assert response.status_code == 304, header
        assert response.content == b""
        assert response.headers["etag"] == etag
        assert response.headers["cache-control"] == "public, max-age=300"

    assert client.get("/api/posts", headers={"If-None-Match": 'W/"nope"'}).status_code == 200


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        (None, False),
        ("", False),
        (" * ", True),
        ('W/"a"', True),
        ('"a"', True),
        ('"b", "a"', True),
        ('"b"', False),
    ],
)
def test_etag_matching(header, expected):
    assert etag_matches(header, 'W/"a"') is expected


def test_fixture_mode_through_the_lifespan(make_client):
    body = make_client(social_feed_enabled=True).get("/api/posts").json()

    assert body["enabled"] is True
    assert body["source"]["provider"] == "fixture"
    assert body["source"]["status"] == "fresh"
    assert len(body["items"]) == 5
    first = body["items"][0]
    assert set(first) == {
        "id",
        "published_at",
        "origin",
        "pinned",
        "featured",
        "has_media",
        "variants",
    }
    assert set(first["variants"]["x"]) == {"id", "url", "published_at", "parts", "truncated"}
    assert first["variants"]["x"]["url"].startswith("https://x.com/")


def test_an_upstream_error_is_a_200_with_status_error(client):
    class Rejecting:
        name = "typefully"
        polls = True

        async def list_published(self):
            raise ProviderError("auth")

        def should_defer(self):
            return False

    feed = FeedService(FeedConfig(enabled=True), Rejecting(), provider_name="typefully")
    asyncio.run(feed.refresh_once())
    client.app.dependency_overrides[get_feed_service] = lambda: feed

    response = client.get("/api/posts")

    assert response.status_code == 200
    assert response.json()["source"]["status"] == "error"
    assert response.json()["items"] == []


def typefully_settings():
    return {
        "social_feed_enabled": True,
        "social_feed_provider": "typefully",
        "typefully_api_key": "tf-route-test-key",
        "typefully_social_set_id": 42,
    }


def use_transport(monkeypatch, handler):
    original = src.core.http.build_http_client

    def patched(settings, transport=None):
        return original(settings, StreamingMockTransport(handler))

    monkeypatch.setattr(src.core.http, "build_http_client", patched)


def test_health_answers_while_the_first_fetch_never_resolves(make_client, monkeypatch):
    started = []

    async def hang(request):
        started.append(request.url.path)
        await asyncio.Event().wait()

    use_transport(monkeypatch, hang)
    client = make_client(**typefully_settings())

    assert client.get("/health").status_code == 200
    assert client.get("/api/health").status_code == 200
    posts = client.get("/api/posts")
    assert posts.status_code == 200
    assert posts.json()["source"]["status"] == "stale"
    assert posts.json()["items"] == []
    assert started == ["/v2/social-sets/42/drafts"]


def test_typefully_mode_end_to_end_with_a_mock_upstream(make_client, monkeypatch):
    full = simple(1)

    def handler(request):
        assert request.headers["authorization"] == "Bearer tf-route-test-key"
        if request.url.path.endswith("/drafts"):
            return httpx.Response(200, json={"results": [summary_row(full)], "next": None})
        return httpx.Response(200, json=full)

    use_transport(monkeypatch, handler)
    client = make_client(**typefully_settings())

    deadline = time.monotonic() + 5
    body = client.get("/api/posts").json()
    while body["source"]["status"] != "fresh" and time.monotonic() < deadline:
        time.sleep(0.05)
        body = client.get("/api/posts").json()

    assert body["source"]["provider"] == "typefully"
    assert body["source"]["status"] == "fresh"
    assert [item["id"] for item in body["items"]] == ["x:1001"]
    assert "PRIVATE" not in str(body)
