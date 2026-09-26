"""The public GET /api/posts contract and the on-disk snapshot format.

Every model forbids extra fields, so nothing that is not named here can reach a response or the
snapshot file. Within `version: 1` only additive changes are allowed.
"""

import re
from datetime import datetime
from typing import Final, Literal, Self

from pydantic import BaseModel, model_validator

from src.core.schemas import FROZEN

Platform = Literal["x", "linkedin"]
SourceStatus = Literal["fresh", "stale", "error", "disabled"]
SourceProvider = Literal["typefully", "fixture", "none"]

# The only permalinks a post may carry. The models check them too, so a variant from any
# source (normaliser, curation file, snapshot file) is validated the same way.
X_URL = re.compile(r"https://x\.com/[A-Za-z0-9_]{1,15}/status/(\d{1,25})")
LINKEDIN_URL = re.compile(
    r"https://www\.linkedin\.com/feed/update/urn:li:(share|activity|ugcPost):(\d{1,25})/?"
)


def x_variant_id(url: str) -> str | None:
    match = X_URL.fullmatch(url)
    return f"x:{match.group(1)}" if match else None


def linkedin_variant_id(url: str) -> str | None:
    match = LINKEDIN_URL.fullmatch(url)
    return f"li:{match.group(1)}:{match.group(2)}" if match else None


def variant_id(platform: Platform, url: str) -> str | None:
    """The variant id a permalink stands for, or None if it is not that platform's permalink."""
    return x_variant_id(url) if platform == "x" else linkedin_variant_id(url)


class PostVariant(BaseModel):
    """One platform's version of a post: the text as published, and its permalink."""

    model_config = FROZEN

    id: str  # "x:<digits>" or "li:<share|activity|ugcPost>:<digits>"
    url: str  # matched against the platform's permalink pattern
    published_at: datetime
    parts: tuple[str, ...]  # an X thread has several parts; LinkedIn has one
    truncated: bool  # a part or the part count hit a cap: the permalink has the rest

    @model_validator(mode="after")
    def _permalink_matches_id(self) -> Self:
        if self.id not in (x_variant_id(self.url), linkedin_variant_id(self.url)):
            raise ValueError("url is not the permalink of id")
        return self


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

    @model_validator(mode="after")
    def _variants_match(self) -> Self:
        if not self.variants:
            raise ValueError("an item needs at least one variant")
        for platform, variant in self.variants.items():
            if variant_id(platform, variant.url) != variant.id:
                raise ValueError("a variant is filed under the wrong platform")
        if self.id not in {v.id for v in self.variants.values()}:
            raise ValueError("id is not one of the variant ids")
        return self


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
