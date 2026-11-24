"""The rules of recurring payments that need no database: dates, matching, checks, CSV."""

from datetime import date

import pytest
from pydantic import ValidationError

from src.dashboards.finance.recurring import (
    MAX_ROWS,
    RecurringIn,
    advance,
    amount_differs,
    anchor_of,
    instalments_agree,
    kind_of,
    normal_color,
    occurrences,
    parse_csv,
    safe_icon_url,
    text_matches,
)

HEADER = (
    "name,amount,currency,frequency,frequency_interval,start_date,next_payment_date,payment_type,"
    "payment_mode,category,notes,is_active,payment_method,reminder_days,icon_url,color,auto_renew,"
    "is_installment,total_installments,completed_installments,total_owed,remaining_balance,"
    "creditor,target_amount,current_saved,recipient,extra_col"
)
STREAMING = (
    "Acme Streaming,9.99,GBP,monthly,1,2026-01-15,2026-12-15,subscription,auto,Entertainment,"
    "family plan,true,Sample card,3,https://example.test/acme.png,#FA0,yes,false,,,,,,,,,x"
)
LOAN = (
    "Example Loan,150.00,GBP,monthly,1,2026-02-01,2026-12-01,loan,manual,Debt,,true,Main account,"
    "5,,,false,true,24,6,3600.00,2700.00,Sample Credit Ltd,,,,"
)


def test_months_keep_their_day_and_clamp_to_the_end_of_a_short_month():
    first = advance(date(2026, 1, 31), "monthly", 1, 31)
    second = advance(first, "monthly", 1, 31)

    assert first == date(2026, 2, 28)
    assert second == date(2026, 3, 31)  # not the 28th: the anchor day is kept
    assert advance(date(2028, 2, 29), "yearly", 1, 29) == date(2029, 2, 28)
    assert advance(date(2026, 11, 20), "monthly", 3, 20) == date(2027, 2, 20)
    assert advance(date(2026, 12, 31), "monthly", 1, 31) == date(2027, 1, 31)


def test_days_and_weeks_step_by_their_interval_and_once_has_no_next():
    assert advance(date(2026, 11, 22), "daily", 3, 22) == date(2026, 11, 25)
    assert advance(date(2026, 11, 22), "weekly", 2, 22) == date(2026, 12, 6)
    assert advance(date(2026, 11, 22), "once", 1, 22) is None
    assert advance(date(9998, 12, 1), "monthly", 1, 1) is None  # past the last year of a date


def test_the_anchor_is_the_start_date_day_else_the_next_date_day():
    assert anchor_of(date(2026, 1, 31), date(2026, 2, 28)) == 31
    assert anchor_of(None, date(2026, 2, 28)) == 28


def test_occurrences_lists_a_weekly_payment_each_time_in_the_window():
    found = occurrences(date(2026, 11, 23), "weekly", 1, 23, date(2026, 12, 7))

    assert found == [date(2026, 11, 23), date(2026, 11, 30), date(2026, 12, 7)]
    assert occurrences(date(2026, 11, 23), "once", 1, 23, date(2027, 1, 1)) == [date(2026, 11, 23)]
    assert occurrences(date(2026, 12, 1), "daily", 1, 1, date(2026, 11, 1)) == []
    assert len(occurrences(date(2026, 1, 1), "daily", 1, 1, date(2030, 1, 1))) == 400  # the cap


@pytest.mark.parametrize(
    ("needle", "counterparty", "description", "expected"),
    [
        ("Acme Streaming", "ACME STREAMING LTD", "", True),
        ("Acme Streaming", None, "card payment to acme-streaming.example 1234", True),
        ("Acme Streaming Plus", "Acme Streaming", None, True),  # the counterparty is in the name
        ("Acme", "Acme Streaming", None, True),
        ("Acme Streaming", "Globex", "something else", False),
        ("ab", "ab ab ab", "ab", False),  # too short to mean anything
        ("Rent", "Rent", None, True),
        ("Acme Streaming", "Ace", "x", False),  # a counterparty under 4 characters is not enough
        ("Acme Streaming", None, None, False),
    ],
)
def test_a_transaction_names_a_payment_by_letters_and_digits_only(
    needle, counterparty, description, expected
):
    assert text_matches(needle, counterparty, description) is expected


def test_a_charge_more_than_one_percent_away_is_a_different_amount():
    assert amount_differs(10_000, 10_100) is False
    assert amount_differs(10_000, 10_101) is True
    assert amount_differs(10_000, 9_899) is True
    assert amount_differs(0, 500) is False  # an unknown amount never differs


