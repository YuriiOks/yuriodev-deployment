"""The tools that enter a bank by hand, over MCP."""

import json

import pytest
from mcp import Client

from tests.dashboards_support import AUTH, running

pytestmark = pytest.mark.anyio


async def call(mcp, name, args):
    result = await mcp.call_tool(name, args)
    return result.is_error, result.content[0].text.removeprefix(f"Error executing tool {name}: ")


async def test_a_bank_is_added_with_an_account_a_balance_and_archived(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), Client(app.state.mcp) as mcp:
        neutral = {"provider": "personal-bank", "display_name": "Mine"}
        failed, text = await call(mcp, "finance_add_manual_connection", neutral)
        link = json.loads(text)
        card = {
            "connection_id": link["id"],
            "name": "Card",
            "kind": "credit_card",
            "currency": "GBP",
            "credit_limit": 500_000,
            "owed": 120_000,
            "as_of": "2026-11-20",
        }
        _, added = await call(mcp, "finance_add_manual_account", {"account": card})
        account = json.loads(added)
        _, paid = await call(
            mcp,
            "finance_set_manual_balance",
            {"account": account["id"], "owed": 20_000, "as_of": "2026-11-21"},
        )
        _, hidden = await call(
            mcp,
            "finance_update_manual_account",
            {"account": account["id"], "changes": {"archived": True, "label": "Spare"}},
        )

    assert (failed, link["manual"], link["display_name"]) == (False, True, "Mine")
    assert (account["balance"], account["own_balance_minor"]) == (380_000, -120_000)
    assert json.loads(paid)["balance"] == 480_000
    assert json.loads(paid)["balance_at"] == "2026-11-21T23:59:59Z"
    assert (json.loads(hidden)["archived"], json.loads(hidden)["label"]) == (True, "Spare")


async def test_bad_input_gets_a_fixed_sentence(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), Client(app.state.mcp) as mcp:
        api_bank = await call(mcp, "finance_add_manual_connection", {"provider": "monzo"})
        no_money = await call(mcp, "finance_add_manual_account", {"account": {"name": "SECRET"}})
        bad_id = await call(mcp, "finance_set_manual_balance", {"account": "nope", "balance": 1})
        both = await call(
            mcp,
            "finance_set_manual_balance",
            {"account": "00000000-0000-0000-0000-000000000001", "balance": 1, "owed": 1},
        )
        unknown = await call(
            mcp,
            "finance_update_manual_account",
            {"account": "00000000-0000-0000-0000-000000000001", "changes": {"x": 1}},
        )
        missing = await call(
            mcp,
            "finance_update_manual_account",
            {"account": "00000000-0000-0000-0000-000000000001", "changes": {"name": "A"}},
        )

    assert api_bank == (True, "That bank is connected through its own API")
    assert no_money == (True, "Invalid fields: connection_id, currency")
    assert bad_id == (True, "Invalid account id")
    assert both == (True, "Invalid payment")
    assert unknown == (True, "Invalid fields: x")
    assert missing == (True, "Account not found")
