"""Hand curation from `feed/content/posts.toml`: pin, feature or hide posts, and add posts that
never went through Typefully (written directly on X or LinkedIn, or older ones).

The file ships with the image and changes through a normal release. It is parsed strictly: an
unknown key, a bad URL or a naive timestamp rejects the whole file (a test loads the real file,
so that fails CI rather than production; at runtime a bad file is logged and ignored).
"""

import tomllib
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC
from pathlib import Path
from typing import Any

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, ValidationError

from src.feed.normalize import cap_parts, clean_text, variant_id
from src.feed.schemas import FeedItem, Platform, PostVariant

CURATION_PATH = Path(__file__).resolve().parent / "content" / "posts.toml"

_STRICT = ConfigDict(extra="forbid", frozen=True)


class CurationError(Exception):
    """The curation file is missing, not TOML, or does not match the schema."""


class Override(BaseModel):
    model_config = _STRICT

    id: str = Field(pattern=r"^(x:\d{1,25}|li:(share|activity|ugcPost):\d{1,25})$")
    pin: int | None = Field(None, ge=1)
    featured: bool | None = None
    hide: bool = False


class NativeVariant(BaseModel):
    model_config = _STRICT

    url: str
    parts: list[str] = Field(min_length=1)
    published_at: AwareDatetime | None = None


class NativePost(BaseModel):
    model_config = _STRICT

    published_at: AwareDatetime
    pin: int | None = Field(None, ge=1)
    featured: bool = False
    has_media: bool = False
    x: NativeVariant | None = None
    linkedin: NativeVariant | None = None


class CurationFile(BaseModel):
    model_config = _STRICT

    override: list[Override] = Field(default_factory=list)
    native: list[NativePost] = Field(default_factory=list)


@dataclass(frozen=True)
class Curation:
    overrides: dict[str, Override] = field(default_factory=dict)
    native: tuple[FeedItem, ...] = ()
    native_pins: dict[str, int] = field(default_factory=dict)

    def _match(self, item: FeedItem) -> Override | None:
        for key in (item.id, *(v.id for v in item.variants.values())):
            if key in self.overrides:
                return self.overrides[key]
        return None

    def hidden(self, item: FeedItem) -> bool:
        match = self._match(item)
        return match is not None and match.hide

    def pin_of(self, item: FeedItem) -> int | None:
        match = self._match(item)
        if match is not None and match.pin is not None:
            return match.pin
        return self.native_pins.get(item.id) if item.origin == "curated" else None

    def apply(self, item: FeedItem) -> FeedItem:
        """The item with curated `pinned` and `featured` applied."""
        match = self._match(item)
        pinned = self.pin_of(item) is not None
        featured = item.featured
        if match is not None and match.featured is not None:
            featured = match.featured
        if pinned == item.pinned and featured == item.featured:
            return item
        return item.model_copy(update={"pinned": pinned, "featured": featured})


def _native_item(post: NativePost, index: int) -> FeedItem:
    variants: dict[Platform, PostVariant] = {}
    raw_variants: Iterable[tuple[Platform, NativeVariant | None]] = (
        ("x", post.x),
        ("linkedin", post.linkedin),
    )
    for platform, native in raw_variants:
        if native is None:
            continue
        vid = variant_id(platform, native.url)
        if vid is None:
            raise CurationError(f"native[{index}].{platform}.url is not a {platform} permalink")
        texts = [t for t in (clean_text(p) for p in native.parts) if t]
        if not texts:
            raise CurationError(f"native[{index}].{platform}.parts is empty")
        parts, truncated = cap_parts(texts)
        published = native.published_at or post.published_at
        variants[platform] = PostVariant(
            id=vid,
            url=native.url,
            published_at=published.astimezone(UTC).replace(microsecond=0),
            parts=parts,
            truncated=truncated,
        )
    if not variants:
        raise CurationError(f"native[{index}] has neither an x nor a linkedin table")
    first: Platform = "x" if "x" in variants else "linkedin"
    return FeedItem(
        id=variants[first].id,
        published_at=min(v.published_at for v in variants.values()),
        origin="curated",
        pinned=post.pin is not None,
        featured=post.featured,
        has_media=post.has_media,
        variants=variants,
    )


def parse_curation(data: dict[str, Any]) -> Curation:
    try:
        parsed = CurationFile.model_validate(data)
    except ValidationError as exc:
        # Locations and error types only: never echo the file's text.
        where = "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['type']}" for e in exc.errors())
        raise CurationError(f"invalid curation file: {where}") from None
    items = tuple(_native_item(post, i) for i, post in enumerate(parsed.native))
    seen: set[str] = set()
    for item in items:
        if item.id in seen:
            raise CurationError(f"duplicate native post {item.id}")
        seen.add(item.id)
    pins = {
        item.id: post.pin
        for item, post in zip(items, parsed.native, strict=True)
        if post.pin is not None
    }
    return Curation(
        overrides={o.id: o for o in parsed.override},
        native=items,
        native_pins=pins,
    )


def load_curation(path: Path = CURATION_PATH) -> Curation:
    try:
        with path.open("rb") as handle:
            data = tomllib.load(handle)
    except OSError as exc:
        raise CurationError(f"cannot read {path.name}: {type(exc).__name__}") from None
    except tomllib.TOMLDecodeError as exc:
        raise CurationError(f"{path.name} is not valid TOML: {exc}") from None
    return parse_curation(data)
