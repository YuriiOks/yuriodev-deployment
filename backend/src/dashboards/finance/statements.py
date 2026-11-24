"""Reading a bank statement the owner downloaded: CSV in a known layout, or OFX/QFX.

Nothing here talks to a bank. A file is read whole and either yields every entry or the list of
every problem (rows count from 1, the first data row); a file is never half-read. Amounts become
integer minor units of the account's currency (the file's own currency must agree), signed: money
out is negative. The layouts are tables (`LAYOUTS`), so adding one is a few lines.

Rules for all of them:

- a layout is chosen by its header row (every column it needs must be there, names compared
  lower-case, trimmed); a file with none of them is `UnknownLayout`, never guessed at;
- an amount is a plain decimal (`1234.56`, `-12.5`, `1,234.56`; a comma is only ever a thousands
  separator, never a decimal point) with no more decimals than the currency has;
- a date is `YYYY-MM-DD` (a time may follow) or `DD/MM/YYYY` or `MM/DD/YYYY`; the order is read
  from the file when a day over 12 settles it, else the layout's own order, else the caller must
  say (`date_order`); an ambiguous file is refused rather than guessed;
- a transaction id of the bank (OFX `FITID`, Wise's id, PayPal's) is kept and is what a second
  import is matched on (an id repeated within one file is told apart by its order; one over 60
  characters is stored as a hash); without one the id is a hash of the account, the date, the
  amount, the text and how many identical lines came before in the file;
- the text is decoded as UTF-8 (a BOM is fine), UTF-16 with a BOM, the charset the OFX header
  names, or else Windows-1252, and the one used is reported; an amount above `MAX_MINOR`, a day
  before 1990 or after tomorrow, a cell with a line break, and a bank id with a control character
  are line errors; control characters in a description are replaced by a space;
- every problem has a stable `code` beside its message (the message is for people).
"""

import codecs
import csv
import hashlib
import html
import io
import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta, timezone, tzinfo
from decimal import Decimal
from typing import Any, Literal

from src.dashboards.finance.categories import CATEGORIES
from src.dashboards.finance.fx import exponent
from src.dashboards.finance.recurring import MAX_MINOR, RowError

DateOrder = Literal["dmy", "mdy"]
MAX_BYTES = 1024 * 1024  # nginx's own body limit is 1m: a bigger one never gets here
MAX_ENTRIES = 5000
MIN_DAY = date(1990, 1, 1)
CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]+")
AMOUNT = re.compile(r"[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?")
SLASH_DATE = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})")
ISO_DATE = re.compile(r"(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?")
OFX_DATE = re.compile(
    r"(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})(?:\.\d+)?)?"
    r"(?:\[([+-]?\d+(?:\.\d+)?)(?::[A-Za-z]+)?\])?"
)
NO_TEXT = "(no description)"


class UnknownLayout(ValueError):
    """The file is not in any layout this account may take. `code` is empty_file, other_bank or
    unknown_layout."""

    def __init__(self, message: str, code: str = "unknown_layout") -> None:
        super().__init__(message)
        self.code = code


class NotText(ValueError):
    """The bytes are text in none of the encodings tried."""


class FileTooLarge(ValueError):
    """More than `MAX_BYTES`."""


@dataclass(frozen=True)
class Context:
    """What a file is read against: the last four digits of the account (to pick its block of an
    OFX file with several), the newest day a line may have (today, in the dashboard's zone) and
    that zone (to put an OFX time with an offset on the local day)."""

    mask_last4: str | None = None
    today: date | None = None
    zone: tzinfo | None = None


@dataclass(frozen=True)
class Entry:
    day: date
    at: time | None  # None when the file gives no time of day
    amount: int
    description: str
    counterparty: str | None
    bank_id: str | None  # the bank's own id of the transaction, when the file has one
    balance: int | None
    pending: bool = False
    declined: bool = False
    category: str | None = None  # one of `CATEGORIES`, when the file says so


@dataclass
class Statement:
    layout: str
    entries: list[Entry] = field(default_factory=list)
    errors: list[RowError] = field(default_factory=list)
    ledger_balance: tuple[int, date] | None = None  # as the file states it (OFX)
    encoding: str = "utf-8"  # what the bytes were decoded as


