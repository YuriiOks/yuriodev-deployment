"""Recurring payments: the rules that need no database (input shapes, dates, text matching, CSV).

The owner enters these by hand (or loads them from a file once); nothing here talks to a bank.
`amount` is what is paid, a positive integer in minor units of `currency`.
"""

import calendar
import csv
import io
import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Annotated, Any, Literal, Self
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from src.dashboards.finance.fx import exponent

Kind = Literal["subscription", "debt", "utility", "insurance", "housing", "service", "one_time"]
Frequency = Literal["once", "daily", "weekly", "monthly", "yearly"]

MAX_MINOR = 10**12  # far above any real figure, below the bigint
MAX_ROWS = 500
MAX_CSV_BYTES = 1024 * 1024
ICON_URL_LENGTH = 500
Minor = Annotated[int, Field(strict=True, ge=0, le=MAX_MINOR)]
Count = Annotated[int, Field(strict=True, ge=0, le=100_000)]

# The window in which a transaction counts as the payment due on a day: this many days before it
# (paid early) up to this many after it (a card payment can post days late).
EARLY_DAYS = 3
LATE_DAYS = 7

SYNONYMS: dict[str, tuple[Frequency, int]] = {
    "once": ("once", 1),
    "one-time": ("once", 1),
    "one time": ("once", 1),
    "onetime": ("once", 1),
    "one_time": ("once", 1),
    "daily": ("daily", 1),
    "day": ("daily", 1),
    "weekly": ("weekly", 1),
    "week": ("weekly", 1),
    "biweekly": ("weekly", 2),
    "bi-weekly": ("weekly", 2),
    "fortnightly": ("weekly", 2),
    "monthly": ("monthly", 1),
    "month": ("monthly", 1),
    "custom": ("monthly", 1),  # the owner's own word: every `frequency_interval` months
    "quarterly": ("monthly", 3),
    "semiannual": ("monthly", 6),
    "semi-annual": ("monthly", 6),
    "biannual": ("monthly", 6),
    "half-yearly": ("monthly", 6),
    "yearly": ("yearly", 1),
    "year": ("yearly", 1),
    "annual": ("yearly", 1),
    "annually": ("yearly", 1),
}
KIND_WORDS: dict[str, Kind] = {
    "subscription": "subscription",
    "subscriptions": "subscription",
    "sub": "subscription",
    "debt": "debt",
    "loan": "debt",
    "credit": "debt",
    "installment": "debt",
    "instalment": "debt",
    "utility": "utility",
    "utilities": "utility",
    "bill": "utility",
    "bills": "utility",
    "insurance": "insurance",
    "housing": "housing",
    "rent": "housing",
    "mortgage": "housing",
    "service": "service",
    "services": "service",
    "one_time": "one_time",
    "one-time": "one_time",
    "one time": "one_time",
    "once": "one_time",
}
CONTROL = re.compile(r"[\x00-\x20\x7f\"'<>\\^`{|}]")
COLOR = re.compile(r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})")
ALNUM = re.compile(r"[^a-z0-9]")


def safe_icon_url(value: str) -> bool:
    """An https URL that is safe to hand to an `<img>`: a host, no credentials, no spaces,
    quotes or markup characters, at most 500 characters. Nothing is fetched here."""
    if len(value) > ICON_URL_LENGTH or CONTROL.search(value):
        return False
    try:
        parts = urlsplit(value)
        host = parts.hostname
        _ = parts.port  # raises on a port that is not a number
    except ValueError:
        return False
    return parts.scheme == "https" and bool(host) and parts.username is None and not parts.password


def normal_color(value: str) -> str | None:
    """`#rgb` or `#rrggbb` as lower-case `#rrggbb`, else None."""
    if not COLOR.fullmatch(value):
        return None
    digits = value[1:].lower()
    if len(digits) == 3:
        digits = "".join(char * 2 for char in digits)
    return "#" + digits


class _Checks(BaseModel):
    """The checks every input shape shares (None is left to the field's own type)."""

    @field_validator("icon_url", check_fields=False)
    @classmethod
    def check_icon(cls, value: str | None) -> str | None:
        if value is not None and not safe_icon_url(value):
            raise ValueError("icon_url must be a plain https URL")
        return value

    @field_validator("color", check_fields=False)
    @classmethod
    def check_color(cls, value: str | None) -> str | None:
        if value is None:
            return None
        found = normal_color(value)
        if found is None:
            raise ValueError("color must be #rgb or #rrggbb")
        return found

    @field_validator("currency", check_fields=False)
    @classmethod
    def check_currency(cls, value: str | None) -> str | None:
        if value is not None and not re.fullmatch(r"[A-Z]{3}", value):
            raise ValueError("currency must be three capital letters")
        return value


