"""Bank logos from the server's settings: never in the repository.

DASHBOARDS_PROVIDER_LOGOS is a JSON object in the secrets file:

    {"<provider id>": {"on_light": "<uri>", "on_dark": "<uri>", "mark": "<uri>"}, ...}

`on_light` is the version for a light card (dark ink), `on_dark` the one for a dark brand colour
(white ink); `mark` is a square brand icon for small places such as a transaction row. Any of
them may be left out. A provider id is lower-case letters, digits and hyphens (1 to
32 characters); no id is built in, so the id of a bank that must not be named in the repository
works like any other. A value is a base64 data URI of a PNG (a real header with a size) or an
SVG, at most 48 KiB. An SVG must parse as XML in the SVG namespace (no document type, so no
entity), may only use the elements and attributes of `SVG_ELEMENTS` and `SVG_ATTRIBUTES` (shapes,
paths, text, gradients, clips, masks, simple filters; no script, image, link, animation or
foreign content), and may point only inside itself (`href="#id"`, `url(#id)`): so it is safe as
the source of an `<img>` and when opened by itself. A `mark` must be square (within 5%) when its
size is known. Besides the three variants a provider may have `"scale"` (a number from 0.5 to 2,
how much larger or smaller than its box the logo looks right: an optical correction) and
`"mono": true` (the logo is one flat colour: a page may recolour it). Whatever is invalid is
dropped one by one, never a startup error and never logged.
"""

import base64
import json
import re
import xml.etree.ElementTree as ET

from src.dashboards.catalog import MAX_ICON_LENGTH

PROVIDER_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,31}")
VARIANTS = ("on_light", "on_dark", "mark")
PNG = "data:image/png;base64,"
SVG = "data:image/svg+xml;base64,"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


SVG_NS = "http://www.w3.org/2000/svg"
XLINK_HREF = "{http://www.w3.org/1999/xlink}href"
_ELEMENTS = (
    "svg g defs path rect circle ellipse line polyline polygon text tspan title desc symbol use "
    "linearGradient radialGradient stop clipPath mask pattern style marker filter feGaussianBlur "
    "feOffset feBlend feColorMatrix feFlood feComposite feMerge feMergeNode"
)
_ATTRIBUTES = (
    "id class style fill fill-opacity fill-rule stroke stroke-width stroke-linecap "
    "stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset stroke-opacity "
    "opacity d x y x1 x2 y1 y2 cx cy r rx ry width height viewBox preserveAspectRatio points "
    "transform version gradientUnits gradientTransform spreadMethod offset stop-color "
    "stop-opacity clip-path clip-rule mask maskUnits maskContentUnits clipPathUnits "
    "patternUnits patternTransform patternContentUnits href font-family font-size font-weight "
    "font-style text-anchor letter-spacing dominant-baseline dy dx rotate textLength fx fy "
    "filter filterUnits in in2 result stdDeviation values type mode operator k1 k2 k3 k4 "
    "flood-color flood-opacity color-interpolation-filters display visibility vector-effect "
    "role aria-hidden aria-label focusable shape-rendering color mix-blend-mode isolation "
    "marker-start marker-mid marker-end markerWidth markerHeight refX refY orient markerUnits "
    "data-name enable-background {http://www.w3.org/XML/1998/namespace}space"
)
SVG_ELEMENTS = frozenset(_ELEMENTS.split())
SVG_ATTRIBUTES = frozenset(_ATTRIBUTES.split())
# Anything that reaches outside the file: a url() that is not `#id`, an import, a script URL.
EXTERNAL_REFERENCE = re.compile(
    r"url\(\s*[\"']?\s*(?:[^#\s\"')]|$)|@import|javascript\s*:|expression\s*\(", re.IGNORECASE
)
# A mark is a square symbol: an aspect ratio this far from 1 is a wordmark in the wrong slot.
MARK_TOLERANCE = 0.05
MAX_SIDE = 20_000


def _local(name: str) -> str:
    return name.rsplit("}", 1)[-1]


def _png_size(body: bytes) -> tuple[int, int] | None:
    """Width and height from the IHDR chunk that must follow the signature."""
    if len(body) < 24 or body[12:16] != b"IHDR":
        return None
    width, height = int.from_bytes(body[16:20], "big"), int.from_bytes(body[20:24], "big")
    return (width, height) if 0 < width <= MAX_SIDE and 0 < height <= MAX_SIDE else None


