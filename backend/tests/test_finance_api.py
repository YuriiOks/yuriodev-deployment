"""The read-only finance REST API: the gate, accounts, transactions (filters, zone, paging) and
the summary. Rows are seeded straight into the finance schema; every name and amount is invented."""

import re
import uuid

import pytest

from src.app import create_app
from tests.dashboards_support import AUTH, CRED, running
from tests.finance_support import ACC_A, ACC_B, NEWEST_FIRST, money, seed

pytestmark = pytest.mark.anyio

BASE = "/api/dashboards/v1/finance"
PATHS = (f"{BASE}/accounts", f"{BASE}/transactions", f"{BASE}/summary")
ACCOUNT_FIELDS = {
    "id",
    "connection_id",
    "provider",
    "name",
    "type",
    "currency",
    "mask_last4",
    "balance",
    "credit_limit",
    "own_balance_minor",
    "balance_at",
    "opened_at",
    "history_from",
    "archived",
    "kind",
    "label",
    "parent_id",
    "goal_amount",
    "overdraft_limit",
    "overdraft_limit_source",
    "overdraft_limit_bank",
    "available_minor",
    "display_balance_minor",
    "display_own_balance_minor",
    "display_available_minor",
    "converted",
}
TRANSACTION_FIELDS = {
    "id",
    "account_id",
    "booked_at",
    "amount",
    "currency",
    "original_amount",
    "original_currency",
    "description",
    "counterparty",
    "category_code",
    "balance_after",
    "pending",
    "internal_transfer",
    "internal_transfer_by_owner",
    "time_known",
    "declined",
    "settled_at",
    "category",
    "category_overridden",
    "display_amount_minor",
    "converted",
}


def ids(response):
    return [int(row["id"].rsplit("-", 1)[1], 16) for row in response.json()["transactions"]]


async def test_the_gate_guards_every_finance_path(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app) as client:
        anonymous = [await client.get(path) for path in PATHS]
        wrong = [await client.get(path, headers={"X-Dashboards-Token": "nope"}) for path in PATHS]
        allowed = [await client.get(path, headers=AUTH) for path in PATHS]

    assert [r.status_code for r in anonymous + wrong] == [401] * 6
    assert [r.status_code for r in allowed] == [200] * 3
    assert all(r.headers["cache-control"] == "no-store" for r in anonymous + allowed)


async def test_a_trusted_proxy_needs_no_token(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url, dashboards_api_token=None, dashboards_trust_proxy_auth=True)
    async with running(app) as client:
        response = await client.get(f"{BASE}/accounts")

    assert response.status_code == 200


async def test_without_a_database_the_finance_paths_are_disabled(make_settings):
    app = create_app(make_settings(dashboards_api_token=CRED))
    async with running(app, AUTH, wait=False) as client:
        responses = [await client.get(path) for path in PATHS]

    assert [r.status_code for r in responses] == [503] * 3
    assert {r.json()["error"] for r in responses} == {"dashboards_disabled"}