class RecurringIn(_Checks):
    """A recurring payment as the owner enters it."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=120)
    amount: Minor
    currency: str
    kind: Kind = "service"
    frequency: Frequency = "monthly"
    frequency_interval: int = Field(default=1, strict=True, ge=1, le=366)
    start_date: date | None = None
    next_payment_date: date | None = None
    payment_type: str | None = Field(default=None, max_length=40)
    payment_mode: str | None = Field(default=None, max_length=40)
    category: str | None = Field(default=None, max_length=40)
    notes: str | None = Field(default=None, max_length=2000)
    is_active: bool = True
    auto_renew: bool = False
    payment_method: str | None = Field(default=None, max_length=80)
    account_id: UUID | None = None
    match_text: str | None = Field(default=None, max_length=80)
    reminder_days: int | None = Field(default=None, strict=True, ge=0, le=90)
    icon_url: str | None = None
    color: str | None = None
    is_installment: bool = False
    total_installments: Count | None = None
    completed_installments: Count | None = None
    total_owed: Minor | None = None
    remaining_balance: Minor | None = None
    creditor: str | None = Field(default=None, max_length=120)
    target_amount: Minor | None = None
    current_saved: Minor | None = None
    recipient: str | None = Field(default=None, max_length=120)
    external_ref: str | None = Field(default=None, min_length=1, max_length=80)

    @model_validator(mode="after")
    def _has_a_date(self) -> Self:
        if needs_a_date(
            self.is_active, self.kind, self.frequency, self.start_date, self.next_payment_date
        ):
            raise ValueError("next_payment_date or start_date is required for a repeating payment")
        return self


class RecurringPatch(_Checks):
    """Fields to change; `null` clears a field that may be empty (name, amount, currency, kind,
    frequency, frequency_interval, is_active, auto_renew and is_installment may not be)."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=120)
    amount: Minor | None = None
    currency: str | None = None
    kind: Kind | None = None
    frequency: Frequency | None = None
    frequency_interval: int | None = Field(default=None, strict=True, ge=1, le=366)
    start_date: date | None = None
    next_payment_date: date | None = None
    payment_type: str | None = Field(default=None, max_length=40)
    payment_mode: str | None = Field(default=None, max_length=40)
    category: str | None = Field(default=None, max_length=40)
    notes: str | None = Field(default=None, max_length=2000)
    is_active: bool | None = None
    auto_renew: bool | None = None
    payment_method: str | None = Field(default=None, max_length=80)
    account_id: UUID | None = None
    match_text: str | None = Field(default=None, max_length=80)
    reminder_days: int | None = Field(default=None, strict=True, ge=0, le=90)
    icon_url: str | None = None
    color: str | None = None
    is_installment: bool | None = None
    total_installments: Count | None = None
    completed_installments: Count | None = None
    total_owed: Minor | None = None
    remaining_balance: Minor | None = None
    creditor: str | None = Field(default=None, max_length=120)
    target_amount: Minor | None = None
    current_saved: Minor | None = None
    recipient: str | None = Field(default=None, max_length=120)
    external_ref: str | None = Field(default=None, min_length=1, max_length=80)


NOT_EMPTY = frozenset(
    {
        "name",
        "amount",
        "currency",
        "kind",
        "frequency",
        "frequency_interval",
        "is_active",
        "auto_renew",
        "is_installment",
    }
)


def instalments_agree(values: dict[str, Any]) -> bool:
    """Completed instalments cannot exceed the total, when both are known."""
    total, done = values.get("total_installments"), values.get("completed_installments")
    return total is None or done is None or done <= total


def advance(day: date, frequency: str, interval: int, anchor_day: int) -> date | None:
    """The date of the payment after `day`, or None for a payment that happens once. Months keep
    `anchor_day` (clamped to the month's end), so 31 January, 28 February, 31 March."""
    if frequency == "daily":
        return date.fromordinal(day.toordinal() + interval)
    if frequency == "weekly":
        return date.fromordinal(day.toordinal() + 7 * interval)
    if frequency in {"monthly", "yearly"}:
        months = interval * (12 if frequency == "yearly" else 1)
        index = day.year * 12 + day.month - 1 + months
        year, month = divmod(index, 12)
        month += 1
        if year > 9998:
            return None
        return date(year, month, min(anchor_day, calendar.monthrange(year, month)[1]))
    return None


