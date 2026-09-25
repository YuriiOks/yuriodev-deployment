"""The only place raw provider drafts become public models.

Allow-list only: a FeedItem is built from named fields, so everything else in a draft (private
notes, titles, tags, internal URLs, media ids, reply settings and any field added upstream
later) can never reach a response. Rules:

- One item per draft, with a variant per platform that is enabled, has a permalink matching its
  pattern, and has text. A draft with no such variant is dropped. The reason says whether that
  was expected (`no_valid_variant`: no platform claims the post, or every one was dropped by a
  rule below) or a sign of a changed upstream format (`incomplete`: a platform is enabled or
  has a permalink but its posts, text, permalink or time are missing; `bad_url`), so the
  service's drift guard can tell the two apart.
- Text is kept as written: styled Unicode letters, emoji joiners and variation selectors stay
  (no NFKC). Only control characters (except newline), bidi overrides and comment-thread markup
  are removed. Parts are capped at 5,000 characters and 30 per variant (`truncated`).
- Fail closed on content that is not plainly Yurii's own public post: a paid partnership drops
  the whole draft, a subscriber-only X part drops the X variant, a LinkedIn reshare drops the
  LinkedIn variant, and X Articles are not imported.
- Variant times come from the full draft (`<platform>_post_published_at`); the listing leaves
  them empty, so the draft's `published_at` is the fallback.
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, TypeGuard

from src.feed.providers.base import DraftSummary
from src.feed.schemas import FeedItem, Platform, PostVariant, variant_id

PLATFORMS: tuple[Platform, ...] = ("x", "linkedin")
MAX_PART_CHARS = 5000
MAX_PARTS = 30

# C0 controls except \n, DEL, C1 controls, and the bidi embedding/override/isolate characters.
_STRIP = re.compile("[\x00-\x09\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]")
# Typefully comment-thread anchors; requested without them, removed again in case they appear.
_COMMENT_MARKUP = re.compile(r"</?typ:[A-Za-z-]+(?:\s[^<>]*)?>")


@dataclass(frozen=True)
class Normalized:
    item: FeedItem | None
    reason: str | None = None  # why the draft was dropped: a code, never content
    skipped: tuple[str, ...] = ()  # variants dropped by a fail-closed rule


def parse_time(value: Any) -> datetime | None:
    """An ISO 8601 timestamp with a zone, as UTC truncated to whole seconds; otherwise None."""
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            return None
        return parsed.astimezone(UTC).replace(microsecond=0)
    except (ValueError, OverflowError):  # OverflowError: a year-1 or year-9999 edge in UTC
        return None


def parse_summary(raw: Any) -> DraftSummary | None:
    """One listing row, or None if it lacks a usable id or update time."""
    if not isinstance(raw, Mapping):
        return None
    draft_id = raw.get("id")
    updated_at = parse_time(raw.get("updated_at"))
    if not _is_int(draft_id) or draft_id <= 0 or updated_at is None:
        return None
    tags = raw.get("tags")
    tag_tuple = tuple(t for t in tags if isinstance(t, str)) if isinstance(tags, list) else ()
    return DraftSummary(
        draft_id=draft_id,
        updated_at=updated_at,
        published_at=parse_time(raw.get("published_at")),
        tags=tag_tuple,
    )


def clean_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _COMMENT_MARKUP.sub("", text)
    return _STRIP.sub("", text).strip()


def cap_parts(texts: Sequence[str]) -> tuple[tuple[str, ...], bool]:
    truncated = len(texts) > MAX_PARTS
    parts: list[str] = []
    for text in texts[:MAX_PARTS]:
        if len(text) > MAX_PART_CHARS:
            text = text[:MAX_PART_CHARS]
            truncated = True
        parts.append(text)
    return tuple(parts), truncated


def normalize_draft(
    raw: Any, summary: DraftSummary | None = None, exclude_tag: str | None = None
) -> Normalized:
    """Turn one full draft (get_draft shape) into a FeedItem, or say why not."""
    if not isinstance(raw, Mapping) or not _is_int(raw.get("id")):
        return Normalized(None, "schema")
    platforms = raw.get("platforms")
    if not isinstance(platforms, Mapping):
        return Normalized(None, "schema")
    tags = raw.get("tags")
    if exclude_tag and isinstance(tags, list) and exclude_tag in tags:
        return Normalized(None, "excluded")

    if raw.get("status") != "published":
        return Normalized(None, "not_published")

    posts = {name: _posts(platforms.get(name)) for name in PLATFORMS}
    if any(p is None for p in posts.values()):
        return Normalized(None, "schema")
    if any(_flag(post, "paid_partnership") for plist in posts.values() for post in plist or ()):
        return Normalized(None, "paid_partnership")

    fallback = parse_time(raw.get("published_at")) or (summary.published_at if summary else None)
    variants: dict[Platform, PostVariant] = {}
    skipped: list[str] = []
    media = False
    bad_url = False
    incomplete = False
    for platform in PLATFORMS:
        plist = posts[platform] or []
        url = raw.get(f"{platform}_published_url")
        enabled = _enabled(platforms.get(platform))
        if not enabled or not plist:
            # Enabled without posts, or a permalink on a platform that is off or empty: the
            # post exists but a field it needs was not found (renamed upstream?).
            incomplete = incomplete or enabled or url is not None
            continue
        if platform == "x" and any(_flag(p, "subscribers_only") for p in plist):
            skipped.append("x:subscribers_only")
            continue
        if platform == "linkedin" and any(p.get("linkedin_reshare_urn") for p in plist):
            skipped.append("linkedin:reshare")
            continue
        vid = variant_id(platform, url) if isinstance(url, str) else None
        if vid is None or not isinstance(url, str):
            if url is None:
                incomplete = True
            else:
                bad_url = True
            continue
        raw_texts = [p.get("text") for p in plist]
        if not any(isinstance(t, str) for t in raw_texts):
            incomplete = True
            continue
        texts = [t for t in (clean_text(r) for r in raw_texts if isinstance(r, str)) if t]
        if not texts:
            skipped.append(f"{platform}:empty")  # published without text (media only)
            continue
        published = parse_time(raw.get(f"{platform}_post_published_at")) or fallback
        if published is None:
            incomplete = True
            continue
        parts, truncated = cap_parts(texts)
        variants[platform] = PostVariant(
            id=vid, url=url, published_at=published, parts=parts, truncated=truncated
        )
        media = media or any(_has_media(p) for p in plist)

    if not variants:
        if _is_x_article(raw, platforms):
            return Normalized(None, "x_article", tuple(skipped))
        reason = "bad_url" if bad_url else "incomplete" if incomplete else "no_valid_variant"
        return Normalized(None, reason, tuple(skipped))

    first: Platform = "x" if "x" in variants else "linkedin"
    item = FeedItem(
        id=variants[first].id,
        published_at=min(v.published_at for v in variants.values()),
        origin="typefully",
        pinned=False,
        featured=False,
        has_media=media,
        variants=variants,
    )
    return Normalized(item, None, tuple(skipped))


def _is_int(value: Any) -> TypeGuard[int]:
    return isinstance(value, int) and not isinstance(value, bool)


def _flag(post: Mapping[str, Any], name: str) -> bool:
    # Anything but an explicit false counts as set: an unexpected value fails closed.
    value = post.get(name, False)
    return value is not False and value is not None


def _enabled(platform: Any) -> bool:
    return isinstance(platform, Mapping) and platform.get("enabled") is True


def _posts(platform: Any) -> list[Mapping[str, Any]] | None:
    """The platform's posts; [] when the platform is absent or off; None when malformed."""
    if platform is None or (isinstance(platform, Mapping) and platform.get("posts") is None):
        return []
    if not isinstance(platform, Mapping):
        return None
    posts = platform.get("posts")
    if not isinstance(posts, list) or not all(isinstance(p, Mapping) for p in posts):
        return None
    return posts


def _has_media(post: Mapping[str, Any]) -> bool:
    ids = post.get("media_ids")
    return isinstance(ids, list) and len(ids) > 0


def _is_x_article(raw: Mapping[str, Any], platforms: Mapping[str, Any]) -> bool:
    return bool(platforms.get("x_article")) or bool(raw.get("x_article_published_url"))
