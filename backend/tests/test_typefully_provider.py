"""TypefullyProvider against httpx.MockTransport: requests, one-page cap, errors, rate limits."""

import gzip
import json
import logging
import time
import tracemalloc
import zlib

import httpx
import pytest
from pydantic import SecretStr

from src.core.http import build_http_client
from src.feed.providers.base import ProviderError
from src.feed.providers.typefully import PAGE_LIMIT, TypefullyProvider
from tests.feed_factory import (
    StreamingMockTransport,
    draft,
    raw_response,
    simple,
    summary_row,
    x_post,
)

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
            make_settings(revision="abcdef1234567890"), StreamingMockTransport(recorder)
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
    async with build_http_client(make_settings(), StreamingMockTransport(rec)) as client:
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
        (httpx.Response(302, headers={"location": "https://evil.example/"}), "bad_response"),
        (httpx.Response(400, json={}), "bad_response"),
        (
            httpx.Response(200, text="<html></html>", headers={"content-type": "text/html"}),
            "bad_response",
        ),
        (
            httpx.Response(200, content=b"{nope", headers={"content-type": "application/json"}),
            "bad_response",
        ),
        (httpx.Response(200, json=["not", "an", "object"]), "bad_response"),
        (httpx.Response(200, json={"results": "nope"}), "bad_response"),
        (
            raw_response(
                200, b"{}", **{"content-type": "application/json", "content-encoding": "br"}
            ),
            "bad_response",
        ),
        (
            raw_response(
                200, b"not gzip", **{"content-type": "application/json", "content-encoding": "gzip"}
            ),
            "bad_response",
        ),
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

    with pytest.raises(ProviderError, match="bad_response"):
        await provider.get_draft(1)


async def test_a_listing_with_an_unusable_row_is_rejected_whole(provider_for, caplog):
    rows = [summary_row(simple(1)), summary_row(simple(2)), summary_row(simple(3))]
    rows[1]["updated_at"] = None
    provider = await provider_for(Recorder(httpx.Response(200, json={"results": rows})))

    with pytest.raises(ProviderError, match="bad_response"):
        await provider.list_published()

    (record,) = [r for r in caplog.records if getattr(r, "event", "") == "feed.listing_invalid"]
    assert (record.rows, record.invalid) == (3, 1)


@pytest.mark.parametrize(
    ("status", "kind"), [(403, "bad_response"), (401, "auth"), (500, "transient")]
)
async def test_get_draft_403_skips_the_draft_but_401_is_auth(provider_for, status, kind):
    provider = await provider_for(Recorder(httpx.Response(status, json={})))

    with pytest.raises(ProviderError) as info:
        await provider.get_draft(1)

    assert info.value.kind == kind


def gzip_bomb_chunks(total, chunk=64 * 1024):
    """A gzip stream of `total` zero bytes, produced and sent in `chunk`-sized raw pieces."""
    compressor = zlib.compressobj(9, zlib.DEFLATED, zlib.MAX_WBITS | 16)
    zeros = b"\0" * (1024 * 1024)

    async def stream():
        buffer = bytearray(compressor.compress(b'{"results": [], "pad": "'))
        for _ in range(total // len(zeros)):
            buffer += compressor.compress(zeros)
            while len(buffer) >= chunk:
                yield bytes(buffer[:chunk])
                del buffer[:chunk]
        buffer += compressor.flush()
        yield bytes(buffer)

    return stream()


async def test_a_compression_bomb_is_capped_in_bounded_memory(provider_for):
    response = httpx.Response(
        200,
        content=gzip_bomb_chunks(64 * 1024 * 1024),
        headers={"content-type": "application/json", "content-encoding": "gzip"},
    )
    provider = await provider_for(Recorder(response))

    tracemalloc.start()
    try:
        with pytest.raises(ProviderError, match="bad_response"):
            await provider.list_published()
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()

    assert peak < 8 * 1024 * 1024  # the cap is 2 MiB; httpx's own decoder would inflate 64 MiB


@pytest.mark.parametrize(
    ("encoding", "compress"),
    [
        ("gzip", gzip.compress),
        ("deflate", zlib.compress),
        ("identity", lambda body: body),
    ],
)
async def test_a_compressed_answer_is_still_read(provider_for, encoding, compress):
    body = json.dumps({"results": [summary_row(simple(1))]}).encode()
    response = httpx.Response(
        200,
        content=compress(body),
        headers={"content-type": "application/json", "content-encoding": encoding},
    )
    rec = Recorder(response)
    provider = await provider_for(rec)

    assert [s.draft_id for s in await provider.list_published()] == [1]
    assert rec.requests[0].headers["accept-encoding"] == "identity"


async def test_an_oversized_plain_body_is_capped(provider_for):
    big = json.dumps({"results": [], "pad": "x" * (3 * 1024 * 1024)}).encode()
    provider = await provider_for(
        Recorder(httpx.Response(200, content=big, headers={"content-type": "application/json"}))
    )

    with pytest.raises(ProviderError, match="bad_response"):
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


@pytest.mark.parametrize("odd", ["inf", "nan", "1e400", "-inf"])
async def test_non_finite_rate_limit_values_are_ignored(provider_for, odd):
    headers = {
        "X-RateLimit-User-Remaining": odd,
        "X-RateLimit-User-Reset": odd,
        "Retry-After": odd,
    }
    ok = listing(simple(1))
    ok.headers.update(headers)
    provider = await provider_for(Recorder(ok))
    assert len(await provider.list_published()) == 1
    assert provider.should_defer() is False

    provider = await provider_for(Recorder(httpx.Response(429, json={}, headers=headers)))
    with pytest.raises(ProviderError) as info:
        await provider.list_published()
    assert info.value.kind == "rate_limited"
    assert info.value.retry_after is None


async def test_a_low_budget_defers_and_a_healthy_one_does_not(provider_for):
    low = listing(simple(1))
    low.headers["X-RateLimit-User-Remaining"] = "4"
    provider = await provider_for(Recorder(low))
    await provider.list_published()
    assert provider.should_defer() is True

    ok = listing(simple(1))
    ok.headers["X-RateLimit-User-Remaining"] = "40"
    ok.headers["X-RateLimit-User-Limit"] = "100"
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


async def test_a_transport_error_quoting_the_key_is_not_kept_on_the_error(provider_for):
    # h11 rejects a malformed header with a message that quotes it; nothing may keep it alive.
    rec = Recorder(httpx.LocalProtocolError(f"Illegal header value b'Bearer {KEY}'"))
    provider = await provider_for(rec)

    with pytest.raises(ProviderError) as info:
        await provider.list_published()

    chain = []
    exc = info.value
    while exc is not None:
        chain.append(exc)
        exc = exc.__cause__ or exc.__context__
    assert all(KEY not in str(e) and KEY not in repr(vars(e)) for e in chain)
    assert not any(isinstance(e, httpx.HTTPError) for e in chain)