def _number(value: str | None) -> float | None:
    found = re.fullmatch(r"\s*([0-9]*\.?[0-9]+)\s*(?:px)?\s*", value or "")
    return float(found[1]) if found and float(found[1]) > 0 else None


def _svg_root(body: bytes) -> ET.Element | None:
    """The root of an SVG that has only allowed elements and attributes and no way to reach
    outside itself, or None. Parsed without DTDs (a document type is refused before parsing, so
    no entity can be defined); `href` may only point inside the file (`#id`)."""
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError:
        return None
    if re.search(r"<!\s*(doctype|entity)", text, re.IGNORECASE):
        return None
    try:
        root = ET.fromstring(text)  # noqa: S314 (no DTD reaches here: refused above)
    except ET.ParseError:
        return None
    if root.tag != f"{{{SVG_NS}}}svg":
        return None
    for element in root.iter():
        if not isinstance(element.tag, str) or not element.tag.startswith(f"{{{SVG_NS}}}"):
            return None
        if _local(element.tag) not in SVG_ELEMENTS:
            return None
        if _local(element.tag) == "style" and EXTERNAL_REFERENCE.search(element.text or ""):
            return None
        for name, value in element.attrib.items():
            if name in ("href", XLINK_HREF):
                if not value.startswith("#"):
                    return None
            elif name not in SVG_ATTRIBUTES and not name.startswith("aria-"):
                return None
            if EXTERNAL_REFERENCE.search(value) or "data:" in value.lower():
                return None
    return root


def _svg_size(root: ET.Element) -> tuple[float, float] | None:
    box = root.get("viewBox", "").replace(",", " ").split()
    if len(box) == 4:
        width, height = _number(box[2]), _number(box[3])
        if width and height:
            return width, height
    width, height = _number(root.get("width")), _number(root.get("height"))
    return (width, height) if width and height else None


def logo_size(value: object) -> tuple[float, float] | bool | None:
    """False for something that is not a valid logo; else its (width, height), or None when an
    SVG says no size."""
    if not isinstance(value, str) or len(value) > MAX_ICON_LENGTH:
        return False
    for prefix in (PNG, SVG):
        if value.startswith(prefix):
            try:
                body = base64.b64decode(value[len(prefix) :], validate=True)
            except ValueError:  # binascii.Error is one
                return False
            if prefix == PNG:
                if not body.startswith(PNG_SIGNATURE):
                    return False
                size = _png_size(body)
                return False if size is None else (float(size[0]), float(size[1]))
            root = _svg_root(body)
            return False if root is None else _svg_size(root)
    return False


def valid_logo(value: object, square: bool = False) -> bool:
    """Is it a PNG (a real header with a size) or an SVG that parses, has only allowed elements,
    and reaches nothing outside itself? A `square` one (a mark) must be as wide as it is high
    when its size is known."""
    size = logo_size(value)
    if size is False:
        return False
    if square and isinstance(size, tuple):
        return abs(size[0] / size[1] - 1) <= MARK_TOLERANCE
    return True


def aspect(value: object) -> float | None:
    """Width over height of a valid logo (rounded), None when the logo does not say."""
    size = logo_size(value)
    return round(size[0] / size[1], 3) if isinstance(size, tuple) else None


def parse_logo_options(raw: str | None) -> dict[str, dict[str, float | bool]]:
    """The valid `scale` and `mono` of each provider of the setting."""
    options: dict[str, dict[str, float | bool]] = {}
    try:
        data = json.loads(raw) if raw else None
    except ValueError:
        return {}
    if not isinstance(data, dict):
        return {}
    for provider, variants in data.items():
        if not isinstance(provider, str) or not PROVIDER_ID.fullmatch(provider):
            continue
        if not isinstance(variants, dict):
            continue
        found: dict[str, float | bool] = {}
        scale = variants.get("scale")
        if isinstance(scale, int | float) and not isinstance(scale, bool) and 0.5 <= scale <= 2:
            found["scale"] = float(scale)
        if variants.get("mono") is True:
            found["mono"] = True
        if found:
            options[provider] = found
    return options


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
        valid = {
            name: variants[name]
            for name in VARIANTS
            if valid_logo(variants.get(name), square=name == "mark")
        }
        if valid:
            logos[provider] = valid
    return logos
