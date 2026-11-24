"""Banks entered by hand over REST: connections, accounts, balances, statements, providers and
the stale-data notice. Every name and amount is invented."""

import uuid

import pytest

from src.dashboards.finance.brands import BRANDS
from tests.dashboards_support import AUTH, execute, running
from tests.finance_support import LINK, seed
from tests.test_finance_statements import OFX_SGML, PAYPAL_FILE

pytestmark = pytest.mark.anyio

FINANCE = "/api/dashboards/v1/finance"
BASE = f"{FINANCE}/manual"
FILE = (
    "Date,Description,Amount,Balance\n"
    "2026-11-02,Corner Cafe,-4.50,95.50\n"
    "2026-11-03,Payroll,1000.00,1095.50\n"
    "2026-11-03,Corner Cafe,-4.50,1091.00\n"
)
NEUTRAL = {"provider": "personal-bank", "display_name": "My Bank"}


async def connect(client, **extra):
    response = await client.post(f"{BASE}/connections", json={"provider": "barclays", **extra})
    assert response.status_code == 201, response.text
    return response.json()


async def open_account(client, link, **extra):
    values = {
        "connection_id": link["id"],
        "name": "Everyday",
        "currency": "GBP",
        "balance": 120_000,
        "as_of": "2026-11-20",
        **extra,
    }
    response = await client.post(f"{BASE}/accounts", json=values)
    assert response.status_code == 201, response.text
    return response.json()


async def upload(client, account, text, query=""):
    body = text if isinstance(text, bytes) else text.encode()
    return await client.post(
        f"{BASE}/accounts/{account['id']}/statement{query}",
        content=body,
        headers={"content-type": "text/csv"},
    )


async def stored(client, account):
    response = await client.get(f"{FINANCE}/transactions?account={account['id']}&limit=200")
    return response.json()["transactions"]


async def connection(client, link):
    found = (await client.get(f"{FINANCE}/accounts")).json()["connections"]
    return next(c for c in found if c["id"] == link["id"])


async def card(client, link, **extra):
    values = {"kind": "credit_card", "credit_limit": 500_000, "owed": 120_000, "name": "Card"}
    values["balance"] = None
    return await open_account(client, link, **{**values, **extra})


# ---- connections ----------------------------------------------------------------------------


