"""Monobank's answers become neutral account and transaction data: minor units, ISO codes, four
digits of a number, and anything malformed refused whole."""

from datetime import UTC, datetime

import pytest
from pydantic import SecretStr

from src.core.http import UpstreamError
from src.dashboards.finance.monobank import (
    MonobankProvider,
    parse_account,
    parse_accounts,
    parse_item,
    parse_statement,
)
from tests.finance_support import (
    MONO_KEY,
    FakeMonobank,
    client_for,
    mono_account,
    mono_item,
    ts,
)

pytestmark = pytest.mark.anyio


def test_an_account_keeps_integer_minor_units_and_four_digits_only():
    account = parse_account(mono_account(balance=1_250_000, credit=500_000))

    assert account.external_id == "acc-black-uah"
    assert account.currency == "UAH"
    assert (account.balance, account.credit_limit) == (1_250_000, 500_000)
    assert account.mask_last4 == "1234"
    assert account.name == "Black card UAH"
    assert account.type == "black"
    assert isinstance(account.balance, int)


def test_an_account_without_a_card_takes_the_last_four_of_its_iban():
    account = parse_account(mono_account("acc-fop", kind="fop", pan=None, currency=978))

    assert account.mask_last4 == "4567"
    assert account.currency == "EUR"
    assert account.name == "Business account EUR"
    assert "UA21" not in repr(account)


def test_a_negative_balance_and_an_unknown_currency_are_kept_honestly():
    account = parse_account(mono_account(balance=-4_000, currency=12345))

    assert account.balance == -4_000
    assert account.currency == "XXX"


@pytest.mark.parametrize(
    "row",
    [
        mono_account(balance=12.5),  # a float is never money
        mono_account(balance=True),
        mono_account(balance="100"),
        {**mono_account(), "id": ""},
        {**mono_account(), "id": "../personal"},  # it goes into a URL path
        {**mono_account(), "id": 7},
        "not an object",
    ],
)
def test_a_malformed_account_refuses_the_whole_answer(row):
    with pytest.raises(UpstreamError) as raised:
        parse_accounts({"accounts": [mono_account("ok-1"), row]})

    assert raised.value.kind == "bad_json"


@pytest.mark.parametrize("body", [[], "x", {"accounts": "no"}, {"other": []}, None])
def test_an_answer_without_a_list_of_accounts_is_refused(body):
    with pytest.raises(UpstreamError):
        parse_accounts(body)


def test_a_purchase_is_negative_minor_units_with_its_category_and_balance():
    item = parse_item(
        mono_item("tx-1", ts(2026, 11, 20), -45_000, "Corner Cafe", balance=955_000), "UAH"
    )

    assert item.external_id == "tx-1"
    assert item.booked_at == datetime(2026, 11, 20, 12, 0, tzinfo=UTC)
    assert (item.amount, item.currency) == (-45_000, "UAH")
    assert item.original_amount is None
    assert item.original_currency is None
    assert item.description == "Corner Cafe"
    assert item.category_code == "5812"
    assert item.balance_after == 955_000
    assert item.pending is False
    assert item.counterparty is None


def test_a_foreign_currency_purchase_keeps_both_amounts():
    row = mono_item("tx-2", ts(2026, 11, 20), -80_000, currency=840, operation=-1_999)

    item = parse_item(row, "UAH")

    assert (item.amount, item.currency) == (-80_000, "UAH")
    assert (item.original_amount, item.original_currency) == (-1_999, "USD")


def test_an_amount_in_the_account_currency_has_no_original():
    item = parse_item(mono_item("tx-3", ts(2026, 11, 20), -500, operation=-500), "UAH")

    assert item.original_amount is None
    assert item.original_currency is None


def test_a_hold_is_pending_and_a_business_counterparty_is_kept():
    row = mono_item("tx-4", ts(2026, 11, 20), 1_000_000, hold=True, counter="Globex Supplies Ltd")

    item = parse_item(row, "UAH")

    assert item.pending is True
    assert item.amount == 1_000_000
    assert item.counterparty == "Globex Supplies Ltd"


