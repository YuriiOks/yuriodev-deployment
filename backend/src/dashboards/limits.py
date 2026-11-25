"""The limits the page may check before it sends (`limits` of `GET /bootstrap`).

Each number is read from the constant or the field constraint that enforces it, never retyped,
so the page and the server cannot disagree (`tests/test_error_codes.py` also sends a value one
over a sample and compares the 422's `limit`).
"""

import typing
from typing import Any

from pydantic import BaseModel

from src.dashboards.finance import recurring, recurring_service, statements
from src.dashboards.finance import service as finance_service
from src.dashboards.finance.icons import MAX_ICON_BYTES
from src.dashboards.finance.manual import AccountIn, ConnectionIn
from src.dashboards.schemas import ProjectCreate, TaskCreate
from src.routes import assistant, finance_recurring


def _constraints(annotation: object) -> typing.Iterator[object]:
    """Every constraint object inside an annotation (through `Annotated` and `X | None`)."""
    yield from getattr(annotation, "__metadata__", ())
    for part in typing.get_args(annotation):
        yield from _constraints(part)


def _bound(model: type[BaseModel], name: str, attr: str) -> int:
    """The `attr` (`max_length`, `le`, ...) a model's field is held to."""
    info = model.model_fields[name]
    for item in [*info.metadata, *_constraints(info.annotation)]:
        value = getattr(item, attr, None)
        if value is not None:
            return int(value)
    raise LookupError(f"{model.__name__}.{name} has no {attr}")


def limits() -> dict[str, Any]:
    return {
        "task": {
            "title": _bound(TaskCreate, "title", "max_length"),
            "notes": _bound(TaskCreate, "notes", "max_length"),
        },
        "project": {"name": _bound(ProjectCreate, "name", "max_length")},
        "connection": {
            "provider": _bound(ConnectionIn, "provider", "max_length"),
            "display_name": _bound(ConnectionIn, "display_name", "max_length"),
        },
        "account": {
            "name": _bound(AccountIn, "name", "max_length"),
            "label": _bound(AccountIn, "label", "max_length"),
        },
        "recurring": {
            "name": _bound(recurring.RecurringIn, "name", "max_length"),
            "notes": _bound(recurring.RecurringIn, "notes", "max_length"),
            "payment_method": _bound(recurring.RecurringIn, "payment_method", "max_length"),
            "match_text": _bound(recurring.RecurringIn, "match_text", "max_length"),
            "external_ref": _bound(recurring.RecurringIn, "external_ref", "max_length"),
            "reminder_days": _bound(recurring.RecurringIn, "reminder_days", "le"),
            "bulk_rows": recurring.MAX_ROWS,
            "csv_rows": recurring.MAX_ROWS,
            "csv_bytes": recurring.MAX_CSV_BYTES,
            "amount": recurring.MAX_MINOR,
        },
        "statement": {"bytes": statements.MAX_BYTES, "rows": statements.MAX_ENTRIES},
        "icon": {"bytes": MAX_ICON_BYTES},
        "attention": {
            "bulk_keys": finance_recurring.MAX_BULK_KEYS,
            "snooze_days": recurring_service.MAX_SNOOZE_DAYS,
        },
        "transactions": {"page": finance_service.MAX_LIMIT, "search": finance_service.MAX_TEXT},
        "assistant": {"question": _bound(assistant.AskIn, "question", "max_length")},
    }
