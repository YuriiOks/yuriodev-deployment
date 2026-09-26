"""GET|HEAD /api/posts: the social feed snapshot, served from memory.

Always 200 (or 304): a disabled feed answers `enabled: false` with no items, and upstream
trouble shows up as `source.status`, never as a 5xx. No query parameters are read.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response

from src.deps import get_feed_service
from src.feed.schemas import PostsResponse
from src.feed.service import FeedService

CACHE_CONTROL = "public, max-age=300"

router = APIRouter(tags=["posts"])


def etag_matches(if_none_match: str | None, etag: str) -> bool:
    """Weak comparison (RFC 9110 13.1.2): `*`, or any listed tag with the same opaque value."""
    if not if_none_match:
        return False
    if if_none_match.strip() == "*":
        return True
    wanted = etag.removeprefix("W/")
    return any(tag.strip().removeprefix("W/") == wanted for tag in if_none_match.split(","))


async def get_posts(
    request: Request, feed: Annotated[FeedService, Depends(get_feed_service)]
) -> Response:
    view = feed.view()
    headers = {"ETag": view.etag, "Cache-Control": CACHE_CONTROL}
    if etag_matches(request.headers.get("if-none-match"), view.etag):
        return Response(status_code=304, headers=headers)
    return Response(view.body, media_type="application/json", headers=headers)


router.add_api_route(
    "/api/posts",
    get_posts,
    methods=["GET"],
    response_model=PostsResponse,
    responses={304: {"description": "Not modified"}},
)
# FastAPI answers HEAD with 405 unless it is registered; uvicorn drops the body.
router.add_api_route("/api/posts", get_posts, methods=["HEAD"], include_in_schema=False)
