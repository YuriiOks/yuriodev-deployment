"""Payment icons: fetched by the server through the checked-address path, never by the browser."""

import base64
import json
import uuid

import httpx
import pytest

from src.core.http import (
    UpstreamError,
    get_public,
    public_address,
    public_host,
)
from src.dashboards.finance.icons import (
    discover_icon,
    fetch_icon,
    fill_pending,
    ico_png,
    is_image,
)
from tests.dashboards_support import AUTH, execute, running, scalar
from tests.test_finance_recurring_api import add

pytestmark = pytest.mark.anyio

PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x10\x00\x00\x00\x10" + b"\x00" * 20
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1"/></svg>'
PUBLIC = "93.184.216.34"
BASE = "/api/dashboards/v1/finance"
SHOP = "shop.example.test"
ACME = "https://icons.example.test/acme.png"


def png_uri(body=PNG):
    return "data:image/png;base64," + base64.b64encode(body).decode()


def ico(*entries):
    """An ICO file from (side, data) pairs."""
    head = b"\x00\x00\x01\x00" + len(entries).to_bytes(2, "little")
    offset = 6 + 16 * len(entries)
    table = b""
    body = b""
    for side, data in entries:
        table += bytes([side, side, 0, 0, 1, 0, 32, 0])
        table += len(data).to_bytes(4, "little") + (offset + len(body)).to_bytes(4, "little")
        body += data
    return head + table + body


def resolving(mapping):
    async def resolver(host):
        return mapping.get(host, [PUBLIC])

    return resolver


def site(routes):
    """A fake internet: routes map (host, path) to (status, media type, body, headers)."""
    seen = []

    def handler(request):
        host = request.headers["host"]
        seen.append((host, request.url.host, request.url.path, request.extensions))
        missing = (404, "text/plain", b"", {})
        status, kind, body, extra = routes.get((host, request.url.path), missing)
        stream = httpx.ByteStream(body)
        return httpx.Response(status, headers={"content-type": kind, **extra}, stream=stream)

    return handler, seen


def client_for(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.parametrize(
    ("text", "ok"),
    [
        ("8.8.8.8", True),
        ("93.184.216.34", True),
        ("2606:4700:4700::1111", True),
        ("127.0.0.1", False),
        ("10.1.2.3", False),
        ("172.16.0.9", False),
        ("192.168.1.1", False),
        ("169.254.169.254", False),  # the cloud metadata address
        ("100.64.0.1", False),  # carrier-grade NAT
        ("0.0.0.0", False),  # noqa: S104
        ("224.0.0.1", False),
        ("::1", False),
        ("fe80::1", False),
        ("fc00::1", False),
        ("::ffff:127.0.0.1", False),  # an IPv4 address inside IPv6
        ("::ffff:10.0.0.5", False),
        ("::ffff:169.254.169.254", False),
        ("not an address", False),
    ],
)
def test_only_a_global_address_is_public(text, ok):
    assert public_address(text) is ok


@pytest.mark.parametrize(
    ("url", "host"),
    [
        ("https://Example.COM/a.png", "example.com"),
        ("https://example.com./a.png", "example.com"),  # a trailing dot
        ("https://example.com:443/a.png", "example.com"),
        ("https://bücher.example/a.png", "xn--bcher-kva.example"),
        ("https://8.8.8.8/a.png", "8.8.8.8"),
    ],
)
def test_a_good_https_address_is_normalised(url, host):
    assert public_host(url)[0] == host


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com/a.png",
        "ftp://example.com/a.png",
        "https://user:pw@example.com/a.png",
        "https://user@example.com/",
        "https://example.com:8443/a.png",
        "https://localhost/a.png",
        "https://intranet/a.png",
        "https://127.0.0.1/a.png",
        "https://[::1]/a.png",
        "https://10.0.0.1/a.png",
        "https://[::ffff:127.0.0.1]/a.png",
        "https:///a.png",
        "not a url",
    ],
)
def test_anything_else_is_not_fetchable(url):
    assert public_host(url) is None


async def test_the_request_goes_to_the_checked_address_with_the_name_kept_for_tls():
    handler, seen = site({("icons.example.test", "/a.png"): (200, "image/png", PNG, {})})
    async with client_for(handler) as client:
        body, _ = await get_public(
            client,
            "https://Icons.Example.Test./a.png?v=1",
            resolver=resolving({"icons.example.test": [PUBLIC]}),
            max_bytes=1000,
            accepts=is_image,
        )

    assert body == PNG
    ((host, dialled, path, extensions),) = seen
    assert (host, dialled, path) == ("icons.example.test", PUBLIC, "/a.png")
    assert extensions["sni_hostname"] == "icons.example.test"


