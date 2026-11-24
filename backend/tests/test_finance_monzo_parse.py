"""Monzo's answers become neutral account and transaction data: minor units, ISO codes, declined
and pending told apart, pot transfers flagged, and nothing private kept."""

from datetime import UTC, datetime

import pytest

from src.core.http import UpstreamError
from src.dashboards.finance.monzo import (
    parse_account_rows,
    parse_current,
    parse_pots,
    parse_transaction,
    parse_transactions,
    rfc3339,
)
from tests.monzo_support import ACCOUNT, POT, monzo_tx

WHEN = datetime(2026, 11, 20, 10, 30, tzinfo=UTC)


def test_a_card_payment_keeps_minor_units_merchant_and_category():
    item = parse_transaction(monzo_tx(1, WHEN, -510), "GBP")

    assert item.external_id == "tx_0000000000000000000001"
    assert item.booked_at == WHEN
    assert (item.amount, item.currency) == (-510, "GBP")
    assert item.counterparty == "Corner Cafe Ltd"
    assert item.category_code == "eating_out"
    assert item.balance_after == 100_000
    assert item.settled_at == datetime(2026, 11, 21, 10, 30, tzinfo=UTC)
    assert (item.pending, item.declined, item.internal_transfer) == (False, False, False)
    assert item.original_amount is None


def test_nothing_private_is_kept():
    item = parse_transaction(monzo_tx(1, WHEN, -510), "GBP")

    assert "SENTINEL" not in repr(item)  # no notes, address or coordinates


def test_an_authorised_payment_that_has_not_settled_is_pending():
    item = parse_transaction(monzo_tx(2, WHEN, -510, settled=False), "GBP")

    assert item.pending is True
    assert item.settled_at is None


def test_a_declined_payment_is_declined_and_not_pending():
    item = parse_transaction(
        monzo_tx(3, WHEN, -510, settled=False, decline="INSUFFICIENT_FUNDS"), "GBP"
    )

    assert (item.declined, item.pending) == (True, False)


def test_a_payment_in_another_currency_keeps_both_amounts():
    item = parse_transaction(monzo_tx(4, WHEN, -1_300, local=(-1_500, "EUR")), "GBP")

    assert (item.amount, item.currency) == (-1_300, "GBP")
    assert (item.original_amount, item.original_currency) == (-1_500, "EUR")
    same = parse_transaction(monzo_tx(5, WHEN, -1_300, local=(-1_300, "GBP")), "GBP")
    assert same.original_amount is None


@pytest.mark.parametrize(
    "row",
    [
        monzo_tx(6, WHEN, -10_000, POT, merchant=None, pot=True),
        {**monzo_tx(7, WHEN, -10_000, "Savings", merchant=None), "scheme": "uk_retail_pot"},
        monzo_tx(8, WHEN, -10_000, "pot_0000778xxfgh4iu8z83nWb", merchant=None),
    ],
)
def test_a_pot_transfer_is_an_internal_transfer(row):
    assert parse_transaction(row, "GBP").internal_transfer is True


def test_a_merchant_that_is_only_an_id_or_a_counterparty_name_is_handled():
    plain = {**monzo_tx(9, WHEN, -1), "merchant": "merch_00008zIcpbAKe8shBxXUtl"}
    friend = {**monzo_tx(10, WHEN, 500, merchant=None), "counterparty": {"name": "A Friend"}}

    assert parse_transaction(plain, "GBP").counterparty is None
    assert parse_transaction(friend, "GBP").counterparty == "A Friend"


@pytest.mark.parametrize(
    "row",
    [
        {**monzo_tx(1, WHEN, -1), "amount": -1.5},
        {**monzo_tx(1, WHEN, -1), "amount": True},
        {**monzo_tx(1, WHEN, -1), "id": ""},
        {**monzo_tx(1, WHEN, -1), "id": "../x"},
        {**monzo_tx(1, WHEN, -1), "created": "2026-11-20T10:30:00"},  # no zone
        {**monzo_tx(1, WHEN, -1), "created": "yesterday"},
        {**monzo_tx(1, WHEN, -1), "account_balance": 1.5},
        [],
    ],
)
def test_a_malformed_transaction_refuses_the_whole_page(row):
    with pytest.raises(UpstreamError) as raised:
        parse_transactions({"transactions": [monzo_tx(2, WHEN, -1), row]}, "GBP")

    assert raised.value.kind == "bad_json"


@pytest.mark.parametrize("body", [[], {}, {"transactions": "x"}, None])
def test_a_page_without_a_list_is_refused(body):
    with pytest.raises(UpstreamError):
        parse_transactions(body, "GBP")


def test_the_current_account_uses_its_own_balance_and_a_neutral_name():
    row = {"id": ACCOUNT, "description": "Sample Holder", "created": "2023-11-22T00:00:00Z"}
    rows = parse_account_rows({"accounts": [row]}, "uk_retail")
    balance = {"balance": 150_000, "total_balance": 200_000, "currency": "GBP"}

    account = parse_current(ACCOUNT, rows[ACCOUNT], balance)

    assert (account.balance, account.currency, account.type) == (150_000, "GBP", "uk_retail")
    assert account.name == "Current account GBP"
    assert "Sample Holder" not in repr(account)  # never the holder's name
    assert account.opened_at == datetime(2023, 11, 22, tzinfo=UTC)
    assert account.mask_last4 is None