async def test_there_is_no_way_to_write(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        codes = [
            (await client.request(method, path, json={})).status_code
            for path in PATHS
            for method in ("POST", "PUT", "PATCH", "DELETE")
        ]
        one = await client.delete(f"{BASE}/transactions/{uuid.UUID(int=1001)}")
        after = await client.get(f"{BASE}/transactions")

    assert set(codes) == {405}
    assert one.status_code in (404, 405)
    assert len(after.json()["transactions"]) == 8


async def test_accounts_carry_balances_in_minor_units_and_the_state_of_the_link(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        response = await client.get(f"{BASE}/accounts")

    body = response.json()
    first = body["accounts"][0]
    assert set(first) == ACCOUNT_FIELDS
    assert (first["name"], first["balance"], first["credit_limit"]) == ("Main", 1_250_000, 500_000)
    assert first["mask_last4"] == "1234"
    assert first["own_balance_minor"] == 750_000  # the stored balance minus the credit limit
    assert first["history_from"] == "2026-10-31T23:30:00Z"  # its oldest transaction
    assert (first["kind"], first["overdraft_limit"], first["parent_id"]) == ("current", None, None)
    assert first["available_minor"] == 1_250_000  # no overdraft known: the balance as it is
    assert first["opened_at"] is None
    assert [a["archived"] for a in body["accounts"]] == [False, False, True]  # open ones first
    (link,) = body["connections"]
    assert (link["provider"], link["status"]) == ("sample", "ok")
    assert re.search(r'"balance":1250000[,}]', response.text)  # an integer, never 1250000.0


async def test_transactions_are_newest_first_and_every_amount_is_an_integer(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        response = await client.get(f"{BASE}/transactions")

    rows = response.json()["transactions"]
    assert ids(response) == NEWEST_FIRST
    assert response.json()["next_cursor"] is None
    assert set(rows[0]) == TRANSACTION_FIELDS
    assert (rows[0]["amount"], rows[0]["currency"]) == (-45_000, "UAH")
    assert rows[0]["booked_at"] == "2026-11-20T10:00:00Z"
    assert (rows[2]["original_amount"], rows[2]["original_currency"]) == (11_000, "USD")
    assert rows[3]["pending"] is True
    flagged = [i for i, row in zip(NEWEST_FIRST, rows, strict=True) if row["internal_transfer"]]
    assert flagged == [1008]
    assert not re.search(r'"(amount|original_amount|balance_after)":-?\d+[.eE]', response.text)


async def test_one_account_and_the_errors_around_it(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        euro = await client.get(f"{BASE}/transactions", params={"account": str(ACC_B)})
        missing = await client.get(f"{BASE}/transactions", params={"account": str(uuid.uuid4())})
        malformed = await client.get(f"{BASE}/transactions", params={"account": "x"})

    assert ids(euro) == [1007, 1006]
    assert missing.status_code == 404
    assert missing.json()["error"] == "not_found"
    assert malformed.status_code == 422


async def test_a_date_range_counts_whole_days_in_the_configured_zone(db_url, make_dashboards_app):
    first = {"from": "2026-11-01", "to": "2026-11-01"}
    app = make_dashboards_app(db_url, dashboards_timezone="Europe/Kyiv")
    async with running(app, AUTH) as client:
        await seed(app)
        kyiv = await client.get(f"{BASE}/transactions", params=first)
        two_days = {"from": "2026-11-18", "to": "2026-11-19"}
        span = await client.get(f"{BASE}/transactions", params=two_days)
        from_only = await client.get(f"{BASE}/transactions", params={"from": "2026-11-19"})
        backwards = {"from": "2026-11-19", "to": "2026-11-18"}
        reversed_ = await client.get(f"{BASE}/transactions", params=backwards)
    app = make_dashboards_app(db_url, dashboards_timezone="Europe/London")
    async with running(app, AUTH) as client:
        london = await client.get(f"{BASE}/transactions", params=first)

    # 23:30 UTC on 31 October is already 1 November at 01:30 in Kyiv.
    assert ids(kyiv) == [1004, 1005]
    assert ids(london) == [1004]
    assert ids(span) == [1007, 1006]
    assert ids(from_only) == [1002, 1001, 1007]
    assert reversed_.status_code == 422


async def test_pages_follow_the_cursor_without_gaps_or_repeats(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        pages = []
        cursor = None
        while True:
            params = {"limit": 3, **({"cursor": cursor} if cursor else {})}
            response = await client.get(f"{BASE}/transactions", params=params)
            pages.append(response)
            cursor = response.json()["next_cursor"]
            if cursor is None:
                break
        tampered = await client.get(f"{BASE}/transactions", params={"cursor": "bm90LWEtY3Vyc29y"})
        garbage = await client.get(f"{BASE}/transactions", params={"cursor": "***"})
        bounds = [
            await client.get(f"{BASE}/transactions", params={"limit": value})
            for value in (0, 201, "x")
        ]

    assert [len(ids(p)) for p in pages] == [3, 3, 2]
    assert [i for p in pages for i in ids(p)] == NEWEST_FIRST
    assert tampered.status_code == 422
    assert garbage.status_code == 422
    assert tampered.json()["error"] == "validation_error"
    assert [r.status_code for r in bounds] == [422, 422, 422]


async def test_text_search_matches_description_or_counterparty_and_treats_wildcards_literally(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)

        async def found(text):
            return ids(await client.get(f"{BASE}/transactions", params={"q": text}))

        cafe = await found("CAFE")
        party = await found("globex")
        percent = await found("100%")
        under = await found("_")
        wild = await found("n%f")
        slash = await found("\\")
        too_long = await client.get(f"{BASE}/transactions", params={"q": "x" * 101})

    assert cafe == [1002]
    assert party == [1003]
    assert percent == [1004]  # a percent sign is a character, not a wildcard
    assert under == []
    assert wild == []
    assert slash == []
    assert too_long.status_code == 422


async def test_amount_bounds_are_signed_minor_units(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        within = {"min_amount": -1000, "max_amount": 0}
        small = await client.get(f"{BASE}/transactions", params=within)
        big_out = await client.get(f"{BASE}/transactions", params={"max_amount": -10_000})
        combined = await client.get(
            f"{BASE}/transactions",
            params={"q": "e", "account": str(ACC_A), "min_amount": -50_000, "max_amount": -10_000},
        )
        floaty = await client.get(f"{BASE}/transactions", params={"min_amount": "12.5"})

    assert ids(small) == [1008, 1004]
    assert ids(big_out) == [1002, 1001]
    assert ids(combined) == [1002, 1001]
    assert floaty.status_code == 422


async def test_the_summary_totals_each_currency_and_this_months_movement(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        empty = await client.get(f"{BASE}/summary")
        await seed(app)
        response = await client.get(f"{BASE}/summary")

    assert money(empty.json()) == {
        "month": "2026-11",
        "as_of": None,
        "as_of_newest": None,
        "as_of_oldest": None,
        "currencies": [],
    }
    body = response.json()
    assert body["month"] == "2026-11"
    assert body["as_of"] == "2026-11-22T12:00:00Z"
    # Open accounts only in the balance; every November transaction in the movement except moves
    # between the owner's own accounts and declined payments; 31 October is last month's.
    assert money(body["currencies"]) == [
        {
            "currency": "EUR",
            "accounts": 1,
            "balance": 33_300,
            "own_balance": 33_300,
            "spent": 2_500,
            "received": 10_000,
        },
        {
            "currency": "UAH",
            "accounts": 1,
            "balance": 1_250_000,
            "own_balance": 750_000,
            "spent": 45_000 + 12_000 + 500,  # not the 300 moved between own accounts
            "received": 1_000_000,
        },
    ]