@pytest.mark.parametrize(
    "addresses",
    [
        ["127.0.0.1"],
        ["10.1.2.3"],
        ["169.254.169.254"],
        ["100.64.0.5"],
        ["::1"],
        ["::ffff:127.0.0.1"],
        [PUBLIC, "10.0.0.1"],  # one good address and one inside: refused
        ["10.0.0.1", PUBLIC],
        [],
    ],
)
async def test_a_name_that_resolves_to_an_inside_address_is_never_connected_to(addresses):
    handler, seen = site({})
    async with client_for(handler) as client:
        with pytest.raises(UpstreamError) as raised:
            await get_public(
                client,
                "https://sneaky.example.test/a.png",
                resolver=resolving({"sneaky.example.test": addresses}),
                max_bytes=1000,
                accepts=is_image,
            )

    assert raised.value.kind == "blocked"
    assert seen == []  # no socket was opened


async def test_an_address_literal_inside_the_network_is_refused_without_a_lookup():
    handler, seen = site({})
    called = []

    async def resolver(host):
        called.append(host)
        return [PUBLIC]

    async with client_for(handler) as client:
        for url in ("https://10.0.0.1/a.png", "https://[::ffff:10.0.0.1]/a.png"):
            with pytest.raises(UpstreamError):
                await get_public(
                    client, url, resolver=resolver, max_bytes=10, accepts=is_image
                )

    assert (seen, called) == ([], [])


async def test_a_redirect_is_never_followed_and_says_where_it_went():
    routes = {
        ("a.example.test", "/x.png"): (302, "text/plain", b"", {"location": "https://127.0.0.1/p"})
    }
    handler, seen = site(routes)
    async with client_for(handler) as client:
        with pytest.raises(UpstreamError) as raised:
            await get_public(
                client,
                "https://a.example.test/x.png",
                resolver=resolving({}),
                max_bytes=10,
                accepts=is_image,
            )

    assert (raised.value.status, raised.value.headers["location"]) == (302, "https://127.0.0.1/p")
    assert len(seen) == 1  # the inside address was never asked


async def test_a_png_an_svg_and_an_ico_with_a_png_become_data_uris_and_anything_else_is_refused():
    async def got(body, kind="image/png", status=200):
        handler, seen = site({("i.example.test", "/a"): (status, kind, body, {})})
        async with client_for(handler) as client:
            return await fetch_icon(client, "https://i.example.test/a", resolving({}))

    assert await got(PNG) == png_uri()
    assert await got(PNG, "application/octet-stream") == png_uri()  # judged by its signature
    assert (await got(SVG, "image/svg+xml; charset=utf-8")).endswith(base64.b64encode(SVG).decode())
    assert await got(ico((16, PNG), (32, b"BM bitmap"))) == png_uri()
    assert await got(ico((16, b"BM bitmap only"))) is None
    assert await got(b"<html></html>", "text/html") is None
    assert await got(b"not a png at all") is None
    assert await got(b"<svg><script>1</script></svg>", "image/svg+xml") is None
    assert await got(PNG + b"\x00" * 40_000) is None  # over the cap
    assert await got(b"", status=404) is None
    assert await got(b"", status=302) is None


def test_the_largest_png_of_an_ico_is_taken():
    small = PNG
    large = PNG + b"\x01" * 8

    assert ico_png(ico((16, small), (48, large))) == large
    assert ico_png(b"nothing") is None


PAGE = """<!doctype html><html><head>
<link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png">
<link rel="shortcut icon" href="/favicon.ico">
<link rel="apple-touch-icon" sizes="120x120" href="/touch-120.png">
<link rel="apple-touch-icon" sizes="180x180" href="https://cdn.example.test/touch-180.png">
<link rel="manifest" href="/site.webmanifest">
</head><body></body></html>"""


def page(extra=None, body=PAGE):
    routes = {("shop.example.test", "/"): (200, "text/html; charset=utf-8", body.encode(), {})}
    routes.update(extra or {})
    return routes


