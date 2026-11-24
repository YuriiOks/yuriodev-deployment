"""Bank logos from the server's settings: never in the repository.

DASHBOARDS_PROVIDER_LOGOS is a JSON object in the secrets file:

    {"<provider id>": {"on_light": "<uri>", "on_dark": "<uri>", "mark": "<uri>"}, ...}

`on_light` is the version for a light card (dark ink), `on_dark` the one for a dark brand colour
(white ink); `mark` is a square brand icon for small places such as a transaction row. Any of
them may be left out. A provider id is lower-case letters, digits and hyphens (1 to
32 characters); no id is built in, so the id of a bank that must not be named in the repository
works like any other. A value is a base64 data URI of a PNG or an SVG, at most 48 KiB, and an SVG
is also read through: one with a script, an event handler, `javascript:`, an embedded document or
object, an entity or an external reference is dropped, so it is safe as the source of an `<img>`
(the only way a page should show it). Whatever is invalid is dropped one by one, never a startup
error and never logged.
"""

import base64
import json
import re

from src.dashboards.catalog import MAX_ICON_LENGTH

PROVIDER_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,31}")
VARIANTS = ("on_light", "on_dark", "mark")
PNG = "data:image/png;base64,"
SVG = "data:image/svg+xml;base64,"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
# What an SVG may not contain to be harmless in an <img> and safe if someone opens it by itself.
SVG_FORBIDDEN = (
    re.compile(r"<\s*(script|foreignobject|iframe|object|embed|audio|video|animate|set)\b"),
    re.compile(r"<!\s*(entity|doctype)"),
    re.compile(r"\bon[a-z]+\s*="),
    re.compile(r"javascript\s*:"),
    re.compile(r"(href|src)\s*=\s*[\"']?\s*(https?:|//|data:|file:|ftp:)"),
    re.compile(r"url\(\s*[\"']?\s*(https?:|//|data:|file:)"),
    re.compile(r"@import"),
)


def valid_logo(value: object) -> bool:
    if not isinstance(value, str) or len(value) > MAX_ICON_LENGTH:
        return False
    for prefix in (PNG, SVG):
        if value.startswith(prefix):
            try:
                body = base64.b64decode(value[len(prefix) :], validate=True)
            except ValueError:  # binascii.Error is one
                return False
            if prefix == PNG:
                return body.startswith(PNG_SIGNATURE)
            return _safe_svg(body)
    return False


def _safe_svg(body: bytes) -> bool:
    try:
        text = body.decode("utf-8").lower()
    except UnicodeDecodeError:
        return False
    if "<svg" not in text:
        return False
    return not any(pattern.search(text) for pattern in SVG_FORBIDDEN)


def parse_provider_logos(raw: str | None) -> dict[str, dict[str, str]]:
    """The valid logos of the setting: provider id to its variants."""
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except ValueError:
        return {}
    if not isinstance(data, dict):
        return {}
    logos: dict[str, dict[str, str]] = {}
    for provider, variants in data.items():
        if not isinstance(provider, str) or not PROVIDER_ID.fullmatch(provider):
            continue
        if not isinstance(variants, dict):
            continue
        valid = {name: variants[name] for name in VARIANTS if valid_logo(variants.get(name))}
        if valid:
            logos[provider] = valid
    return logos
