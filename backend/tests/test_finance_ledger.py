"""Transaction filters, the owner's say on own-account moves, what a statement can carry (a
category, whether the time is known) and the display flag of a category. Invented names."""

import uuid
from datetime import timedelta

import pytest

from tests.dashboards_support import AUTH, execute, running
from tests.finance_support import ACC_A, ACC_B, NOW, seed, seed_rates, tx
from tests.test_finance_manual_api import connect, open_account, upload

pytestmark = pytest.mark.anyio

FINANCE = "/api/dashboards/v1/finance"
MANUAL = f"{FINANCE}/manual"


async def add(app, *rows):
    async with app.state.dashboards.sessions() as session, session.begin():
        session.add_all(rows)


async def test_transactions_can_be_limited_to_several_accounts_or_one_provider(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        link = await connect(client)
        manual = await open_account(client, link)
        await upload(client, manual, "Date,Description,Amount\n2026-11-02,From a file,-1.00\n")
        both = await client.get(f"{FINANCE}/transactions?account={ACC_A}&account={ACC_B}")
        one = await client.get(f"{FINANCE}/transactions?account={ACC_B}")
        sample = await client.get(f"{FINANCE}/transactions?provider=sample&limit=200")
        barclays = await client.get(f"{FINANCE}/transactions?provider=barclays")
        unknown = await client.get(f"{FINANCE}/transactions?account={uuid.uuid4()}&account={ACC_A}")
        bad = await client.get(f"{FINANCE}/transactions?provider=Not%20Valid")

    accounts = {row["account_id"] for row in both.json()["transactions"]}
    assert accounts == {str(ACC_A), str(ACC_B)}
    assert {row["account_id"] for row in one.json()["transactions"]} == {str(ACC_B)}
    assert {row["description"] for row in barclays.json()["transactions"]} == {"From a file"}
    assert len(sample.json()["transactions"]) == 8
    assert (unknown.status_code, bad.status_code) == (404, 422)


async def test_the_owner_marks_two_lines_as_one_move_and_it_sticks(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    when = NOW - timedelta(days=1)
    async with running(app, AUTH) as client:
        await seed(app)
        await add(
            app,
            tx(40, ACC_A, when, -43_750, "To the euro card", category_code="4829"),
            tx(41, ACC_B, when + timedelta(hours=3), 1_000, "From the card", category_code="4829"),
        )
        out, into = uuid.UUID(int=1040), uuid.UUID(int=1041)
        marked = await client.patch(
            f"{FINANCE}/transactions/{out}",
            json={"internal_transfer": True, "counterpart_id": str(into)},
        )
        listed = (await client.get(f"{FINANCE}/transactions?limit=200")).json()["transactions"]
        same_account = await client.patch(
            f"{FINANCE}/transactions/{out}",
            json={"internal_transfer": True, "counterpart_id": str(out)},
        )
        cleared = await client.patch(
            f"{FINANCE}/transactions/{into}", json={"internal_transfer": False}
        )
        nothing = await client.patch(f"{FINANCE}/transactions/{into}", json={})
        with_null = await client.patch(
            f"{FINANCE}/transactions/{into}", json={"internal_transfer": None}
        )
        nulled = await client.patch(
            f"{FINANCE}/transactions/{into}", json={"category": "groceries"}
        )

    by_id = {row["id"]: row for row in listed}
    assert marked.status_code == 200
    assert marked.json()["internal_transfer"] is True
    assert marked.json()["internal_transfer_by_owner"] is True
    marked_in = by_id[str(into)]
    assert (marked_in["internal_transfer"], marked_in["category"]) == (True, "transfers")
    assert same_account.status_code == 422
    assert cleared.json()["internal_transfer"] is False
    assert cleared.json()["internal_transfer_by_owner"] is True
    assert cleared.json()["category"] == "income"  # the rules for code 4829 again: money in
    assert (nothing.status_code, with_null.status_code) == (422, 422)
    assert nulled.json()["category"] == "groceries"


async def test_a_statement_can_carry_a_category_and_says_when_the_time_is_unknown(
    db_url, make_dashboards_app
):
    text = (
        "Date,Description,Amount,Category,Time\n"
        "2026-11-02,Corner Cafe,-4.50,eating_out,09:15:00\n"
        "2026-11-03,Mystery,-1.00,,\n"
    )
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        link = await connect(client)
        account = await open_account(client, link)
        good = await upload(client, account, text)
        wrong = "Date,Description,Amount,Category\n2026-11-02,A,-1,fun\n"
        bad = await upload(client, account, wrong)
        rows = (await client.get(f"{FINANCE}/transactions?limit=50")).json()["transactions"]

    by_text = {row["description"]: row for row in rows}
    assert good.status_code == 200
    assert (by_text["Corner Cafe"]["category"], by_text["Corner Cafe"]["time_known"]) == (
        "eating_out",
        True,
    )
    assert (by_text["Mystery"]["category"], by_text["Mystery"]["time_known"]) == ("other", False)
    assert bad.json()["errors"][0]["code"] == "category_unknown"


async def test_a_payee_keeps_the_category_the_owner_gave_it_in_later_statements(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        link = await connect(client)
        account = await open_account(client, link)
        first = "Date,Description,Amount,Counterparty\n2026-11-02,Card,-4.50,Corner Cafe\n"
        await upload(client, account, first)
        row = (await client.get(f"{FINANCE}/transactions")).json()["transactions"][0]
        await client.patch(f"{FINANCE}/transactions/{row['id']}", json={"category": "health"})
        second = "Date,Description,Amount,Counterparty\n2026-11-09,Card,-5.00,CORNER CAFE\n"
        await upload(client, account, second)
        rows = (await client.get(f"{FINANCE}/transactions")).json()["transactions"]

    assert [r["category"] for r in rows] == ["health", "health"]
    assert [r["category_overridden"] for r in rows] == [False, True]


async def test_a_category_says_when_another_currency_is_in_it(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await seed_rates(app)
        await execute(db_url, "UPDATE finance.transaction SET category = 'groceries'")
        mixed = (await client.get(f"{FINANCE}/categories")).json()["display"]["categories"]
        await execute(db_url, "UPDATE finance.account SET archived = true WHERE name = 'Euro'")
        await execute(db_url, "UPDATE finance.transaction SET currency = 'GBP'")
        plain = (await client.get(f"{FINANCE}/categories")).json()["display"]["categories"]

    assert {line["converted"] for line in mixed} == {True}
    assert {line["converted"] for line in plain} == {False}