async def discover(routes, host="shop.example.test"):
    handler, seen = site(routes)
    async with client_for(handler) as client:
        return await discover_icon(client, host, resolving({})), [s[:3] for s in seen]


async def test_the_sites_own_apple_touch_icon_comes_first_and_the_largest_of_them():
    other = PNG + b"\x07" * 4
    routes = page({("cdn.example.test", "/touch-180.png"): (200, "image/png", other, {})})

    uri, seen = await discover(routes)

    assert uri == png_uri(other)
    assert seen[1] == ("cdn.example.test", PUBLIC, "/touch-180.png")  # the second request


async def test_then_the_icon_links_then_the_manifest_then_the_well_known_files():
    body = '<link rel="icon" href="/i.svg" type="image/svg+xml">'
    vector = {(SHOP, "/i.svg"): (200, "image/svg+xml", SVG, {})}
    svg_uri, _ = await discover(page(vector, body))
    icons = [{"src": "/m-48.png", "sizes": "48x48"}, {"src": "/m-192.png", "sizes": "192x192"}]
    manifest = json.dumps({"icons": icons})
    link = '<link rel="manifest" href="/m.json">'
    routes = page(
        {
            (SHOP, "/m.json"): (200, "application/manifest+json", manifest.encode(), {}),
            ("shop.example.test", "/m-192.png"): (200, "image/png", PNG, {}),
        },
        link,
    )
    from_manifest, _ = await discover(routes)
    well_known = {(SHOP, "/apple-touch-icon.png"): (200, "image/png", PNG, {})}
    touch, _ = await discover(page(well_known, "<html></html>"))
    fav, _ = await discover(
        {("shop.example.test", "/favicon.ico"): (200, "image/x-icon", ico((16, PNG)), {})}
    )

    assert svg_uri.startswith("data:image/svg+xml")
    assert from_manifest == png_uri()
    assert touch == png_uri()
    assert fav == png_uri()  # no page at all: the favicon is still tried


async def test_a_site_with_no_icon_gives_none_and_the_requests_stay_few():
    links = "".join(f'<link rel="icon" href="/i{n}.png">' for n in range(30))

    uri, seen = await discover(page({}, links))

    assert uri is None
    assert len(seen) <= 8


async def test_the_home_page_may_hop_between_the_bare_and_the_www_name_only():
    to_www = {"location": "https://www.shop.example.test/"}
    to_evil = {"location": "https://evil.example.test/"}
    routes = {
        (SHOP, "/"): (301, "text/plain", b"", to_www),
        ("www.shop.example.test", "/"): (200, "text/html", PAGE.encode(), {}),
        ("cdn.example.test", "/touch-180.png"): (200, "image/png", PNG, {}),
    }
    elsewhere = {
        (SHOP, "/"): (301, "text/plain", b"", to_evil),
        ("evil.example.test", "/"): (200, "text/html", PAGE.encode(), {}),
    }

    hopped, seen = await discover(routes)
    refused, seen2 = await discover(elsewhere)

    assert hopped == png_uri()
    assert refused is None
    assert all(item[0] != "evil.example.test" for item in seen2)


async def test_a_site_that_resolves_inside_is_never_asked():
    handler, seen = site(page())
    async with client_for(handler) as client:
        inside = resolving({SHOP: ["10.0.0.9"]})
        uri = await discover_icon(client, SHOP, inside)

    assert (uri, seen) == (None, [])


