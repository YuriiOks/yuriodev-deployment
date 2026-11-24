"""Recurring payments over REST: entering, loading, matching to transactions, upcoming, attention.

Rows are seeded straight into the finance schema (`finance_support.seed`: a "Main" account in
hryvnia with 1 250 000 minor units, a "Euro" account, an archived one, and a few transactions
around 20 November 2026; "today" is 22 November). Every name and amount is invented.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from src.dashboards.finance.models import AttentionState
from src.dashboards.finance.recurring_schemas import RecurringOut
from tests.dashboards_support import AUTH, execute, running, scalar
from tests.finance_support import ACC_A, ACC_B, ACC_C, LINK, NOW, at, seed, seed_rates, tx
from tests.test_finance_recurring_logic import HEADER, LOAN, STREAMING

pytestmark = pytest.mark.anyio

BASE = "/api/dashboards/v1/finance"
MAIN = str(ACC_A)
OUTPUT_FIELDS = set(RecurringOut.model_fields)
OLD = timedelta(days=100)  # past the 90 days an unused state is kept
RECENT = timedelta(days=1)


def payment(**extra):
    return {"name": "Acme Streaming", "amount": 999, "currency": "GBP", **extra}


async def add(client, **extra):
    response = await client.post(f"{BASE}/recurring", json=payment(**extra))
    assert response.status_code == 201, response.text
    return response.json()


async def pay(client, name, amount, due, **extra):
    """A monthly payment in hryvnia from the Main account, due on a day; any field can be
    replaced (`account_id=None` for one no account of ours pays)."""
    values = {
        "name": name,
        "amount": amount,
        "currency": "UAH",
        "next_payment_date": due,
        "account_id": MAIN,
        **extra,
    }
    response = await client.post(f"{BASE}/recurring", json=values)
    assert response.status_code == 201, response.text
    return response.json()


async def listed(client, query=""):
    response = await client.get(f"{BASE}/recurring{query}")
    assert response.status_code == 200, response.text
    return response.json()["recurring"]


async def one(client, recurring_id):
    return (await client.get(f"{BASE}/recurring/{recurring_id}")).json()


async def add_transactions(app, *rows):
    async with app.state.dashboards.sessions() as session, session.begin():
        session.add_all(rows)


async def attention(client, query=""):
    response = await client.get(f"{BASE}/attention{query}")
    assert response.status_code == 200, response.text
    return response.json()


def kinds(answer):
    return [item["kind"] for item in answer["items"]]


# ---- entering and reading -------------------------------------------------------------------


async def test_a_payment_is_created_read_listed_and_shown_in_the_display_currency(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed_rates(app)
        made = await client.post(
            f"{BASE}/recurring",
            json=payment(
                amount=50_000,
                currency="UAH",
                kind="debt",
                next_payment_date="2026-12-15",
                start_date="2026-01-15",
                icon_url="https://example.test/a.png",
                color="#FA0",
                is_installment=True,
                total_installments=24,
                completed_installments=6,
                total_owed=100_000,
                remaining_balance=75_000,
                creditor="Sample Credit Ltd",
                payment_method="Sample card",
                reminder_days=3,
            ),
        )
        body = made.json()
        read = await one(client, body["id"])
        everything = (await client.get(f"{BASE}/recurring")).json()

    assert made.status_code == 201
    assert set(body) == OUTPUT_FIELDS
    assert read == body
    assert everything["recurring"] == [body]
    assert (body["amount"], body["currency"], body["kind"]) == (50_000, "UAH", "debt")
    assert (body["frequency"], body["frequency_interval"]) == ("monthly", 1)
    assert body["color"] == "#ffaa00"  # normalised
    assert body["remaining_installments"] == 18
    assert body["is_active"] is True
    assert (body["display_amount"], body["converted"]) == (1_000, True)  # at 0.02 pounds per UAH
    assert (body["display_total_owed"], body["display_remaining_balance"]) == (2_000, 1_500)
    assert everything["display"]["currency"] == "GBP"
    assert everything["display"]["rates"]["UAH"]["rate"] == "0.02"
    assert everything["display"]["missing"] == []


async def test_without_a_rate_the_original_stays_and_the_display_figures_are_null(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        body = await add(client, currency="UAH", total_owed=5)
        everything = (await client.get(f"{BASE}/recurring")).json()

    assert (body["display_amount"], body["display_total_owed"], body["converted"]) == (
        None,
        None,
        True,
    )
    assert everything["display"]["missing"] == ["UAH"]


async def test_the_list_filters_and_orders_active_first_then_by_next_date(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await add(client, name="Zed", next_payment_date="2026-12-20")
        await add(client, name="Beta", next_payment_date="2026-12-10", kind="utility")
        await add(client, name="Alpha", is_active=False, next_payment_date="2026-12-01")
        await add(client, name="Undated")
        everything = [r["name"] for r in await listed(client)]
        active = [r["name"] for r in await listed(client, "?active=true")]
        inactive = [r["name"] for r in await listed(client, "?active=false")]
        utilities = [r["name"] for r in await listed(client, "?kind=utility")]
        bad_kind = await client.get(f"{BASE}/recurring?kind=gift")

    assert everything == ["Beta", "Zed", "Undated", "Alpha"]
    assert active == ["Beta", "Zed", "Undated"]
    assert inactive == ["Alpha"]
    assert utilities == ["Beta"]
    assert bad_kind.status_code == 422


@pytest.mark.parametrize(
    "bad",
    [
        {"amount": -1},
        {"amount": 1.5},
        {"amount": "9.99"},
        {"amount": True},
        {"currency": "gbp"},
        {"currency": "POUND"},
        {"kind": "gift"},
        {"frequency": "sometimes"},
        {"frequency_interval": 0},
        {"reminder_days": 91},
        {"icon_url": "http://example.test/a.png"},
        {"icon_url": "javascript:alert(1)"},
        {"color": "blue"},
        {"name": ""},
        {"name": "x" * 121},
        {"next_payment_date": "22/11/2026"},
        {"total_installments": 2, "completed_installments": 3},
        {"unknown_field": 1},
        {"account_id": "not-a-uuid"},
        {"account_id": str(uuid.uuid4())},
    ],
)
async def test_a_bad_payment_is_refused_and_nothing_is_stored(db_url, make_dashboards_app, bad):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        response = await client.post(f"{BASE}/recurring", json=payment(**bad))
        after = await listed(client)

    assert response.status_code == 422
    assert after == []


async def test_a_reference_is_unique_and_a_missing_payment_is_404(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await add(client, external_ref="ref-1")
        again = await client.post(f"{BASE}/recurring", json=payment(external_ref="ref-1"))
        missing = await client.get(f"{BASE}/recurring/{uuid.uuid4()}")
        malformed = await client.get(f"{BASE}/recurring/nope")

    assert again.status_code == 409
    assert missing.status_code == 404
    assert malformed.status_code == 422


async def test_a_payment_can_name_one_of_our_accounts(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        body = await add(client, account_id=MAIN)

    assert body["account_id"] == MAIN


async def test_deleting_an_account_only_unlinks_the_payment(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        body = await add(client, account_id=str(ACC_C))
        await execute(
            db_url,
            "DELETE FROM finance.transaction "
            "WHERE account_id IN (SELECT id FROM finance.account WHERE name = 'Old')",
            "DELETE FROM finance.account WHERE name = 'Old'",
        )
        after = await one(client, body["id"])

    assert after["account_id"] is None


# ---- changing -------------------------------------------------------------------------------


async def test_a_patch_changes_what_is_sent_and_null_clears_what_may_be_empty(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        body = await add(client, notes="family plan", color="#112233")
        url = f"{BASE}/recurring/{body['id']}"
        changed = await client.patch(url, json={"amount": 1_250, "notes": None, "color": "#ABC"})
        stored = await one(client, body["id"])

    assert changed.status_code == 200
    assert changed.json() == stored
    assert (stored["amount"], stored["notes"], stored["color"]) == (1_250, None, "#aabbcc")
    assert stored["name"] == "Acme Streaming"


@pytest.mark.parametrize(
    "bad",
    [
        {"name": None},
        {"amount": None},
        {"currency": None},
        {"kind": None},
        {"frequency": None},
        {"frequency_interval": None},
        {"is_active": None},
        {"amount": -5},
        {"completed_installments": 5, "total_installments": 4},
        {"account_id": str(uuid.uuid4())},
        {"unknown": 1},
    ],
)
async def test_a_bad_patch_is_refused_and_changes_nothing(db_url, make_dashboards_app, bad):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        body = await add(client)
        response = await client.patch(f"{BASE}/recurring/{body['id']}", json=bad)
        after = await one(client, body["id"])

    assert response.status_code == 422
    assert after == body


async def test_a_patch_keeps_the_instalment_rule_with_what_is_stored(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        body = await add(client, total_installments=10, completed_installments=4)
        url = f"{BASE}/recurring/{body['id']}"
        too_many = await client.patch(url, json={"completed_installments": 11})
        fewer_total = await client.patch(url, json={"total_installments": 3})
        fine = await client.patch(url, json={"completed_installments": 10})

    assert (too_many.status_code, fewer_total.status_code, fine.status_code) == (422, 422, 200)


async def test_a_patch_of_a_reference_cannot_take_another_payments(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await add(client, name="One", external_ref="r1")
        second = await add(client, name="Two", external_ref="r2")
        url = f"{BASE}/recurring/{second['id']}"
        taken = await client.patch(url, json={"external_ref": "r1"})
        same = await client.patch(url, json={"external_ref": "r2"})
        missing = await client.patch(f"{BASE}/recurring/{uuid.uuid4()}", json={"amount": 1})

    assert (taken.status_code, same.status_code, missing.status_code) == (409, 200, 404)


async def test_a_payment_is_deleted(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        body = await add(client)
        gone = await client.delete(f"{BASE}/recurring/{body['id']}")
        again = await client.delete(f"{BASE}/recurring/{body['id']}")
        after = await listed(client)

    assert (gone.status_code, again.status_code, after) == (204, 404, [])


async def test_marking_a_payment_paid_moves_it_on_one_step(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        monthly = await add(
            client, next_payment_date="2026-11-30", start_date="2026-08-31", total_owed=900
        )
        once = await add(client, name="Fee", frequency="once", next_payment_date="2026-11-25")
        first = await client.post(f"{BASE}/recurring/{monthly['id']}/paid")
        second = await client.post(
            f"{BASE}/recurring/{monthly['id']}/paid", json={"paid_on": "2026-11-21"}
        )
        ended = await client.post(f"{BASE}/recurring/{once['id']}/paid", json={})
        missing = await client.post(f"{BASE}/recurring/{uuid.uuid4()}/paid")
        extra = await client.post(f"{BASE}/recurring/{monthly['id']}/paid", json={"x": 1})

    assert first.json()["next_payment_date"] == "2026-12-31"  # the 31st is kept as the anchor
    assert first.json()["last_paid_on"] == "2026-11-22"
    assert (second.json()["next_payment_date"], second.json()["last_paid_on"]) == (
        "2027-01-31",
        "2026-11-21",
    )
    assert second.json()["total_owed"] == 900  # no figure of his is changed on a guess
    assert (ended.json()["is_active"], ended.json()["next_payment_date"]) == (False, "2026-11-25")
    assert missing.status_code == 404
    assert extra.status_code == 422


# ---- loading many ---------------------------------------------------------------------------


async def test_a_bulk_load_creates_skips_and_updates_by_reference(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    items = [
        payment(name="One", external_ref="r1"),
        payment(name="Two", external_ref="r2"),
        payment(name="Three"),
    ]
    async with running(app, AUTH) as client:
        first = await client.post(f"{BASE}/recurring/bulk", json={"items": items})
        second = await client.post(f"{BASE}/recurring/bulk", json={"items": items})
        changed = [{**items[0], "amount": 5_000}]
        third = await client.post(
            f"{BASE}/recurring/bulk", json={"items": changed, "on_conflict": "update"}
        )
        names = sorted((r["name"], r["amount"]) for r in await listed(client))

    assert first.status_code == 200
    assert (first.json()["created"], first.json()["updated"], first.json()["skipped"]) == (3, 0, 0)
    assert len(first.json()["recurring"]) == 3
    assert (second.json()["created"], second.json()["skipped"]) == (1, 2)  # "Three" has no ref
    assert (third.json()["created"], third.json()["updated"]) == (0, 1)
    assert third.json()["recurring"][0]["amount"] == 5_000
    assert names == [("One", 5_000), ("Three", 999), ("Three", 999), ("Two", 999)]


async def test_a_bulk_load_with_any_error_writes_nothing_and_lists_every_problem(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    items = [
        payment(name="Fine"),
        {"name": "No money"},
        payment(name="Strange", account_id=str(uuid.uuid4())),
        payment(name="Same", external_ref="r"),
        payment(name="Same again", external_ref="r"),
        payment(name="Too many", total_installments=1, completed_installments=2),
    ]
    async with running(app, AUTH) as client:
        response = await client.post(f"{BASE}/recurring/bulk", json={"items": items})
        after = await listed(client)

    assert response.status_code == 422
    assert [(e["row"], e["field"]) for e in response.json()["errors"]] == [
        (2, "amount"),
        (2, "currency"),
        (3, "account_id"),
        (5, "external_ref"),
        (6, "completed_installments"),
    ]
    assert response.json()["created"] == 0
    assert after == []


async def test_a_dry_run_checks_and_stores_nothing(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        response = await client.post(
            f"{BASE}/recurring/bulk", json={"items": [payment()], "dry_run": True}
        )
        after = await listed(client)

    assert response.status_code == 200
    assert (response.json()["dry_run"], response.json()["created"]) == (True, 1)
    assert response.json()["recurring"] == []
    assert after == []


@pytest.mark.parametrize(
    "body",
    [
        {"items": [payment()] * 501},
        {"items": [payment()], "on_conflict": "delete"},
        {"items": [payment()], "extra": 1},
        {"items": "nope"},
        {},
    ],
)
async def test_a_malformed_bulk_body_is_refused(db_url, make_dashboards_app, body):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        response = await client.post(f"{BASE}/recurring/bulk", json=body)

    assert response.status_code == 422


def csv_body(*rows):
    return "\n".join([HEADER, *rows]).encode()


async def import_csv(client, body, query=""):
    return await client.post(
        f"{BASE}/recurring/import{query}", content=body, headers={"content-type": "text/csv"}
    )


async def test_the_owners_csv_loads_once_and_a_second_time_changes_nothing(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        first = await import_csv(client, csv_body(STREAMING, LOAN))
        second = await import_csv(client, csv_body(STREAMING, LOAN))
        updated = await import_csv(client, csv_body(STREAMING), "?on_conflict=update")
        everything = await listed(client, "?active=true")

    assert first.status_code == 200, first.text
    assert (first.json()["created"], first.json()["ignored_columns"]) == (2, ["extra_col"])
    streaming = next(r for r in first.json()["recurring"] if r["name"] == "Acme Streaming")
    assert (streaming["amount"], streaming["color"]) == (999, "#ffaa00")
    assert streaming["auto_renew"] is True
    assert streaming["icon_url"] == "https://example.test/acme.png"
    loan = next(r for r in first.json()["recurring"] if r["name"] == "Example Loan")
    assert (loan["kind"], loan["payment_type"], loan["total_owed"]) == ("debt", "loan", 360_000)
    assert (loan["remaining_balance"], loan["remaining_installments"]) == (270_000, 18)
    assert (second.json()["created"], second.json()["skipped"]) == (0, 2)
    assert updated.json()["updated"] == 1
    assert len(everything) == 2


async def test_a_dry_run_of_a_csv_stores_nothing(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        response = await import_csv(client, csv_body(STREAMING), "?dry_run=true")
        after = await listed(client)

    assert (response.status_code, response.json()["created"]) == (200, 1)
    assert after == []


async def test_a_csv_with_a_bad_row_writes_nothing_and_names_the_row(db_url, make_dashboards_app):
    bad = "Broken,1.234,GBP,monthly" + "," * 23
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        response = await import_csv(client, csv_body(STREAMING, bad))
        after = await listed(client)

    assert response.status_code == 422
    assert [(e["row"], e["field"]) for e in response.json()["errors"]] == [(2, "amount")]
    assert after == []


async def test_a_file_that_is_not_utf8_or_too_large_is_refused(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        latin = await import_csv(client, b"name\n\xe9\xff\xfe")
        huge = await import_csv(client, b"a" * (1024 * 1024 + 1))
        empty = await import_csv(client, b"")

    assert latin.status_code == 422
    assert (huge.status_code, huge.json()["error"]) == (413, "payload_too_large")
    assert empty.status_code == 422
    assert empty.json()["errors"][0]["message"] == "the file has no header row"


# ---- matching and moving on -----------------------------------------------------------------


async def test_a_payment_with_a_matching_transaction_moves_on_by_itself(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        body = await pay(client, "Corner Cafe", 45_000, "2026-11-20", start_date="2026-10-20")
        first = await one(client, body["id"])
        second = await one(client, body["id"])
        notices = await attention(client)

    assert body["next_payment_date"] == "2026-11-20"  # creating does not move anything
    assert first["next_payment_date"] == "2026-12-20"
    assert (first["last_paid_on"], first["last_charged_amount"]) == ("2026-11-20", 45_000)
    assert second == first  # running it again changes nothing
    assert notices["items"] == []  # the same amount: nothing to look at


async def test_a_different_amount_is_still_the_payment_and_is_raised_for_attention(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await seed_rates(app)
        body = await pay(client, "Bakery Example", 10_000, "2026-11-20")
        notices = await attention(client)
        await client.patch(f"{BASE}/recurring/{body['id']}", json={"amount": 12_000})
        after = await attention(client)

    (item,) = notices["items"]
    assert item["kind"] == "amount_changed"
    assert item["key"].startswith(f"amount_changed:{body['id']}:")
    assert item["facts"] == {
        "recorded_amount": 10_000,
        "charged_amount": 12_000,
        "difference": 2_000,
        "paid_on": "2026-11-20",
    }
    assert (item["amount"], item["currency"], item["display_amount"]) == (12_000, "UAH", 240)
    assert (item["subject_type"], item["subject_id"]) == ("recurring", body["id"])
    assert after["items"] == []  # the owner updated the amount


async def test_the_window_runs_three_days_before_to_seven_after(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        # The cafe and the bakery were paid on 20 November (10:00).
        early = await pay(client, "Corner Cafe", 45_000, "2026-11-23")
        too_early = await pay(client, "Corner Cafe", 45_000, "2026-11-24")
        late = await pay(client, "Bakery Example", 12_000, "2026-11-13")
        too_late = await pay(client, "Bakery Example", 12_000, "2026-11-12")
        states = {r["id"]: r["next_payment_date"] for r in await listed(client)}

    assert states[early["id"]] == "2026-12-23"  # 3 days early still counts
    assert states[too_early["id"]] == "2026-11-24"  # 4 days early does not
    assert states[late["id"]] == "2026-12-13"  # 7 days late still counts
    assert states[too_late["id"]] == "2026-11-12"  # 8 days late does not


async def test_one_transaction_pays_one_payment_only(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        first = await pay(client, "Corner Cafe", 45_000, "2026-11-20")
        second = await pay(client, "Corner Cafe", 45_000, "2026-11-21")
        states = {r["id"]: r["next_payment_date"] for r in await listed(client)}

    assert states[first["id"]] == "2026-12-20"
    assert states[second["id"]] == "2026-11-21"


async def test_the_closest_transaction_to_the_date_is_the_one(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await add_transactions(
            app,
            tx(30, ACC_A, at(11, 19), -5_000, "Gym Club"),
            tx(31, ACC_A, at(11, 21), -6_000, "Gym Club"),
        )
        body = await pay(client, "Gym Club", 5_000, "2026-11-21")
        after = await one(client, body["id"])

    assert after["last_charged_amount"] == 6_000
    assert after["last_paid_on"] == "2026-11-21"


async def test_money_in_declined_internal_and_other_currency_never_match(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await add_transactions(
            app,
            tx(30, ACC_A, at(11, 21), 5_000, "Gym Club"),  # money in
            tx(31, ACC_A, at(11, 21), -5_000, "Gym Club", declined=True),
            tx(32, ACC_A, at(11, 21), -5_000, "Gym Club", internal_transfer=True),
            tx(33, ACC_B, at(11, 21), -5_000, "Gym Club"),  # euros, on another account
        )
        from_main = await pay(client, "Gym Club", 5_000, "2026-11-21")
        in_pounds = await pay(client, "Gym Club", 5_000, "2026-11-21", currency="GBP")
        nobody = await pay(client, "Gym Club", 5_000, "2026-11-21", account_id=None)
        states = {r["id"]: r for r in await listed(client)}

    assert states[from_main["id"]]["next_payment_date"] == "2026-11-21"
    assert states[in_pounds["id"]]["next_payment_date"] == "2026-11-21"
    # No account of ours pays it and its date has passed: it moves on without any match.
    assert states[nobody["id"]]["next_payment_date"] == "2026-12-21"
    assert states[nobody["id"]]["last_paid_on"] is None


async def test_the_match_text_names_what_the_banks_text_says(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        plain = await pay(client, "Coffee subscription", 45_000, "2026-11-20")
        named = await pay(
            client, "Coffee subscription", 45_000, "2026-11-20", match_text="corner cafe"
        )
        states = {r["id"]: r["next_payment_date"] for r in await listed(client)}

    assert states[plain["id"]] == "2026-11-20"
    assert states[named["id"]] == "2026-12-20"


async def test_a_payment_that_happens_once_ends_when_it_is_paid(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        body = await pay(
            client, "Old purchase", 7_000, "2026-11-01", frequency="once", kind="one_time"
        )
        after = await one(client, body["id"])
        active = await listed(client, "?active=true")

    assert (after["is_active"], after["last_charged_amount"]) == (False, 7_000)
    assert after["next_payment_date"] == "2026-11-01"
    assert active == []


async def test_a_payment_nobody_can_see_moves_on_when_its_date_has_passed(
    db_url, make_dashboards_app, clock
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        body = await pay(
            client, "Cash rent", 1_000, "2026-09-30", start_date="2026-01-31", account_id=None
        )
        today = await one(client, body["id"])  # 22 November: two dates have passed
        clock.now = datetime(2027, 1, 1, 12, tzinfo=UTC)
        later = await one(client, body["id"])
        once = await pay(client, "Fee", 1, "2026-11-01", frequency="once", account_id=None)
        ended = await one(client, once["id"])

    assert today["next_payment_date"] == "2026-11-30"
    assert today["last_paid_on"] is None  # nothing was seen, so nothing is recorded
    assert later["next_payment_date"] == "2027-01-31"
    assert (ended["is_active"], ended["next_payment_date"]) == (False, "2026-11-01")


async def test_a_long_gap_is_caught_up_in_steps(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        body = await pay(client, "Old weekly", 1, "2025-01-01", frequency="weekly", account_id=None)
        after = await one(client, body["id"])
        again = await one(client, body["id"])

    assert after["next_payment_date"] == "2025-06-18"  # 24 weeks on: the cap of one pass
    assert again["next_payment_date"] == "2025-12-03"  # the next request continues


# ---- upcoming -------------------------------------------------------------------------------


async def sample_payments(client):
    await pay(client, "Rent Co", 1_000_000, "2026-11-25", color="#112233")
    await pay(client, "Insurance Co", 400_000, "2026-11-28")
    await pay(client, "Gym Weekly", 10_000, "2026-11-23", frequency="weekly", account_id=None)
    await pay(client, "Euro Sub", 1_000, "2026-12-01", currency="EUR")
    await pay(client, "Far Away", 5, "2026-12-30", account_id=None)
    await pay(client, "Paused", 5, "2026-11-24", account_id=None, is_active=False)


async def test_upcoming_lists_each_occurrence_with_coverage_and_converted_totals(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await seed_rates(app)
        await sample_payments(client)
        response = await client.get(f"{BASE}/upcoming")
        explicit = await client.get(f"{BASE}/upcoming?days=14")

    body = response.json()
    assert response.status_code == 200
    assert explicit.json() == body  # 14 days is the default
    assert (body["from_date"], body["to_date"]) == ("2026-11-22", "2026-12-06")
    assert [(i["name"], i["due_date"], i["days_until"]) for i in body["items"]] == [
        ("Gym Weekly", "2026-11-23", 1),
        ("Rent Co", "2026-11-25", 3),
        ("Insurance Co", "2026-11-28", 6),
        ("Gym Weekly", "2026-11-30", 8),
        ("Euro Sub", "2026-12-01", 9),
    ]
    by_name = {}
    for item in body["items"]:
        by_name.setdefault(item["name"], item)
    # The Main account has 1 250 000: rent leaves 250 000, insurance 400 000 is 150 000 short,
    # and the euro payment (1 000 EUR is 43 750 hryvnia) is short by that much more.
    assert (by_name["Rent Co"]["covered"], by_name["Rent Co"]["shortfall"]) == (True, 0)
    assert (by_name["Insurance Co"]["covered"], by_name["Insurance Co"]["shortfall"]) == (
        False,
        150_000,
    )
    assert (by_name["Euro Sub"]["covered"], by_name["Euro Sub"]["shortfall"]) == (False, 193_750)
    assert by_name["Euro Sub"]["account_currency"] == "UAH"
    assert (by_name["Gym Weekly"]["covered"], by_name["Gym Weekly"]["shortfall"]) == (None, None)
    assert by_name["Gym Weekly"]["account_currency"] is None
    assert by_name["Rent Co"]["color"] == "#112233"
    assert by_name["Rent Co"]["account_id"] == MAIN
    assert (by_name["Rent Co"]["display_amount"], by_name["Rent Co"]["converted"]) == (20_000, True)
    assert body["totals"] == [
        {"currency": "EUR", "amount": 1_000, "display_amount": 875, "converted": True},
        {"currency": "UAH", "amount": 1_420_000, "display_amount": 28_400, "converted": True},
    ]
    assert body["display"]["currency"] == "GBP"
    assert (body["display"]["total"], body["display"]["complete"]) == (29_275, True)
    assert body["display"]["rates"]["EUR"]["rate"] == "0.875"


async def test_the_owners_overdraft_counts_towards_coverage(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await seed_rates(app)
        await sample_payments(client)
        await client.patch(f"{BASE}/accounts/{MAIN}", json={"overdraft_limit": 200_000})
        body = (await client.get(f"{BASE}/upcoming")).json()

    covered = {i["name"]: i["covered"] for i in body["items"] if i["account_id"]}
    assert covered == {"Rent Co": True, "Insurance Co": True, "Euro Sub": True}


async def test_without_rates_coverage_in_the_same_currency_still_works(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await sample_payments(client)
        body = (await client.get(f"{BASE}/upcoming")).json()

    by_name = {i["name"]: i for i in body["items"]}
    assert by_name["Rent Co"]["covered"] is True
    assert by_name["Euro Sub"]["covered"] is None  # no rate to put euros in hryvnia
    assert by_name["Rent Co"]["display_amount"] is None
    assert body["display"]["complete"] is False
    assert body["display"]["missing"] == ["EUR", "UAH"]
    assert body["display"]["total"] == 0
    assert all(t["display_amount"] is None for t in body["totals"])


async def test_an_archived_account_covers_nothing_it_is_not_asked(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await pay(client, "Old card bill", 5, "2026-11-25", account_id=str(ACC_C))
        (item,) = (await client.get(f"{BASE}/upcoming")).json()["items"]

    assert (item["covered"], item["account_currency"]) == (None, None)


@pytest.mark.parametrize("days", [0, 367, -1, "x"])
async def test_the_days_of_upcoming_are_bounded(db_url, make_dashboards_app, days):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        response = await client.get(f"{BASE}/upcoming?days={days}")

    assert response.status_code == 422


async def test_upcoming_with_nothing_set_is_empty(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        body = (await client.get(f"{BASE}/upcoming?days=366")).json()

    assert (body["items"], body["totals"], body["display"]["total"]) == ([], [], 0)
    assert body["to_date"] == "2027-11-23"


# ---- attention ------------------------------------------------------------------------------


async def test_a_payment_due_soon_that_the_account_cannot_cover_is_raised(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await seed_rates(app)
        big = await pay(client, "Big Bill", 2_000_000, "2026-11-23")
        await pay(client, "Later Bill", 2_000_000, "2026-11-27")
        await pay(client, "Quiet Bill", 2_000_000, "2026-11-23", reminder_days=0)
        remind = await pay(client, "Early Bill", 2_000_000, "2026-11-27", reminder_days=5)
        body = await attention(client)

    assert [i["subject_id"] for i in body["items"]] == [big["id"], remind["id"]]
    first = body["items"][0]
    assert first["kind"] == "due_not_covered"
    assert first["key"] == f"due_not_covered:{big['id']}:2026-11-23"
    assert "tomorrow" in first["title"]
    assert first["facts"] == {"due_in_days": 1, "shortfall": 750_000, "account_currency": "UAH"}
    assert (first["amount"], first["currency"]) == (2_000_000, "UAH")
    assert first["due_date"] == "2026-11-23"
    assert (first["display_amount"], first["converted"]) == (40_000, True)
    assert (first["state"], first["snoozed_until"]) == ("active", None)
    assert body["display"]["currency"] == "GBP"
    assert body["hidden"] == 0


async def test_a_payment_past_its_date_with_no_transaction_is_raised_when_we_can_see_the_account(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        seen = await pay(client, "Acme Water", 3_000, "2026-11-18")
        await pay(client, "Cash Water", 3_000, "2026-11-18", account_id=None)
        body = await attention(client)

    (item,) = body["items"]
    assert item["kind"] == "missed_payment"
    assert item["key"] == f"missed_payment:{seen['id']}:2026-11-18"
    assert item["facts"] == {"days_overdue": 4, "last_paid_on": None, "account_id": MAIN}
    assert item["due_date"] == "2026-11-18"


async def test_a_card_close_to_its_limit_and_an_account_past_its_overdraft_are_raised(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await execute(
            db_url,
            "UPDATE finance.account SET kind = 'credit_card', balance = 40000 WHERE name = 'Main'",
        )
        high = await attention(client)
        await execute(db_url, "UPDATE finance.account SET balance = 50000 WHERE name = 'Main'")
        at_ninety = await attention(client)
        await execute(
            db_url,
            "UPDATE finance.account SET kind = 'current', balance = -10000 WHERE name = 'Main'",
        )
        past = await attention(client)
        await client.patch(f"{BASE}/accounts/{MAIN}", json={"overdraft_limit": 4_000})
        still = await attention(client)
        await client.patch(f"{BASE}/accounts/{MAIN}", json={"overdraft_limit": 10_000})
        within = await attention(client)

    (card,) = high["items"]
    assert (card["kind"], card["key"]) == ("credit_high", f"credit_high:{MAIN}:2026-11")
    assert card["facts"] == {"used_percent": 92, "owed": 460_000, "credit_limit": 500_000}
    assert (card["amount"], card["currency"]) == (460_000, "UAH")
    assert at_ninety["items"] == []  # exactly 90% is not above it
    (over,) = past["items"]
    assert (over["kind"], over["key"]) == ("overdraft", f"overdraft:{MAIN}:2026-11")
    assert over["facts"] == {"balance": -10_000, "overdraft_limit": None, "over_by": 10_000}
    assert over["amount"] == 10_000
    assert still["items"][0]["facts"]["over_by"] == 6_000  # the owner's limit counts
    assert within["items"] == []


async def test_a_connection_that_needs_approving_again_is_raised(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await execute(
            db_url,
            "UPDATE finance.connection SET status = 'needs_reconsent', "
            "status_changed_at = '2026-11-20T08:00:00Z'",
        )
        body = await attention(client)

    (item,) = body["items"]
    assert (item["kind"], item["key"]) == ("reconsent", f"reconsent:{LINK}:2026-11-20")
    assert item["facts"] == {"provider": "sample", "since": "2026-11-20"}
    assert item["subject_type"] == "connection"
    assert (item["amount"], item["display_amount"]) == (None, None)
    assert item["converted"] is False


async def test_items_come_in_a_fixed_order_by_kind_then_date(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await execute(
            db_url,
            "UPDATE finance.connection SET status = 'needs_reconsent'",
            "UPDATE finance.account SET balance = -10000 WHERE name = 'Main'",
        )
        await pay(client, "Missed", 1, "2026-11-18")
        await pay(client, "Big", 2_000_000, "2026-11-23")
        body = await attention(client)

    assert kinds(body) == ["due_not_covered", "missed_payment", "overdraft", "reconsent"]


async def test_dismissing_snoozing_and_restoring_an_item(db_url, make_dashboards_app, clock):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        body = await pay(client, "Acme Water", 3_000, "2026-11-18")
        key = (await attention(client))["items"][0]["key"]
        dismissed = await client.post(f"{BASE}/attention/dismiss", json={"key": key})
        hidden = await attention(client)
        shown = await attention(client, "?include_hidden=true")
        restored = await client.post(f"{BASE}/attention/restore", json={"key": key})
        back = await attention(client)
        snoozed = await client.post(f"{BASE}/attention/snooze", json={"key": key, "days": 3})
        quiet = await attention(client)
        clock.now += timedelta(days=4)  # the snooze has run out
        again = await attention(client)

    assert dismissed.status_code == 200
    assert (dismissed.json()["state"], dismissed.json()["key"]) == ("dismissed", key)
    assert (hidden["items"], hidden["hidden"]) == ([], 1)
    assert [(i["key"], i["state"]) for i in shown["items"]] == [(key, "dismissed")]
    assert restored.json()["state"] == "active"
    assert len(back["items"]) == 1
    assert snoozed.json()["state"] == "snoozed"
    assert snoozed.json()["snoozed_until"] == "2026-11-25T12:00:00Z"
    assert (quiet["items"], quiet["hidden"]) == ([], 1)
    assert [i["state"] for i in again["items"]] == ["active"]
    assert again["items"][0]["facts"]["days_overdue"] == 8
    assert body["id"] in key


async def test_a_new_occasion_is_a_new_item_after_a_dismissal(db_url, make_dashboards_app, clock):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await execute(db_url, "UPDATE finance.account SET balance = -10000 WHERE name = 'Main'")
        key = (await attention(client))["items"][0]["key"]
        await client.post(f"{BASE}/attention/dismiss", json={"key": key})
        same_month = await attention(client)
        clock.now = datetime(2026, 12, 2, 12, tzinfo=UTC)
        next_month = await attention(client)

    assert same_month["items"] == []
    assert [i["key"] for i in next_month["items"]] == [f"overdraft:{MAIN}:2026-12"]


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("dismiss", {"key": "nothing:here"}),
        ("snooze", {"key": "nothing:here", "days": 2}),
        ("restore", {"key": "nothing:here"}),
    ],
)
async def test_an_unknown_key_is_404(db_url, make_dashboards_app, path, body):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        response = await client.post(f"{BASE}/attention/{path}", json=body)

    assert response.status_code == 404


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("snooze", {"key": "k", "days": 0}),
        ("snooze", {"key": "k", "days": 91}),
        ("snooze", {"key": "k", "days": "3"}),
        ("snooze", {"key": "k"}),
        ("dismiss", {"key": ""}),
        ("dismiss", {"key": "k" * 201}),
        ("dismiss", {"key": "k", "days": 3}),
        ("dismiss", {}),
    ],
)
async def test_a_bad_state_change_is_refused(db_url, make_dashboards_app, path, body):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        response = await client.post(f"{BASE}/attention/{path}", json=body)

    assert response.status_code == 422


async def test_old_states_of_items_that_are_gone_are_cleaned_up(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await execute(db_url, "UPDATE finance.account SET balance = -10000 WHERE name = 'Main'")
        async with app.state.dashboards.sessions() as session, session.begin():
            session.add_all(
                [
                    AttentionState(key="old:gone", state="dismissed", updated_at=NOW - OLD),
                    AttentionState(key="new:gone", state="dismissed", updated_at=NOW - RECENT),
                ]
            )
        key = (await attention(client))["items"][0]["key"]
        await client.post(f"{BASE}/attention/dismiss", json={"key": key})
        left = await scalar(
            db_url, "SELECT string_agg(key, ',' ORDER BY key) FROM finance.attention_state"
        )

    assert left == f"new:gone,{key}"


async def test_every_new_route_needs_the_token(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    some = str(uuid.uuid4())
    calls = [
        ("get", "/recurring"),
        ("post", "/recurring"),
        ("post", "/recurring/bulk"),
        ("post", "/recurring/import"),
        ("get", f"/recurring/{some}"),
        ("patch", f"/recurring/{some}"),
        ("delete", f"/recurring/{some}"),
        ("post", f"/recurring/{some}/paid"),
        ("get", "/upcoming"),
        ("get", "/attention"),
        ("post", "/attention/dismiss"),
        ("post", "/attention/snooze"),
        ("post", "/attention/restore"),
    ]
    async with running(app, {"X-Dashboards-Token": "nope"}) as client:
        answers = [(await client.request(m, f"{BASE}{p}")).status_code for m, p in calls]

    assert answers == [401] * len(calls)


async def test_a_charge_found_only_while_catching_up_on_old_dates_is_not_an_amount_change(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await seed(app)
        await pay(client, "Bakery Example", 10_000, "2026-11-20")
        await listed(client)  # rolls it: the charge of 12 000 is found
        await execute(db_url, "UPDATE finance.recurring SET last_paid_on = '2026-08-01'")
        body = await attention(client)

    assert body["items"] == []
