"""The one outbound HTTP path: a shared client with fixed timeouts and a capped JSON reader.

- One `httpx.AsyncClient` per process, created in the app lifespan and closed on shutdown.
- No credentials on the client: auth headers are passed per request, so a call to another
  host can never carry a provider's key.
- Redirects are never followed, proxy settings from the environment are ignored, bodies are
  capped after decompression, and every error is reduced to a `kind` that carries no URL,
  header or body text.
"""

import asyncio
import json
from collections.abc import AsyncIterator, Mapping
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
    bad_content_type, too_large, bad_json. The exception message is the kind only.
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
        headers={"User-Agent": user_agent(settings), "Accept": "application/json"},
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
    try:
        async with (
            asyncio.timeout(deadline),
            client.stream("GET", url, headers=headers, params=params) as response,
        ):
            if response.status_code != 200:
                raise UpstreamError(
                    classify(response.status_code), response.status_code, response.headers
                )
            content_type = response.headers.get("content-type", "")
            if not content_type.split(";")[0].strip().lower().endswith("json"):
                raise UpstreamError("bad_content_type", 200)
            body = bytearray()
            async for chunk in response.aiter_bytes():  # decoded: also caps compression bombs
                body += chunk
                if len(body) > max_bytes:
                    raise UpstreamError("too_large", 200)
            return json.loads(body), response.headers
    except UpstreamError:
        raise
    except (TimeoutError, httpx.TimeoutException) as exc:
        raise UpstreamError("timeout") from exc
    except httpx.HTTPError as exc:  # transport errors, decoding errors, protocol errors
        raise UpstreamError("connect") from exc
    except ValueError as exc:  # json.JSONDecodeError and UnicodeDecodeError
        raise UpstreamError("bad_json") from exc
