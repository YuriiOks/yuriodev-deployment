"""Bank logos from a setting: what is accepted, what is dropped, and where they are served."""

import base64
import json

import pytest

from src.dashboards.finance.logos import PNG, SVG, parse_provider_logos, valid_logo
from tests.dashboards_support import AUTH, running
from tests.finance_support import seed

pytestmark = pytest.mark.anyio

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


def uri(prefix, body):
    return prefix + base64.b64encode(body).decode()


GOOD_SVG = uri(SVG, b'<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>')
GOOD_PNG = uri(PNG, PNG_BYTES)


def svg(markup):
    return uri(SVG, markup.encode())


def test_a_png_and_a_clean_svg_are_accepted():
    assert valid_logo(GOOD_PNG)
    assert valid_logo(GOOD_SVG)


@pytest.mark.parametrize(
    "value",
    [
        None,
        5,
        "",
        "https://example.test/logo.png",  # a link, not data
        "data:image/png;base64,",  # nothing in it
        "data:image/png;base64,not base64!",
        uri(PNG, b"GIF89a not a png"),  # the wrong signature
        uri("data:image/gif;base64,", b"GIF89a"),
        uri("data:image/webp;base64,", b"RIFF"),  # allowed for space icons, not for logos
        uri("data:image/x-icon;base64,", b"\x00"),
        uri("data:text/html;base64,", b"<svg></svg>"),
        uri(SVG, b"not an svg at all"),
        uri(SVG, b"\xff\xfe<svg/>"),  # not UTF-8
        uri(PNG, PNG_BYTES + b"x" * 49_000),  # over 48 KiB
    ],
)
def test_anything_else_is_dropped(value):
    assert valid_logo(value) is False


@pytest.mark.parametrize(
    "markup",
    [
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        "<svg><SCRIPT src=x></SCRIPT></svg>",
        '<svg onload="x()"></svg>',
        '<svg><rect onclick = "x()"/></svg>',
        '<svg><a href="javascript:x()"><rect/></a></svg>',
        '<svg><a xlink:href="  javascript :x()"/></svg>',
        "<svg><foreignObject><div/></foreignObject></svg>",
        '<svg><iframe src="x"></iframe></svg>',
        "<svg><object data='x'/></svg>",
        "<svg><embed src='x'/></svg>",
        '<svg><image href="https://example.test/x.png"/></svg>',
        '<svg><image xlink:href="//example.test/x.png"/></svg>',
        '<svg><image href="data:image/png;base64,AAAA"/></svg>',
        '<svg><rect style="fill:url(https://example.test/x)"/></svg>',
        "<svg><style>@import url(x);</style></svg>",
        '<!DOCTYPE svg [<!ENTITY a "b">]><svg>&a;</svg>',
        "<svg><animate attributeName='href' values='javascript:x()'/></svg>",
        "<svg><set attributeName='onload' to='x()'/></svg>",
    ],
)
def test_an_svg_that_could_run_or_fetch_anything_is_dropped(markup):
    assert valid_logo(svg(markup)) is False


def test_clean_svg_features_are_kept():
    markup = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><defs>'
        '<linearGradient id="g"><stop offset="0" stop-color="#123"/></linearGradient></defs>'
        '<style>.a{fill:url(#g)}</style><path class="a" d="M0 0h8v8z"/></svg>'
    )

    assert valid_logo(svg(markup)) is True


def test_the_setting_gives_valid_variants_per_provider_and_drops_the_rest():
    raw = json.dumps(
        {
            "monzo": {"on_light": GOOD_SVG, "on_dark": GOOD_PNG, "mark": GOOD_PNG},
            "monobank": {
                "on_dark": GOOD_SVG,
                "on_light": "data:text/plain;base64,AAAA",
                "mark": "data:text/plain;base64,AAAA",
            },
            "neutral-bank": {"on_light": GOOD_PNG},
            "Bad Id": {"on_light": GOOD_PNG},
            "x" * 33: {"on_light": GOOD_PNG},
            "-leading": {"on_light": GOOD_PNG},
            "nothing-valid": {"on_light": "x"},
            "wrong-shape": GOOD_PNG,
            "extra-key": {"on_light": GOOD_PNG, "favicon": GOOD_PNG},
        }
    )

    logos = parse_provider_logos(raw)

    assert logos == {
        "monzo": {"on_light": GOOD_SVG, "on_dark": GOOD_PNG, "mark": GOOD_PNG},
        "monobank": {"on_dark": GOOD_SVG},
        "neutral-bank": {"on_light": GOOD_PNG},
        "extra-key": {"on_light": GOOD_PNG},
    }


@pytest.mark.parametrize("raw", [None, "", "not json", "[]", '"text"', "5", "{"])
def test_a_malformed_setting_is_no_logos_and_never_an_error(raw):
    assert parse_provider_logos(raw) == {}


def test_the_settings_object_reads_it_lazily(make_settings):
    raw = json.dumps({"monzo": {"on_light": GOOD_SVG}})

    assert make_settings(dashboards_provider_logos=raw).provider_logos == {
        "monzo": {"on_light": GOOD_SVG}
    }
    assert make_settings(dashboards_provider_logos="{{").provider_logos == {}
    assert make_settings().provider_logos == {}


async def test_the_providers_answer_has_every_logo_and_every_provider_with_accounts(
    db_url, make_dashboards_app
):
    raw = json.dumps(
        {
            "monzo": {"on_light": GOOD_SVG, "on_dark": GOOD_PNG, "mark": GOOD_SVG},
            "neutral-bank": {"on_dark": GOOD_PNG},
        }
    )
    app = make_dashboards_app(db_url, dashboards_provider_logos=raw)
    async with running(app, AUTH) as client:
        before = await client.get("/api/dashboards/v1/finance/providers")
        await seed(app)  # accounts of the provider "sample"
        after = await client.get("/api/dashboards/v1/finance/providers")
        anonymous = await client.get(
            "/api/dashboards/v1/finance/providers", headers={"X-Dashboards-Token": "nope"}
        )

    assert before.json() == {
        "providers": [
            {
                "id": "monzo",
                "logo": {"on_light": GOOD_SVG, "on_dark": GOOD_PNG, "mark": GOOD_SVG},
            },
            {
                "id": "neutral-bank",
                "logo": {"on_light": None, "on_dark": GOOD_PNG, "mark": None},
            },
        ]
    }
    assert [p["id"] for p in after.json()["providers"]] == ["monzo", "neutral-bank", "sample"]
    assert after.json()["providers"][2]["logo"] == {
        "on_light": None,
        "on_dark": None,
        "mark": None,
    }
    assert anonymous.status_code == 401


async def test_the_logos_are_not_in_the_accounts_answer(db_url, make_dashboards_app):
    raw = json.dumps({"sample": {"on_light": GOOD_SVG}})
    app = make_dashboards_app(db_url, dashboards_provider_logos=raw)
    async with running(app, AUTH) as client:
        await seed(app)
        accounts = await client.get("/api/dashboards/v1/finance/accounts")

    assert GOOD_SVG not in accounts.text  # the page fetches /providers once
