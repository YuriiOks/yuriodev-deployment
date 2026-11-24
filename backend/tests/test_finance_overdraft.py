"""The owner's overdraft limit: set by hand, wins over the bank's, kept by every refresh."""

import uuid
from datetime import timedelta

import pytest
from mcp import Client

from tests.dashboards_support import AUTH, execute, running, scalar
from tests.finance_support import ACC_A, ACC_B, drive, seed
from tests.monzo_support import FakeMonzo
from tests.test_finance_monzo import client_for, collector_for, consent

pytestmark = pytest.mark.anyio

BASE = "/api/dashboards/v1/finance"
MAIN = str(ACC_A)
BANK_SENDS_FIFTY_THOUSAND = "UPDATE finance.account SET overdraft_limit = 50000 WHERE name = 'Main'"


async def account(client, account_id=MAIN):
    listed = (await client.get(f"{BASE}/accounts")).json()["accounts"]
    return next(a for a in listed if a["id"] == account_id)


async def test_the_owner_sets_a_limit_and_available_money_uses_it(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        before = await account(client)
        changed = await client.patch(f"{BASE}/accounts/{MAIN}", json={"overdraft_limit": 100_000})
        after = await account(client)

    assert (before["overdraft_limit"], before["overdraft_limit_source"]) == (None, None)
    assert changed.status_code == 200
    assert changed.json() == after
    assert (after["overdraft_limit"], after["overdraft_limit_source"]) == (100_000, "owner")
    assert after["overdraft_limit_bank"] is None
    assert after["available_minor"] == 1_250_000 + 100_000
    assert after["display_available_minor"] is None  # no rates in this test: original only


async def test_the_owners_figure_wins_over_the_banks_and_clearing_it_gives_the_bank_back(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await execute(db_url, BANK_SENDS_FIFTY_THOUSAND)
        banks = await account(client)
        owners = (
            await client.patch(f"{BASE}/accounts/{MAIN}", json={"overdraft_limit": 100_000})
        ).json()
        clear = await client.patch(f"{BASE}/accounts/{MAIN}", json={"overdraft_limit": None})
        cleared = clear.json()

    assert (banks["overdraft_limit"], banks["overdraft_limit_source"]) == (50_000, "bank")
    assert (owners["overdraft_limit"], owners["overdraft_limit_source"]) == (100_000, "owner")
    assert owners["overdraft_limit_bank"] == 50_000  # the bank's figure is still shown
    assert owners["available_minor"] == 1_250_000 + 100_000
    assert (cleared["overdraft_limit"], cleared["overdraft_limit_source"]) == (50_000, "bank")
    assert cleared["available_minor"] == 1_250_000 + 50_000


async def test_zero_is_a_limit_too(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await execute(db_url, BANK_SENDS_FIFTY_THOUSAND)
        zero = (await client.patch(f"{BASE}/accounts/{MAIN}", json={"overdraft_limit": 0})).json()

    assert (zero["overdraft_limit"], zero["overdraft_limit_source"]) == (0, "owner")  # no overdraft
    assert zero["available_minor"] == 1_250_000


@pytest.mark.parametrize(
    "body",
    [
        {"overdraft_limit": -1},
        {"overdraft_limit": 10**12 + 1},
        {"overdraft_limit": 12.5},
        {"overdraft_limit": "100"},
        {"overdraft_limit": True},
        {},
        {"overdraft_limit": 5, "balance": 1},
    ],
)
async def test_a_bad_limit_is_refused_and_changes_nothing(db_url, make_dashboards_app, body):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        response = await client.patch(f"{BASE}/accounts/{MAIN}", json=body)
        after = await account(client)

    assert response.status_code == 422
    assert after["overdraft_limit_source"] is None


async def test_unknown_accounts_and_pots_are_refused(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await execute(db_url, "UPDATE finance.account SET kind = 'pot' WHERE name = 'Euro'")
        missing = await client.patch(f"{BASE}/accounts/{uuid.uuid4()}", json={"overdraft_limit": 5})
        pot = await client.patch(f"{BASE}/accounts/{ACC_B}", json={"overdraft_limit": 5})
        malformed = await client.patch(f"{BASE}/accounts/nope", json={"overdraft_limit": 5})
        anonymous = await client.patch(
            f"{BASE}/accounts/{MAIN}",
            json={"overdraft_limit": 5},
            headers={"X-Dashboards-Token": "nope"},
        )

    assert missing.status_code == 404
    assert (pot.status_code, pot.json()["error"]) == (422, "validation_error")
    assert malformed.status_code == 422
    assert anonymous.status_code == 401


async def test_a_refresh_keeps_the_owners_figure_and_updates_the_banks(
    db_url, make_dashboards_app, clock
):
    fake = FakeMonzo(clock)
    fake.balance = {"balance": -74_782, "currency": "GBP", "overdraft_limit": 20_000}
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as http, client_for(fake) as client:
        await consent(app, fake, clock)
        sessions = app.state.dashboards.sessions
        finance = collector_for(app, clock)
        await drive(finance, client, sessions, clock, 1)
        listed = (await http.get(f"{BASE}/accounts")).json()["accounts"]
        current = next(a for a in listed if a["kind"] == "current")
        await http.patch(f"{BASE}/accounts/{current['id']}", json={"overdraft_limit": 75_000})
        fake.balance = {**fake.balance, "overdraft_limit": 30_000}  # the bank changes its mind
        clock.now += timedelta(minutes=25)
        await drive(finance, client, sessions, clock, 2)
        after = await account(http, current["id"])

    assert (current["overdraft_limit"], current["overdraft_limit_source"]) == (20_000, "bank")
    assert (after["overdraft_limit"], after["overdraft_limit_source"]) == (75_000, "owner")
    assert after["overdraft_limit_bank"] == 30_000  # refreshed beside it
    assert after["available_minor"] == -74_782 + 75_000


async def test_the_tool_sets_and_clears_it(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), Client(app.state.mcp) as mcp:
        await seed(app)
        args = {"account": MAIN, "limit_minor": 5_000}
        set_it = await mcp.call_tool("finance_set_overdraft", args)
        stored = await scalar(
            db_url, "SELECT overdraft_limit_override FROM finance.account WHERE name = 'Main'"
        )
        cleared = await mcp.call_tool("finance_set_overdraft", {"account": MAIN})
        bad_id = await mcp.call_tool("finance_set_overdraft", {"account": "nope", "limit_minor": 1})
        below = {"account": MAIN, "limit_minor": -1}
        negative = await mcp.call_tool("finance_set_overdraft", below)

    assert '"overdraft_limit":5000' in set_it.content[0].text
    assert stored == 5_000
    assert '"overdraft_limit_source":null' in cleared.content[0].text
    assert bad_id.is_error
    assert "Invalid account id" in bad_id.content[0].text
    assert negative.is_error
    assert "Invalid overdraft limit" in negative.content[0].text