def anchor_of(start: date | None, next_date: date) -> int:
    return (start or next_date).day


def occurrences(
    first: date, frequency: str, interval: int, anchor_day: int, until: date, limit: int = 400
) -> list[date]:
    """The dates from `first` (included) to `until` (included)."""
    found: list[date] = []
    day: date | None = first
    while day is not None and day <= until and len(found) < limit:
        found.append(day)
        day = advance(day, frequency, interval, anchor_day)
    return found


def needs_a_date(
    is_active: bool, kind: str, frequency: str, start: date | None, following: date | None
) -> bool:
    """An active payment that repeats but has neither a next date nor a start date to work one
    out from would never be rolled, listed or noticed."""
    repeats = frequency_of(kind, frequency) != "once"
    return is_active and repeats and start is None and following is None


def first_on_or_after(start: date, frequency: str, interval: int, anchor: int, today: date) -> date:
    """The first occurrence of a payment that began on `start` that is today or later (`start`
    itself when it is later, or when the payment happens once). `frequency` is the real one."""
    day = start
    for _ in range(5000):
        if day >= today:
            return day
        following = advance(day, frequency, interval, anchor)
        if following is None:
            return day
        day = following
    return day


def frequency_of(kind: str, frequency: str) -> str:
    """How often a payment really repeats: a one-time payment never does, whatever it says."""
    return "once" if kind == "one_time" else frequency


MAX_PLAN = 1200  # instalments: more than this and the last date is not worked out


def last_installment_date(
    start: date | None, frequency: str, interval: int, total: int | None
) -> date | None:
    """The date of the last instalment of a plan (the first is on `start`), or None when it
    cannot be told (no start or count, or a plan of more than `MAX_PLAN`)."""
    if start is None or not total or total > MAX_PLAN:
        return None
    day = start
    for _ in range(total - 1):
        following = advance(day, frequency, interval, start.day)
        if following is None:
            return None
        day = following
    return day


ScheduleState = Literal["on_track", "ended_by_schedule", "unknown"]


def schedule_state(row: Any, today: date) -> ScheduleState | None:
    """What the owner's own list says about a payment, with nothing sent to a bank: an instalment
    plan whose last instalment (start date plus count) or count is behind it, and a payment that
    happens once whose date is behind it, are `ended_by_schedule`; a plan that cannot be worked
    out, or that the bank's lines contradict (a match after its supposed last date), is
    `unknown`. None for a payment the owner switched off."""
    if not row.is_active:
        return None
    frequency = frequency_of(row.kind, row.frequency)
    if frequency == "once":
        if row.next_payment_date is None:
            return "unknown"
        if row.next_payment_date >= today:
            return "on_track"
        if row.account_id is not None and row.recent_outcomes[-1:] not in ("1", "p"):
            return "unknown"  # a collected account saw nothing: still a missed payment
        return "ended_by_schedule"
    if not row.is_installment:
        return "on_track"
    total = row.total_installments
    if not total:
        return "unknown"
    last = last_installment_date(row.start_date, frequency, row.frequency_interval, total)
    done = row.completed_installments or 0
    if done >= total:  # counted by a line or by the owner
        ended = True
    else:
        ended = (last is not None and last < today) or done + row.assumed_installments >= total
        # A payment from an account we collect is over only when its last due date was seen paid
        # (a line, or the owner's word); a date that passed with nothing seen is still missed.
        ended = ended and (row.account_id is None or row.recent_outcomes[-1:] in ("1", "p"))
    if ended:
        proven_later = last is not None and row.last_matched_on and row.last_matched_on > last
        return "unknown" if proven_later else "ended_by_schedule"
    if last is not None and last < today:
        return "unknown"  # the schedule says it is over, the bank has not confirmed
    return "on_track" if last is not None else "unknown"


def squash(text: str | None) -> str:
    return ALNUM.sub("", (text or "").casefold())


