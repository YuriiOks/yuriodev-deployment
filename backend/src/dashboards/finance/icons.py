"""The icons of recurring payments: fetched by the server, never by the browser.

A payment has an `icon_url` (an https address the owner typed) and/or a `website` (a host). The
page's content security policy allows images from itself and `data:` only, so the server fetches
the image, checks it like a bank logo (`logos.valid_logo`: a real PNG, or an SVG that is only
drawing) and keeps it as a data URI in `recurring.icon_data`. The raw address is never served.

- With an `icon_url` that one file is fetched. Otherwise the site's own declared icon is looked
  for: the home page's `apple-touch-icon`, its `icon` links (PNG or SVG, the largest first), the
  web manifest's icons, then `/apple-touch-icon.png` and `/favicon.ico`. No third-party favicon
  service is asked.
- Every request goes through `core.http.get_public`: https only, the name resolved here and every
  address required to be public, the request sent to that checked address (so a name cannot be
  re-resolved to an inside one), no redirect followed, no cookie or credential sent, a short
  deadline, a body read as a capped stream. The one hop allowed is the home page's own redirect
  to or from its `www.` form, which goes through the same path. Nothing about a URL is logged.
- A PNG or SVG is kept as it is; an ICO file is not converted but its embedded PNG image (what
  modern .ico files hold) is taken out as it is; a bitmap-only ICO, and any image over 256 KiB
  (no way to scale it down without an imaging library), is refused. A candidate that fails is
  skipped for the next one. Only the start of the home page is read (its head holds the links).
- Why a fetch failed is kept in `icon_error` (not_public, timeout, blocked_status_403, too_large,
  not_an_image, unsafe_svg, bitmap_ico, no_icon_found, ...): never a URL or a header.
- The owner may set an icon by hand (`POST /recurring/{id}/icon`, `icon_manual`): it wins over
  the website and is left alone by the fetcher until `refresh` clears it.
- `icon_checked_url` remembers which source (the URL, or `site:<host>`) the stored data (or the
  refusal) is for, so a changed source is looked at again and a refused one is not asked for every
  minute; `POST /recurring/{id}/icon/refresh` clears it. `icon_state` is none (nothing to fetch),
  pending, ok or failed.
"""

import base64
import json
import logging
import uuid
from collections.abc import Callable
from datetime import datetime
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx
from sqlalchemy import func, literal, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.core.http import Resolver, UpstreamError, get_public, resolve_host
from src.dashboards.finance.logos import PNG, PNG_SIGNATURE, SVG, valid_logo
from src.dashboards.finance.models import Recurring

logger = logging.getLogger("yuriodev.finance")

MAX_ICON_BYTES = 256 * 1024
MAX_DATA_URI = 360_000  # a 256 KiB image as base64, with its prefix
MAX_PAGE_BYTES = 192 * 1024  # only the start of the page is read: the head is all that is wanted
MAX_MANIFEST_BYTES = 64 * 1024
MAX_REQUESTS = 10  # for one site: the page, the manifest, and the icons tried
# What an ordinary client sends, and no more: some sites answer 403 to a bare one. Nothing here
# tries to get past a site that refuses.
BROWSER_AGENT = "Mozilla/5.0 (compatible; icon-fetch/1.0)"
PAGE_HEADERS = {
    "User-Agent": BROWSER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en",
}
IMAGE_HEADERS = {
    "User-Agent": BROWSER_AGENT,
    "Accept": "image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5",
    "Accept-Language": "en",
}
JSON_HEADERS = {
    "User-Agent": BROWSER_AGENT,
    "Accept": "application/manifest+json,application/json;q=0.9,*/*;q=0.5",
}
PER_TICK = 5
SITE = "site:"
HEAD_ICON = {"apple-touch-icon", "apple-touch-icon-precomposed"}


def source_of(icon_url: str | None, website: str | None) -> str | None:
    """What the stored icon is for: the typed address, else the site's host."""
    if icon_url:
        return icon_url
    return SITE + website if website else None


