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
  import is matched on; without one the id is a hash of the account, the date, the amount, the
  text and how many identical lines came before in the file.
"""

import csv
import hashlib
import io
import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta, tzinfo
from decimal import Decimal
from typing import Literal

from src.dashboards.finance.fx import exponent
from src.dashboards.finance.recurring import RowError

DateOrder = Literal["dmy", "mdy"]
MAX_BYTES = 2 * 1024 * 1024
MAX_ENTRIES = 5000
AMOUNT = re.compile(r"[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?")
SLASH_DATE = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})")
ISO_DATE = re.compile(r"(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?")
OFX_DATE = re.compile(r"(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?")
NO_TEXT = "(no description)"


class UnknownLayout(ValueError):
    """The file is not in any layout this account may take."""


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


@dataclass
class Statement:
    layout: str
    entries: list[Entry] = field(default_factory=list)
    errors: list[RowError] = field(default_factory=list)
    ledger_balance: tuple[int, date] | None = None  # as the file states it (OFX)


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
    def __init__(self, field_name: str, message: str) -> None:
        super().__init__(message)
        self.field_name = field_name


def parse_amount(field_name: str, text: str, currency: str) -> int:
    value = text.strip()
    if not AMOUNT.fullmatch(value):
        raise CellError(field_name, "expected a plain decimal such as -12.50 or 1,234.56")
    shifted = Decimal(value.replace(",", "")).scaleb(exponent(currency))
    if shifted != shifted.to_integral_value():
        raise CellError(field_name, f"{currency} has {exponent(currency)} decimal places")
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
        raise CellError("date", "the dates are in two different orders")
    if dmy or mdy:
        return "dmy" if dmy else "mdy"
    if hint is not None:
        return hint
    raise CellError("date", "the date order is ambiguous: say date_order=dmy or mdy")


def parse_day(field_name: str, text: str, order: DateOrder) -> tuple[date, time | None]:
    value = text.strip()
    iso = ISO_DATE.fullmatch(value)
    if iso:
        day = valid_date(int(iso[1]), int(iso[2]), int(iso[3]))
        if day is None:
            raise CellError(field_name, "not a real date")
        if not iso[4]:
            return day, None
        try:
            return day, time(int(iso[4]), int(iso[5]), int(iso[6] or 0))
        except ValueError:
            raise CellError(field_name, "not a real time") from None
    parts = date_parts(value)
    if parts is None:
        raise CellError(field_name, "expected a date as YYYY-MM-DD, DD/MM/YYYY or MM/DD/YYYY")
    first, second, year = parts
    day = valid_date(year, second, first) if order == "dmy" else valid_date(year, first, second)
    if day is None:
        raise CellError(field_name, "not a real date")
    return day, None


def parse_clock(field_name: str, text: str) -> time:
    found = re.fullmatch(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", text.strip())
    if not found or int(found[1]) > 23 or int(found[2]) > 59 or int(found[3] or 0) > 59:
        raise CellError(field_name, "expected a time such as 14:30:00")
    return time(int(found[1]), int(found[2]), int(found[3] or 0))


def entry_id(account: str, entry: Entry, index: int) -> str:
    """The id a transaction is stored under: the bank's own, else a hash that makes the same
    line in the same place of a second file the same transaction (`index` counts identical
    lines before it in the file)."""
    if entry.bank_id:
        return "b:" + entry.bank_id[:60]
    stamp = f"{account}|{entry.day}|{entry.at}|{entry.amount}|{entry.description}|{index}"
    return "h:" + hashlib.sha256(stamp.encode()).hexdigest()[:40]


def number_entries(account: str, entries: Sequence[Entry]) -> list[tuple[str, Entry]]:
    """Entries with their stored ids (identical lines are told apart by their order)."""
    seen: dict[tuple[date, time | None, int, str], int] = {}
    numbered: list[tuple[str, Entry]] = []
    for entry in entries:
        key = (entry.day, entry.at, entry.amount, entry.description)
        index = seen.get(key, 0)
        seen[key] = index + 1
        numbered.append((entry_id(account, entry, index), entry))
    return numbered


# ---- CSV ------------------------------------------------------------------------------------


def _headers(text: str) -> tuple[list[str], list[dict[str, str]]]:
    reader = csv.reader(io.StringIO(text.lstrip("﻿")))
    rows = [row for row in reader if any(cell.strip() for cell in row)]
    if not rows:
        raise UnknownLayout("empty file")
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
                raise UnknownLayout("another bank's statement")
            return layout
    amount = GENERIC.amount in have or {GENERIC.debit, GENERIC.credit} <= have
    if GENERIC.needs <= have and amount:
        return GENERIC
    raise UnknownLayout("unknown layout")


def parse_csv_statement(
    text: str, provider: str, currency: str, order_given: DateOrder | None = None
) -> Statement:
    names, rows = _headers(text)
    layout = pick_layout(names, provider)
    statement = Statement(layout.id)
    if len(rows) > MAX_ENTRIES:
        statement.errors.append(RowError(0, None, f"more than {MAX_ENTRIES} lines"))
        return statement
    try:
        order = choose_order([r.get(layout.date, "") for r in rows], layout.date_order, order_given)
    except CellError as exc:
        statement.errors.append(RowError(0, exc.field_name, str(exc)))
        return statement
    for number, row in enumerate(rows, start=1):
        try:
            statement.entries.append(_entry(layout, row, currency, order))
        except CellError as exc:
            statement.errors.append(RowError(number, exc.field_name, str(exc)))
    return statement


def _entry(layout: Layout, row: dict[str, str], currency: str, order: DateOrder) -> Entry:
    day, at = parse_day("date", row.get(layout.date, ""), order)
    if layout.time and row.get(layout.time):
        at = parse_clock("time", row[layout.time])
    if layout.currency and (row.get(layout.currency) or currency).upper() != currency:
        raise CellError("currency", "the line is not in the account's currency")
    amount = _money(layout, row, currency)
    balance = None
    if layout.balance and row.get(layout.balance):
        balance = parse_amount("balance", row[layout.balance], currency)
    text = " ".join(part for column in layout.description if (part := row.get(column, "")))
    state = row.get(layout.state or "", "").upper()
    counterparty = row.get(layout.counterparty or "", "")
    return Entry(
        day=day,
        at=at,
        amount=amount,
        description=text[:500] or NO_TEXT,
        counterparty=counterparty[:200] or None,
        bank_id=row.get(layout.bank_id or "") or None,
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
            raise CellError("amount", "exactly one of the debit and credit columns is needed")
        if out:
            return -abs(parse_amount("debit", out, currency))
        return abs(parse_amount("credit", income, currency))
    raise CellError("amount", "required")


# ---- OFX ------------------------------------------------------------------------------------


def _tag(block: str, name: str) -> str | None:
    found = re.search(rf"<{name}>\s*([^<\r\n]*)", block, re.IGNORECASE)
    return found[1].strip() if found and found[1].strip() else None


def _ofx_date(text: str, field_name: str) -> tuple[date, time | None]:
    found = OFX_DATE.match(text.strip())
    day = valid_date(int(found[1]), int(found[2]), int(found[3])) if found else None
    if not found or day is None:
        raise CellError(field_name, "not a date")
    if not found[4]:
        return day, None
    try:
        return day, time(int(found[4]), int(found[5]), int(found[6]))
    except ValueError:
        raise CellError(field_name, "not a real time") from None


def _ofx_amount(text: str, field_name: str, currency: str) -> int:
    value = text.strip()
    if "." not in value and re.fullmatch(r"[+-]?\d+,\d+", value):
        value = value.replace(",", ".")  # the OFX specification allows a decimal comma
    return parse_amount(field_name, value, currency)


def is_ofx(text: str) -> bool:
    head = text[:2000].upper()
    return "OFXHEADER" in head or "<OFX>" in head


def parse_ofx_statement(text: str, currency: str) -> Statement:
    statement = Statement("ofx")
    declared = _tag(text, "CURDEF")
    if declared is not None and declared.upper() != currency:
        message = "the file is not in the account's currency"
        statement.errors.append(RowError(0, "currency", message))
        return statement
    blocks = re.findall(r"<STMTTRN>(.*?)</STMTTRN>", text, re.IGNORECASE | re.DOTALL)
    if not blocks:
        statement.errors.append(RowError(0, None, "no transactions in the file"))
        return statement
    if len(blocks) > MAX_ENTRIES:
        statement.errors.append(RowError(0, None, f"more than {MAX_ENTRIES} lines"))
        return statement
    for number, block in enumerate(blocks, start=1):
        try:
            statement.entries.append(_ofx_entry(block, currency))
        except CellError as exc:
            statement.errors.append(RowError(number, exc.field_name, str(exc)))
    ledger = re.search(r"<LEDGERBAL>(.*?)</LEDGERBAL>", text, re.IGNORECASE | re.DOTALL)
    if ledger and (amount := _tag(ledger[1], "BALAMT")) and (when := _tag(ledger[1], "DTASOF")):
        try:
            statement.ledger_balance = (
                _ofx_amount(amount, "balance", currency),
                _ofx_date(when, "balance_date")[0],
            )
        except CellError as exc:
            statement.errors.append(RowError(0, exc.field_name, str(exc)))
    return statement


def _ofx_entry(block: str, currency: str) -> Entry:
    posted, amount = _tag(block, "DTPOSTED"), _tag(block, "TRNAMT")
    if posted is None or amount is None:
        raise CellError("date" if posted is None else "amount", "required")
    day, at = _ofx_date(posted, "date")
    name, memo = _tag(block, "NAME"), _tag(block, "MEMO")
    text = " ".join(dict.fromkeys(part for part in (name, memo) if part))
    return Entry(
        day=day,
        at=at,
        amount=_ofx_amount(amount, "amount", currency),
        description=text[:500] or NO_TEXT,
        counterparty=name[:200] if name else None,
        bank_id=_tag(block, "FITID"),
        balance=None,
    )


# ---- entry point ----------------------------------------------------------------------------


def parse_statement(
    data: bytes, provider: str, currency: str, order: DateOrder | None = None
) -> Statement:
    """A downloaded file as a `Statement`; raises `UnknownLayout` for a layout that is not
    supported (and `ValueError` for a file that is not UTF-8 text)."""
    if len(data) > MAX_BYTES:
        raise ValueError("too large")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        raise ValueError("not utf-8") from None
    if is_ofx(text):
        return parse_ofx_statement(text, currency)
    return parse_csv_statement(text, provider, currency, order)


def booked_at(entry: Entry, zone: tzinfo) -> datetime:
    """When it was booked: the time in the file, else noon of the day, in the local zone."""
    return datetime.combine(entry.day, entry.at or time(12, 0), tzinfo=zone).astimezone(UTC)


def balance_moment(day: date, zone: tzinfo) -> datetime:
    """The end of a day in the local zone, as a UTC instant."""
    end = datetime.combine(day, time.min, tzinfo=zone) + timedelta(days=1)
    return (end - timedelta(seconds=1)).astimezone(UTC)
