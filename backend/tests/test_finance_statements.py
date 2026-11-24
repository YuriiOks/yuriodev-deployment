"""Reading downloaded statements and brand colours: rules that need no database."""

from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo

import pytest

from src.dashboards.finance.brands import BRANDS, MIN_CONTRAST, NEUTRAL, contrast_ratio, readable
from src.dashboards.finance.statements import (
    CellError,
    Context,
    Entry,
    NotText,
    UnknownLayout,
    balance_moment,
    bank_key,
    booked_at,
    choose_order,
    decode_text,
    number_entries,
    parse_amount,
    parse_day,
    parse_statement,
    supported,
)

LONDON = ZoneInfo("Europe/London")
GENERIC = (
    "Date,Description,Amount,Balance\n"
    "2026-11-02,Corner Cafe,-4.50,95.50\n"
    "2026-11-03,Payroll,1000.00,1095.50\n"
    "2026-11-03,Corner Cafe,-4.50,1091.00\n"
)
OFX_SGML = """OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>GBP
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261102120000
<TRNAMT>-4.50
<FITID>FIT-1
<NAME>Corner Cafe
<MEMO>card payment
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261103
<TRNAMT>1,000.00
<FITID>FIT-2
<NAME>Payroll
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>1095.50<DTASOF>20261103</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>
"""


def parse(text, provider="sample", currency="GBP", order=None):
    return parse_statement(text.encode(), provider, currency, order)


@pytest.mark.parametrize(
    ("text", "currency", "expected"),
    [
        ("12.50", "GBP", 1250),
        ("-12.5", "GBP", -1250),
        ("+3", "GBP", 300),
        ("1,234.56", "GBP", 123_456),
        ("-1,234,567.89", "GBP", -123_456_789),
        ("40", "JPY", 40),
        ("1.234", "KWD", 1234),
        (" 7.00 ", "GBP", 700),
    ],
)
def test_amounts_are_plain_decimals_in_the_currencys_minor_units(text, currency, expected):
    assert parse_amount("amount", text, currency) == expected


@pytest.mark.parametrize(
    "text", ["", "abc", "12,50", "1.234", "12,5", "1 234.50", "(12.50)", "12.5.0", "1e3", "--5"]
)
def test_anything_that_is_not_a_plain_decimal_is_refused(text):
    with pytest.raises(CellError):
        parse_amount("amount", text, "GBP")


def test_a_day_over_twelve_settles_the_order_of_a_file():
    assert choose_order(["25/11/2026", "01/12/2026"], None, None) == "dmy"
    assert choose_order(["11/25/2026", "12/01/2026"], None, None) == "mdy"
    assert choose_order(["01/02/2026"], "dmy", None) == "dmy"  # ambiguous: the layout's own
    assert choose_order(["25/11/2026"], "mdy", None) == "dmy"  # the file wins over the hint
    assert choose_order(["01/02/2026"], None, "mdy") == "mdy"  # the caller wins over everything


def test_an_ambiguous_or_contradictory_file_is_refused():
    with pytest.raises(CellError, match="ambiguous"):
        choose_order(["01/02/2026", "03/04/2026"], None, None)
    with pytest.raises(CellError, match="two different"):
        choose_order(["25/11/2026", "11/25/2026"], None, None)


def test_days_come_from_iso_or_slash_dates():
    assert parse_day("date", "2026-11-02", "dmy") == (date(2026, 11, 2), None)
    assert parse_day("date", "2026-11-02 14:30:05", "dmy") == (date(2026, 11, 2), time(14, 30, 5))
    assert parse_day("date", "2026-11-02T14:30", "mdy") == (date(2026, 11, 2), time(14, 30))
    assert parse_day("date", "02/11/2026", "dmy")[0] == date(2026, 11, 2)
    assert parse_day("date", "02/11/2026", "mdy")[0] == date(2026, 2, 11)
    for bad in ("2026-13-01", "31/02/2026", "yesterday", "2026/11/02", "", "1/1/26"):
        with pytest.raises(CellError):
            parse_day("date", bad, "dmy")


