"""How a bank is shown: its name and a brand colour pair, in code for the public brands.

Logos are not here (they come from the `DASHBOARDS_PROVIDER_LOGOS` setting). A bank that must not
be named in the repository has no entry: its connection carries its own display name and, if the
owner wants, its own colours (`finance.connection.display_name`, `brand_bg`, `brand_fg`), and until
then it is shown with the neutral pair. Every pair, built in or set by the owner, must have a
contrast of at least 3:1 (`contrast_ratio`, the WCAG floor for large text: on a bank's card the
only text is its name and a big bold amount). The background of a built-in pair is the brand's own
signature colour, the ink is chosen for contrast.
"""

import re
from dataclasses import dataclass

# Providers with a collector of their own: an account of theirs is never entered by hand.
COLLECTOR_PROVIDERS = frozenset({"monobank", "monzo"})
HEX = re.compile(r"#[0-9a-f]{6}")
MIN_CONTRAST = 3.0


@dataclass(frozen=True)
class Brand:
    name: str
    background: str  # the brand colour
    foreground: str  # the text on it


NEUTRAL = Brand("", "#334155", "#ffffff")
BRANDS: dict[str, Brand] = {
    "aqua": Brand("Aqua", "#0000a6", "#ffffff"),  # deep blue, white ink
    # The cyan itself (white ink on it is 2.5:1, under the floor), with Barclays' navy as ink.
    "barclays": Brand("Barclays", "#00aeef", "#00395d"),
    "lloyds": Brand("Lloyds Bank", "#006a4d", "#ffffff"),  # dark green
    "monobank": Brand("monobank", "#000000", "#ffffff"),
    "monzo": Brand("Monzo", "#ff4f40", "#ffffff"),  # hot coral: 3.3:1 with white as it is
    "paypal": Brand("PayPal", "#0070ba", "#ffffff"),
    "revolut": Brand("Revolut", "#ffffff", "#191c1f"),  # white card, near-black ink
    "starling": Brand("Starling Bank", "#50ffeb", "#321e37"),  # mint-teal, dark purple ink
    "wise": Brand("Wise", "#9fe870", "#163300"),  # lime, dark green ink
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