def reason_of(exc: UpstreamError) -> str:
    """A short code for why a fetch failed (never a URL or a header)."""
    if exc.kind == "blocked":
        return "not_public"
    if exc.status in (301, 302, 303, 307, 308):
        return "redirect"
    if exc.status is not None and exc.status != 200:
        refused = exc.status in (401, 403, 429)
        return f"blocked_status_{exc.status}" if refused else f"status_{exc.status}"
    return {
        "timeout": "timeout",
        "connect": "connect_failed",
        "too_large": "too_large",
        "bad_content_type": "not_an_image",
        "bad_encoding": "not_an_image",
    }.get(exc.kind, exc.kind)


def icon_state(row: Any) -> str:
    """none (nothing to fetch), pending, ok or failed."""
    if row.icon_manual and row.icon_data:
        return "ok"
    source = source_of(row.icon_url, row.website)
    if source is None:
        return "none"
    if row.icon_checked_url != source:
        return "pending"
    return "ok" if row.icon_data else "failed"


def is_image(media: str) -> bool:
    return media.startswith("image/") or media in {"application/octet-stream", "text/xml"}


def is_page(media: str) -> bool:
    return media in {"text/html", "application/xhtml+xml"}


def is_json_media(media: str) -> bool:
    return media in {"application/manifest+json", "application/json", "text/json"}


def ico_png(body: bytes) -> bytes | None:
    """The largest PNG image inside an ICO file (modern ones hold PNGs), or None."""
    if len(body) < 22 or body[:4] != b"\x00\x00\x01\x00":
        return None
    count = int.from_bytes(body[4:6], "little")
    best: bytes | None = None
    best_side = 0
    for index in range(min(count, 32)):
        entry = body[6 + 16 * index : 22 + 16 * index]
        if len(entry) < 16:
            break
        side = entry[0] or 256
        size = int.from_bytes(entry[8:12], "little")
        offset = int.from_bytes(entry[12:16], "little")
        data = body[offset : offset + size]
        if data.startswith(PNG_SIGNATURE) and side >= best_side:
            best, best_side = data, side
    return best


def to_data_uri(body: bytes) -> tuple[str | None, str | None]:
    """A PNG, an SVG or the PNG inside an ICO as a data URI that passes the logo checks, else the
    reason: bitmap_ico, not_an_image or unsafe_svg."""
    if body.startswith(b"\x00\x00\x01\x00"):
        inner = ico_png(body)
        if inner is None:
            return None, "bitmap_ico"
        body = inner
    if body.startswith(PNG_SIGNATURE):
        prefix = PNG
    elif b"<svg" in body[:2000].lower():
        prefix = SVG
    else:
        return None, "not_an_image"
    uri = prefix + base64.b64encode(body).decode()
    if valid_logo(uri, limit=MAX_DATA_URI):
        return uri, None
    return None, "unsafe_svg" if prefix == SVG else "not_an_image"


async def fetch_icon(
    client: httpx.AsyncClient, url: str, resolver: Resolver = resolve_host
) -> tuple[str | None, str | None]:
    """(the data URI of the image at `url`, None), or (None, why it could not be had)."""
    try:
        body, _ = await get_public(
            client,
            url,
            resolver=resolver,
            headers=IMAGE_HEADERS,
            max_bytes=MAX_ICON_BYTES,
            accepts=is_image,
        )
    except UpstreamError as exc:
        return None, reason_of(exc)
    return to_data_uri(body)


class _Head(HTMLParser):
    """The `<link>` tags of a page that name an icon or a manifest."""

    def __init__(self) -> None:
        super().__init__()
        self.links: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "link":
            self.links.append({name: value or "" for name, value in attrs})


def _side(sizes: str) -> int:
    """The largest side a `sizes` value names ("any" counts as large: a vector)."""
    best = 0
    for word in sizes.lower().split():
        if word == "any":
            best = max(best, 1024)
        elif "x" in word:
            try:
                best = max(best, int(word.split("x", 1)[0]))
            except ValueError:
                continue
    return best


