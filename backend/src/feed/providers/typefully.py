"""Typefully API v2: Yurii's own published drafts for one social set.

- Auth: `Authorization: Bearer <key>` on each request (never on the shared client). Typefully
  keys carry the creating user's full permissions, so the key is treated as able to publish.
  It is read from a SecretStr once, here, and never logged or put in an exception.
- Listing: one page, `GET /v2/social-sets/{id}/drafts?status=published&order_by=-published_at
  &limit=50`. The feed shows at most a dozen posts, so the newest 50 are enough; `next` is never
  followed as a URL.
- Full drafts: `GET /v2/social-sets/{id}/drafts/{draft_id}?exclude_comment_markers=true`, only
  for drafts that are new or whose `updated_at` changed. The listing has no post text and leaves
  the per-platform publish times empty, so the full draft is the source for both.
- URLs are built from a fixed base and integer ids only; nothing from post text is fetched.
- Rate limits: the `X-RateLimit-*` headers are read on every response (their numbers are not
  published). A 429 reports the reset time; a nearly spent budget defers the remaining
  get_draft calls to the next cycle. Calls are sequential with a short gap.
"""

import asyncio
import contextlib
import logging
import time
from collections.abc import Awaitable, Callable, Mapping
from typing import Any, Literal

import httpx
from pydantic import SecretStr

from src.core.http import UpstreamError, get_json_capped
from src.feed.normalize import parse_summary
from src.feed.providers.base import DraftSummary, ProviderError, ProviderErrorKind

API_BASE = "https://api.typefully.com"
PAGE_LIMIT = 50
CALL_GAP_SECONDS = 0.2
LOW_BUDGET = 5

logger = logging.getLogger("yuriodev.feed.typefully")


def _provider_kind(upstream_kind: str) -> ProviderErrorKind:
    if upstream_kind == "auth":
        return "auth"
    if upstream_kind == "not_found":
        return "not_found"
    if upstream_kind == "rate_limited":
        return "rate_limited"
    return "transient"  # timeouts, 5xx, redirects, wrong content type, oversize, bad JSON


def _remaining_and_reset(headers: Mapping[str, str]) -> tuple[int | None, float | None]:
    """Lowest `X-RateLimit-*-Remaining` and latest reset (seconds from now) across the scopes."""
    remaining: list[int] = []
    resets: list[float] = []
    now = time.time()
    for name, value in headers.items():
        key = name.lower()
        if not key.startswith("x-ratelimit-"):
            continue
        try:
            number = float(value)
        except ValueError:
            continue
        if key.endswith("-remaining"):
            remaining.append(int(number))
        elif key.endswith("-reset"):
            # Unpublished format: a large value is an epoch time, a small one a delay.
            resets.append(number - now if number > 1e9 else number)
    retry_after = headers.get("retry-after")
    if retry_after is not None:
        with contextlib.suppress(ValueError):  # the HTTP-date form is not used by Typefully
            resets.append(float(retry_after))
    return (min(remaining) if remaining else None), (max(resets) if resets else None)


class TypefullyProvider:
    name: Literal["typefully"] = "typefully"
    polls = True

    def __init__(
        self,
        client: httpx.AsyncClient,
        api_key: SecretStr,
        social_set_id: int,
        *,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        call_gap: float = CALL_GAP_SECONDS,
    ) -> None:
        self._client = client
        self._auth = {"Authorization": f"Bearer {api_key.get_secret_value()}"}
        self._base = f"{API_BASE}/v2/social-sets/{int(social_set_id)}/drafts"
        self._sleep = sleep
        self._call_gap = call_gap
        self._remaining: int | None = None
        self._calls = 0

    def __repr__(self) -> str:
        return "TypefullyProvider()"

    def should_defer(self) -> bool:
        return self._remaining is not None and self._remaining < LOW_BUDGET

    async def _get(self, url: str, params: Mapping[str, str | int]) -> Any:
        if self._calls:
            await self._sleep(self._call_gap)
        self._calls += 1
        try:
            body, headers = await get_json_capped(
                self._client, url, headers=self._auth, params=params
            )
        except UpstreamError as exc:
            remaining, reset = _remaining_and_reset(exc.headers)
            if remaining is not None:
                self._remaining = remaining
            kind = _provider_kind(exc.kind)
            logger.info(
                "typefully call failed",
                extra={"event": "feed.upstream_error", "kind": exc.kind, "status": exc.status},
            )
            raise ProviderError(kind, retry_after=reset) from None
        self._remaining, _ = _remaining_and_reset(headers)
        return body

    async def list_published(self) -> list[DraftSummary]:
        self._calls = 0
        body = await self._get(
            self._base,
            {"status": "published", "order_by": "-published_at", "limit": PAGE_LIMIT, "offset": 0},
        )
        if not isinstance(body, Mapping) or not isinstance(body.get("results"), list):
            raise ProviderError("transient")
        summaries: list[DraftSummary] = []
        for row in body["results"][:PAGE_LIMIT]:
            summary = parse_summary(row)
            if summary is not None:
                summaries.append(summary)
        return summaries

    async def get_draft(self, draft_id: int) -> Mapping[str, Any]:
        body = await self._get(f"{self._base}/{int(draft_id)}", {"exclude_comment_markers": "true"})
        if not isinstance(body, Mapping):
            raise ProviderError("transient")
        return body