def test_an_impossible_time_is_a_line_error_not_a_crash():
    text = "Date,Description,Amount\n2026-11-02 25:00:00,A,-1.00\n2026-11-02,B,-1.00\n"
    ofx = "<OFX><STMTTRN><DTPOSTED>20261102256100<TRNAMT>1.00<FITID>1</STMTTRN></OFX>"

    assert [(e.row, e.field) for e in parse(text).errors] == [(1, "date")]
    assert [(e.row, e.field) for e in parse(ofx).errors] == [(1, "date")]


def test_a_generic_csv_is_read_with_signed_amounts_and_balances():
    statement = parse(GENERIC)

    assert (statement.layout, statement.errors) == ("generic", [])
    assert [(e.day, e.amount, e.description, e.balance) for e in statement.entries] == [
        (date(2026, 11, 2), -450, "Corner Cafe", 9_550),
        (date(2026, 11, 3), 100_000, "Payroll", 109_550),
        (date(2026, 11, 3), -450, "Corner Cafe", 109_100),
    ]


def test_debit_and_credit_columns_make_one_signed_amount():
    text = "Date,Description,Debit,Credit\n2026-11-02,Cafe,4.50,\n2026-11-03,Pay,,10.00\n"

    statement = parse(text)

    assert [e.amount for e in statement.entries] == [-450, 1_000]


def test_optional_generic_columns_are_read_when_present():
    text = (
        "Date,Time,Description,Counterparty,Amount,Currency,Id\n"
        "2026-11-02,09:15,Card payment,Corner Cafe,-4.50,gbp,tx-1\n"
    )

    (entry,) = parse(text).entries

    assert (entry.at, entry.counterparty, entry.bank_id) == (time(9, 15), "Corner Cafe", "tx-1")


def test_every_bad_line_is_reported_with_its_number_and_nothing_is_half_read():
    text = (
        "Date,Description,Amount,Currency\n"
        "2026-11-02,Fine,-1.00,GBP\n"
        "2026-13-02,Bad date,-1.00,GBP\n"
        "2026-11-04,Bad amount,1.234,GBP\n"
        "2026-11-05,Other currency,-1.00,EUR\n"
        "2026-11-06,,-1.00,GBP\n"
    )

    statement = parse(text)

    assert [(e.row, e.field) for e in statement.errors] == [
        (2, "date"),
        (3, "amount"),
        (4, "currency"),
    ]
    assert statement.entries[-1].description == "(no description)"


def test_debit_and_credit_together_or_neither_is_an_error():
    text = "Date,Description,Debit,Credit\n2026-11-02,A,1.00,2.00\n2026-11-03,B,,\n"

    statement = parse(text)

    assert [(e.row, e.field) for e in statement.errors] == [(1, "amount"), (2, "amount")]


@pytest.mark.parametrize(
    "text",
    [
        "",
        "\n\n",
        "Name,Total\nA,1\n",
        "Date,Description\n2026-11-02,A\n",
        "Date,Amount\n2026-11-02,1\n",
    ],
)
def test_an_unknown_layout_is_refused_not_guessed(text):
    with pytest.raises(UnknownLayout):
        parse(text)


def test_a_file_that_is_not_text_or_too_large_is_a_value_error():
    with pytest.raises(ValueError, match="utf-8"):
        parse_statement(b"\xff\xfe\x00", "sample", "GBP")
    with pytest.raises(ValueError, match="large"):
        parse_statement(b"a" * (2 * 1024 * 1024 + 1), "sample", "GBP")


def test_too_many_lines_are_an_error():
    rows = "\n".join(f"2026-11-02,P{n},-1.00" for n in range(5001))

    statement = parse("Date,Description,Amount\n" + rows)

    assert [e.message for e in statement.errors] == ["more than 5000 lines"]


