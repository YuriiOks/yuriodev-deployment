"""One JSON error shape, {error, message, request_id}, for every error the app answers itself."""

import re
from collections.abc import Mapping
from decimal import Decimal
from http import HTTPStatus
from typing import Any, cast

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from src.core.logging import get_request_id
from src.core.refusals import reason_for, value_rule
from src.core.schemas import ErrorBody

_CODES = {
    404: ("not_found", "Not found"),
    405: ("method_not_allowed", "Method not allowed"),
}


class AppError(Exception):
    """An error a feature raises on purpose: answered as {error, message, request_id}.

    `code` is the stable machine code and `message` a short fixed sentence. Neither may carry
    request input (titles, notes, tokens): they reach the client and the logs as written.
    """

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.message = message
        # The finer, stable code a page words the refusal from (`src/core/refusals.py`).
        self.field, self.reason = reason_for(code, message)


def error_response(
    status: int,
    code: str,
    message: str,
    request_id: str | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    body = ErrorBody(error=code, message=message, request_id=request_id or get_request_id())
    return JSONResponse(body.model_dump(), status_code=status, headers=headers)


def _code_for(status: int) -> tuple[str, str]:
    if status in _CODES:
        return _CODES[status]
    try:
        phrase = HTTPStatus(status).phrase
    except ValueError:
        phrase = "Error"
    return re.sub(r"[^a-z0-9]+", "_", phrase.lower()).strip("_"), phrase


async def http_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    http_exc = cast(StarletteHTTPException, exc)  # registered for this type only
    code, message = _code_for(http_exc.status_code)
    return error_response(http_exc.status_code, code, message, headers=http_exc.headers)


async def app_error_handler(request: Request, exc: Exception) -> JSONResponse:
    app_exc = cast(AppError, exc)  # registered for this type only
    if app_exc.reason is None:
        return error_response(app_exc.status, app_exc.code, app_exc.message)
    body = ErrorBody(error=app_exc.code, message=app_exc.message, request_id=get_request_id())
    content = body.model_dump() | {"reason": app_exc.reason}
    if app_exc.status == 422 and app_exc.field is not None:
        content["fields"] = [app_exc.field]
        content["issues"] = [
            {
                "field": app_exc.field,
                "code": app_exc.reason,
                "limit": None,
                "bound": None,
                "type": "rule",
                "reason": app_exc.message,
            }
        ]
    return JSONResponse(content, status_code=app_exc.status)


_PLACES = frozenset({"body", "query", "path", "header", "cookie"})
_REASONS = {
    "missing": "Required",
    "string_too_short": "Too short",
    "string_too_long": "Too long",
    "string_pattern_mismatch": "Not in the expected format",
    "string_type": "Must be text",
    "int_type": "Must be a whole number",
    "int_parsing": "Must be a whole number",
    "int_from_float": "Must be a whole number",
    "float_type": "Must be a number",
    "float_parsing": "Must be a number",
    "bool_type": "Must be true or false",
    "bool_parsing": "Must be true or false",
    "greater_than": "Too small",
    "greater_than_equal": "Too small",
    "less_than": "Too large",
    "less_than_equal": "Too large",
    "literal_error": "Not one of the accepted values",
    "enum": "Not one of the accepted values",
    "extra_forbidden": "Not an accepted field",
    "uuid_parsing": "Not a valid id",
    "uuid_type": "Not a valid id",
    "date_type": "Not a valid date",
    "date_parsing": "Not a valid date",
    "date_from_datetime_parsing": "Not a valid date",
    "datetime_type": "Not a valid date and time",
    "datetime_parsing": "Not a valid date and time",
    "json_invalid": "The body is not valid JSON",
    "model_attributes_type": "Must be an object",
    "dict_type": "Must be an object",
    "list_type": "Must be a list",
    "too_short": "Too few items",
    "too_long": "Too many items",
    "value_error": "Not accepted",
    "assertion_error": "Not accepted",
}
MAX_ISSUES = 20


def _field(location: tuple[object, ...]) -> str:
    """A path such as `items.0.amount`. A key the client invented (an extra field) is cut to
    letters, digits, `_`, `-` and `.` and 64 characters: it is the one place input could show."""
    parts = location[1:] if location and location[0] in _PLACES else location
    name = ".".join(str(part) for part in parts) or str(location[0] if location else "body")
    return re.sub(r"[^A-Za-z0-9_.-]", "", name)[:64] or "body"


_CODES_BY_TYPE = {
    "missing": "required",
    "string_too_short": "too_short",
    "too_short": "too_short",
    "string_too_long": "too_long",
    "too_long": "too_long",
    "string_pattern_mismatch": "bad_format",
    "int_type": "not_a_number",
    "int_parsing": "not_a_number",
    "int_from_float": "not_a_number",
    "float_type": "not_a_number",
    "float_parsing": "not_a_number",
    "decimal_type": "not_a_number",
    "decimal_parsing": "not_a_number",
    "greater_than": "out_of_range",
    "greater_than_equal": "out_of_range",
    "less_than": "out_of_range",
    "less_than_equal": "out_of_range",
    "literal_error": "unknown_value",
    "enum": "unknown_value",
    "extra_forbidden": "unknown_field",
    "uuid_parsing": "bad_format",
    "uuid_type": "bad_format",
    "bool_type": "bad_format",
    "bool_parsing": "bad_format",
    "date_type": "bad_format",
    "date_parsing": "bad_format",
    "date_from_datetime_parsing": "bad_format",
    "datetime_type": "bad_format",
    "datetime_parsing": "bad_format",
    "timezone_aware": "bad_format",
    "json_invalid": "bad_json",
    "string_type": "wrong_type",
    "dict_type": "wrong_type",
    "list_type": "wrong_type",
    "model_attributes_type": "wrong_type",
}
# The constraint a failing value broke, by type: (key in the error's `ctx`, which end of a range).
_LIMITS: dict[str, tuple[str, str | None]] = {
    "string_too_short": ("min_length", None),
    "too_short": ("min_length", None),
    "string_too_long": ("max_length", None),
    "too_long": ("max_length", None),
    "greater_than": ("gt", "min"),
    "greater_than_equal": ("ge", "min"),
    "less_than": ("lt", "max"),
    "less_than_equal": ("le", "max"),
}


def _number(value: object) -> int | float | None:
    """A limit as a plain JSON number (a Decimal bound comes out as an int when it is whole)."""
    if isinstance(value, bool) or not isinstance(value, int | float | Decimal):
        return None
    return int(value) if value == int(value) else float(value)


def _issue(problem: Mapping[str, Any]) -> dict[str, Any]:
    kind = str(problem.get("type", ""))
    key, bound = _LIMITS.get(kind, ("", None))
    limit = _number((problem.get("ctx") or {}).get(key)) if key else None
    field = _field(tuple(problem.get("loc", ())))
    code = _CODES_BY_TYPE.get(kind, "invalid")
    if kind == "value_error":
        # A validator of ours raised `ValueError("<fixed sentence>")`: the table names the rule.
        rule = value_rule(str((problem.get("ctx") or {}).get("error", "")))
        if rule is not None:
            field, code = rule[0] or field, rule[1]
    return {
        "field": field,
        "code": code,
        "limit": limit,
        "bound": bound,
        "type": kind,
        "reason": _REASONS.get(kind, "Not valid"),
    }


async def validation_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """422 with the failing fields: `issues` is `[{field, code, limit, bound, type, reason}]`
    (`code` is stable: required, too_short, too_long, not_a_number, out_of_range, bad_format,
    unknown_value, unknown_field, wrong_type, bad_json or invalid; `limit` is the number that was
    broken, `bound` says whether it is a minimum or a maximum for out_of_range) and `fields` the
    names alone. Never the input (FastAPI's default body echoes it back) and never a message built
    from it."""
    problems = cast(RequestValidationError, exc).errors()
    issues: list[dict[str, Any]] = []
    for problem in problems:
        issue = _issue(problem)
        if not any(i["field"] == issue["field"] and i["type"] == issue["type"] for i in issues):
            issues.append(issue)
    issues = issues[:MAX_ISSUES]
    body = ErrorBody(
        error="validation_error", message="Invalid request", request_id=get_request_id()
    )
    content = body.model_dump() | {
        "fields": list(dict.fromkeys(i["field"] for i in issues)),
        "issues": issues,
    }
    return JSONResponse(content, status_code=422)


def install_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(AppError, app_error_handler)
