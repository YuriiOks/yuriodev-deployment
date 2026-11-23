"""The finance MCP tools: read-only, minor-unit amounts, filters and paging, fixed error text."""

import json

import pytest
from mcp import Client

from tests.dashboards_support import AUTH, running
from tests.finance_support import ACC_A, NEWEST_FIRST, seed

pytestmark = pytest.mark.anyio

READ_ONLY = {"finance_accounts", "finance_balances", "finance_transactions"}


async def call(mcp, tool, **arguments):
    result = await mcp.call_tool(tool, arguments)
    return result.is_error, result.content[0].text


async def ok(mcp, tool, **arguments):
    failed, text = await call(mcp, tool, **arguments)
    assert not failed, text
    return json.loads(text)


def ids(body):
    return [int(row["id"].rsplit("-", 1)[1], 16) for row in body["transactions"]]


async def test_the_finance_tools_are_three_and_none_of_them_writes(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), Client(app.state.mcp) as mcp:
        listed = await mcp.list_tools()

    finance = {tool.name for tool in listed.tools if "finance" in tool.name}
    assert finance == READ_ONLY


async def test_accounts_and_balances(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), Client(app.state.mcp) as mcp:
        await seed(app)
        accounts = await ok(mcp, "finance_accounts")
        balances = await ok(mcp, "finance_balances")

    assert [a["name"] for a in accounts["accounts"]] == ["Main", "Euro", "Old"]
    assert accounts["accounts"][0]["balance"] == 1_250_000
    assert accounts["accounts"][0]["own_balance_minor"] == 750_000
    assert accounts["connections"][0]["status"] == "ok"
    assert balances["month"] == "2026-11"
    assert [(c["currency"], c["balance"]) for c in balances["currencies"]] == [
        ("EUR", 33_300),
        ("UAH", 1_250_000),
    ]


async def test_transactions_can_be_searched_by_text_date_amount_and_account(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), Client(app.state.mcp) as mcp:
        await seed(app)
        everything = await ok(mcp, "finance_transactions")
        by_text = await ok(mcp, "finance_transactions", query="grocery")
        by_date = await ok(
            mcp, "finance_transactions", from_date="2026-11-18", to_date="2026-11-19"
        )
        by_amount = await ok(mcp, "finance_transactions", max_amount=-10_000)
        by_account = await ok(mcp, "finance_transactions", account=str(ACC_A), min_amount=0)

    assert ids(everything) == NEWEST_FIRST
    assert ids(by_text) == [1006]
    assert by_text["transactions"][0]["amount"] == -2_500
    assert ids(by_date) == [1007, 1006]
    assert ids(by_amount) == [1002, 1001]
    assert ids(by_account) == [1003]


async def test_pages_follow_next_cursor(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), Client(app.state.mcp) as mcp:
        await seed(app)
        seen = []
        cursor = None
        for _ in range(5):
            page = await ok(mcp, "finance_transactions", limit=3, cursor=cursor)
            seen += ids(page)
            cursor = page["next_cursor"]
            if cursor is None:
                break

    assert seen == NEWEST_FIRST
    assert cursor is None


@pytest.mark.parametrize(
    ("arguments", "message"),
    [
        ({"account": "not-a-uuid"}, "Invalid account id"),
        ({"account": "00000000-0000-0000-0000-00000000ffff"}, "Account not found"),
        ({"cursor": "bm90LWEtY3Vyc29y"}, "Invalid cursor"),
        ({"limit": 0}, "Invalid limit"),
        ({"limit": 201}, "Invalid limit"),
        ({"from_date": "2026-11-19", "to_date": "2026-11-18"}, "from must not be after to"),
        ({"query": "x" * 101}, "Search text is too long"),
    ],
)
async def test_a_bad_argument_is_a_fixed_sentence(db_url, make_dashboards_app, arguments, message):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), Client(app.state.mcp) as mcp:
        failed, text = await call(mcp, "finance_transactions", **arguments)

    assert failed
    assert message in text
    assert "x" * 50 not in text