@dataclass(frozen=True)
class Layout:
    """Where each thing is in a CSV file. Names are lower-case column headers."""

    id: str
    provider: str | None  # the provider whose account takes it; None for any account
    needs: frozenset[str]  # every one of these headers must be present
    date: str
    description: tuple[str, ...]
    amount: str | None = None  # one signed column ...
    debit: str | None = None  # ... or money out and money in in two
    credit: str | None = None
    time: str | None = None
    counterparty: str | None = None
    balance: str | None = None
    currency: str | None = None  # a column with the currency of each row
    bank_id: str | None = None
    category: str | None = None  # a column naming one of the categories
    state: str | None = None
    declined_states: frozenset[str] = frozenset()
    pending_states: frozenset[str] = frozenset()
    date_order: DateOrder | None = None  # the layout's own order for an ambiguous file


GENERIC = Layout(
    id="generic",
    provider=None,
    needs=frozenset({"date", "description"}),
    date="date",
    description=("description",),
    amount="amount",
    debit="debit",
    credit="credit",
    time="time",
    counterparty="counterparty",
    balance="balance",
    currency="currency",
    bank_id="id",
    category="category",
)
# PayPal's Activity Download is the one export whose columns the provider itself publishes
# (https://developer.paypal.com/docs/reports/online-reports/activity-download/): the first 13 of
# up to 87 selectable fields are Date, Time, TimeZone, Name, Type, Status, Currency, Gross, Fee,
# Net, From Email Address, To Email Address, Transaction ID, and Balance is another. The cash
# effect of a line is `Net` (Gross plus the fee); the date is localised (MM/DD/YYYY for US
# accounts), so the order is read from the file or given; the time is in the line's own TimeZone
# and is not used (a line is booked at noon of its day); `Status` Pending and Denied are
# marked, anything else is taken as it is. Every other bank has no published layout (nothing in
# its help pages or documentation) and takes the generic one or OFX until its own file is seen.
PAYPAL = Layout(
    id="paypal",
    provider="paypal",
    needs=frozenset(
        {
            "date",
            "time",
            "timezone",
            "name",
            "type",
            "status",
            "currency",
            "gross",
            "fee",
            "net",
            "transaction id",
        }
    ),
    date="date",
    description=("name", "type"),
    amount="net",
    counterparty="name",
    balance="balance",
    currency="currency",
    bank_id="transaction id",
    state="status",
    declined_states=frozenset({"DENIED"}),
    pending_states=frozenset({"PENDING"}),
)
LAYOUTS: tuple[Layout, ...] = (PAYPAL,)


def supported() -> list[str]:
    return ["generic", "ofx", *[layout.id for layout in LAYOUTS]]


# ---- cells ----------------------------------------------------------------------------------


class CellError(ValueError):
    def __init__(self, field_name: str, message: str, code: str = "invalid") -> None:
        super().__init__(message)
        self.field_name = field_name
        self.code = code


def parse_amount(field_name: str, text: str, currency: str) -> int:
    value = text.strip()
    if not AMOUNT.fullmatch(value):
        raise CellError(
            field_name, "expected a plain decimal such as -12.50 or 1,234.56", "amount_format"
        )
    shifted = Decimal(value.replace(",", "")).scaleb(exponent(currency))
    if shifted != shifted.to_integral_value():
        message = f"{currency} has {exponent(currency)} decimal places"
        raise CellError(field_name, message, "amount_decimals")
    if abs(shifted) > MAX_MINOR:
        raise CellError(field_name, "the amount is too large", "amount_too_large")
    return int(shifted)


def date_parts(text: str) -> tuple[int, int, int] | None:
    found = SLASH_DATE.fullmatch(text.strip())
    return (int(found[1]), int(found[2]), int(found[3])) if found else None