async def test_the_icon_of_a_payment_is_fetched_after_the_write_and_shown_as_data(
    db_url, make_dashboards_app
):
    handler, seen = site(
        {
            ("icons.example.test", "/acme.png"): (200, "image/png", PNG, {}),
            ("shop.example.test", "/"): (200, "text/html", PAGE.encode(), {}),
            ("cdn.example.test", "/touch-180.png"): (200, "image/png", PNG + b"\x02", {}),
        }
    )
    app = make_dashboards_app(db_url)
    app.state.icon_transport = httpx.MockTransport(handler)
    async with running(app, AUTH) as client:
        none = await add(client)
        typed = await add(client, name="Typed", icon_url=ACME)
        by_site = await add(client, name="Site", website="HTTPS://Shop.Example.Test/pricing?x=1")
        both = await add(client, name="Both", icon_url=ACME, website=SHOP)
        rows = {r["name"]: r for r in (await client.get(f"{BASE}/recurring")).json()["recurring"]}
        none_url = {"icon_url": "https://icons.example.test/none.png"}
        moved = await client.patch(f"{BASE}/recurring/{typed['id']}", json=none_url)
        looked_again = (await client.get(f"{BASE}/recurring/{typed['id']}")).json()
        refreshed = await client.post(f"{BASE}/recurring/{by_site['id']}/icon/refresh")

    assert (none["icon_state"], none["icon_data"]) == ("none", None)
    assert (rows["Typed"]["icon_state"], rows["Typed"]["icon_data"]) == ("ok", png_uri())
    assert rows["Site"]["icon_state"] == "ok"
    assert rows["Site"]["icon_data"] == png_uri(PNG + b"\x02")
    assert rows["Site"]["website"] == "shop.example.test"
    assert rows["Both"]["icon_data"] == png_uri()  # the typed address wins over the site
    assert all("icon_url" not in row for row in rows.values())  # the raw address is not served
    assert moved.status_code == 200
    assert looked_again["icon_state"] == "failed"  # fetched in the background: no such file
    assert looked_again["icon_data"] is None
    assert refreshed.json()["icon_state"] == "pending"
    assert any(item[0] == "icons.example.test" for item in seen)


async def test_a_refreshed_icon_is_fetched_again_and_a_failure_keeps_the_row(
    db_url, make_dashboards_app
):
    answers = [(200, "image/png", PNG, {}), (404, "text/plain", b"", {})]

    def handler(request):
        status, kind, body, extra = answers[0]
        return httpx.Response(
            status, headers={"content-type": kind, **extra}, stream=httpx.ByteStream(body)
        )

    app = make_dashboards_app(db_url)
    app.state.icon_transport = httpx.MockTransport(handler)
    async with running(app, AUTH) as client:
        made = await add(client, icon_url="https://icons.example.test/acme.png")
        first = (await client.get(f"{BASE}/recurring/{made['id']}")).json()
        answers.reverse()
        second = await client.post(f"{BASE}/recurring/{made['id']}/icon/refresh")
        after = (await client.get(f"{BASE}/recurring/{made['id']}")).json()
        missing = await client.post(f"{BASE}/recurring/{uuid.uuid4()}/icon/refresh")

    assert first["icon_state"] == "ok"
    assert second.status_code == 200
    assert (after["icon_state"], after["icon_data"]) == ("failed", None)
    assert after["name"] == made["name"]
    assert missing.status_code == 404


@pytest.mark.parametrize(
    ("given", "stored"),
    [
        ("example.com", "example.com"),
        ("https://www.Example.com/a/b?c=d", "www.example.com"),
        ("Example.COM.", "example.com"),
    ],
)
async def test_a_website_is_normalised_to_a_host(db_url, make_dashboards_app, given, stored):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        made = await add(client, website=given)

    assert made["website"] == stored


@pytest.mark.parametrize(
    "given",
    [
        "http://example.com",
        "localhost",
        "10.0.0.1",
        "https://user@example.com",
        "a b.com",
        "example.com:8443",
        "",
    ],
)
async def test_a_website_that_is_not_a_public_host_is_refused(db_url, make_dashboards_app, given):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        body = {"name": "X", "amount": 1, "currency": "GBP", "next_payment_date": "2026-12-15"}
        response = await client.post(f"{BASE}/recurring", json={**body, "website": given})

    assert response.status_code == 422
    assert response.json()["fields"] == ["website"]


async def test_the_website_comes_in_by_csv_and_the_collector_fills_what_is_left(
    db_url, make_dashboards_app, clock
):
    handler, _ = site({("shop.example.test", "/apple-touch-icon.png"): (200, "image/png", PNG, {})})
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client, client_for(handler) as outbound:
        text = (
            "name,amount,currency,frequency,next_payment_date,website\n"
            "A,1,GBP,monthly,2026-12-01,shop.example.test\n"
        )
        sent = await client.post(
            f"{BASE}/recurring/import",
            content=text.encode(),
            headers={"content-type": "text/csv"},
        )
        await execute(db_url, "UPDATE finance.recurring SET icon_checked_url = NULL")
        filled = await fill_pending(outbound, app.state.dashboards.sessions, resolving({}))
        stored = await scalar(db_url, "SELECT icon_checked_url FROM finance.recurring")

    assert sent.status_code == 200, sent.text
    assert filled == {"icons": 1, "refused": 0}
    assert stored == "site:shop.example.test"
