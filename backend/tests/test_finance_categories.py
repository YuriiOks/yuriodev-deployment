"""Categories: the rules, the report, the filter, the owner's override, the startup fill."""

import uuid

import pytest
from mcp import Client

from src.dashboards.finance.categories import CATEGORIES, categorize
from src.dashboards.finance.maintenance import fill_categories
from tests.dashboards_support import AUTH, execute, running, scalar
from tests.finance_support import money, seed

pytestmark = pytest.mark.anyio

BASE = "/api/dashboards/v1/finance"


def test_the_set_is_the_agreed_fourteen():
    assert CATEGORIES == (
        "housing_utilities",
        "groceries",
        "eating_out",
        "transport",
        "subscriptions",
        "health",
        "shopping",
        "entertainment",
        "debt",
        "income",
        "transfers",
        "transfers_out",
        "cash",
        "other",
    )


@pytest.mark.parametrize(
    ("code", "expected"),
    [
        ("5411", "groceries"),
        ("5499", "groceries"),
        ("5300", "groceries"),
        ("5310", "shopping"),
        ("5311", "shopping"),
        ("5812", "eating_out"),
        ("5814", "eating_out"),
        ("4111", "transport"),
        ("4121", "transport"),
        ("5541", "transport"),
        ("7523", "transport"),
        ("3000", "transport"),
        ("4511", "transport"),
        ("4900", "housing_utilities"),
        ("4814", "housing_utilities"),
        ("6513", "housing_utilities"),
        ("4899", "subscriptions"),
        ("5815", "subscriptions"),
        ("5817", "subscriptions"),
        ("5816", "entertainment"),
        ("7832", "entertainment"),
        ("7995", "entertainment"),
        ("5912", "health"),
        ("8011", "health"),
        ("8062", "health"),
        ("7230", "health"),
        ("5651", "shopping"),
        ("5732", "shopping"),
        ("5942", "shopping"),
        ("5200", "shopping"),
        ("6011", "cash"),
        ("6012", "debt"),
        ("4829", "transfers_out"),  # money sent to someone: spending
        ("6538", "transfers_out"),
        ("5999", "other"),
        ("0", "other"),
        ("abc", "other"),
        ("", "other"),
        (None, "other"),
    ],
)
def test_a_card_payment_is_sorted_by_its_merchant_category_code(code, expected):
    assert categorize("monobank", code, -100, False) == expected


@pytest.mark.parametrize(
    ("code", "amount", "expected"),
    [
        ("eating_out", -100, "eating_out"),
        ("groceries", -100, "groceries"),
        ("transport", -100, "transport"),
        ("bills", -100, "housing_utilities"),
        ("entertainment", -100, "entertainment"),
        ("holidays", -100, "entertainment"),
        ("shopping", -100, "shopping"),
        ("cash", -100, "cash"),
        ("personal_care", -100, "health"),
        ("mondo", 5_000, "income"),  # a top-up from another bank: money in
        ("mondo", -5_000, "transfers_out"),  # and one sent on: spending
        ("savings", -5_000, "transfers_out"),  # a pot move is flagged internal by the provider
        ("income", 5_000, "income"),
        ("general", -100, "other"),
        ("general", 100, "income"),  # money in that nothing else explains
        ("a_category_nobody_knows", -100, "other"),
        ("a_category_nobody_knows", 100, "income"),
        (None, 100, "income"),
        (None, -100, "other"),
    ],
)
def test_monzos_own_category_decides(code, amount, expected):
    assert categorize("monzo", code, amount, False) == expected


@pytest.mark.parametrize("code", ["4829", "6538", "6539", "6540"])
def test_money_arriving_by_a_transfer_code_is_income_not_spending(code):
    assert categorize("monobank", code, 5_000, False) == "income"
    assert categorize("monobank", code, -5_000, False) == "transfers_out"


@pytest.mark.parametrize("provider", ["monzo", "monobank", "sample"])
def test_a_move_between_own_accounts_is_a_transfer_whatever_the_provider_says(provider):
    assert categorize(provider, "5812", -100, True) == "transfers"
    assert categorize(provider, "eating_out", 100, True) == "transfers"


def test_an_unknown_provider_uses_the_card_code():
    assert categorize("sample", "5411", -100, False) == "groceries"