def valid_date(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def choose_order(
    texts: Sequence[str], hint: DateOrder | None, given: DateOrder | None
) -> DateOrder:
    """The order of slash dates in a file: what the caller says, else what a day over 12 shows,
    else the layout's own, else an error (the caller must say)."""
    if given is not None:
        return given
    if not any(date_parts(text) for text in texts):
        return hint or "dmy"  # no slash dates: the order never matters
    dmy = mdy = False
    for text in texts:
        parts = date_parts(text)
        if parts is None:
            continue
        first, second, year = parts
        if valid_date(year, second, first) is None and valid_date(year, first, second) is None:
            continue
        if first > 12:
            dmy = True
        if second > 12:
            mdy = True
    if dmy and mdy:
        raise CellError("date", "the dates are in two different orders", "date_mixed_order")
    if dmy or mdy:
        return "dmy" if dmy else "mdy"
    if hint is not None:
        return hint
    message = "the date order is ambiguous: say date_order=dmy or mdy"
    raise CellError("date", message, "date_ambiguous")


def parse_day(field_name: str, text: str, order: DateOrder) -> tuple[date, time | None]:
    value = text.strip()
    iso = ISO_DATE.fullmatch(value)
    if iso:
        day = valid_date(int(iso[1]), int(iso[2]), int(iso[3]))
        if day is None:
            raise CellError(field_name, "not a real date", "not_a_date")
        if not iso[4]:
            return day, None
        try:
            return day, time(int(iso[4]), int(iso[5]), int(iso[6] or 0))
        except ValueError:
            raise CellError(field_name, "not a real time", "not_a_time") from None
    parts = date_parts(value)
    if parts is None:
        message = "expected a date as YYYY-MM-DD, DD/MM/YYYY or MM/DD/YYYY"
        raise CellError(field_name, message, "not_a_date")
    first, second, year = parts
    day = valid_date(year, second, first) if order == "dmy" else valid_date(year, first, second)
    if day is None:
        raise CellError(field_name, "not a real date", "not_a_date")
    return day, None


def parse_clock(field_name: str, text: str) -> time:
    found = re.fullmatch(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", text.strip())
    if not found or int(found[1]) > 23 or int(found[2]) > 59 or int(found[3] or 0) > 59:
        raise CellError(field_name, "expected a time such as 14:30:00", "not_a_time")
    return time(int(found[1]), int(found[2]), int(found[3] or 0))


def bank_key(bank_id: str, repeat: int) -> str:
    """The stored id of a bank's own id (at most 64 characters): as it is up to 60 characters,
    else a hash of it; the `repeat`-th use of the same id in one file gets `~repeat` after it."""
    if repeat == 0 and len(bank_id) <= 60:
        return "b:" + bank_id
    digest = hashlib.sha256(bank_id.encode()).hexdigest()[:40]
    base = bank_id if len(bank_id) <= 50 else "sha:" + digest
    return f"b:{base}" + (f"~{repeat}" if repeat else "")


def entry_id(account: str, entry: Entry, index: int) -> str:
    """The id a transaction is stored under: the bank's own, else a hash that makes the same
    line in the same place of a second file the same transaction (`index` counts identical
    lines before it in the file, or the earlier uses of the same bank id)."""
    if entry.bank_id:
        return bank_key(entry.bank_id, index)
    stamp = f"{account}|{entry.day}|{entry.at}|{entry.amount}|{entry.description}|{index}"
    return "h:" + hashlib.sha256(stamp.encode()).hexdigest()[:40]


def number_entries(account: str, entries: Sequence[Entry]) -> list[tuple[str, Entry]]:
    """Entries with their stored ids (identical lines are told apart by their order)."""
    seen: dict[Any, int] = {}
    numbered: list[tuple[str, Entry]] = []
    for entry in entries:
        key = entry.bank_id or (entry.day, entry.at, entry.amount, entry.description)
        index = seen.get(key, 0)
        seen[key] = index + 1
        numbered.append((entry_id(account, entry, index), entry))
    return numbered


# ---- CSV ------------------------------------------------------------------------------------


def _headers(text: str) -> tuple[list[str], list[dict[str, str]]]:
    reader = csv.reader(io.StringIO(text.lstrip("\ufeff")), strict=True)
    rows = [row for row in reader if any(cell.strip() for cell in row)]
    if not rows:
        raise UnknownLayout("empty file", "empty_file")
    names = [cell.strip().lower() for cell in rows[0]]
    body = [
        {names[i]: cell.strip() for i, cell in enumerate(row) if i < len(names)} for row in rows[1:]
    ]
    return names, body


def pick_layout(names: Sequence[str], provider: str) -> Layout:
    """The layout of a header row for an account of `provider`: its own bank's, else generic."""
    have = set(names)
    for layout in LAYOUTS:
        if layout.needs <= have:
            if layout.provider != provider:
                raise UnknownLayout("another bank's statement", "other_bank")
            return layout
    amount = GENERIC.amount in have or {GENERIC.debit, GENERIC.credit} <= have
    if GENERIC.needs <= have and amount:
        return GENERIC
    raise UnknownLayout("unknown layout")


def clean_text(value: str) -> str:
    """Control characters (a line break, a tab, an escape) become a space."""
    return CONTROL.sub(" ", value).strip()


def check_day(day: date, context: Context) -> date:
    """A statement line is from 1990 on and no later than tomorrow (a bank may book ahead)."""
    if day < MIN_DAY or (context.today is not None and day > context.today + timedelta(days=1)):
        message = "the date is before 1990 or after tomorrow"
        raise CellError("date", message, "date_out_of_range")
    return day


def parse_csv_statement(
    text: str,
    provider: str,
    currency: str,
    order_given: DateOrder | None = None,
    context: Context | None = None,
) -> Statement:
    context = context or Context()
    try:
        names, rows = _headers(text)
    except csv.Error:
        statement = Statement("csv")
        message = "The file is not valid CSV (an unclosed quote, or a quote in the wrong place)"
        statement.errors.append(RowError(0, None, message, "csv_malformed"))
        return statement
    layout = pick_layout(names, provider)
    statement = Statement(layout.id)
    if len(rows) > MAX_ENTRIES:
        message = f"more than {MAX_ENTRIES} lines"
        statement.errors.append(RowError(0, None, message, "too_many_lines"))
        return statement
    try:
        order = choose_order([r.get(layout.date, "") for r in rows], layout.date_order, order_given)
    except CellError as exc:
        statement.errors.append(RowError(0, exc.field_name, str(exc), exc.code))
        return statement
    for number, row in enumerate(rows, start=1):
        try:
            statement.entries.append(_entry(layout, row, currency, order, context))
        except CellError as exc:
            statement.errors.append(RowError(number, exc.field_name, str(exc), exc.code))
    return statement


def _entry(
    layout: Layout, row: dict[str, str], currency: str, order: DateOrder, context: Context
) -> Entry:
    for name, cell in row.items():
        if "\n" in cell or "\r" in cell:
            raise CellError(name, "a cell holds a line break", "cell_line_break")
    day, at = parse_day("date", row.get(layout.date, ""), order)
    check_day(day, context)
    if layout.time and row.get(layout.time):
        at = parse_clock("time", row[layout.time])
    if layout.currency and (row.get(layout.currency) or currency).upper() != currency:
        message = "the line is not in the account's currency"
        raise CellError("currency", message, "wrong_currency")
    amount = _money(layout, row, currency)
    balance = None
    if layout.balance and row.get(layout.balance):
        balance = parse_amount("balance", row[layout.balance], currency)
    text = " ".join(part for column in layout.description if (part := row.get(column, "")))
    state = row.get(layout.state or "", "").upper()
    counterparty = clean_text(row.get(layout.counterparty or "", ""))
    bank_id = row.get(layout.bank_id or "") or None
    if bank_id and CONTROL.search(bank_id):
        raise CellError("id", "the id has a control character", "control_character")
    named = row.get(layout.category or "", "").lower() or None
    if named is not None and named not in CATEGORIES:
        raise CellError("category", "not one of the categories", "category_unknown")
    return Entry(
        category=named,
        day=day,
        at=at,
        amount=amount,
        description=clean_text(text)[:500] or NO_TEXT,
        counterparty=counterparty[:200] or None,
        bank_id=bank_id,
        balance=balance,
        pending=state in layout.pending_states,
        declined=state in layout.declined_states,
    )


def _money(layout: Layout, row: dict[str, str], currency: str) -> int:
    if layout.amount and row.get(layout.amount):
        return parse_amount("amount", row[layout.amount], currency)
    if layout.debit and layout.credit:
        out, income = row.get(layout.debit, ""), row.get(layout.credit, "")
        if bool(out) == bool(income):
            message = "exactly one of the debit and credit columns is needed"
            raise CellError("amount", message, "debit_credit_both")
        if out:
            return -abs(parse_amount("debit", out, currency))
        return abs(parse_amount("credit", income, currency))
    raise CellError("amount", "required", "required")


# ---- OFX ------------------------------------------------------------------------------------


def _tag(block: str, name: str) -> str | None:
    found = re.search(rf"<{name}>\s*([^<\r\n]*)", block, re.IGNORECASE)
    return found[1].strip() if found and found[1].strip() else None


def _text_tag(block: str, name: str) -> str | None:
    """A text element: the SGML form of OFX writes `&amp;` and `&#39;` for the characters it
    cannot carry, so they are read back before the text is cleaned."""
    value = _tag(block, name)
    return html.unescape(value) if value else None


def _ofx_date(text: str, field_name: str, context: Context) -> tuple[date, time | None]:
    """A date as `YYYYMMDD[HHMMSS[.XXX]][[offset:TZ]]`. A time with an offset is put on the
    dashboard's own clock (so a late evening in New York is the next day in London)."""
    found = OFX_DATE.match(text.strip())
    day = valid_date(int(found[1]), int(found[2]), int(found[3])) if found else None
    if not found or day is None:
        raise CellError(field_name, "not a date", "not_a_date")
    if not found[4]:
        return day, None
    try:
        clock = time(int(found[4]), int(found[5]), int(found[6]))
    except ValueError:
        raise CellError(field_name, "not a real time", "not_a_time") from None
    if found[7] is not None and context.zone is not None:
        try:
            zone = timezone(timedelta(hours=float(found[7])))
        except ValueError:
            raise CellError(field_name, "not a real time zone", "not_a_time") from None
        moved = datetime.combine(day, clock, tzinfo=zone).astimezone(context.zone)
        return moved.date(), moved.time()
    return day, clock


def _ofx_amount(text: str, field_name: str, currency: str) -> int:
    value = text.strip()
    if "." not in value and re.fullmatch(r"[+-]?\d+,\d+", value):
        value = value.replace(",", ".")  # the OFX specification allows a decimal comma
    return parse_amount(field_name, value, currency)


def is_ofx(text: str) -> bool:
    head = text[:2000].upper()
    return "OFXHEADER" in head or "<OFX>" in head


def _ofx_accounts(text: str) -> list[str]:
    """The statement responses of the file (a bank or a card each); the whole text when it has
    no such wrapper."""
    found = [m[2] for m in re.finditer(r"<(STMTRS|CCSTMTRS)>(.*?)</\1>", text, re.I | re.DOTALL)]
    return found or [text]


def parse_ofx_statement(text: str, currency: str, context: Context | None = None) -> Statement:
    context = context or Context()
    statement = Statement("ofx")
    accounts = _ofx_accounts(text)
    if len(accounts) > 1:
        mask = context.mask_last4
        mine = [a for a in accounts if mask and (_tag(a, "ACCTID") or "").endswith(mask)]
        if len(mine) != 1:
            message = (
                "The file holds several accounts and not exactly one of them ends with this "
                "account's last four digits"
            )
            statement.errors.append(RowError(0, "account", message, "ofx_several_accounts"))
            return statement
        accounts = mine
    block = accounts[0]
    declared = _tag(block, "CURDEF") or _tag(text, "CURDEF")
    if declared is not None and declared.upper() != currency:
        message = "the file is not in the account's currency"
        statement.errors.append(RowError(0, "currency", message, "wrong_currency"))
        return statement
    lines = re.findall(r"<STMTTRN>(.*?)</STMTTRN>", block, re.IGNORECASE | re.DOTALL)
    if not lines:
        statement.errors.append(RowError(0, None, "no transactions in the file", "no_lines"))
        return statement
    if len(lines) > MAX_ENTRIES:
        message = f"more than {MAX_ENTRIES} lines"
        statement.errors.append(RowError(0, None, message, "too_many_lines"))
        return statement
    for number, line in enumerate(lines, start=1):
        try:
            statement.entries.append(_ofx_entry(line, currency, context))
        except CellError as exc:
            statement.errors.append(RowError(number, exc.field_name, str(exc), exc.code))
    ledger = re.search(r"<LEDGERBAL>(.*?)</LEDGERBAL>", block, re.IGNORECASE | re.DOTALL)
    if ledger and (amount := _tag(ledger[1], "BALAMT")) and (when := _tag(ledger[1], "DTASOF")):
        try:
            statement.ledger_balance = (
                _ofx_amount(amount, "balance", currency),
                _ofx_date(when, "balance_date", context)[0],
            )
        except CellError as exc:
            statement.errors.append(RowError(0, exc.field_name, str(exc), exc.code))
    return statement


def _ofx_entry(block: str, currency: str, context: Context) -> Entry:
    posted, amount = _tag(block, "DTPOSTED"), _tag(block, "TRNAMT")
    if posted is None or amount is None:
        raise CellError("date" if posted is None else "amount", "required", "required")
    day, at = _ofx_date(posted, "date", context)
    check_day(day, context)
    name, memo = _text_tag(block, "NAME"), _text_tag(block, "MEMO")
    text = " ".join(dict.fromkeys(clean_text(part) for part in (name, memo) if part))
    bank_id = _text_tag(block, "FITID")
    if bank_id and CONTROL.search(bank_id):
        raise CellError("id", "the id has a control character", "control_character")
    counterparty = clean_text(name) if name else ""
    return Entry(
        day=day,
        at=at,
        amount=_ofx_amount(amount, "amount", currency),
        description=text[:500] or NO_TEXT,
        counterparty=counterparty[:200] or None,
        bank_id=bank_id,
        balance=None,
    )


# ---- entry point ----------------------------------------------------------------------------


def _declared_charset(data: bytes) -> tuple[str, str] | None:
    """The charset an OFX header names (`CHARSET:1252`, or `encoding="..."` of an XML one)."""
    head = data[:2048].decode("ascii", "ignore")
    found = re.search(r"CHARSET:\s*([\w-]+)", head, re.IGNORECASE)
    if found:
        name = found[1].lower()
        if name == "1252":
            return "cp1252", "cp1252"
        if name in {"8859-1", "iso-8859-1", "latin1"}:
            return "latin-1", "iso-8859-1"
    declared = re.search(r'encoding="([\w-]+)"', head, re.IGNORECASE)
    if declared:
        try:
            return codecs.lookup(declared[1]).name, declared[1].lower()
        except LookupError:
            return None
    return None


def decode_text(data: bytes) -> tuple[str, str]:
    """The text of a file and the encoding it was read as: UTF-8 (a BOM is dropped), UTF-16 with
    a BOM, the charset an OFX header names, then Windows-1252 (what a Windows bank writes)."""
    attempts: list[tuple[str, str]] = []
    if data.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        attempts.append(("utf-16", "utf-16"))
    attempts.append(("utf-8-sig", "utf-8"))
    declared = _declared_charset(data)
    if declared is not None:
        attempts.append(declared)
    attempts.append(("cp1252", "cp1252"))
    for codec, name in attempts:
        try:
            text = data.decode(codec)
        except UnicodeDecodeError:
            continue
        if "\x00" not in text:  # a UTF-16 file with no BOM reads as text between NULs
            return text, name
    raise NotText("not utf-8 or a text encoding that can be told")


def parse_statement(
    data: bytes,
    provider: str,
    currency: str,
    order: DateOrder | None = None,
    context: Context | None = None,
) -> Statement:
    """A downloaded file as a `Statement`; raises `UnknownLayout` for a layout that is not
    supported, `NotText` for bytes that are no text and `FileTooLarge` above `MAX_BYTES`."""
    if len(data) > MAX_BYTES:
        raise FileTooLarge("too large")
    text, encoding = decode_text(data)
    if is_ofx(text):
        statement = parse_ofx_statement(text, currency, context)
    else:
        statement = parse_csv_statement(text, provider, currency, order, context)
    statement.encoding = encoding
    return statement


def booked_at(entry: Entry, zone: tzinfo) -> datetime:
    """When it was booked: the time in the file, else noon of the day, in the local zone."""
    return datetime.combine(entry.day, entry.at or time(12, 0), tzinfo=zone).astimezone(UTC)


def balance_moment(day: date, zone: tzinfo) -> datetime:
    """The end of a day in the local zone, as a UTC instant."""
    end = datetime.combine(day, time.min, tzinfo=zone) + timedelta(days=1)
    return (end - timedelta(seconds=1)).astimezone(UTC)