def test_an_ofx_file_is_read_with_its_ids_text_and_ledger_balance():
    statement = parse(OFX_SGML)

    assert (statement.layout, statement.errors) == ("ofx", [])
    first, second = statement.entries
    assert (first.day, first.at, first.amount, first.bank_id) == (
        date(2026, 11, 2),
        time(12, 0),
        -450,
        "FIT-1",
    )
    assert (first.description, first.counterparty) == ("Corner Cafe card payment", "Corner Cafe")
    assert (second.amount, second.at, second.description) == (100_000, None, "Payroll")
    assert statement.ledger_balance == (109_550, date(2026, 11, 3))


def test_an_xml_ofx_file_is_read_too():
    text = (
        '<?xml version="1.0"?><OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>GBP</CURDEF>'
        "<BANKTRANLIST><STMTTRN><DTPOSTED>20261102</DTPOSTED><TRNAMT>-4,50</TRNAMT>"
        "<FITID>A1</FITID><NAME>Cafe</NAME></STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS>"
        "</BANKMSGSRSV1></OFX>"
    )

    statement = parse(text)

    assert [(e.amount, e.bank_id) for e in statement.entries] == [(-450, "A1")]
    assert statement.ledger_balance is None


def test_an_ofx_file_with_problems_says_so():
    other = parse(OFX_SGML, currency="EUR")
    empty = parse("<OFX><CURDEF>GBP</OFX>")
    broken = parse(
        "<OFX><STMTTRN><DTPOSTED>soon<TRNAMT>1.00</STMTTRN>"
        "<STMTTRN><DTPOSTED>20261102</STMTTRN>"
        "<STMTTRN><TRNAMT>1.00</STMTTRN></OFX>"
    )

    assert [(e.row, e.field) for e in other.errors] == [(0, "currency")]
    assert [e.message for e in empty.errors] == ["no transactions in the file"]
    assert [(e.row, e.field) for e in broken.errors] == [(1, "date"), (2, "amount"), (3, "date")]


def test_identical_lines_get_ids_that_are_the_same_in_a_second_file():
    entry = Entry(date(2026, 11, 2), None, -450, "Corner Cafe", None, None, None)
    other = Entry(date(2026, 11, 2), None, -450, "Corner Cafe", None, None, None)
    with_id = Entry(date(2026, 11, 2), None, -450, "x", None, "FIT-9", None)

    first = number_entries("acc", [entry, other, with_id])
    again = number_entries("acc", [entry, other, with_id])
    elsewhere = number_entries("acc2", [entry])

    assert first == again
    assert first[0][0] != first[1][0]  # two identical lines are two transactions
    assert first[2][0] == "b:FIT-9"
    assert first[0][0].startswith("h:")
    assert elsewhere[0][0] != first[0][0]


def test_a_day_is_booked_at_noon_local_time_unless_the_file_has_a_time():
    summer = Entry(date(2026, 7, 1), None, 1, "x", None, None, None)
    timed = Entry(date(2026, 7, 1), time(9, 30), 1, "x", None, None, None)

    assert booked_at(summer, LONDON) == datetime(2026, 7, 1, 11, 0, tzinfo=UTC)
    assert booked_at(timed, LONDON) == datetime(2026, 7, 1, 8, 30, tzinfo=UTC)
    winter = balance_moment(date(2026, 11, 3), LONDON)
    assert winter == datetime(2026, 11, 3, 23, 59, 59, tzinfo=UTC)
    assert balance_moment(date(2026, 7, 1), LONDON) == datetime(2026, 7, 1, 22, 59, 59, tzinfo=UTC)


