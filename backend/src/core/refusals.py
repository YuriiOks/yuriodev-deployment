"""The stable codes of the refusals the services word as fixed sentences.

A service raises `AppError(422, "validation_error", "<fixed sentence>")`; the sentence is for
people and logs and may change, so the page words a refusal from `reason` (and, for a failing
field, from `field`), both fixed here, one row per sentence. `tests/test_error_codes.py` checks
that every sentence passed to `invalid()` is in this table.

`REFUSALS[sentence] = (field, reason)`; `field` is the request field to point at, or None.
"""

import re

REFUSALS: dict[str, tuple[str | None, str]] = {
    # tasks, events, areas, projects
    "Unknown area for this space": ("area_id", "unknown_value"),
    "Invalid date range": ("from", "bad_range"),
    "ends_at must be after starts_at": ("ends_at", "ends_before_start"),
    "The name needs a letter or a digit": ("name", "needs_letter_or_digit"),
    "Projects have no areas": ("area_id", "not_allowed"),
    "Invalid scope": ("scope", "unknown_value"),
    # finance reads and the transaction patch
    "Invalid cursor": ("cursor", "bad_format"),
    "Invalid limit": ("limit", "out_of_range"),
    "from must not be after to": ("from", "bad_range"),
    "Search text is too long": ("q", "too_long"),
    "Invalid category": ("category", "unknown_value"),
    "Invalid month": ("month", "bad_format"),
    "Nothing to change": (None, "nothing_to_change"),
    "A counterpart goes with a move to mark": ("counterpart", "required"),
    "The counterpart must be on another account and go the other way": (
        "counterpart",
        "bad_counterpart",
    ),
    "Invalid overdraft limit": ("overdraft_limit", "out_of_range"),
    "Only a current or business account has an overdraft": (
        "overdraft_limit",
        "wrong_account_kind",
    ),
    # manual connections, accounts, balances, statements
    "Give both brand colours or neither": ("brand_bg", "colours_pair"),
    "The brand colours must be #rrggbb with a contrast of at least 3": (
        "brand_bg",
        "colours_contrast",
    ),
    "as_of needs a UTC offset": ("as_of", "needs_utc_offset"),
    "Only a manual connection can be changed by hand": (None, "not_manual"),
    "Only an account entered by hand can be changed this way": (None, "not_manual"),
    "A provider id is lower-case letters, digits and hyphens": ("provider", "bad_format"),
    "That bank is connected through its own API": ("provider", "provider_is_api"),
    "A credit card needs credit_limit above 0": ("credit_limit", "credit_limit_required"),
    "Only a credit card has a limit": ("credit_limit", "wrong_account_kind"),
    "That field cannot be cleared": (None, "cannot_clear"),
    "Only a credit card has a limit, above 0": ("credit_limit", "wrong_account_kind"),
    "A credit card takes owed, any other account balance": ("balance", "wrong_account_kind"),
    "The newest balance of the file cannot be told: the lines share a day": (
        None,
        "statement_balance_unknown",
    ),
    "Set a credit card's balance with its own endpoint (owed)": ("balance", "wrong_account_kind"),
    "The file has no balance to apply": (None, "statement_has_no_balance"),
    "The file must be UTF-8": (None, "not_utf8"),
    # recurring payments
    "completed_installments cannot exceed total_installments": (
        "completed_installments",
        "exceeds_total",
    ),
    "Unknown account": ("account_id", "unknown_value"),
    "A required field cannot be cleared": (None, "cannot_clear"),
    "A repeating payment needs a next date or a start date": (
        "next_payment_date",
        "date_required",
    ),
    "Invalid days": ("days", "out_of_range"),
    # conflicts
    "A payment with this reference exists": ("external_ref", "payment_reference_exists"),
    "This payment has already moved on": (None, "payment_moved_on"),
}

# The sentences a request model's own validators raise (a `ValueError`), as `(field, reason)`.
# Pydantic reports them as a failing `value_error` on the whole body; this names the field.
VALUE_RULES: dict[str, tuple[str | None, str]] = {
    "no fields to change": (None, "nothing_to_change"),
    "nothing to change": (None, "nothing_to_change"),
    "icon_url must be a plain https URL": ("icon_url", "bad_format"),
    "website must be a public host name such as example.com": ("website", "bad_format"),
    "color must be #rgb or #rrggbb": ("color", "bad_format"),
    "currency must be three capital letters": ("currency", "bad_format"),
    "next_payment_date or start_date is required for a repeating payment": (
        "next_payment_date",
        "date_required",
    ),
    "not a currency of ISO 4217": ("currency", "unknown_value"),
    "a credit card needs credit_limit above 0 and owed, not balance": (
        "credit_limit",
        "credit_card_fields",
    ),
    "this kind needs balance, and no owed or credit_limit": ("balance", "balance_fields"),
    "an overdraft belongs to a current or business account": (
        "overdraft_limit",
        "wrong_account_kind",
    ),
    "exactly one of balance and owed": ("balance", "balance_or_owed"),
    "internal_transfer is true or false": ("internal_transfer", "bad_format"),
    "days goes with snooze and only with it": ("days", "days_only_for_snooze"),
}
_CANNOT_BE_NULL = re.compile(r"^([a-z_]+) cannot be null$")


def value_rule(message: str) -> tuple[str | None, str] | None:
    """`(field, reason)` of a validator's sentence, or None for one this table does not know."""
    if message in REFUSALS:
        return REFUSALS[message]
    if message in VALUE_RULES:
        return VALUE_RULES[message]
    null = _CANNOT_BE_NULL.match(message)
    return (null.group(1), "cannot_be_null") if null else None


_NOT_FOUND = re.compile(r"^(.+) not found$")


def reason_for(code: str, message: str) -> tuple[str | None, str | None]:
    """`(field, reason)` of a refusal the services word as a fixed sentence, else `(None, None)`
    (the `error` code is then already the finest there is). A `<thing> not found` answer gets
    `<thing>_not_found` (`task_not_found`, `recurring_payment_not_found`, ...)."""
    if code == "not_found":
        found = _NOT_FOUND.match(message)
        if found:
            slug = re.sub(r"[^a-z0-9]+", "_", found.group(1).lower()).strip("_")
            return None, f"{slug}_not_found"
        return None, None
    if code in ("validation_error", "conflict"):
        return REFUSALS.get(message, (None, "invalid" if code == "validation_error" else None))
    return None, None