async def test_the_month_report_per_currency_with_the_month_before(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        november = await client.get(f"{BASE}/categories")
        october = await client.get(f"{BASE}/categories", params={"month": "2026-10"})
        empty = await client.get(f"{BASE}/categories", params={"month": "2024-01"})

    assert money(november.json()) == {
        "month": "2026-11",
        "previous_month": "2026-10",
        "currencies": [
            {
                "currency": "EUR",
                "spent": 2_500,
                "previous_spent": 0,
                "categories": [{"category": "groceries", "spent": 2_500, "previous": 0}],
            },
            {
                "currency": "UAH",
                # Left out: the 300 moved between own accounts, the payroll (money in).
                "spent": 45_000 + 12_000 + 500,
                "previous_spent": 7_000,
                "categories": [
                    {"category": "eating_out", "spent": 45_000, "previous": 0},
                    {"category": "groceries", "spent": 12_000, "previous": 0},
                    {"category": "subscriptions", "spent": 500, "previous": 0},
                    {"category": "shopping", "spent": 0, "previous": 7_000},
                ],
            },
        ],
    }
    assert october.json()["month"] == "2026-10"
    assert money(october.json()["currencies"]) == [
        {
            "currency": "UAH",
            "spent": 7_000,
            "previous_spent": 0,
            "categories": [{"category": "shopping", "spent": 7_000, "previous": 0}],
        }
    ]
    assert empty.json()["currencies"] == []


@pytest.mark.parametrize(
    "month", ["2026-13", "2026-00", "2026-1", "26-11", "abc", "2026/11", "", "0001-01", "9999-12"]
)
async def test_a_bad_month_is_422(db_url, make_dashboards_app, month):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        response = await client.get(f"{BASE}/categories", params={"month": month})

    assert response.status_code == 422


async def test_a_declined_payment_is_not_spending(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await execute(
            db_url, "UPDATE finance.transaction SET declined = true WHERE amount = -45000"
        )
        report = await client.get(f"{BASE}/categories")

    uah = next(c for c in report.json()["currencies"] if c["currency"] == "UAH")
    assert uah["spent"] == 12_500
    assert "eating_out" not in {line["category"] for line in uah["categories"]}


async def test_transactions_show_and_filter_by_category(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        everything = await client.get(f"{BASE}/transactions")
        groceries = await client.get(f"{BASE}/transactions", params={"category": "groceries"})
        income = await client.get(f"{BASE}/transactions", params={"category": "income"})
        wrong = await client.get(f"{BASE}/transactions", params={"category": "fun"})

    by_id = {row["description"]: row for row in everything.json()["transactions"]}
    assert (by_id["Corner Cafe"]["category"], by_id["Corner Cafe"]["category_code"]) == (
        "eating_out",
        "5812",  # the raw code is kept next to it
    )
    assert by_id["Corner Cafe"]["category_overridden"] is False
    assert [r["description"] for r in groceries.json()["transactions"]] == [
        "Bakery Example",
        "Acme Grocery",
    ]
    assert {r["description"] for r in income.json()["transactions"]} == {"Refund", "Payroll"}
    assert wrong.status_code == 422


async def test_the_owner_can_override_a_category_and_clear_it(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    cafe = str(uuid.UUID(int=1002))
    async with running(app, AUTH) as client:
        await seed(app)
        changed = await client.patch(f"{BASE}/transactions/{cafe}", json={"category": "health"})
        listed = await client.get(f"{BASE}/transactions", params={"category": "health"})
        report = await client.get(f"{BASE}/categories")
        cleared = await client.patch(f"{BASE}/transactions/{cafe}", json={"category": None})
        bad = await client.patch(f"{BASE}/transactions/{cafe}", json={"category": "fun"})
        extra = await client.patch(f"{BASE}/transactions/{cafe}", json={"description": "x"})
        missing = await client.patch(
            f"{BASE}/transactions/{uuid.UUID(int=999)}", json={"category": "health"}
        )
        malformed = await client.patch(f"{BASE}/transactions/nope", json={"category": "health"})

    assert changed.status_code == 200
    assert (changed.json()["category"], changed.json()["category_overridden"]) == ("health", True)
    assert [r["description"] for r in listed.json()["transactions"]] == ["Corner Cafe"]
    uah = next(c for c in report.json()["currencies"] if c["currency"] == "UAH")
    assert {"category": "health", "spent": 45_000, "previous": 0} in money(uah["categories"])
    assert (cleared.json()["category"], cleared.json()["category_overridden"]) == (
        "eating_out",
        False,
    )
    assert (bad.status_code, extra.status_code, missing.status_code) == (422, 422, 404)
    assert malformed.status_code == 422


async def test_every_transaction_without_a_category_gets_one_at_startup(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await execute(db_url, "UPDATE finance.transaction SET category = NULL")
        shown = await client.get(f"{BASE}/transactions")
        filled = await fill_categories(app.state.dashboards.sessions)
        again = await fill_categories(app.state.dashboards.sessions)
        rows = await scalar(
            db_url,
            "SELECT string_agg(external_id || '=' || category, ',' ORDER BY external_id) "
            "FROM finance.transaction",
        )

    assert {row["category"] for row in shown.json()["transactions"]} == {"other"}  # never null
    assert (filled, again) == (8, 0)
    assert rows == (
        "ext-1=other,ext-2=eating_out,ext-3=income,ext-4=other,ext-5=other,"
        "ext-6=other,ext-7=income,ext-8=transfers"
    )


async def test_the_tools(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    cafe = str(uuid.UUID(int=1002))
    async with running(app, AUTH), Client(app.state.mcp) as mcp:
        await seed(app)
        report = await mcp.call_tool("finance_categories", {"month": "2026-10"})
        found = await mcp.call_tool("finance_transactions", {"category": "groceries"})
        noted = await mcp.call_tool("finance_set_category", {"id": cafe, "category": "health"})
        bad_id = await mcp.call_tool("finance_set_category", {"id": "nope"})
        bad_category = await mcp.call_tool("finance_set_category", {"id": cafe, "category": "fun"})
        bad_month = await mcp.call_tool("finance_categories", {"month": "2026-13"})

    assert '"previous_month":"2026-09"' in report.content[0].text
    assert '"month":"2026-10"' in report.content[0].text
    assert found.content[0].text.count('"category":"groceries"') == 2
    assert '"category":"health"' in noted.content[0].text
    assert bad_id.is_error
    assert "Invalid transaction id" in bad_id.content[0].text
    assert bad_category.is_error
    assert "Invalid category" in bad_category.content[0].text
    assert bad_month.is_error
    assert "Invalid month" in bad_month.content[0].text
