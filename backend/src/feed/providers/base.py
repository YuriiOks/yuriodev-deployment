"""What the feed service needs from a post source. Raw drafts stay inside `feed/`."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, Protocol

# transient: timeouts, refused connections, 5xx; worth retrying the whole cycle.
# bad_response: an answer that will not get better by asking again (wrong content type, oversize,
#   not JSON, an unexpected status). On a single draft it skips that draft, not the cycle.
ProviderErrorKind = Literal["transient", "bad_response", "rate_limited", "auth", "not_found"]


@dataclass(frozen=True)
class DraftSummary:
    """One row of the published-drafts listing: enough to decide whether to fetch the draft."""

    draft_id: int
    updated_at: datetime
    published_at: datetime | None
    tags: tuple[str, ...]


class ProviderError(Exception):
    """A failed provider call. The message is the kind only (no URL, header or body)."""

    def __init__(self, kind: ProviderErrorKind, retry_after: float | None = None) -> None:
        super().__init__(kind)
        self.kind: ProviderErrorKind = kind
        self.retry_after = retry_after


class FeedProvider(Protocol):
    @property
    def name(self) -> Literal["typefully", "fixture"]: ...

    @property
    def polls(self) -> bool:
        """True: refreshed in the background. False: a static source, read once at startup."""
        ...

    async def list_published(self) -> list[DraftSummary]:
        """The newest published drafts, or raise ProviderError. Never a partial list."""
        ...

    async def get_draft(self, draft_id: int) -> Mapping[str, Any]:
        """One draft in the provider's raw shape, or raise ProviderError."""
        ...

    def should_defer(self) -> bool:
        """True when the provider's rate budget is nearly spent: fetch the rest next cycle."""
        ...