@pytest.mark.parametrize(
    "url",
    [
        "https://example.test/a.png",
        "https://cdn.example.test:8443/i/a.svg?v=2",
    ],
)
def test_a_plain_https_url_is_a_safe_icon(url):
    assert safe_icon_url(url) is True


@pytest.mark.parametrize(
    "url",
    [
        "http://example.test/a.png",
        "javascript:alert(1)",
        "data:image/png;base64,AAAA",
        "//example.test/a.png",
        "https://user:pw@example.test/a.png",
        "https://example.test/a b.png",
        "https://example.test/a.png\n",
        'https://example.test/a".png',
        "https://example.test/<a>.png",
        "https://example.test:notaport/a.png",
        "https:///a.png",
        "https://example.test/" + "a" * 500,
        "ftp://example.test/a.png",
    ],
)
def test_anything_else_is_not(url):
    assert safe_icon_url(url) is False


def test_colours_become_lower_case_six_digit_hex():
    assert normal_color("#FA0") == "#ffaa00"
    assert normal_color("#12ABef") == "#12abef"
    assert normal_color("red") is None
    assert normal_color("#12345") is None
    assert normal_color("#12345g") is None


def test_the_kind_comes_from_the_owners_payment_type_words():
    assert kind_of("Subscription", False) == "subscription"
    assert kind_of("loan", False) == "debt"
    assert kind_of("Bills", False) == "utility"
    assert kind_of("rent", False) == "housing"
    assert kind_of("one-time", False) == "one_time"
    assert kind_of("something odd", False) == "service"
    assert kind_of(None, True) == "debt"  # an instalment plan with no word is a debt
    assert kind_of("", False) == "service"


def test_completed_instalments_may_not_pass_the_total():
    assert instalments_agree({"total_installments": 12, "completed_installments": 12}) is True
    assert instalments_agree({"total_installments": 12, "completed_installments": 13}) is False
    assert instalments_agree({"total_installments": None, "completed_installments": 13}) is True


def test_the_input_shape_is_strict_about_money_and_unknown_fields():
    good = {"name": "Acme", "amount": 100, "currency": "GBP"}

    assert RecurringIn.model_validate(good).kind == "service"
    for bad in (
        {**good, "amount": 1.5},
        {**good, "amount": True},
        {**good, "amount": -1},
        {**good, "currency": "gbp"},
        {**good, "frequency": "sometimes"},
        {**good, "frequency_interval": 0},
        {**good, "reminder_days": 91},
        {**good, "unknown": 1},
        {**good, "icon_url": "http://example.test/a.png"},
        {**good, "color": "blue"},
        {**good, "name": "   "},
    ):
        with pytest.raises(ValidationError):
            RecurringIn.model_validate(bad)


def test_the_owners_file_columns_load_without_loss():
    text = "\n".join([HEADER, STREAMING, LOAN])

    inputs, errors, ignored = parse_csv(text)

    assert errors == []
    assert ignored == ["extra_col"]
    streaming, loan = inputs
    assert (streaming.name, streaming.amount, streaming.currency) == ("Acme Streaming", 999, "GBP")
    assert (streaming.kind, streaming.frequency, streaming.frequency_interval) == (
        "subscription",
        "monthly",
        1,
    )
    assert streaming.start_date == date(2026, 1, 15)
    assert streaming.next_payment_date == date(2026, 12, 15)
    assert (streaming.payment_type, streaming.payment_mode) == ("subscription", "auto")
    assert (streaming.category, streaming.notes) == ("Entertainment", "family plan")
    assert streaming.is_active is True
    assert streaming.auto_renew is True
    assert (streaming.payment_method, streaming.reminder_days) == ("Sample card", 3)
    assert streaming.icon_url == "https://example.test/acme.png"
    assert streaming.color == "#ffaa00"
    assert streaming.is_installment is False
    assert streaming.external_ref == "csv:acme-streaming:gbp:1"
    assert loan.kind == "debt"  # "loan" is the owner's word for it, kept in payment_type
    assert loan.payment_type == "loan"
    assert loan.is_installment is True
    assert (loan.total_installments, loan.completed_installments) == (24, 6)
    assert (loan.total_owed, loan.remaining_balance) == (360_000, 270_000)
    assert loan.creditor == "Sample Credit Ltd"
    assert loan.external_ref == "csv:example-loan:gbp:2"