PAYPAL_FILE = (
    '"Date","Time","TimeZone","Name","Type","Status","Currency","Gross","Fee","Net",'
    '"From Email Address","To Email Address","Transaction ID","Balance"\n'
    '"15/11/2026","10:15:00","GMT","Acme Shop","Express Checkout Payment","Completed","GBP",'
    '"-20.00","0.00","-20.00","me@example.test","shop@example.test","TX1","80.00"\n'
    '"16/11/2026","11:00:00","GMT","Seller Ltd","Payment Received","Completed","GBP",'
    '"10.00","-0.50","9.50","buyer@example.test","me@example.test","TX2","89.50"\n'
    '"16/11/2026","12:00:00","GMT","Gadget Co","Express Checkout Payment","Pending","GBP",'
    '"-5.00","0.00","-5.00","me@example.test","gadget@example.test","TX3",""\n'
    '"17/11/2026","08:00:00","GMT","Gadget Co","Express Checkout Payment","Denied","GBP",'
    '"-5.00","0.00","-5.00","me@example.test","gadget@example.test","TX4",""\n'
)


def test_a_paypal_activity_download_is_read_by_its_published_columns():
    statement = parse(PAYPAL_FILE, provider="paypal")

    assert (statement.layout, statement.errors) == ("paypal", [])
    assert [(e.amount, e.bank_id, e.pending, e.declined) for e in statement.entries] == [
        (-2_000, "TX1", False, False),
        (950, "TX2", False, False),  # the net: 10.00 less the 0.50 fee
        (-500, "TX3", True, False),
        (-500, "TX4", False, True),
    ]
    first = statement.entries[0]
    assert (first.day, first.at, first.counterparty) == (date(2026, 11, 15), None, "Acme Shop")
    assert first.description == "Acme Shop Express Checkout Payment"
    assert (first.balance, statement.entries[2].balance) == (8_000, None)


def test_a_paypal_file_is_only_taken_by_a_paypal_account_and_with_its_columns():
    with pytest.raises(UnknownLayout):
        parse(PAYPAL_FILE, provider="barclays")
    fewer = PAYPAL_FILE.replace('"Net",', "")  # a download without the Net column
    with pytest.raises(UnknownLayout):
        parse(fewer, provider="paypal")


def test_paypal_money_in_another_currency_or_in_a_comma_format_is_refused_by_line():
    text = PAYPAL_FILE.replace('"Completed","GBP",', '"Completed","EUR",', 1)
    text = text.replace('"-5.00"', '"-5,00"')

    statement = parse(text, provider="paypal")

    assert [(e.row, e.field) for e in statement.errors] == [
        (1, "currency"),
        (3, "amount"),
        (4, "amount"),
    ]


def test_the_supported_layouts_are_listed():
    assert supported()[:3] == ["generic", "ofx", "paypal"]


def test_every_built_in_brand_pair_reaches_the_large_text_floor():
    assert BRANDS
    for brand in [*BRANDS.values(), NEUTRAL]:
        assert contrast_ratio(brand.background, brand.foreground) >= MIN_CONTRAST, brand.name
    assert all(brand.name for brand in BRANDS.values())


def test_contrast_follows_the_wcag_formula():
    assert contrast_ratio("#000000", "#ffffff") == pytest.approx(21)
    assert contrast_ratio("#ffffff", "#ffffff") == pytest.approx(1)
    assert readable("#003087", "#ffffff") is True
    assert readable("#777777", "#888888") is False
    assert readable("#00AEEF", "#ffffff") is False  # upper case is not the stored form
    assert readable("blue", "#ffffff") is False


def test_the_built_in_cards_are_the_brands_own_signature_colours_with_a_readable_ink():
    pairs = {name: (brand.background, brand.foreground) for name, brand in BRANDS.items()}

    assert pairs["monzo"] == ("#ff4f40", "#ffffff")  # the hot coral, white ink
    assert pairs["starling"] == ("#50ffeb", "#321e37")  # mint-teal, dark purple ink
    assert pairs["wise"] == ("#9fe870", "#163300")  # lime, dark green ink
    assert pairs["revolut"] == ("#ffffff", "#191c1f")  # white, near-black ink
    assert pairs["aqua"] == ("#0000a6", "#ffffff")
    assert pairs["barclays"] == ("#00aeef", "#00395d")  # the cyan itself, navy ink
    assert pairs["monobank"] == ("#000000", "#ffffff")


