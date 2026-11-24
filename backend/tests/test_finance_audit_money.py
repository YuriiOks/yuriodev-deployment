"""Money figures that must be right: refunds, own-account moves, the fair comparison with the
month before, holds that vanish, balances of debts, overdraft rules. Every name is invented."""

from datetime import UTC, datetime, timedelta

import pytest

from tests.dashboards_support import AUTH, execute, running, scalar
from tests.finance_support import (
    ACC_A,
    ACC_C,
    FakeMonobank,
    at,
    client_for,
    collector,
    drive,
    mono_account,
    mono_item,
    seed,
    ts,
    tx,
)
from tests.test_finance_recurring_api import pay

pytestmark = pytest.mark.anyio

BASE = "/api/dashboards/v1/finance"
MAIN = str(ACC_A)


async def add(app, *rows):
    async with app.state.dashboards.sessions() as session, session.begin():
        session.add_all(rows)


async def uah(client, path):
    body = (await client.get(f"{BASE}/{path}")).json()
    return next(c for c in body["currencies"] if c["currency"] == "UAH")


def lines(currency):
    return {line["category"]: line for line in currency["categories"]}


async def test_a_refund_is_taken_off_its_category_and_is_not_income(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        before_summary = await uah(client, "summary")
        before = lines(await uah(client, "categories"))
        await add(
            app,
            tx(60, ACC_A, at(11, 21), 5_000, "Refund Cafe", category="eating_out"),
            tx(61, ACC_A, at(11, 21, 11), 90_000, "Refund Shop", category="shopping"),
            tx(62, ACC_A, at(11, 21, 12), 70_000, "Gift", category="income"),
        )
        summary = await uah(client, "summary")
        report = lines(await uah(client, "categories"))

    assert before["eating_out"]["spent"] == 45_000
    assert report["eating_out"]["spent"] == 40_000  # the refund is taken off
    assert report["shopping"]["spent"] == 0  # more refunded than spent: never below 0
    assert summary["spent"] == before_summary["spent"] - 5_000  # the same figure as the report
    assert summary["received"] == before_summary["received"] + 70_000  # only the gift is income
    assert sum(line["spent"] for line in report.values()) == summary["spent"]


async def test_a_line_called_transfers_by_the_owner_is_left_out_of_every_figure(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        before = await uah(client, "summary")
        cafe = next(
            t
            for t in (await client.get(f"{BASE}/transactions")).json()["transactions"]
            if t["description"] == "Corner Cafe"
        )
        await client.patch(f"{BASE}/transactions/{cafe['id']}", json={"category": "transfers"})
        summary = await uah(client, "summary")
        report = lines(await uah(client, "categories"))

    assert summary["spent"] == before["spent"] - 45_000
    assert "transfers" not in report
    assert "eating_out" not in report


async def test_a_declined_and_an_archived_account_line_follow_the_rules_of_the_movement(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        before = await uah(client, "summary")
        await add(app, tx(60, ACC_C, at(11, 21), -1_000, "Closed card shop", category="shopping"))
        after = await uah(client, "summary")

    # Spending that happened counts, whichever account it is on now (the balance counts open
    # accounts only), so a currency line can have a movement beyond its accounts.
    assert after["spent"] == before["spent"] + 1_000
    assert after["accounts"] == before["accounts"] == 1


async def test_the_month_in_progress_is_also_compared_with_the_same_days_of_the_month_before(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await add(
            app,
            tx(60, ACC_A, at(10, 10), -3_000, "Early", category="groceries"),
            tx(61, ACC_A, at(10, 25), -4_000, "Late", category="groceries"),
            tx(62, ACC_A, at(10, 22, 10), -800, "Just before", category="groceries"),
            tx(63, ACC_A, at(10, 22, 12), -900, "Just after", category="groceries"),
        )
        report = (await client.get(f"{BASE}/categories")).json()
        october = (await client.get(f"{BASE}/categories?month=2026-10")).json()

    currency = next(c for c in report["currencies"] if c["currency"] == "UAH")
    groceries = lines(currency)["groceries"]
    assert report["previous_to_date_day"] == "2026-10-22"
    assert groceries["previous"] == 3_000 + 4_000 + 800 + 900
    # Up to 12:00 on 22 October in London, which is 11:00 UTC (summer time still).
    assert groceries["previous_to_date"] == 3_000 + 800
    assert lines(currency)["shopping"]["previous"] == 7_000  # 31 October, in full
    assert lines(currency)["shopping"]["previous_to_date"] == 0
    assert currency["previous_to_date_spent"] == 3_800
    assert report["display"]["previous_to_date_spent"] == 0  # no rates: nothing converted
    # A month that is over has no "so far".
    old = next(c for c in october["currencies"] if c["currency"] == "UAH")
    assert october["previous_to_date_day"] is None
    assert old["previous_to_date_spent"] is None
    assert all(line["previous_to_date"] is None for line in old["categories"])
    assert october["display"]["previous_to_date_spent"] is None


async def test_the_comparison_day_is_clamped_to_the_length_of_the_month_before(
    db_url, make_dashboards_app, clock
):
    app = make_dashboards_app(db_url)
    clock.now = datetime(2026, 3, 31, 9, 30, tzinfo=UTC)
    async with running(app, AUTH) as client:
        body = (await client.get(f"{BASE}/categories")).json()

    assert (body["month"], body["previous_to_date_day"]) == ("2026-03", "2026-02-28")


async def test_a_released_hold_stops_being_money_out(db_url, make_dashboards_app, clock):
    held = mono_item("hold-1", ts(2026, 11, 20), -45_000, "Fuel hold", hold=True, mcc=5541)
    kept = mono_item("tx-2", ts(2026, 11, 21), -1_000, "Corner Cafe")
    fake = FakeMonobank([mono_account("acc-black")], {"acc-black": [held, kept]})
    app = make_dashboards_app(db_url)
    state = (
        "SELECT string_agg(external_id || ':' || pending::text || ':' || declined::text, ',' "
        "ORDER BY external_id) FROM finance.transaction"
    )
    async with running(app, AUTH) as http, client_for(fake) as client:
        sessions = app.state.dashboards.sessions
        finance = collector(0)
        await drive(finance, client, sessions, clock, 3)
        first = await scalar(db_url, state)
        before = await uah(http, "summary")
        fake.statements["acc-black"] = [kept]  # the merchant released the hold
        clock.now += timedelta(minutes=25)
        await drive(finance, client, sessions, clock, 3)
        second = await scalar(db_url, state)
        after = await uah(http, "summary")

    assert first == "hold-1:true:false,tx-2:false:false"
    assert second == "hold-1:false:true,tx-2:false:false"
    assert after["spent"] == before["spent"] - 45_000


async def test_a_debt_that_is_no_instalment_plan_still_loses_balance_when_paid(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        owner = await pay(
            client, "Family loan", 10_000, "2026-11-30", account_id=None, remaining_balance=50_000
        )
        matched = await pay(
            client, "Bakery Example", 10_000, "2026-11-20", kind="debt", remaining_balance=50_000
        )
        paid = (await client.post(f"{BASE}/recurring/{owner['id']}/paid")).json()
        after = (await client.get(f"{BASE}/recurring/{matched['id']}")).json()

    assert paid["remaining_balance"] == 40_000  # by the recorded amount: his word
    assert after["remaining_balance"] == 38_000  # by what was really charged (12 000)
    assert after["completed_installments"] is None  # no plan: no count
    assert after["scheduled_remaining_balance"] == 38_000


async def test_an_overdraft_belongs_to_a_current_or_business_account(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await execute(db_url, "UPDATE finance.account SET kind = 'credit_card' WHERE name = 'Main'")
        card = await client.patch(f"{BASE}/accounts/{MAIN}", json={"overdraft_limit": 100_000})
        cleared = await client.patch(f"{BASE}/accounts/{MAIN}", json={"overdraft_limit": None})
        await execute(
            db_url,
            "UPDATE finance.account SET kind = 'savings', overdraft_limit = 5000 "
            "WHERE name = 'Main'",
        )
        savings = (await client.get(f"{BASE}/accounts")).json()["accounts"][0]
        await execute(db_url, "UPDATE finance.account SET kind = 'business' WHERE name = 'Main'")
        business = await client.patch(f"{BASE}/accounts/{MAIN}", json={"overdraft_limit": 7_000})

    assert card.status_code == 422
    assert cleared.status_code == 200  # clearing is always allowed
    assert savings["available_minor"] == savings["balance"]  # a bank-sent limit adds nothing here
    assert business.json()["available_minor"] == business.json()["balance"] + 7_000


@pytest.mark.parametrize("limit", [-1, 10**12 + 1, 1.5, "5", True])
async def test_a_bad_overdraft_with_another_change_changes_nothing(
    db_url, make_dashboards_app, limit
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        response = await client.patch(
            f"{BASE}/accounts/{MAIN}", json={"name": "Renamed", "overdraft_limit": limit}
        )
        name = await scalar(
            db_url,
            "SELECT name FROM finance.account WHERE id = '00000000-0000-0000-0000-00000000000a'",
        )

    assert response.status_code == 422
    assert name == "Main"


async def test_a_refused_half_of_a_patch_does_not_save_the_other(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        link = (await client.post(f"{BASE}/manual/connections", json={"provider": "aqua"})).json()
        card = (
            await client.post(
                f"{BASE}/manual/accounts",
                json={
                    "connection_id": link["id"],
                    "name": "Card",
                    "kind": "credit_card",
                    "currency": "GBP",
                    "credit_limit": 500_000,
                    "owed": 1_000,
                },
            )
        ).json()
        response = await client.patch(
            f"{BASE}/accounts/{card['id']}", json={"name": "Renamed", "overdraft_limit": 5_000}
        )
        after = (await client.get(f"{BASE}/accounts")).json()["accounts"]

    assert response.status_code == 422  # a credit card has no overdraft
    assert "Card" in {a["name"] for a in after}
    assert "Renamed" not in {a["name"] for a in after}