def test_cadence_words_become_a_frequency_and_an_interval():
    rows = [
        "name,amount,currency,frequency,frequency_interval",
        "A,1,GBP,quarterly,",
        "B,1,GBP,quarterly,2",
        "C,1,GBP,fortnightly,",
        "D,1,GBP,Annually,",
        "E,1,GBP,one-time,",
        "F,1,GBP,weekly,3",
        "G,1,GBP,custom,6",
        "H,1,GBP,custom,",
    ]

    inputs, errors, _ = parse_csv("\n".join(rows))

    assert errors == []
    assert [(i.frequency, i.frequency_interval) for i in inputs] == [
        ("monthly", 3),
        ("monthly", 6),
        ("weekly", 2),
        ("yearly", 1),
        ("once", 1),
        ("weekly", 3),
        ("monthly", 6),
        ("monthly", 1),
    ]


def test_money_follows_the_currencys_decimals():
    rows = [
        "name,amount,currency,frequency,total_owed",
        "A,40,JPY,monthly,1000",
        "B,1.234,KWD,monthly,",
        "C,\u00a3,GBP,monthly,",
        "D,1.234,GBP,monthly,",
        "E,12.5,GBP,monthly,",
        "F,12,GBP,monthly,",
    ]

    inputs, errors, _ = parse_csv("\n".join(rows))

    assert [(i.name, i.amount) for i in inputs] == [
        ("A", 40),
        ("B", 1234),
        ("E", 1250),
        ("F", 1200),
    ]
    assert inputs[0].total_owed == 1000
    assert [(e.row, e.field) for e in errors] == [(3, "amount"), (4, "amount")]
    assert "decimal" in errors[1].message


def test_every_problem_of_every_row_is_reported_with_its_row():
    rows = [
        "name,amount,currency,frequency,next_payment_date,is_active,icon_url,total_installments,"
        "completed_installments",
        "Fine,1,GBP,monthly,2026-12-01,true,,,",
        ",1,GBP,monthly,,,,,",
        "NoCurrency,1,,monthly,,,,,",
        "NoAmount,,GBP,monthly,,,,,",
        "NoFrequency,1,GBP,,,,,,",
        "BadFrequency,1,GBP,sometimes,,,,,",
        "BadDate,1,GBP,monthly,15/12/2026,,,,",
        "BadBool,1,GBP,monthly,,maybe,,,",
        "BadIcon,1,GBP,monthly,,,http://example.test/a.png,,",
        "Negative,-5,GBP,monthly,,,,,",
        "BadCount,1,GBP,monthly,,,,x,",
    ]

    inputs, errors, _ = parse_csv("\n".join(rows))

    assert [i.name for i in inputs] == ["Fine"]
    assert [(e.row, e.field) for e in errors] == [
        (2, "name"),
        (3, "currency"),
        (4, "amount"),
        (5, "frequency"),
        (6, "frequency"),
        (7, "next_payment_date"),
        (8, "is_active"),
        (9, "icon_url"),
        (10, "amount"),
        (11, "total_installments"),
    ]
    assert errors[7].message == "icon_url must be a plain https URL"
    assert errors[0].message == "required"


def test_a_one_time_payment_needs_no_frequency():
    rows = ["name,amount,currency,payment_type", "Fee,5,GBP,one-time"]

    inputs, errors, _ = parse_csv("\n".join(rows))

    assert errors == []
    assert (inputs[0].kind, inputs[0].frequency) == ("one_time", "once")


def test_a_file_without_a_header_blank_lines_a_bom_and_repeated_references():
    assert parse_csv("")[1][0].message == "the file has no header row"
    rows = ["\ufeffName,Amount,Currency,Frequency,External_Ref", ",,,,", "A,1,GBP,weekly,r1"]
    inputs, errors, _ = parse_csv("\n".join(rows))
    assert errors == []
    assert [i.external_ref for i in inputs] == ["r1"]
    twice = [
        "name,amount,currency,frequency,external_ref",
        "A,1,GBP,weekly,r1",
        "B,1,GBP,weekly,r1",
    ]
    inputs, errors, _ = parse_csv("\n".join(twice))
    assert len(inputs) == 1
    assert [(e.row, e.field) for e in errors] == [(2, "external_ref")]


def test_more_than_the_row_limit_is_an_error_and_a_broken_file_is_too():
    rows = ["name,amount,currency,frequency"] + [f"P{n},1,GBP,monthly" for n in range(MAX_ROWS + 1)]

    inputs, errors, _ = parse_csv("\n".join(rows))

    assert len(inputs) == MAX_ROWS
    assert errors[-1].message == f"more than {MAX_ROWS} rows"
    huge = "name,amount,currency,frequency\n" + "x" * 200_000 + ",1,GBP,monthly\n"
    assert parse_csv(huge)[1][-1].message == "the file is not valid CSV"
