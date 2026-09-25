"""The public GET /api/posts contract and the on-disk snapshot format.

Every model forbids extra fields, so nothing that is not named here can reach a response or the
snapshot file. Within `version: 1` only additive changes are allowed.
"""

from datetime import datetime
from typing import Final, Literal

from pydantic import BaseModel

from src.core.schemas import FROZEN

Platform = Literal["x", "linkedin"]
SourceStatus = Literal["fresh", "stale", "error", "disabled"]
SourceProvider = Literal["typefully", "fixture", "none"]


class PostVariant(BaseModel):
    """One platform's version of a post: the text as published, and its permalink."""

    model_config = FROZEN

    id: str  # "x:<digits>" or "li:<share|activity|ugcPost>:<digits>"
    url: str  # matched against the platform's permalink pattern
    published_at: datetime
    parts: tuple[str, ...]  # an X thread has several parts; LinkedIn has one
    truncated: bool  # a part or the part count hit a cap: the permalink has the rest


class FeedItem(BaseModel):
    """One piece of content: one card, with a variant per platform it was published on."""

    model_config = FROZEN

    id: str  # the X variant's id if there is one, otherwise the LinkedIn one
    published_at: datetime  # the earliest variant time
    origin: Literal["typefully", "curated"]
    pinned: bool
    featured: bool
    has_media: bool  # the original has images or video; the card links out to see them
    variants: dict[Platform, PostVariant]


class FeedSource(BaseModel):
    model_config = FROZEN

    provider: SourceProvider
    status: SourceStatus
    last_success_at: datetime | None


class PostsResponse(BaseModel):
    model_config = FROZEN

    version: Literal[1] = 1
    enabled: bool
    generated_at: datetime
    source: FeedSource
    items: tuple[FeedItem, ...]


# Snapshot file (internal; never served). Draft ids are provider bookkeeping, not secret.

SNAPSHOT_FORMAT: Final = "yuriodev.posts-snapshot/1"


class SnapshotEntry(BaseModel):
    model_config = FROZEN

    draft_id: int
    updated_at: datetime
    item: FeedItem | None  # None: the draft failed normalisation (see `reason`)
    reason: str | None = None


class FeedSnapshot(BaseModel):
    model_config = FROZEN

    format: Literal["yuriodev.posts-snapshot/1"] = SNAPSHOT_FORMAT
    provider: SourceProvider
    social_set_id: int | None
    saved_at: datetime
    last_success_at: datetime | None
    entries: tuple[SnapshotEntry, ...]
