"""Every logo and every payment icon in one answer each, so a page does not fan out into dozens
of image requests (a CDN in front of the site refuses bursts from one visitor with 429).

The per-image addresses stay (`/providers/{id}/logo/{variant}`, `/recurring/{id}/icon`); these
bundles carry the same validated images as data URIs, with a `version` (a hash of exactly what is
in them) that the listing answers repeat (`logos_version`, `icons_version`) so a page knows when
its copy is stale. Cached by the browser for a day, `ETag` = the version, 304 on a match.
"""

import hashlib
import json
from collections.abc import Mapping
from typing import Any

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.dashboards.finance.icons import _source
from src.dashboards.finance.logos import VARIANTS
from src.dashboards.finance.models import Recurring

MAX_BUNDLE_ICON = 64 * 1024  # an icon over this stays reachable by its own address only
MAX_BUNDLE_BYTES = 2 * 1024 * 1024
CACHE = "private, max-age=86400"


def logos_bundle(
    logos: Mapping[str, Mapping[str, str]], connected: set[str]
) -> tuple[str, dict[str, dict[str, str | None]]]:
    """The validated logo variants of the providers that have a connection, and their version."""
    bundle: dict[str, dict[str, str | None]] = {
        provider: {variant: logos[provider].get(variant) for variant in VARIANTS}
        for provider in sorted(logos)
        if provider in connected
    }
    digest = hashlib.sha256(json.dumps(bundle, sort_keys=True).encode()).hexdigest()
    return digest[:16], bundle


def _shown() -> Any:
    """Rows whose stored icon is the one for the address they have now (or set by hand)."""
    return (
        Recurring.icon_data.is_not(None),
        or_(Recurring.icon_manual.is_(True), Recurring.icon_checked_url == _source()),
    )


def _version(pairs: list[tuple[str, str]]) -> str:
    text = "\n".join(f"{key}:{digest}" for key, digest in sorted(pairs))
    return hashlib.sha256(text.encode()).hexdigest()[:16]


async def icons_version(session: AsyncSession) -> str:
    """The version of the icon bundle, from the database without moving the images."""
    rows = await session.execute(
        select(Recurring.id, func.md5(Recurring.icon_data)).where(*_shown())
    )
    return _version([(str(row_id), str(digest)) for row_id, digest in rows])


async def icons_bundle(session: AsyncSession) -> tuple[str, dict[str, str]]:
    """Every payment's icon as a data URI (those over 64 KiB and what would pass 2 MiB are left
    out: they stay reachable by their own address), and the version of all of them."""
    rows = (
        await session.execute(
            select(Recurring.id, Recurring.icon_data, func.md5(Recurring.icon_data)).where(
                *_shown()
            )
        )
    ).all()
    version = _version([(str(row_id), str(digest)) for row_id, _, digest in rows])
    icons: dict[str, str] = {}
    total = 0
    for row_id, data, _ in sorted(rows, key=lambda row: str(row[0])):
        if data is None or len(data) > MAX_BUNDLE_ICON or total + len(data) > MAX_BUNDLE_BYTES:
            continue
        icons[str(row_id)] = str(data)
        total += len(data)
    return version, icons


def cached(request: Request, version: str, payload: dict[str, Any]) -> Response:
    """The bundle with its ETag and a day's private cache, or 304 for a copy that is current."""
    tag = f'"{version}"'
    headers = {"Cache-Control": CACHE, "ETag": tag}
    if request.headers.get("if-none-match") == tag:
        return Response(status_code=304, headers=headers)
    return JSONResponse({"version": version, **payload}, headers=headers)
