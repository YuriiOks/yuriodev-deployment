"""The one outbound HTTP path: a shared client with fixed timeouts and a capped JSON reader.

- One `httpx.AsyncClient` per process, created in the app lifespan and closed on shutdown.
- No credentials on the client: auth headers are passed per request, so a call to another
  host can never carry a provider's key.
- Redirects are never followed, proxy settings from the environment are ignored, and every
  error is reduced to a `kind` that carries no URL, header or body text; the underlying
  exception is not chained, since an httpx error message can quote a request header.
- Bodies are asked for uncompressed. If a server compresses anyway (gzip or deflate), the body
  is inflated here in bounded steps, so a compression bomb costs at most the cap in memory;
  any other encoding is refused.
"""

import asyncio
import json
import zlib
from collections.abc import AsyncIterator, Callable, Mapping
from contextlib import asynccontextmanager
from typing import Any

import httpx

from src.core.config import Settings

MAX_BODY_BYTES = 2 * 1024 * 1024
TOTAL_DEADLINE_SECONDS = 20.0
TIMEOUT = httpx.Timeout(10.0, connect=5.0)
LIMITS = httpx.Limits(max_connections=4, max_keepalive_connections=2)


class UpstreamError(Exception):
    """A failed upstream call.

    `kind` is one of: timeout, connect, http_5xx, rate_limited, auth, not_found, bad_status,
    bad_content_type, bad_encoding, too_large, bad_json. The exception message is the kind only.
    """

    def __init__(
        self,
        kind: str,
        status: int | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(kind)
        self.kind = kind
        self.status = status
        self.headers: dict[str, str] = {k.lower(): v for k, v in (headers or {}).items()}


def classify(status: int) -> str:
    if status in (401, 403):
        return "auth"
    if status == 404:
        return "not_found"
    if status == 429:
        return "rate_limited"
    if status >= 500:
        return "http_5xx"
    return "bad_status"


def user_agent(settings: Settings) -> str:
    return f"yuriodev-backend/{settings.revision[:12]} (+https://yuriodev.co.uk)"


@asynccontextmanager
async def build_http_client(
    settings: Settings,
    transport: httpx.AsyncBaseTransport | None = None,
) -> AsyncIterator[httpx.AsyncClient]:
    """The shared client. `transport` is for tests (httpx.MockTransport)."""
    async with httpx.AsyncClient(
        timeout=TIMEOUT,
        limits=LIMITS,
        follow_redirects=False,
        trust_env=False,
        headers={
            "User-Agent": user_agent(settings),
            "Accept": "application/json",
            "Accept-Encoding": "identity",
        },
        transport=transport,
    ) as client:
        yield client


async def get_json_capped(
    client: httpx.AsyncClient,
    url: str,
    *,
    headers: Mapping[str, str],
    params: Mapping[str, str | int] | None = None,
    max_bytes: int = MAX_BODY_BYTES,
    deadline: float = TOTAL_DEADLINE_SECONDS,
) -> tuple[Any, httpx.Headers]:
    """GET `url` and parse a JSON body of at most `max_bytes`; raise UpstreamError otherwise."""
    return await request_json_capped(
        client, "GET", url, headers=headers, params=params, max_bytes=max_bytes, deadline=deadline
    )


async def post_json_capped(
    client: httpx.AsyncClient,
    url: str,
    *,
    headers: Mapping[str, str],
    json_body: Any,
    max_bytes: int = MAX_BODY_BYTES,
    deadline: float = TOTAL_DEADLINE_SECONDS,
) -> tuple[Any, httpx.Headers]:
    """POST a JSON body to `url`; the answer is read exactly as `get_json_capped` reads it."""
    return await request_json_capped(
        client,
        "POST",
        url,
        headers=headers,
        json_body=json_body,
        max_bytes=max_bytes,
        deadline=deadline,
    )


async def post_form_capped(
    client: httpx.AsyncClient,
    url: str,
    *,
    headers: Mapping[str, str],
    form: Mapping[str, str],
    max_bytes: int = MAX_BODY_BYTES,
    deadline: float = TOTAL_DEADLINE_SECONDS,
) -> tuple[Any, httpx.Headers]:
    """POST a form-encoded body (OAuth token requests); the answer is read like `get_json_capped`.
    The form may hold a secret: it is never part of an error or a log line."""
    return await request_json_capped(
        client,
        "POST",
        url,
        headers=headers,
        form=form,
        max_bytes=max_bytes,
        deadline=deadline,
    )


def is_json(media_type: str) -> bool:
    return media_type.endswith("json")


CALENDAR_TYPES = ("text/calendar", "application/ics", "application/octet-stream", "text/plain")


def is_calendar(media_type: str) -> bool:
    return media_type in CALENDAR_TYPES


async def request_json_capped(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    headers: Mapping[str, str],
    params: Mapping[str, str | int] | None = None,
    json_body: Any = None,
    form: Mapping[str, str] | None = None,
    max_bytes: int = MAX_BODY_BYTES,
    deadline: float = TOTAL_DEADLINE_SECONDS,
) -> tuple[Any, httpx.Headers]:
    """Send the request and parse a 200 JSON body of at most `max_bytes`; raise UpstreamError
    otherwise."""
    _, body, response_headers = await request_capped(
        client,
        method,
        url,
        headers=headers,
        params=params,
        json_body=json_body,
        form=form,
        max_bytes=max_bytes,
        deadline=deadline,
        accepts=is_json,
    )
    try:
        return json.loads(body), response_headers
    except ValueError:  # json.JSONDecodeError and UnicodeDecodeError
        raise UpstreamError("bad_json", 200) from None


async def request_capped(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    headers: Mapping[str, str],
    params: Mapping[str, str | int] | None = None,
    json_body: Any = None,
    form: Mapping[str, str] | None = None,
    max_bytes: int = MAX_BODY_BYTES,
    deadline: float = TOTAL_DEADLINE_SECONDS,
    accepts: Callable[[str], bool] = is_json,
    not_modified_ok: bool = False,
) -> tuple[int, bytes, httpx.Headers]:
    """Send the request and return (status, body, headers) of a 200 answer whose media type
    `accepts` and whose body is at most `max_bytes`; raise UpstreamError otherwise.

    With `not_modified_ok` a 304 is returned as (304, b"", headers) instead of failing, for
    conditional requests."""
    kind: str
    status: int | None
    try:
        async with (
            asyncio.timeout(deadline),
            client.stream(
                method, url, headers=headers, params=params, json=json_body, data=form
            ) as response,
        ):
            if response.status_code == 304 and not_modified_ok:
                return 304, b"", response.headers
            if response.status_code != 200:
                raise UpstreamError(
                    classify(response.status_code), response.status_code, response.headers
                )
            media_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
            if not accepts(media_type):
                raise UpstreamError("bad_content_type", 200)
            inflater = _inflater(response.headers.get("content-encoding", ""))
            body = bytearray()
            received = 0
            async for chunk in response.aiter_raw():  # raw: decoded here, never by httpx
                received += len(chunk)
                if inflater is None:
                    body += chunk
                else:
                    # At most one byte past the cap per step; the rest waits in unconsumed_tail.
                    body += inflater.decompress(chunk, max_bytes + 1 - len(body))
                if (
                    received > max_bytes
                    or len(body) > max_bytes
                    or (inflater is not None and inflater.unconsumed_tail)
                ):
                    raise UpstreamError("too_large", 200)
            if inflater is not None:
                body += inflater.flush()  # all input is consumed: at most a few bytes remain
            if len(body) > max_bytes:
                raise UpstreamError("too_large", 200)
            return 200, bytes(body), response.headers
    except UpstreamError:
        raise
    except TimeoutError, httpx.TimeoutException:
        kind, status = "timeout", None
    except httpx.HTTPError:  # transport and protocol errors; the message may quote a header
        kind, status = "connect", None
    except zlib.error:
        kind, status = "bad_encoding", 200
    # Raised outside the handler, so the original exception is neither chained nor kept as
    # context: nothing that quotes a request header stays reachable from the error.
    raise UpstreamError(kind, status)


def _inflater(content_encoding: str) -> zlib._Decompress | None:
    """A bounded decompressor for the response's Content-Encoding; None for an identity body."""
    encoding = content_encoding.strip().lower()
    if encoding in ("", "identity"):
        return None
    if encoding in ("gzip", "x-gzip"):
        return zlib.decompressobj(zlib.MAX_WBITS | 16)
    if encoding == "deflate":
        return zlib.decompressobj()
    raise UpstreamError("bad_encoding", 200)
