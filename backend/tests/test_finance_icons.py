"""The icon of a recurring payment is fetched once by the server and shown as a data URI."""

import base64
from datetime import timedelta

import httpx
import pytest

from src.dashboards.finance.icons import IconCollector, fetch_icon, fetchable
from tests.dashboards_support import AUTH, execute, running, scalar
from tests.test_finance_recurring_api import add

pytestmark = pytest.mark.anyio

PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x10\x00\x00\x00\x10" + b"\x00" * 20
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1"/></svg>'
URL = "https://icons.example.test/acme.png"


def serving(body, kind="image/png", status=200):
    seen = []

    def handler(request):
        seen.append(str(request.url))
        stream = httpx.ByteStream(body)
        return httpx.Response(status, headers={"content-type": kind}, stream=stream)

    return handler, seen


@pytest.mark.parametrize(
    ("url", "ok"),
    [
        (URL, True),
        ("https://8.8.8.8/a.png", True),
        ("https://127.0.0.1/a.png", False),
        ("https://10.1.2.3/a.png", False),
        ("https://169.254.169.254/latest", False),
        ("https://localhost/a.png", False),
        ("https://intranet/a.png", False),
        ("https://box.internal/a.png", False),
    ],
)
def test_only_a_public_looking_host_is_asked(url, ok):
    assert fetchable(url) is ok


async def test_a_png_and_an_svg_become_data_uris_and_anything_else_is_refused():
    async def got(body, kind="image/png", status=200, url=URL):
        handler, seen = serving(body, kind, status)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await fetch_icon(client, url), seen

    png, _ = await got(PNG)
    svg, _ = await got(SVG, "image/svg+xml; charset=utf-8")
    html, _ = await got(b"<html></html>", "text/html")
    fake_png, _ = await got(b"not a png at all")
    script, _ = await got(b"<svg><script>1</script></svg>", "image/svg+xml")
    huge, _ = await got(PNG + b"\x00" * 40_000)
    missing, _ = await got(b"", status=404)
    redirect, _ = await got(b"", status=302)
    private, asked = await got(PNG, url="https://127.0.0.1/a.png")

    assert png == "data:image/png;base64," + base64.b64encode(PNG).decode()
    assert svg == "data:image/svg+xml;base64," + base64.b64encode(SVG).decode()
    assert {html, fake_png, script, huge, missing, redirect, private} == {None}
    assert asked == []  # no request was made to an address inside a network


async def test_the_collector_fills_a_payments_icon_once_and_shows_it_only_for_its_own_address(
    db_url, make_dashboards_app, clock
):
    handler, seen = serving(PNG)
    app = make_dashboards_app(db_url)
    async with (
        running(app, AUTH) as client,
        httpx.AsyncClient(transport=httpx.MockTransport(handler)) as outbound,
    ):
        sessions = app.state.dashboards.sessions
        made = await add(client, icon_url=URL)
        before = (await client.get(f"/api/dashboards/v1/finance/recurring/{made['id']}")).json()
        first = await IconCollector().collect(outbound, sessions, clock.now)
        again = await IconCollector().collect(outbound, sessions, clock.now + timedelta(minutes=2))
        after = (await client.get(f"/api/dashboards/v1/finance/recurring/{made['id']}")).json()
        moved = await client.patch(
            f"/api/dashboards/v1/finance/recurring/{made['id']}",
            json={"icon_url": "https://icons.example.test/other.png"},
        )
        refetched = await IconCollector().collect(outbound, sessions, clock.now)

    assert before["icon_data"] is None
    assert (first, again) == ({"icons": 1, "refused": 0}, {"icons": 0, "refused": 0})
    assert after["icon_data"] == "data:image/png;base64," + base64.b64encode(PNG).decode()
    assert after["icon_url"] == URL
    assert moved.json()["icon_data"] is None  # not the image of the new address
    assert refetched == {"icons": 1, "refused": 0}
    assert len(seen) == 2


async def test_an_address_that_gave_no_image_is_not_asked_again_until_it_changes(
    db_url, make_dashboards_app, clock
):
    handler, seen = serving(b"nope", "text/html")
    app = make_dashboards_app(db_url)
    async with (
        running(app, AUTH) as client,
        httpx.AsyncClient(transport=httpx.MockTransport(handler)) as outbound,
    ):
        sessions = app.state.dashboards.sessions
        await add(client, icon_url=URL)
        first = await IconCollector().collect(outbound, sessions, clock.now)
        second = await IconCollector().collect(outbound, sessions, clock.now)
        checked = await scalar(db_url, "SELECT icon_checked_url FROM finance.recurring")
        await execute(db_url, "UPDATE finance.recurring SET icon_url = NULL")
        none = await IconCollector().collect(outbound, sessions, clock.now)

    assert (first, second, none) == (
        {"icons": 0, "refused": 1},
        {"icons": 0, "refused": 0},
        {"icons": 0, "refused": 0},
    )
    assert checked == URL
    assert len(seen) == 1