def test_text_is_one_printable_line_and_cut():
    row = mono_item("tx-5", ts(2026, 11, 20), -1, "  Two\n  lines\x07 here  " + "x" * 800)

    item = parse_item(row, "UAH")

    assert item.description.startswith("Two lines here xxx")
    assert len(item.description) == 500
    assert "\x07" not in item.description


@pytest.mark.parametrize(
    "row",
    [
        {**mono_item("tx", ts(2026, 11, 20), -1), "amount": -1.5},
        {**mono_item("tx", ts(2026, 11, 20), -1), "amount": None},
        {**mono_item("tx", ts(2026, 11, 20), -1), "id": ""},
        {**mono_item("tx", ts(2026, 11, 20), -1), "id": "x" * 65},
        {**mono_item("tx", ts(2026, 11, 20), -1), "time": 0},
        {**mono_item("tx", ts(2026, 11, 20), -1), "time": 99_999_999_999},
        {**mono_item("tx", ts(2026, 11, 20), -1), "time": 1.5},
        {**mono_item("tx", ts(2026, 11, 20), -1), "balance": 1.5},
        [],
    ],
)
def test_a_malformed_item_refuses_the_whole_statement(row):
    with pytest.raises(UpstreamError) as raised:
        parse_statement([mono_item("ok", ts(2026, 11, 20), -1), row], "UAH")

    assert raised.value.kind == "bad_json"


def test_a_statement_that_is_not_a_list_is_refused():
    with pytest.raises(UpstreamError):
        parse_statement({"errorDescription": "x"}, "UAH")


async def test_requests_carry_the_key_in_x_token_and_the_documented_paths():
    fake = FakeMonobank(
        [mono_account()], {"acc-black-uah": [mono_item("tx-1", ts(2026, 11, 20), -45_000)]}
    )
    provider = MonobankProvider(SecretStr(MONO_KEY))
    async with client_for(fake) as client:
        accounts = await provider.fetch_accounts(client)
        start = datetime(2026, 10, 25, 12, 0, tzinfo=UTC)
        end = datetime(2026, 11, 22, 12, 0, tzinfo=UTC)
        items = await provider.fetch_statement(client, "acc-black-uah", "UAH", start, end)

    assert [a.external_id for a in accounts] == ["acc-black-uah"]
    assert [i.external_id for i in items] == ["tx-1"]
    assert fake.calls == [
        ("client-info",),
        ("statement", "acc-black-uah", int(start.timestamp()), int(end.timestamp())),
    ]
    assert all(seen["x-token"] == MONO_KEY for seen in fake.headers_seen)
    assert all(MONO_KEY not in seen["user-agent"] for seen in fake.headers_seen)


def test_the_provider_limits_are_the_documented_ones_with_margin():
    provider = MonobankProvider(SecretStr(MONO_KEY))

    assert provider.min_call_gap.total_seconds() > 60
    assert provider.max_window.total_seconds() <= 2_682_000
    assert provider.page_limit == 500


def test_jars_are_accounts_of_type_jar():
    body = {
        "accounts": [mono_account()],
        "jars": [{"id": "jar-1", "title": "Holiday fund", "currencyCode": 840, "balance": 25_000}],
    }

    black, jar = parse_accounts(body)

    assert black.type == "black"
    assert (jar.external_id, jar.name, jar.type, jar.currency) == (
        "jar-1",
        "Holiday fund",
        "jar",
        "USD",
    )
    assert (jar.balance, jar.credit_limit, jar.mask_last4) == (25_000, 0, None)
    assert parse_accounts({"accounts": []}) == []
    with pytest.raises(UpstreamError):
        parse_accounts({"accounts": [], "jars": "no"})
    with pytest.raises(UpstreamError):
        parse_accounts({"accounts": [], "jars": [{"id": "a/b", "balance": 1}]})