def text_matches(
    needle_source: str,
    counterparty: str | None,
    description: str | None,
    reverse: bool = True,
) -> bool:
    """Does a transaction's text name this payment? Both sides are lower-cased and stripped to
    letters and digits; the payment's name (or `match_text`) must be inside the counterparty or
    the description, or, with `reverse`, the counterparty (4 characters or more) inside the name
    (not when the owner gave `match_text`: he said what to look for)."""
    needle = squash(needle_source)
    if len(needle) < 3:
        return False
    other = squash(counterparty)
    if needle in other or needle in squash(description):
        return True
    return reverse and len(other) >= 4 and other in needle


def amount_differs(recorded: int, charged: int) -> bool:
    """A charge more than 1% away from the recorded amount (an unknown amount, 0, never differs)."""
    return recorded > 0 and abs(charged - recorded) * 100 > recorded


def kind_of(payment_type: str | None, is_installment: bool) -> Kind:
    word = (payment_type or "").strip().lower()
    if word in KIND_WORDS:
        return KIND_WORDS[word]
    return "debt" if is_installment else "service"


# ---- CSV ----------------------------------------------------------------------------------------


@dataclass(frozen=True)
class RowError:
    row: int  # 1 is the first data row
    field: str | None
    message: str


class CellError(ValueError):
    def __init__(self, field: str, message: str) -> None:
        super().__init__(message)
        self.field = field


TRUE = frozenset({"true", "yes", "y", "1", "t"})
FALSE = frozenset({"false", "no", "n", "0", "f"})
KNOWN_COLUMNS = frozenset(
    {
        "name",
        "amount",
        "currency",
        "frequency",
        "frequency_interval",
        "start_date",
        "next_payment_date",
        "payment_type",
        "payment_mode",
        "category",
        "notes",
        "is_active",
        "payment_method",
        "reminder_days",
        "icon_url",
        "color",
        "auto_renew",
        "is_installment",
        "total_installments",
        "completed_installments",
        "total_owed",
        "remaining_balance",
        "creditor",
        "target_amount",
        "current_saved",
        "recipient",
        "kind",
        "match_text",
        "external_ref",
    }
)
MONEY_COLUMNS = ("amount", "total_owed", "remaining_balance", "target_amount", "current_saved")
INT_COLUMNS = (
    "frequency_interval",
    "reminder_days",
    "total_installments",
    "completed_installments",
)
TEXT_COLUMNS = (
    "name",
    "payment_type",
    "payment_mode",
    "category",
    "notes",
    "payment_method",
    "creditor",
    "recipient",
    "match_text",
    "icon_url",
    "color",
    "external_ref",
)


def cell_bool(field: str, text: str) -> bool:
    word = text.lower()
    if word in TRUE:
        return True
    if word in FALSE:
        return False
    raise CellError(field, "expected true or false")


def cell_date(field: str, text: str) -> date:
    try:
        if len(text) > 10 and text[10] not in "T ":
            raise ValueError(text)
        return date.fromisoformat(text[:10])  # a time after the date is ignored
    except ValueError:
        raise CellError(field, "expected a date as YYYY-MM-DD") from None


def cell_int(field: str, text: str) -> int:
    if not re.fullmatch(r"\d{1,9}", text):
        raise CellError(field, "expected a whole number")
    return int(text)


def cell_minor(field: str, text: str, currency: str) -> int:
    """A decimal such as 12.99 as minor units of the currency; no more decimals than it has."""
    if not re.fullmatch(r"\d{1,13}(\.\d+)?", text):
        raise CellError(field, "expected a plain decimal such as 12.99, not negative")
    try:
        value = Decimal(text)
    except InvalidOperation:  # pragma: no cover - the pattern is a decimal already
        raise CellError(field, "expected a plain decimal such as 12.99") from None
    shifted = value.scaleb(exponent(currency))
    if shifted != shifted.to_integral_value():
        raise CellError(field, f"{currency} has {exponent(currency)} decimal places")
    return int(shifted)


def cell_frequency(text: str, interval: int | None) -> tuple[Frequency, int]:
    found = SYNONYMS.get(text.lower())
    if found is None:
        raise CellError(
            "frequency",
            "unknown frequency: use daily, weekly, monthly, quarterly, yearly, one-time, or "
            "custom with frequency_interval in months",
        )
    return found[0], found[1] * (interval or 1)