def test_the_floor_is_three_to_one_for_a_pair_the_owner_types_in_too():
    assert readable("#ff4f40", "#ffffff") is True  # 3.3: large text
    assert readable("#0090d0", "#ffffff") is True
    assert readable("#00aeef", "#ffffff") is False  # 2.5: white on pure cyan is under the floor
    assert readable("#00aeef", "#00395d") is True


def test_text_is_decoded_in_a_fixed_order():
    text = "Caf\u00e9"
    ofx_1252 = b"OFXHEADER:100\nCHARSET:1252\n<OFX>" + text.encode("cp1252")

    assert decode_text(text.encode()) == (text, "utf-8")
    assert decode_text(b"\xef\xbb\xbf" + text.encode()) == (text, "utf-8")
    assert decode_text(b"\xff\xfe" + text.encode("utf-16-le")) == (text, "utf-16")
    assert decode_text(b"\xfe\xff" + text.encode("utf-16-be")) == (text, "utf-16")
    assert decode_text(ofx_1252)[1] == "cp1252"
    assert decode_text(text.encode("cp1252")) == (text, "cp1252")
    with pytest.raises(NotText):
        decode_text(b"a\x00b")  # a UTF-16 file with no BOM is not guessed at
    with pytest.raises(NotText):
        decode_text(b"\x81\x8d")  # no meaning in Windows-1252 either


def test_a_bank_id_is_kept_up_to_sixty_characters_then_hashed_and_a_repeat_is_numbered():
    assert bank_key("FIT-1", 0) == "b:FIT-1"
    assert bank_key("x" * 60, 0) == "b:" + "x" * 60
    long = bank_key("x" * 61, 0)
    assert long.startswith("b:sha:")
    assert len(long) <= 64
    assert bank_key("x" * 61, 0) != bank_key("x" * 61 + "y", 0)
    assert bank_key("FIT-1", 2) == "b:FIT-1~2"
    assert len(bank_key("x" * 60, 12345)) <= 64


def test_the_same_bank_id_twice_in_a_file_is_two_transactions():
    same = Entry(date(2026, 11, 2), None, -100, "A", None, "tx1", None)
    other = Entry(date(2026, 11, 2), None, -200, "B", None, "tx1", None)

    ids = [i for i, _ in number_entries("acct", [same, other])]

    assert ids == ["b:tx1", "b:tx1~1"]


@pytest.mark.parametrize("size", [40, 200_000])
def test_an_unclosed_quote_is_one_error_for_the_file_in_a_small_and_a_large_file(size):
    text = 'Date,Description,Amount\n2026-11-02,"' + "a,b\n" * size

    statement = parse(text)

    assert [(e.row, e.code) for e in statement.errors] == [(0, "csv_malformed")]


def test_an_ofx_text_is_unescaped_once_and_a_wrong_account_block_is_not_taken():
    text = OFX_SGML.replace("Corner Cafe", "Fish &amp; Chips &#39;n&#39; Co")
    text = text.replace("FIT-1", "A&amp;B")

    statement = parse(text)

    assert statement.entries[0].description.startswith("Fish & Chips 'n' Co")
    assert statement.entries[0].bank_id == "A&B"
    assert parse_statement(text.encode(), "sample", "GBP", None, Context("1234")).entries


def test_a_line_outside_1990_to_tomorrow_is_a_line_error():
    context = Context(today=date(2026, 11, 22))
    rows = "Date,Description,Amount\n1989-12-31,A,1\n2026-11-23,B,1\n2026-11-24,C,1\n"

    statement = parse_statement(rows.encode(), "sample", "GBP", None, context)

    assert [(e.row, e.code) for e in statement.errors] == [
        (1, "date_out_of_range"),
        (3, "date_out_of_range"),
    ]
    assert [e.description for e in statement.entries] == ["B"]


def test_an_amount_over_the_limit_is_refused():
    with pytest.raises(CellError) as raised:
        parse_amount("amount", "10000000000.01", "GBP")

    assert raised.value.code == "amount_too_large"
