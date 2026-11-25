"""Every logo and every payment icon in one answer each, with a version and a day's cache."""

import json

import pytest

from src.dashboards.finance.bundles import MAX_BUNDLE_ICON, logos_bundle
from tests.dashboards_support import AUTH, execute, running
from tests.finance_support import seed
from tests.test_finance_icons import PNG, add, png_uri
from tests.test_finance_logos import GOOD_PNG, GOOD_SVG

pytestmark = pytest.mark.anyio

FINANCE = "/api/dashboards/v1/finance"


def test_the_version_is_the_hash_of_what_is_in_the_bundle():
    logos = {"a": {"on_light": GOOD_SVG}, "b": {"mark": GOOD_PNG}, "c": {"mark": GOOD_PNG}}

    version, bundle = logos_bundle(logos, {"a", "b"})
    other, _ = logos_bundle(logos, {"a", "b", "c"})

    assert set(bundle) == {"a", "b"}
    assert bundle["a"] == {"on_light": GOOD_SVG, "on_dark": None, "mark": None}
    assert version != other
    assert logos_bundle(logos, {"b", "a"})[0] == version


async def test_the_logos_come_in_one_answer_for_the_providers_that_have_a_connection(
    db_url, make_dashboards_app
):
    raw = json.dumps(
        {
            "sample": {"on_light": GOOD_SVG, "mark": GOOD_PNG},
            "elsewhere": {"mark": GOOD_PNG},
        }
    )
    app = make_dashboards_app(db_url, dashboards_provider_logos=raw)
    async with running(app, AUTH) as client:
        await seed(app)  # a connection of the provider "sample"
        first = await client.get(f"{FINANCE}/providers/logos")
        tag = first.headers["etag"]
        again = await client.get(f"{FINANCE}/providers/logos", headers={"If-None-Match": tag})
        listing = (await client.get(f"{FINANCE}/providers")).json()
        anonymous = await client.get(
            f"{FINANCE}/providers/logos", headers={"X-Dashboards-Token": "no"}
        )
        single = await client.get(f"{FINANCE}/providers/sample/logo/mark")

    body = first.json()
    assert first.status_code == 200
    assert set(body) == {"version", "logos"}
    assert body["logos"] == {"sample": {"on_light": GOOD_SVG, "on_dark": None, "mark": GOOD_PNG}}
    assert first.headers["cache-control"] == "private, max-age=86400"
    assert tag == f'"{body["version"]}"'
    assert (again.status_code, again.content) == (304, b"")
    assert listing["logos_version"] == body["version"]
    assert anonymous.status_code == 401
    assert anonymous.headers["cache-control"] == "no-store"
    assert single.status_code == 200  # the address of one image is still there


async def test_no_logos_is_an_empty_bundle_with_a_version(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        body = (await client.get(f"{FINANCE}/providers/logos")).json()
        listing = (await client.get(f"{FINANCE}/providers")).json()

    assert body["logos"] == {}
    assert listing["logos_version"] == body["version"]


async def put_icon(db_url, name, data, manual=True):
    await execute(
        db_url,
        f"UPDATE finance.recurring SET icon_data = '{data}', icon_manual = {str(manual).lower()} "
        f"WHERE name = '{name}'",
    )


async def test_the_icons_come_in_one_answer_and_the_big_ones_stay_out(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        small = await add(client, name="Small")
        big = await add(client, name="Big")
        plain = await add(client, name="Plain")
        empty = (await client.get(f"{FINANCE}/recurring/icons")).json()
        await put_icon(db_url, "Small", png_uri())
        await put_icon(db_url, "Big", "data:image/png;base64," + "A" * (MAX_BUNDLE_ICON + 10))
        response = await client.get(f"{FINANCE}/recurring/icons")
        tag = response.headers["etag"]
        again = await client.get(f"{FINANCE}/recurring/icons", headers={"If-None-Match": tag})
        listing = (await client.get(f"{FINANCE}/recurring")).json()
        upcoming = (await client.get(f"{FINANCE}/upcoming?days=60")).json()
        one = await client.get(f"{FINANCE}/recurring/{small['id']}/icon")
        await put_icon(db_url, "Plain", png_uri(PNG + b"\x03"))
        changed = (await client.get(f"{FINANCE}/recurring/icons")).json()

    body = response.json()
    assert empty["icons"] == {}
    assert body["icons"] == {small["id"]: png_uri()}  # the big one is not in the bundle
    assert big["id"] not in body["icons"]
    assert response.headers["cache-control"] == "private, max-age=86400"
    assert tag == f'"{body["version"]}"'
    assert again.status_code == 304
    assert listing["icons_version"] == upcoming["icons_version"] == body["version"]
    assert empty["version"] != body["version"]
    assert one.status_code == 200  # reachable by its own address
    assert set(changed["icons"]) == {small["id"], plain["id"]}
    assert changed["version"] != body["version"]


async def test_an_icon_for_another_address_is_not_in_the_bundle(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        made = await add(client, name="Moved", icon_url="https://icons.example.test/a.png")
        await execute(
            db_url,
            f"UPDATE finance.recurring SET icon_data = '{png_uri()}', "
            "icon_checked_url = 'https://icons.example.test/old.png', icon_manual = false",
        )
        stale = (await client.get(f"{FINANCE}/recurring/icons")).json()
        await execute(
            db_url,
            "UPDATE finance.recurring SET icon_checked_url = 'https://icons.example.test/a.png'",
        )
        current = (await client.get(f"{FINANCE}/recurring/icons")).json()

    assert stale["icons"] == {}
    assert current["icons"] == {made["id"]: png_uri()}