async def test_a_manual_connection_is_made_named_and_changed(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        plain = await connect(client)
        own = await client.post(
            f"{BASE}/connections", json={**NEUTRAL, "brand_bg": "#14233C", "brand_fg": "#FFFFFF"}
        )
        renamed = await client.patch(
            f"{BASE}/connections/{own.json()['id']}", json={"display_name": "Other Name"}
        )
        uncoloured = await client.patch(
            f"{BASE}/connections/{own.json()['id']}", json={"brand_bg": None, "brand_fg": None}
        )
        listed = (await client.get(f"{FINANCE}/accounts")).json()["connections"]

    assert plain["provider"] == "barclays"
    assert (plain["manual"], plain["status"], plain["last_ok_at"]) == (True, "ok", None)
    assert plain["display_name"] is None
    assert own.status_code == 201
    assert (own.json()["provider"], own.json()["display_name"]) == ("personal-bank", "My Bank")
    assert renamed.json()["display_name"] == "Other Name"
    assert uncoloured.json()["display_name"] == "Other Name"
    assert sorted(c["id"] for c in listed) == sorted([plain["id"], own.json()["id"]])


@pytest.mark.parametrize(
    "bad",
    [
        {"provider": "monzo"},
        {"provider": "monobank"},
        {"provider": "Bad Id"},
        {"provider": "x" * 33},
        {"provider": ""},
        {"display_name": ""},
        {"display_name": "x" * 61},
        {"brand_bg": "#003087"},
        {"brand_fg": "#ffffff"},
        {"brand_bg": "#777777", "brand_fg": "#888888"},
        {"brand_bg": "blue", "brand_fg": "white"},
        {"unknown": 1},
    ],
)
async def test_a_bad_connection_is_refused(db_url, make_dashboards_app, bad):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        response = await client.post(f"{BASE}/connections", json={"provider": "barclays", **bad})
        after = (await client.get(f"{FINANCE}/accounts")).json()["connections"]

    assert response.status_code == 422
    assert after == []


async def test_only_a_manual_connection_can_be_changed_by_hand(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        api = await client.patch(f"{BASE}/connections/{LINK}", json={"display_name": "X"})
        other = f"{BASE}/connections/{uuid.uuid4()}"
        missing = await client.patch(other, json={"display_name": "X"})
        low = await connect(client)
        contrast = await client.patch(
            f"{BASE}/connections/{low['id']}", json={"brand_bg": "#777777", "brand_fg": "#888888"}
        )
        half = await client.patch(f"{BASE}/connections/{low['id']}", json={"brand_bg": "#003087"})

    assert (api.status_code, missing.status_code) == (422, 404)
    assert (contrast.status_code, half.status_code) == (422, 422)


# ---- accounts and balances ------------------------------------------------------------------


async def test_an_account_is_opened_with_its_first_balance_and_date(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        link = await connect(client)
        body = await open_account(
            client, link, mask_last4="4321", label="Joint", opened_at="2020-05-01"
        )
        found = await connection(client, link)

    assert (body["provider"], body["kind"], body["currency"]) == ("barclays", "current", "GBP")
    assert (body["balance"], body["own_balance_minor"], body["available_minor"]) == (
        120_000,
        120_000,
        120_000,
    )
    assert (body["mask_last4"], body["label"], body["credit_limit"]) == ("4321", "Joint", 0)
    assert body["balance_at"] == "2026-11-20T23:59:59Z"
    assert body["opened_at"] == "2020-04-30T23:00:00Z"  # the start of that day in London
    assert body["overdraft_limit_source"] is None
    assert found["last_ok_at"] == "2026-11-20T23:59:59Z"  # the data is as of that day
    assert found["manual"] is True


async def test_an_account_can_take_an_overdraft_and_a_time_with_an_offset(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        link = await connect(client)
        body = await open_account(
            client, link, balance=-5_000, overdraft_limit=20_000, as_of="2026-11-21T09:00:00+01:00"
        )
        today = await open_account(client, link, name="Today", as_of="2026-11-22")
        unset = await open_account(client, link, name="Now", as_of=None)

    assert body["balance"] == -5_000
    assert (body["overdraft_limit"], body["overdraft_limit_source"]) == (20_000, "owner")
    assert body["available_minor"] == 15_000
    assert body["balance_at"] == "2026-11-21T08:00:00Z"
    assert today["balance_at"] == "2026-11-22T12:00:00Z"  # today is as of now, not later
    assert unset["balance_at"] == "2026-11-22T12:00:00Z"


async def test_a_credit_card_is_given_by_what_is_owed(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        link = await connect(client, provider="aqua")
        body = await card(client, link)
        listed = (await client.get(f"{FINANCE}/accounts")).json()["accounts"]

    assert (body["kind"], body["credit_limit"]) == ("credit_card", 500_000)
    assert (body["balance"], body["own_balance_minor"], body["available_minor"]) == (
        380_000,
        -120_000,
        380_000,
    )
    assert [a["id"] for a in listed] == [body["id"]]


@pytest.mark.parametrize(
    "bad",
    [
        {"kind": "credit_card", "credit_limit": 500_000, "balance": 1},
        {"kind": "credit_card", "credit_limit": 0, "owed": 5, "balance": None},
        {"kind": "credit_card", "owed": 5, "balance": None},
        {"kind": "credit_card", "credit_limit": 500_000, "balance": None},
        {"owed": 5},
        {"credit_limit": 100},
        {"balance": None},
        {"kind": "savings", "overdraft_limit": 100},
        {"kind": "pot"},
        {"mask_last4": "12"},
        {"currency": "gbp"},
        {"name": ""},
        {"as_of": "2026-11-23"},
        {"as_of": "2026-11-22T13:00:00+00:00"},
        {"as_of": "2026-11-20T10:00:00"},
        {"balance": 1.5},
        {"balance": 10**13},
        {"unknown": 1},
    ],
)
async def test_a_bad_account_is_refused(db_url, make_dashboards_app, bad):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        link = await connect(client)
        values = {
            "connection_id": link["id"],
            "name": "Everyday",
            "currency": "GBP",
            "balance": 1,
            **bad,
        }
        response = await client.post(f"{BASE}/accounts", json=values)
        listed = (await client.get(f"{FINANCE}/accounts")).json()["accounts"]

    assert response.status_code == 422
    assert listed == []


async def test_an_account_needs_a_manual_connection_that_exists(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        values = {"name": "A", "currency": "GBP", "balance": 1}
        api = await client.post(f"{BASE}/accounts", json={"connection_id": str(LINK), **values})
        missing = await client.post(
            f"{BASE}/accounts", json={"connection_id": str(uuid.uuid4()), **values}
        )

    assert (api.status_code, missing.status_code) == (422, 404)


async def test_a_balance_is_set_with_a_date_and_the_data_date_only_moves_forward(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        link = await connect(client)
        account = await open_account(client, link)
        url = f"{BASE}/accounts/{account['id']}/balance"
        newer = await client.post(url, json={"balance": 130_000, "as_of": "2026-11-21"})
        older = await client.post(url, json={"balance": -2_000, "as_of": "2026-11-10"})
        found = await connection(client, link)

    assert newer.json()["balance"] == 130_000
    assert older.json()["balance"] == -2_000  # the owner may correct an older figure
    assert older.json()["balance_at"] == "2026-11-10T23:59:59Z"
    assert found["last_ok_at"] == "2026-11-21T23:59:59Z"  # but the connection is as new as it was


async def test_a_card_balance_is_set_by_what_is_owed_and_the_other_kinds_by_balance(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        link = await connect(client)
        plain = await open_account(client, link)
        owing = await card(client, link)
        on_card = f"{BASE}/accounts/{owing['id']}/balance"
        on_plain = f"{BASE}/accounts/{plain['id']}/balance"
        paid_down = await client.post(on_card, json={"owed": 20_000})
        wrong_for_card = await client.post(on_card, json={"balance": 5})
        wrong_for_plain = await client.post(on_plain, json={"owed": 5})
        both = await client.post(on_plain, json={"balance": 5, "owed": 5})
        neither = await client.post(on_plain, json={})
        future = await client.post(on_plain, json={"balance": 5, "as_of": "2026-12-01"})

    assert paid_down.json()["balance"] == 480_000
    assert paid_down.json()["own_balance_minor"] == -20_000
    refused = (wrong_for_card, wrong_for_plain, both, neither, future)
    assert [r.status_code for r in refused] == [422] * 5


async def test_the_fields_of_a_manual_account_can_be_changed(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        link = await connect(client)
        plain = await open_account(client, link)
        owing = await card(client, link)
        mine, cards = f"{FINANCE}/accounts/{plain['id']}", f"{FINANCE}/accounts/{owing['id']}"
        changes = {"name": "Bills", "label": "Joint", "mask_last4": "9876"}
        changes["overdraft_limit"] = 7_000
        renamed = await client.patch(mine, json=changes)
        hidden = await client.patch(mine, json={"archived": True})
        limit = await client.patch(cards, json={"credit_limit": 600_000})
        cleared = await client.patch(mine, json={"label": None})

    assert (renamed.json()["name"], renamed.json()["label"]) == ("Bills", "Joint")
    assert (renamed.json()["mask_last4"], renamed.json()["overdraft_limit"]) == ("9876", 7_000)
    assert hidden.json()["archived"] is True
    assert (limit.json()["credit_limit"], limit.json()["balance"]) == (600_000, 480_000)
    assert limit.json()["own_balance_minor"] == -120_000  # what is owed stays
    assert cleared.json()["label"] is None


@pytest.mark.parametrize(
    "bad",
    [
        {"name": None},
        {"archived": None},
        {"credit_limit": 0},
        {"credit_limit": 5},
        {"mask_last4": "1"},
    ],
)
async def test_a_bad_change_to_a_manual_account_is_refused(db_url, make_dashboards_app, bad):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        link = await connect(client)
        plain = await open_account(client, link)
        response = await client.patch(f"{FINANCE}/accounts/{plain['id']}", json=bad)

    assert response.status_code == 422


async def test_a_current_account_becomes_a_credit_card_and_back_keeping_what_is_owed(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        link = await connect(client)
        plain = await open_account(client, link, balance=-120_000, overdraft_limit=5_000)
        url = f"{FINANCE}/accounts/{plain['id']}"
        no_limit = await client.patch(url, json={"kind": "credit_card"})
        zero = await client.patch(url, json={"kind": "credit_card", "credit_limit": 0})
        card = await client.patch(url, json={"kind": "credit_card", "credit_limit": 500_000})
        raised = await client.patch(url, json={"credit_limit": 600_000})
        back_with_limit = await client.patch(url, json={"kind": "current", "credit_limit": 1})
        back = await client.patch(url, json={"kind": "current"})
        savings = await client.patch(url, json={"kind": "savings"})
        same = await client.patch(url, json={"kind": "savings", "name": "Pot of cash"})
        pot = await client.patch(url, json={"kind": "pot"})
        cleared = await client.patch(url, json={"kind": None})

    assert (no_limit.status_code, zero.status_code) == (422, 422)
    assert (card.json()["kind"], card.json()["credit_limit"]) == ("credit_card", 500_000)
    assert (card.json()["balance"], card.json()["own_balance_minor"]) == (380_000, -120_000)
    assert card.json()["overdraft_limit_source"] is None  # a card has no overdraft
    assert raised.json()["balance"] == 480_000
    assert back_with_limit.status_code == 422
    assert (back.json()["kind"], back.json()["credit_limit"], back.json()["balance"]) == (
        "current",
        0,
        -120_000,
    )
    assert savings.json()["kind"] == "savings"
    assert (same.json()["kind"], same.json()["name"]) == ("savings", "Pot of cash")
    assert (pot.status_code, cleared.status_code) == (422, 422)


async def test_an_account_from_a_bank_api_only_takes_the_overdraft(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        account = (await client.get(f"{FINANCE}/accounts")).json()["accounts"][0]
        renamed = await client.patch(f"{FINANCE}/accounts/{account['id']}", json={"name": "X"})
        overdraft = await client.patch(
            f"{FINANCE}/accounts/{account['id']}", json={"overdraft_limit": 5}
        )
        empty = await client.patch(f"{FINANCE}/accounts/{account['id']}", json={})
        balance = await client.post(f"{BASE}/accounts/{account['id']}/balance", json={"balance": 1})
        statement = await upload(client, account, FILE)

    assert (renamed.status_code, overdraft.status_code, empty.status_code) == (422, 200, 422)
    assert (balance.status_code, statement.status_code) == (422, 422)


# ---- statements -----------------------------------------------------------------------------


async def test_a_statement_is_read_into_transactions_with_totals_to_check(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        link = await connect(client)
        account = await open_account(client, link, as_of="2026-10-01")
        response = await upload(client, account, FILE)
        rows = await stored(client, account)
        found = await connection(client, link)
        again = await upload(client, account, FILE)
        after = await stored(client, account)

    result = response.json()
    assert response.status_code == 200
    assert (result["layout"], result["dry_run"], result["parsed"]) == ("generic", False, 3)
    assert (result["created"], result["duplicates"]) == (3, 0)
    assert (result["first_date"], result["last_date"]) == ("2026-11-02", "2026-11-03")
    assert (result["money_in"], result["money_out"]) == (100_000, 900)
    assert (result["balance_applied"], result["errors"]) == (False, [])
    assert sorted((r["amount"], r["description"]) for r in rows) == [
        (-450, "Corner Cafe"),
        (-450, "Corner Cafe"),  # two identical lines are two transactions
        (100_000, "Payroll"),
    ]
    assert {r["currency"] for r in rows} == {"GBP"}
    assert {r["category"] for r in rows if r["amount"] < 0} == {"other"}
    assert {r["category"] for r in rows if r["amount"] > 0} == {"income"}
    assert {r["booked_at"][11:] for r in rows} == {"12:00:00Z"}  # no time in the file: noon
    assert found["last_ok_at"] == "2026-11-03T12:00:00Z"
    assert (again.json()["created"], again.json()["duplicates"]) == (0, 3)
    assert len(after) == 3


async def test_an_overlapping_statement_adds_only_the_new_lines(db_url, make_dashboards_app):
    later = (
        "Date,Description,Amount\n"
        "2026-11-03,Payroll,1000.00\n"
        "2026-11-03,Corner Cafe,-4.50\n"
        "2026-11-04,Bakery Example,-2.00\n"
    )
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        link = await connect(client)
        account = await open_account(client, link)
        await upload(client, account, FILE)
        response = await upload(client, account, later)
        rows = await stored(client, account)

    assert (response.json()["created"], response.json()["duplicates"]) == (1, 2)
    assert len(rows) == 4


async def test_a_dry_run_reads_the_file_and_stores_nothing(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        link = await connect(client)
        account = await open_account(client, link)
        response = await upload(client, account, FILE, "?dry_run=true&apply_balance=true")
        rows = await stored(client, account)
        found = await connection(client, link)

    result = response.json()
    assert (result["dry_run"], result["created"], result["parsed"]) == (True, 3, 3)
    assert (result["money_in"], result["money_out"]) == (100_000, 900)
    assert result["balance_applied"] is False
    assert rows == []
    assert found["last_ok_at"] == "2026-11-20T23:59:59Z"


async def test_a_file_with_any_bad_line_writes_nothing_and_lists_every_problem(
    db_url, make_dashboards_app
):
    text = (
        "Date,Description,Amount\n"
        "2026-11-02,Fine,-1.00\n"
        "2026-13-02,Bad date,-1.00\n"
        "2026-11-04,Bad amount,1.234\n"
    )
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        link = await connect(client)
        account = await open_account(client, link)
        response = await upload(client, account, text)
        rows = await stored(client, account)

    assert response.status_code == 422
    problems = [(e["row"], e["field"]) for e in response.json()["errors"]]
    assert problems == [(2, "date"), (3, "amount")]
    assert (response.json()["created"], response.json()["parsed"]) == (0, 0)
    assert rows == []


async def test_the_balance_of_the_newest_line_can_be_applied(db_url, make_dashboards_app):
    descending = (
        "Date,Description,Amount,Balance\n"
        "2026-11-03,Payroll,1000.00,1095.50\n"
        "2026-11-02,Corner Cafe,-4.50,95.50\n"
    )
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        link = await connect(client)
        ascending = await open_account(client, link, name="Up", as_of="2026-11-01")
        down = await open_account(client, link, name="Down", as_of="2026-11-01")
        rising = FILE.replace("-4.50,1091.00", "1.00,1096.50")
        up_result = await upload(client, ascending, rising, "?apply_balance=true")
        down_result = await upload(client, down, descending, "?apply_balance=true")
        listed = (await client.get(f"{FINANCE}/accounts")).json()["accounts"]
        accounts = {a["name"]: a for a in listed}

    assert up_result.json()["balance_applied"] is True
    assert down_result.json()["balance_applied"] is True
    assert accounts["Up"]["balance"] == 109_650
    assert accounts["Up"]["balance_at"] == "2026-11-03T23:59:59Z"
    assert accounts["Down"]["balance"] == 109_550


async def test_a_balance_that_is_not_newer_than_the_one_set_is_not_applied(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        link = await connect(client)
        account = await open_account(client, link, as_of="2026-11-10")
        response = await upload(client, account, FILE, "?apply_balance=true")
        after = (await client.get(f"{FINANCE}/accounts")).json()["accounts"][0]

    assert response.json()["created"] == 3
    assert response.json()["balance_applied"] is False
    assert after["balance"] == 120_000


@pytest.mark.parametrize(
    "text",
    [
        "Date,Description,Amount\n2026-11-02,A,-1.00\n",  # no balance column
        "Date,Description,Amount,Balance\n2026-11-02,A,-1.00,5.00\n2026-11-02,B,-1.00,4.00\n",
    ],
)
async def test_a_balance_that_cannot_be_told_is_refused_before_anything_is_written(
    db_url, make_dashboards_app, text
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        link = await connect(client)
        account = await open_account(client, link)
        response = await upload(client, account, text, "?apply_balance=true")
        rows = await stored(client, account)

    assert response.status_code == 422
    assert rows == []


async def test_a_credit_cards_balance_is_not_taken_from_a_statement(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        link = await connect(client, provider="aqua")
        account = await card(client, link)
        response = await upload(client, account, FILE, "?apply_balance=true")
        plain = await upload(client, account, FILE)

    assert response.status_code == 422
    assert (plain.status_code, plain.json()["created"]) == (200, 3)


async def test_an_unknown_layout_an_empty_file_and_a_bad_encoding_are_refused(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        link = await connect(client)
        account = await open_account(client, link)
        unknown = await upload(client, account, "Name,Total\nA,1\n")
        empty = await upload(client, account, b"")
        latin = await upload(client, account, b"Date,Description,Amount\n2026-11-02,\xe9,1\n")
        no_lines = await upload(client, account, "Date,Description,Amount\n")
        huge = await upload(client, account, b"a" * (2 * 1024 * 1024 + 1))
        missing = await client.post(f"{BASE}/accounts/{uuid.uuid4()}/statement", content=b"x")

    assert (unknown.status_code, unknown.json()["error"]) == (422, "unknown_layout")
    assert (empty.status_code, empty.json()["error"]) == (422, "unknown_layout")
    assert (latin.status_code, latin.json()["error"]) == (422, "validation_error")
    assert (no_lines.status_code, no_lines.json()["errors"][0]["message"]) == (422, "no lines")
    assert (huge.status_code, huge.json()["error"]) == (413, "payload_too_large")
    assert missing.status_code == 404


async def test_slash_dates_need_their_order_unless_the_file_shows_it(db_url, make_dashboards_app):
    ambiguous = "Date,Description,Amount\n01/02/2026,A,-1.00\n03/02/2026,B,-2.00\n"
    clear = "Date,Description,Amount\n25/11/2026,A,-1.00\n"
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        link = await connect(client)
        account = await open_account(client, link)
        refused = await upload(client, account, ambiguous)
        dmy = await upload(client, account, ambiguous, "?date_order=dmy")
        shown = await upload(client, account, clear)
        bad = await upload(client, account, ambiguous, "?date_order=ymd")

    assert refused.status_code == 422
    assert refused.json()["errors"][0]["field"] == "date"
    assert (dmy.json()["first_date"], dmy.json()["last_date"]) == ("2026-02-01", "2026-02-03")
    assert shown.json()["first_date"] == "2026-11-25"
    assert bad.status_code == 422


async def test_an_ofx_file_is_read_with_the_banks_own_ids_and_its_balance(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        link = await connect(client, provider="personal-bank")
        account = await open_account(client, link, as_of="2026-11-01")
        first = await upload(client, account, OFX_SGML, "?apply_balance=true")
        second = await upload(client, account, OFX_SGML)
        rows = await stored(client, account)
        current = (await client.get(f"{FINANCE}/accounts")).json()["accounts"][0]

    assert (first.json()["layout"], first.json()["created"]) == ("ofx", 2)
    assert first.json()["balance_applied"] is True
    assert (second.json()["created"], second.json()["duplicates"]) == (0, 2)
    assert sorted(r["booked_at"] for r in rows) == ["2026-11-02T12:00:00Z", "2026-11-03T12:00:00Z"]
    assert (current["balance"], current["balance_at"]) == (109_550, "2026-11-03T23:59:59Z")


async def test_a_paypal_download_goes_into_a_paypal_account_and_no_other(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        paypal = await connect(client, provider="paypal")
        account = await open_account(client, paypal, as_of="2026-10-01")
        elsewhere = await open_account(client, await connect(client), as_of="2026-10-01")
        response = await upload(client, account, PAYPAL_FILE)
        wrong = await upload(client, elsewhere, PAYPAL_FILE)
        rows = await stored(client, account)

    result = response.json()
    assert (result["layout"], result["created"], result["money_in"]) == ("paypal", 4, 950)
    assert result["money_out"] == 2_500  # the denied line moved no money
    assert sorted(r["amount"] for r in rows) == [-2_000, -500, -500, 950]
    assert sum(r["pending"] for r in rows) == 1
    assert sum(r["declined"] for r in rows) == 1
    assert (wrong.status_code, wrong.json()["error"]) == (422, "unknown_layout")


async def test_a_statement_in_another_currency_is_refused(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        link = await connect(client)
        account = await open_account(client, link, currency="EUR")
        response = await upload(client, account, OFX_SGML)

    assert response.status_code == 422
    assert response.json()["errors"][0]["field"] == "currency"


# ---- providers and the stale-data notice -----------------------------------------------------


async def test_the_providers_come_with_names_colours_and_how_they_are_entered(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await connect(client, **NEUTRAL, brand_bg="#14233C", brand_fg="#FFFFFF")
        await connect(client, provider="barclays", display_name="Joint Barclays")
        await connect(client, provider="unnamed-bank")
        found = (await client.get(f"{FINANCE}/providers")).json()["providers"]

    by_id = {p["id"]: p for p in found}
    assert set(BRANDS) <= set(by_id)
    assert by_id["lloyds"]["name"] == "Lloyds Bank"
    assert by_id["lloyds"]["colors"] == {"background": "#006a4d", "foreground": "#ffffff"}
    assert (by_id["monzo"]["entry"], by_id["barclays"]["entry"]) == ("api", "manual")
    assert by_id["barclays"]["name"] == "Joint Barclays"  # the owner's name wins
    assert by_id["barclays"]["colors"]["background"] == "#00395d"  # but the brand's colours stay
    assert by_id["personal-bank"]["name"] == "My Bank"
    assert by_id["personal-bank"]["entry"] == "manual"
    assert by_id["personal-bank"]["colors"] == {"background": "#14233c", "foreground": "#ffffff"}
    assert by_id["unnamed-bank"]["name"] == "unnamed-bank"
    assert by_id["unnamed-bank"]["colors"] == {"background": "#334155", "foreground": "#ffffff"}
    assert set(by_id["lloyds"]["logo"]) == {"on_light", "on_dark", "mark"}


async def test_data_older_than_thirty_days_is_raised_for_attention(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        link = await connect(client, display_name="Joint Barclays")
        old = await open_account(client, link, as_of="2026-10-22")
        fresh = await client.post(
            f"{BASE}/accounts/{old['id']}/balance", json={"balance": 1, "as_of": "2026-10-23"}
        )
        within = (await client.get(f"{FINANCE}/attention")).json()
        await client.post(
            f"{BASE}/accounts/{old['id']}/balance", json={"balance": 1, "as_of": "2026-10-22"}
        )
        await execute(db_url, "UPDATE finance.connection SET last_ok_at = '2026-10-22T22:59:59Z'")
        stale = (await client.get(f"{FINANCE}/attention")).json()
        await client.patch(f"{FINANCE}/accounts/{old['id']}", json={"archived": True})
        archived = (await client.get(f"{FINANCE}/attention")).json()

    assert fresh.status_code == 200
    assert within["items"] == []  # 29 and a half days
    (item,) = stale["items"]
    assert item["kind"] == "stale_statement"
    assert item["key"] == f"stale_statement:{link['id']}:2026-10-22"
    assert item["facts"] == {"provider": "barclays", "as_of": "2026-10-22", "days_old": 31}
    assert (item["subject_type"], item["amount"]) == ("connection", None)
    assert "Joint Barclays" in item["title"]
    assert archived["items"] == []  # nothing open on it


async def test_a_connection_with_no_data_yet_is_stale_only_once_it_has_an_account(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await connect(client)
        empty = (await client.get(f"{FINANCE}/attention")).json()

    assert empty["items"] == []


async def test_every_manual_route_needs_the_token(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    some = str(uuid.uuid4())
    calls = [
        ("post", "/connections"),
        ("patch", f"/connections/{some}"),
        ("post", "/accounts"),
        ("post", f"/accounts/{some}/balance"),
        ("post", f"/accounts/{some}/statement"),
    ]
    async with running(app, {"X-Dashboards-Token": "nope"}) as client:
        answers = [(await client.request(m, f"{BASE}{p}")).status_code for m, p in calls]

    assert answers == [401] * len(calls)
