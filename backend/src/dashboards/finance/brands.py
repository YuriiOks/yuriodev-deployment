"""How a bank is shown: its name and a brand colour pair, in code for the public brands.

Logos are not here (they come from the `DASHBOARDS_PROVIDER_LOGOS` setting). A bank that must not
be named in the repository has no entry: its connection carries its own display name and, if the
owner wants, its own colours (`finance.connection.display_name`, `brand_bg`, `brand_fg`), and until
then it is shown with the neutral pair. Every pair, built in or set by the owner, must pass the
WCAG AA contrast of 4.5 for text (`contrast_ratio`).
"""

import re
from dataclasses import dataclass

# Providers with a collector of their own: an account of theirs is never entered by hand.
COLLECTOR_PROVIDERS = frozenset({"monobank", "monzo"})
HEX = re.compile(r"#[0-9a-f]{6}")
MIN_CONTRAST = 4.5


@dataclass(frozen=True)
class Brand:
    name: str
    background: str  # the brand colour
    foreground: str  # the text on it


NEUTRAL = Brand("", "#334155", "#ffffff")
BRANDS: dict[str, Brand] = {
    "aqua": Brand("Aqua", "#0000a6", "#ffffff"),
    "barclays": Brand("Barclays", "#00395d", "#ffffff"),
    "lloyds": Brand("Lloyds Bank", "#006a4d", "#ffffff"),
    "monobank": Brand("monobank", "#16181d", "#ffffff"),
    "monzo": Brand("Monzo", "#14233c", "#ffffff"),
    "paypal": Brand("PayPal", "#003087", "#ffffff"),
    "revolut": Brand("Revolut", "#191c1f", "#ffffff"),
    "starling": Brand("Starling Bank", "#6935d3", "#ffffff"),
    "wise": Brand("Wise", "#163300", "#9fe870"),
}


def _luminance(color: str) -> float:
    def channel(index: int) -> float:
        value = int(color[1 + 2 * index : 3 + 2 * index], 16) / 255
        return value / 12.92 if value <= 0.03928 else ((value + 0.055) / 1.055) ** 2.4

    return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)


def contrast_ratio(first: str, second: str) -> float:
    """The WCAG contrast of two `#rrggbb` colours, 1 to 21."""
    light, dark = sorted((_luminance(first), _luminance(second)), reverse=True)
    return (light + 0.05) / (dark + 0.05)


def readable(background: str, foreground: str) -> bool:
    return bool(HEX.fullmatch(background) and HEX.fullmatch(foreground)) and (
        contrast_ratio(background, foreground) >= MIN_CONTRAST
    )