def row_to_input(row: dict[str, str], ordinal: int = 1) -> RecurringIn:
    """One CSV row as the input shape; raises `CellError` or pydantic's `ValidationError`."""
    cells = {key: value.strip() for key, value in row.items() if value and value.strip()}
    currency = cells.get("currency", "").upper()
    if not currency:
        raise CellError("currency", "required")
    values: dict[str, Any] = {"currency": currency}
    for column in TEXT_COLUMNS:
        if column in cells:
            values[column] = cells[column]
    for column in MONEY_COLUMNS:
        if column in cells:
            values[column] = cell_minor(column, cells[column], currency)
    for column in INT_COLUMNS:
        if column in cells:
            values[column] = cell_int(column, cells[column])
    for column in ("start_date", "next_payment_date"):
        if column in cells:
            values[column] = cell_date(column, cells[column])
    for column in ("is_active", "auto_renew", "is_installment"):
        if column in cells:
            values[column] = cell_bool(column, cells[column])
    if "kind" not in cells:
        values["kind"] = kind_of(cells.get("payment_type"), bool(values.get("is_installment")))
    if "frequency" in cells:
        values["frequency"], values["frequency_interval"] = cell_frequency(
            cells["frequency"], values.get("frequency_interval")
        )
    elif values["kind"] == "one_time":
        values["frequency"] = "once"
    else:
        raise CellError("frequency", "required")
    if "name" not in values or "amount" not in values:
        raise CellError("name" if "name" not in values else "amount", "required")
    values.setdefault("external_ref", reference(values["name"], currency, ordinal))
    return RecurringIn.model_validate(values)


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:50] or "row"


def reference(name: str, currency: str, ordinal: int) -> str:
    """The key that makes a second import of the same file find the same rows: the name and the
    currency, and `ordinal` (1, 2, ...) among the rows of the file with that name and currency,
    never the row's position, so adding, removing or sorting rows changes no other key."""
    return f"csv:{slug(name)}:{currency.lower()}:{ordinal}"


def parse_csv(text: str) -> tuple[list[tuple[int, RecurringIn]], list[RowError], list[str]]:
    """A file with a header row (the owner's own column names) to its rows as (row number,
    input), per-row errors and the columns that were ignored. A row's reference names it by its
    name and currency (see `reference`), so a file loaded twice matches itself and an edited file
    keeps the references of the rows that did not change."""
    reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")))
    header = [name.strip().lower() for name in (reader.fieldnames or [])]
    if not header:
        return [], [RowError(0, None, "the file has no header row")], []
    reader.fieldnames = header
    ignored = [name for name in header if name and name not in KNOWN_COLUMNS]
    inputs: list[tuple[int, RecurringIn]] = []
    errors: list[RowError] = []
    seen: set[str] = set()
    counted: dict[tuple[str, str], int] = {}
    try:
        for number, row in enumerate(reader, start=1):
            if number > MAX_ROWS:
                errors.append(RowError(number, None, f"more than {MAX_ROWS} rows"))
                break
            if not any((value or "").strip() for value in row.values() if isinstance(value, str)):
                continue
            clean = {key: value for key, value in row.items() if isinstance(value, str)}
            key = (slug(clean.get("name", "")), clean.get("currency", "").upper())
            try:
                item = row_to_input(clean, counted.get(key, 0) + 1)
            except CellError as exc:
                errors.append(RowError(number, exc.field, str(exc)))
                continue
            except ValidationError as exc:
                errors.extend(problem_row(number, problem) for problem in exc.errors())
                continue
            if item.external_ref in seen:
                errors.append(RowError(number, "external_ref", "the same reference twice"))
                continue
            seen.add(str(item.external_ref))
            counted[key] = counted.get(key, 0) + 1
            inputs.append((number, item))
    except csv.Error:
        errors.append(RowError(0, None, "the file is not valid CSV"))
    return inputs, errors, ignored


def problem_row(number: int, problem: Any) -> RowError:
    where = problem.get("loc") or ()
    return RowError(number, str(where[0]) if where else None, field_message(problem))


def field_message(problem: Any) -> str:
    """A fixed sentence per kind of problem, never the value that was sent."""
    kind = str(problem.get("type", ""))
    if kind == "missing":
        return "required"
    if kind.startswith("literal"):
        return "not an allowed value"
    if "too_long" in kind or "too_short" in kind:
        return "wrong length"
    if "greater" in kind or "less" in kind:
        return "out of range"
    if kind == "value_error":
        return str(problem.get("msg", "invalid")).removeprefix("Value error, ")
    return "invalid value"
