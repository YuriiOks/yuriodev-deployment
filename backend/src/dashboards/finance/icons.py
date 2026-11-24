"""The icons of recurring payments: fetched once by the server, never by the browser.

A payment's `icon_url` is an https address the owner typed. The page's content security policy
allows images from itself and `data:` only, so the server fetches the image once (a small PNG or
SVG, through the one outbound client: no redirects, a capped body), checks it like a bank logo
(`logos.valid_logo`: a real PNG, or an SVG with no script or external reference) and keeps it as a
data URI in `recurring.icon_data`. `icon_checked_url` remembers which URL that was for: a changed
URL is fetched again, a refused one is not asked for again until it changes. Nothing is logged but
counts. A host that is an address inside a network (loopback, private, link-local) or has no dot
is not asked.
"""

import base64
import ipaddress
import uuid
from datetime import datetime
from urllib.parse import urlsplit

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.core.http import UpstreamError, request_capped
from src.dashboards.finance.logos import PNG, SVG, valid_logo
from src.dashboards.finance.models import Recurring

MAX_ICON_BYTES = 36 * 1024  # base64 grows it by a third: 48 KiB in all, the logo limit
PER_TICK = 5
MEDIA_PREFIX = {"image/png": PNG, "image/svg+xml": SVG}


def fetchable(url: str) -> bool:
    """An https URL whose host is a public-looking name or address (no DNS lookup is made here:
    a name that resolves inside a network is the one case this does not catch)."""
    host = urlsplit(url).hostname
    if not host or host == "localhost" or host.endswith((".local", ".internal", ".localhost")):
        return False
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return "." in host  # a name: it needs a dot
    return address.is_global


def media(value: str) -> bool:
    return value in MEDIA_PREFIX


async def fetch_icon(client: httpx.AsyncClient, url: str) -> str | None:
    """The data URI of the image at `url`, or None when it cannot be had or is not safe."""
    if not fetchable(url):
        return None
    try:
        _, body, headers = await request_capped(
            client,
            "GET",
            url,
            headers={"Accept": "image/png, image/svg+xml"},
            max_bytes=MAX_ICON_BYTES,
            accepts=media,
        )
    except UpstreamError:
        return None
    kind = headers.get("content-type", "").split(";")[0].strip().lower()
    uri = MEDIA_PREFIX[kind] + base64.b64encode(body).decode()
    return uri if valid_logo(uri) else None


class IconCollector:
    """Under the finance loop (so only when a bank collector runs, like the rates): looks at up
    to five payments per tick whose icon address has not been looked at yet."""

    name = "icons"

    async def collect(
        self,
        client: httpx.AsyncClient,
        sessions: async_sessionmaker[AsyncSession],
        now: datetime,
    ) -> dict[str, int]:
        async with sessions() as session:
            waiting = await self._waiting(session)
        stored = failed = 0
        for row_id, url in waiting:
            icon = await fetch_icon(client, url)
            async with sessions() as session, session.begin():
                await session.execute(
                    update(Recurring)
                    .where(Recurring.id == row_id, Recurring.icon_url == url)
                    .values(icon_data=icon, icon_checked_url=url)
                )
            stored += icon is not None
            failed += icon is None
        return {"icons": stored, "refused": failed}

    @staticmethod
    async def _waiting(session: AsyncSession) -> list[tuple[uuid.UUID, str]]:
        rows = await session.execute(
            select(Recurring.id, Recurring.icon_url)
            .where(
                Recurring.icon_url.is_not(None),
                Recurring.icon_checked_url.is_distinct_from(Recurring.icon_url),
            )
            .order_by(Recurring.updated_at)
            .limit(PER_TICK)
        )
        return [(row_id, url) for row_id, url in rows if url is not None]
