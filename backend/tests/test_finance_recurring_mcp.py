"""The recurring-payment tools of the MCP endpoint."""

import json

import pytest
from mcp import Client

from tests.dashboards_support import AUTH, running
from tests.finance_support import ACC_A, seed, seed_rates

pytestmark = pytest.mark.anyio

NEW = {
    "name": "Acme Streaming",
    "amount": 999,
    "currency": "UAH",
    "next_payment_date": "2026-11-25",
}


async def call(mcp, name, args=None):
    result = await mcp.call_tool(name, args or {})
    return result.is_error, result.content[0].text


async def test_a_payment_is_added_listed_changed_and_seen_in_upcoming(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), Client(app.state.mcp) as mcp:
        await seed(app)
        await seed_rates(app)
        mine = {**NEW, "account_id": str(ACC_A)}
        added = await call(mcp, "finance_add_recurring", {"payment": mine})
        payment_id = json.loads(added[1])["id"]
        change = {"recurring_id": payment_id, "changes": {"amount": 1500}}
        changed = await call(mcp, "finance_update_recurring", change)
        listing = json.loads((await call(mcp, "finance_recurring"))[1])
        inactive = json.loads((await call(mcp, "finance_recurring", {"active_only": False}))[1])
        upcoming = json.loads((await call(mcp, "finance_upcoming", {"days": 7}))[1])
        attention = json.loads((await call(mcp, "finance_attention"))[1])

    assert added[0] is False
    assert json.loads(changed[1])["amount"] == 1_500
    assert [(p["name"], p["amount"], p["display_amount"]) for p in listing["recurring"]] == [
        ("Acme Streaming", 1_500, 30)
    ]
    assert listing["display"]["currency"] == "GBP"
    assert len(inactive["recurring"]) == 1
    assert [(i["name"], i["covered"]) for i in upcoming["items"]] == [("Acme Streaming", True)]
    assert upcoming["display"]["total"] == 30
    assert attention["items"] == []


async def test_a_bad_payment_names_the_fields_and_never_the_values(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), Client(app.state.mcp) as mcp:
        missing = await call(mcp, "finance_add_recurring", {"payment": {"name": "SECRET-NAME"}})
        wrong = await call(
            mcp, "finance_add_recurring", {"payment": {**NEW, "amount": "SECRET-AMOUNT"}}
        )
        listing = json.loads((await call(mcp, "finance_recurring"))[1])

    assert missing == (True, "Invalid fields: amount, currency")
    assert wrong == (True, "Invalid fields: amount")
    assert listing["recurring"] == []


async def test_a_bad_change_is_refused_with_a_fixed_sentence(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), Client(app.state.mcp) as mcp:
        added = await call(mcp, "finance_add_recurring", {"payment": NEW})
        payment_id = json.loads(added[1])["id"]
        clear = await call(
            mcp, "finance_update_recurring", {"recurring_id": payment_id, "changes": {"name": None}}
        )
        unknown_field = await call(
            mcp, "finance_update_recurring", {"recurring_id": payment_id, "changes": {"x": 1}}
        )
        bad_id = await call(
            mcp, "finance_update_recurring", {"recurring_id": "nope", "changes": {"amount": 1}}
        )
        gone = await call(
            mcp,
            "finance_update_recurring",
            {"recurring_id": "00000000-0000-0000-0000-000000000099", "changes": {"amount": 1}},
        )
        too_far = await call(mcp, "finance_upcoming", {"days": 400})

    assert clear == (True, "A required field cannot be cleared")
    assert unknown_field == (True, "Invalid fields: x")
    assert bad_id == (True, "Invalid payment id")
    assert gone == (True, "Recurring payment not found")
    assert too_far == (True, "Invalid days")