async def test_a_counterparty_that_is_one_of_the_owners_own_accounts_is_an_internal_transfer():
    own_iban = "UA213220010000026207301234567"
    items = [
        mono_item("tx-1", ts(2026, 11, 20), -1_000, counter_iban=own_iban),
        mono_item("tx-2", ts(2026, 11, 20), -2_000, counter_iban="UA00OTHER0000000000000000001"),
        mono_item("tx-3", ts(2026, 11, 20), -3_000),
    ]
    fake = FakeMonobank([mono_account(iban=own_iban)], {"acc-black-uah": items})
    provider = MonobankProvider(SecretStr(MONO_KEY))
    start = datetime(2026, 11, 1, tzinfo=UTC)
    end = datetime(2026, 11, 22, tzinfo=UTC)
    async with client_for(fake) as client:
        before = parse_statement([items[0]], "UAH")  # no accounts known yet
        await provider.fetch_accounts(client)
        found = await provider.fetch_statement(client, "acc-black-uah", "UAH", start, end)

    assert before[0].internal_transfer is False
    assert {item.external_id: item.internal_transfer for item in found} == {
        "tx-1": True,
        "tx-2": False,
        "tx-3": False,
    }
    assert own_iban not in repr(found)  # the counterparty's IBAN is compared, never kept


def test_a_card_with_a_credit_limit_is_a_credit_card_a_fop_is_business_and_a_jar_is_a_pot():
    black = parse_account(mono_account())
    credit = parse_account(mono_account("acc-credit", kind="platinum", credit=7_000_000))
    fop = parse_account(mono_account("acc-fop", kind="fop", pan=None))
    (jar,) = parse_accounts(
        {"accounts": [], "jars": [{"id": "jar-1", "currencyCode": 980, "balance": 5}]}
    )

    assert (black.kind, black.label) == ("current", "Black")
    assert (credit.kind, credit.label) == ("credit_card", "Platinum")
    assert (fop.kind, fop.label) == ("business", "Business")
    assert (jar.kind, jar.label) == ("pot", "Jar")
    assert jar.name_generated is True  # no title: the name was made up
    assert (black.overdraft_limit, black.parent_external_id) == (None, None)


def test_a_card_payment_gets_its_category_from_the_merchant_code_and_keeps_the_code():
    shop = parse_item(mono_item("tx-1", ts(2026, 11, 20), -45_000, mcc=5411), "UAH")
    cafe = parse_item(mono_item("tx-2", ts(2026, 11, 20), -45_000, mcc=5812), "UAH")
    salary = parse_item(mono_item("tx-3", ts(2026, 11, 20), 100_000, mcc=0), "UAH")
    unknown = parse_item(mono_item("tx-4", ts(2026, 11, 20), -100, mcc=9999), "UAH")

    assert (shop.category, shop.category_code) == ("groceries", "5411")
    assert cafe.category == "eating_out"
    assert salary.category == "income"
    assert unknown.category == "other"


def test_a_move_between_own_accounts_is_a_transfer_not_spending():
    own = frozenset({"UA213220010000026207301234567"})
    row = mono_item("tx-1", ts(2026, 11, 20), -45_000, mcc=5411, counter_iban=next(iter(own)))

    item = parse_item(row, "UAH", own)

    assert (item.internal_transfer, item.category) == (True, "transfers")


def test_a_jar_has_its_goal_and_a_given_name_is_not_generated():
    body = {
        "accounts": [{"id": "a1", "balance": 1, "currencyCode": 980, "type": "black"}],
        "jars": [
            {"id": "j1", "title": "Holiday", "currencyCode": 980, "balance": 5, "goal": 100_000},
            {"id": "j2", "title": "Spare", "currencyCode": 980, "balance": 5, "goal": 0},
        ],
    }

    card, holiday, spare = parse_accounts(body)

    assert (holiday.kind, holiday.goal_amount, holiday.name_generated) == ("pot", 100_000, False)
    assert (spare.goal_amount, card.name_generated) == (None, True)
    with pytest.raises(UpstreamError):
        parse_accounts({"accounts": [], "jars": [{"id": "j", "balance": 1, "goal": 1.5}]})
