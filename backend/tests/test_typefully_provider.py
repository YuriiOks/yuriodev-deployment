"""TypefullyProvider against httpx.MockTransport: requests, one-page cap, errors, rate limits."""

import gzip
import json
import logging
import time

import httpx
import pytest
from pydantic import SecretStr

from src.core.http import build_http_client
from src.feed.providers.base import ProviderError
from src.feed.providers.typefully import PAGE_LIMIT, TypefullyProvider
from tests.feed_factory import draft, simple, summary_row, x_post

pytestmark = pytest.mark.anyio

KEY = "tf-test-key-0123456789abcdef"


class Recorder:
    """A MockTransport handler: a queue of responses (or exceptions), and every request seen."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []

    def __call__(self, request):
        self.requests.append(request)
        response = self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]
        if isinstance(response, Exception):
            raise response
        return response


def listing(*drafts, next_url=None):
    return httpx.Response(
        200, json={"results": [summary_row(d) for d in drafts], "next": next_url, "count": 0}
    )


@pytest.fixture
async def provider_for(make_settings):
    clients = []

    async def _make(recorder, **kw):
        cm = build_http_client(
            make_settings(revision="abcdef1234567890"), httpx.MockTransport(recorder)
        )
        client = await cm.__aenter__()
        clients.append(cm)
        return TypefullyProvider(client, SecretStr(KEY), 334563, call_gap=0, **kw)

    yield _make
    for cm in clients:
        await cm.__aexit__(None, None, None)


async def test_listing_request_shape(provider_for):
    rec = Recorder(listing(simple(1), simple(2)))
    provider = await provider_for(rec)

    summaries = await provider.list_published()

    assert [s.draft_id for s in summaries] == [1, 2]
    (request,) = rec.requests
    assert request.method == "GET"
    assert request.url.host == "api.typefully.com"
    assert request.url.scheme == "https"
    assert request.url.path == "/v2/social-sets/334563/drafts"
    assert dict(request.url.params) == {
        "status": "published",
        "order_by": "-published_at",
        "limit": "50",
        "offset": "0",
    }
    assert request.headers["authorization"] == f"Bearer {KEY}"
    assert (
        request.headers["user-agent"] == "yuriodev-backend/abcdef123456 (+https://yuriodev.co.uk)"
    )
    assert request.headers["accept"] == "application/json"


async def test_one_page_only_and_next_is_never_followed(provider_for):
    drafts = [simple(i) for i in range(1, 61)]
    rec = Recorder(listing(*drafts, next_url="https://evil.example/v2/next?offset=50"))
    provider = await provider_for(rec)

    summaries = await provider.list_published()

    assert len(summaries) == PAGE_LIMIT
    assert len(rec.requests) == 1


async def test_get_draft_request_shape(provider_for):
    rec = Recorder(httpx.Response(200, json=simple(7)))
    provider = await provider_for(rec)

    raw = await provider.get_draft(7)

    assert raw["id"] == 7
    (request,) = rec.requests
    assert request.url.path == "/v2/social-sets/334563/drafts/7"
    assert dict(request.url.params) == {"exclude_comment_markers": "true"}
    assert request.headers["authorization"] == f"Bearer {KEY}"


async def test_calls_are_spaced(make_settings):
    slept = []

    async def fake_sleep(seconds):
        slept.append(seconds)

    rec = Recorder(listing(simple(1)), httpx.Response(200, json=simple(1)))
    async with build_http_client(make_settings(), httpx.MockTransport(rec)) as client:
        provider = TypefullyProvider(client, SecretStr(KEY), 1, sleep=fake_sleep)
        await provider.list_published()
        await provider.get_draft(1)

    assert slept == [0.2]


@pytest.mark.parametrize(
    ("response", "kind"),
    [
        (httpx.Response(401, json={}), "auth"),
        (httpx.Response(403, json={}), "auth"),
        (httpx.Response(404, json={}), "not_found"),
        (httpx.Response(429, json={}), "rate_limited"),
        (httpx.Response(500, json={}), "transient"),
        (httpx.Response(503, text="down"), "transient"),
        (httpx.Response(302, headers={"location": "https://evil.example/"}), "transient"),
        (
            httpx.Response(200, text="<html></html>", headers={"content-type": "text/html"}),
            "transient",
        ),
        (
            httpx.Response(200, content=b"{nope", headers={"content-type": "application/json"}),
            "transient",
        ),
        (httpx.Response(200, json=["not", "an", "object"]), "transient"),
        (httpx.Response(200, json={"results": "nope"}), "transient"),
        (httpx.ReadTimeout("slow"), "transient"),
        (httpx.ConnectError("refused"), "transient"),
    ],
)
async def test_listing_errors_are_classified(provider_for, response, kind):
    rec = Recorder(response)
    provider = await provider_for(rec)

    with pytest.raises(ProviderError) as info:
        await provider.list_published()

    assert info.value.kind == kind
    assert str(info.value) == kind
    assert len(rec.requests) == 1  # no redirect followed, no retry inside the cycle


async def test_get_draft_must_be_an_object(provider_for):
    provider = await provider_for(Recorder(httpx.Response(200, json=[1, 2])))

    with pytest.raises(ProviderError, match="transient"):
        await provider.get_draft(1)


async def test_an_oversized_body_is_capped_after_decompression(provider_for):
    big = json.dumps({"results": [], "pad": "x" * (3 * 1024 * 1024)}).encode()
    response = httpx.Response(
        200,
        content=gzip.compress(big),
        headers={"content-type": "application/json", "content-encoding": "gzip"},
    )
    provider = await provider_for(Recorder(response))

    with pytest.raises(ProviderError, match="transient"):
        await provider.list_published()


async def test_429_reports_the_reset_as_a_delay(provider_for):
    headers = {
        "X-RateLimit-User-Remaining": "0",
        "X-RateLimit-User-Reset": "120",
        "X-RateLimit-SocialSet-Remaining": "3",
        "X-RateLimit-SocialSet-Reset": str(int(time.time()) + 600),  # epoch form
    }
    provider = await provider_for(Recorder(httpx.Response(429, json={}, headers=headers)))

    with pytest.raises(ProviderError) as info:
        await provider.list_published()

    assert info.value.kind == "rate_limited"
    assert 590 <= info.value.retry_after <= 600
    assert provider.should_defer() is True


async def test_retry_after_header_is_honoured(provider_for):
    response = httpx.Response(
        429, json={}, headers={"Retry-After": "90", "X-RateLimit-User-Reset": "x"}
    )
    provider = await provider_for(Recorder(response))

    with pytest.raises(ProviderError) as info:
        await provider.list_published()

    assert info.value.retry_after == 90


async def test_a_low_budget_defers_and_a_healthy_one_does_not(provider_for):
    low = listing(simple(1))
    low.headers["X-RateLimit-User-Remaining"] = "4"
    provider = await provider_for(Recorder(low))
    await provider.list_published()
    assert provider.should_defer() is True

    ok = listing(simple(1))
    ok.headers["X-RateLimit-User-Remaining"] = "40"
    ok.headers["X-RateLimit-User-Reset"] = "later"
    provider = await provider_for(Recorder(ok))
    await provider.list_published()
    assert provider.should_defer() is False


async def test_the_key_never_reaches_logs_or_repr(provider_for, caplog):
    caplog.set_level(logging.DEBUG)
    rec = Recorder(
        httpx.Response(500, json={}),
        httpx.Response(401, json={"detail": "bad key"}),
        listing(draft(3, x=[x_post("t")])),
        httpx.ConnectError("refused"),
    )
    provider = await provider_for(rec)
    for _ in range(2):
        with pytest.raises(ProviderError):
            await provider.list_published()
    await provider.list_published()
    with pytest.raises(ProviderError):
        await provider.get_draft(3)

    text = caplog.text + " ".join(str(vars(r)) for r in caplog.records)
    assert KEY not in text
    assert "Bearer" not in text
    assert KEY not in repr(provider)