def test_a_closed_account_is_left_out_and_a_malformed_balance_refused():
    body = {"accounts": [{"id": "acc_1", "closed": True}, {"id": "acc_2"}]}

    assert list(parse_account_rows(body, "uk_retail")) == ["acc_2"]
    row = {"type": "uk_retail", "created": None}
    for balance in ({"balance": 1.5, "currency": "GBP"}, {"balance": 1, "currency": "gbp"}):
        with pytest.raises(UpstreamError):
            parse_current("acc_2", row, balance)


def test_pots_are_accounts_of_type_pot_and_deleted_ones_are_skipped():
    body = {
        "pots": [
            {"id": POT, "name": "Holiday", "balance": 50_000, "currency": "GBP", "deleted": False},
            {"id": "pot_gone", "name": "Old", "balance": 0, "currency": "GBP", "deleted": True},
        ]
    }

    (pot,) = parse_pots(body)

    assert (pot.external_id, pot.name, pot.type, pot.balance) == (POT, "Holiday", "pot", 50_000)
    with pytest.raises(UpstreamError):
        parse_pots({"pots": "x"})


def test_timestamps_are_written_in_utc_seconds():
    assert rfc3339(WHEN) == "2026-11-20T10:30:00Z"


def test_a_current_account_has_a_kind_a_neutral_label_the_last_four_digits_and_an_overdraft():
    body = {
        "accounts": [
            {"id": ACCOUNT, "created": "2022-12-01T00:00:00Z", "account_number": "12345678"},
        ]
    }
    rows = parse_account_rows(body, "uk_retail")
    balance = {"balance": -74_782, "currency": "GBP", "overdraft_limit": 100_000}

    account = parse_current(ACCOUNT, rows[ACCOUNT], balance)

    assert (account.kind, account.label, account.mask_last4) == ("current", "Personal", "5678")
    assert account.overdraft_limit == 100_000
    assert account.balance == -74_782
    assert "12345678" not in repr(account)  # only the last four digits are kept


@pytest.mark.parametrize(
    ("balance_extra", "expected"),
    [
        ({"overdraft": {"limit": 75_000}}, 75_000),
        ({"overdraft_limit": 0}, 0),
        ({"overdraft_limit": -5}, None),
        ({"overdraft_limit": 12.5}, None),
        ({"overdraft_limit": True}, None),
        ({"overdraft": "yes"}, None),
        ({}, None),
    ],
)
def test_an_overdraft_is_used_when_the_answer_carries_one_and_never_required(
    balance_extra, expected
):
    rows = parse_account_rows({"accounts": [{"id": ACCOUNT}]}, "uk_retail")
    balance = {"balance": 1, "currency": "GBP", **balance_extra}

    assert parse_current(ACCOUNT, rows[ACCOUNT], balance).overdraft_limit == expected


@pytest.mark.parametrize(
    ("account_type", "kind", "label"),
    [
        ("uk_retail", "current", "Personal"),
        ("uk_retail_joint", "current", "Joint"),
        ("uk_monzo_flex", "credit_card", "Monzo Flex"),
        ("uk_business", "business", "Business"),
        ("uk_retail_savings", "savings", "Retail Savings"),
    ],
)
def test_the_account_type_gives_the_kind_and_a_label(account_type, kind, label):
    rows = parse_account_rows({"accounts": [{"id": ACCOUNT, "type": account_type}]}, "uk_retail")
    balance = {"balance": 1, "currency": "GBP", "overdraft_limit": 5}

    account = parse_current(ACCOUNT, rows[ACCOUNT], balance)

    assert (account.kind, account.label) == (kind, label)
    assert (account.overdraft_limit is not None) == (kind == "current")  # only a current one


def test_a_pot_knows_its_account_and_its_goal_when_there_is_one():
    def pot(number, **goal):
        return {"id": f"pot_{number}", "name": "P", "balance": 5, "currency": "GBP", **goal}

    body = {
        "pots": [
            pot(1, goal_amount=300_000),
            pot(2, target_amount=700),
            pot(3, goal_amount=0),
            pot(4, goal_amount=True),
        ]
    }

    pots = parse_pots(body, ACCOUNT)

    assert [p.goal_amount for p in pots] == [300_000, 700, None, None]
    assert {(p.kind, p.parent_external_id, p.label) for p in pots} == {("pot", ACCOUNT, "Pot")}


@pytest.mark.parametrize(
    ("code", "amount", "category"),
    [
        ("groceries", -500, "groceries"),
        ("general", 700, "income"),
        ("bills", -9_000, "housing_utilities"),
    ],
)
def test_a_transaction_gets_a_normalised_category_and_keeps_monzos_own(code, amount, category):
    item = parse_transaction(monzo_tx(1, WHEN, amount, category=code), "GBP")

    assert (item.category, item.category_code) == (category, code)


def test_a_pot_transfer_is_a_transfer():
    item = parse_transaction(monzo_tx(1, WHEN, -10_000, POT, merchant=None, pot=True), "GBP")

    assert (item.internal_transfer, item.category) == (True, "transfers")