def page_candidates(page: bytes, base: str) -> tuple[list[str], str | None]:
    """The icon addresses a home page declares, best first, and its manifest's address."""
    parser = _Head()
    parser.feed(page.decode("utf-8", "replace"))
    touch: list[tuple[int, str]] = []
    plain: list[tuple[int, int, str]] = []
    manifest: str | None = None
    for link in parser.links:
        rels = link.get("rel", "").lower().split()
        href = link.get("href", "").strip()
        if not href:
            continue
        target = urljoin(base, href)
        if urlsplit(target).scheme != "https":
            continue
        if HEAD_ICON & set(rels):
            touch.append((_side(link.get("sizes", "")) or 180, target))
        elif "icon" in rels:
            kind = link.get("type", "").lower()
            vector = target.lower().split("?")[0].endswith(".svg") or "svg" in kind
            png = target.lower().split("?")[0].endswith(".png") or "png" in kind
            rank = 2 if vector else 1 if png else 0  # .ico last
            plain.append((rank, _side(link.get("sizes", "")), target))
        elif "manifest" in rels and manifest is None:
            manifest = target
    ordered = [url for _, url in sorted(touch, key=lambda item: -item[0])]
    ordered += [url for _, _, url in sorted(plain, key=lambda item: (-item[0], -item[1]))]
    return ordered, manifest


def manifest_candidates(raw: bytes, base: str) -> list[str]:
    """The addresses of a web manifest's icons, the largest first."""
    try:
        icons = json.loads(raw.decode("utf-8", "replace")).get("icons", [])
    except ValueError, AttributeError:
        return []
    found: list[tuple[int, str]] = []
    for icon in icons if isinstance(icons, list) else []:
        if not isinstance(icon, dict) or not isinstance(icon.get("src"), str):
            continue
        target = urljoin(base, icon["src"])
        if urlsplit(target).scheme == "https":
            found.append((_side(str(icon.get("sizes", ""))), target))
    return [url for _, url in sorted(found, key=lambda item: -item[0])][:4]


def _same_site(first: str, second: str) -> bool:
    """The two hosts are one name with and without `www.`."""
    a, b = first.removeprefix("www."), second.removeprefix("www.")
    return a == b and first != second


async def _home(
    client: httpx.AsyncClient, host: str, resolver: Resolver
) -> tuple[bytes, str] | str:
    """The start of the home page and the address it was read at (one hop to the other `www.`
    form), or the reason it could not be read."""
    url = f"https://{host}/"
    reason = "no_page"
    for _ in range(2):
        try:
            body, _ = await get_public(
                client,
                url,
                resolver=resolver,
                headers=PAGE_HEADERS,
                max_bytes=MAX_PAGE_BYTES,
                accepts=is_page,
                truncate=True,
            )
        except UpstreamError as exc:
            reason = reason_of(exc)
            moved = exc.headers.get("location") if exc.status in (301, 302, 307, 308) else None
            target = urljoin(url, moved) if moved else None
            next_host = urlsplit(target).hostname if target else None
            if (
                next_host
                and urlsplit(url).hostname
                and _same_site(urlsplit(url).hostname or "", next_host.lower())
            ):
                url = f"https://{next_host.lower()}/"
                continue
            return reason
        return body, url
    return reason


