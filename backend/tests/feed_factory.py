"""Builders for synthetic Typefully-shaped drafts. Every private field carries a sentinel."""

import copy
from datetime import UTC, datetime

import httpx

SENTINELS = (
    "PRIVATE-SCRATCHPAD-SENTINEL",
    "PRIVATE-TITLE-SENTINEL",
    "PRIVATE-TAG-SENTINEL",
    "PRIVATE-URL-SENTINEL",
    "PRIVATE-SHARE-SENTINEL",
    "PRIVATE-MEDIA-SENTINEL",
    "PRIVATE-PREVIEW-SENTINEL",
    "PRIVATE-QUOTE-SENTINEL",
)
FORBIDDEN_KEYS = (
    "scratchpad_text",
    "draft_title",
    "tags",
    "private_url",
    "share_url",
    "media_ids",
    "quote_post_url",
    "reply_settings",
    "paid_partnership",
    "made_with_ai",
    "linkedin_reshare_urn",
    "subscribers_only",
    "preview",
    "draft_id",
    "social_set_id",
)

T0 = datetime(2026, 9, 20, 9, 0, tzinfo=UTC)


def x_url(n):
    return f"https://x.com/YuriODev/status/{1000 + n}"


def li_url(n):
    return f"https://www.linkedin.com/feed/update/urn:li:share:{7000 + n}"


def x_post(text, **flags):
    post = {
        "text": text,
        "media_ids": [],
        "quote_post_url": "https://x.com/someone/status/1?PRIVATE-QUOTE-SENTINEL",
        "subscribers_only": False,
        "reply_settings": None,
        "paid_partnership": False,
        "made_with_ai": False,
        "hide_link_preview": False,
    }
    post.update(flags)
    return post


def li_post(text, **flags):
    post = {"text": text, "media_ids": [], "linkedin_reshare_urn": None, "hide_link_preview": False}
    post.update(flags)
    return post


def draft(
    n,
    *,
    x=None,
    linkedin=None,
    x_link="default",
    li_link="default",
    updated="2026-09-20T08:30:00.000Z",
    published="2026-09-20T09:00:00.000Z",
    x_at="2026-09-20T09:00:05.000Z",
    li_at="2026-09-20T09:00:01.000Z",
    tags=("PRIVATE-TAG-SENTINEL",),
    status="published",
    x_article=None,
):
    """A full draft (get_draft shape). x/linkedin are lists of posts; None disables it."""
    return {
        "id": n,
        "social_set_id": 1,
        "draft_id": n,
        "status": status,
        "publish_state": "finished",
        "created_at": "2026-09-20T08:00:00.000Z",
        "updated_at": updated,
        "scheduled_date": None,
        "published_at": published,
        "draft_title": "PRIVATE-TITLE-SENTINEL",
        "scratchpad_text": "PRIVATE-SCRATCHPAD-SENTINEL",
        "private_url": "https://typefully.com/?d=PRIVATE-URL-SENTINEL",
        "share_url": "https://typefully.com/t/PRIVATE-SHARE-SENTINEL",
        "preview": "PRIVATE-PREVIEW-SENTINEL",
        "tags": list(tags),
        "platforms": {
            "x": {"enabled": x is not None, "posts": x or [], "settings": None},
            "linkedin": {
                "enabled": linkedin is not None,
                "posts": linkedin or [],
                "settings": None,
            },
            "mastodon": {"enabled": False},
            "x_article": x_article,
        },
        "x_published_url": (x_url(n) if x_link == "default" else x_link) if x is not None else None,
        "linkedin_published_url": (li_url(n) if li_link == "default" else li_link)
        if linkedin is not None
        else None,
        "x_post_published_at": x_at if x is not None else None,
        "linkedin_post_published_at": li_at if linkedin is not None else None,
        "x_article_published_url": None,
    }


def simple(n, text=None, **kw):
    """A published X-only draft with one part and media."""
    return draft(n, x=[x_post(text or f"post {n}", media_ids=["PRIVATE-MEDIA-SENTINEL"])], **kw)


def summary_row(full):
    """The listing row for a full draft: no platforms, no per-platform publish times."""
    row = {k: copy.deepcopy(v) for k, v in full.items() if k != "platforms"}
    row["x_post_published_at"] = None
    return row


class StreamingMockTransport(httpx.MockTransport):
    """A MockTransport whose responses arrive unread, as from a network transport.

    `httpx.Response(content=...)` reads (and decodes) its body at construction; a real transport
    hands over an unread stream, and `get_json_capped` reads the raw bytes itself.
    """

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        response = await super().handle_async_request(request)
        return httpx.Response(
            response.status_code, headers=response.headers, stream=response.stream
        )


def raw_response(status, body, **headers):
    """A response whose body is sent exactly as given (not decoded when it is built)."""
    return httpx.Response(status, headers=headers, stream=httpx.ByteStream(body))