async def discover_icon(
    client: httpx.AsyncClient, host: str, resolver: Resolver = resolve_host
) -> tuple[str | None, str | None]:
    """(the site's own declared icon, None), or (None, why not): the first reason a candidate
    failed, `no_icon_found` when the site declares nothing."""
    home = await _home(client, host, resolver)
    errors: list[str] = []
    candidates: list[str] = []
    manifest: str | None = None
    if isinstance(home, str):
        errors.append(home)
        base = f"https://{host}/"
    else:
        base = home[1]
        candidates, manifest = page_candidates(home[0], base)
    budget = MAX_REQUESTS - (0 if isinstance(home, str) else 1)
    tried: set[str] = set()

    async def attempt(url: str) -> str | None:
        nonlocal budget
        if url in tried or budget <= 0:
            return None
        tried.add(url)
        budget -= 1
        uri, why = await fetch_icon(client, url, resolver)
        if why is not None:
            errors.append(why)
        return uri

    for url in candidates:
        if (uri := await attempt(url)) is not None:
            return uri, None
    if manifest and budget > 0:
        budget -= 1
        try:
            raw, _ = await get_public(
                client,
                manifest,
                resolver=resolver,
                headers=JSON_HEADERS,
                max_bytes=MAX_MANIFEST_BYTES,
                accepts=is_json_media,
            )
        except UpstreamError as exc:
            errors.append(reason_of(exc))
            raw = b""
        for url in manifest_candidates(raw, manifest):
            if (uri := await attempt(url)) is not None:
                return uri, None
    for url in (urljoin(base, "/apple-touch-icon.png"), urljoin(base, "/favicon.ico")):
        if (uri := await attempt(url)) is not None:
            return uri, None
    real = [why for why in errors if why != "status_404"]
    return None, real[0] if real else "no_icon_found"


async def resolve_source(
    client: httpx.AsyncClient, source: str, resolver: Resolver = resolve_host
) -> tuple[str | None, str | None]:
    if source.startswith(SITE):
        return await discover_icon(client, source.removeprefix(SITE), resolver)
    return await fetch_icon(client, source, resolver)


async def fill_pending(
    client: httpx.AsyncClient,
    sessions: async_sessionmaker[AsyncSession],
    resolver: Resolver = resolve_host,
    limit: int = PER_TICK,
) -> dict[str, int]:
    """Fetch the icons of up to `limit` payments whose source has not been looked at (a payment
    whose icon the owner set by hand is left alone). A failure keeps the row, stores no icon and
    records why in `icon_error`."""
    async with sessions() as session:
        waiting = await _waiting(session, limit)
    stored = failed = 0
    for row_id, source in waiting:
        icon, error = await resolve_source(client, source, resolver)
        async with sessions() as session, session.begin():
            await session.execute(
                update(Recurring)
                .where(Recurring.id == row_id, _source() == source)
                .values(icon_data=icon, icon_checked_url=source, icon_error=error)
            )
        stored += icon is not None
        failed += icon is None
    return {"icons": stored, "refused": failed}


def _source() -> Any:
    return func.coalesce(Recurring.icon_url, literal(SITE) + Recurring.website)


async def _waiting(session: AsyncSession, limit: int) -> list[tuple[uuid.UUID, str]]:
    source = _source()
    rows = await session.execute(
        select(Recurring.id, source)
        .where(
            source.is_not(None),
            Recurring.icon_manual.is_(False),
            Recurring.icon_checked_url.is_distinct_from(source),
        )
        .order_by(Recurring.updated_at)
        .limit(limit)
    )
    return [(row_id, text) for row_id, text in rows if text is not None]


class IconCollector:
    """Under the finance loop (so only when a bank collector runs, like the rates): a safety net
    for what the background fetch after a write did not get to."""

    name = "icons"

    async def collect(
        self,
        client: httpx.AsyncClient,
        sessions: async_sessionmaker[AsyncSession],
        now: datetime,
    ) -> dict[str, int]:
        return await fill_pending(client, sessions)


async def fill_in_background(
    sessions: async_sessionmaker[AsyncSession],
    client_for: Callable[[], Any],
    resolver: Resolver = resolve_host,
) -> None:
    """Run after a write has been answered: a few pending icons, under a short deadline. Never
    raises (a failure is logged by class only)."""
    try:
        async with client_for() as client:
            await fill_pending(client, sessions, resolver)
    except Exception as exc:  # a background task: nothing may escape, nothing is quoted
        extra = {"event": "finance.icons", "error": type(exc).__name__}
        logger.warning("icon fetch failed", extra=extra)
