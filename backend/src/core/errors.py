"""One JSON error shape, {error, message, request_id}, for every error the app answers itself."""

import re
from collections.abc import Mapping
from http import HTTPStatus
from typing import cast

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from src.core.logging import get_request_id
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
    return error_response(app_exc.status, app_exc.code, app_exc.message)


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


async def validation_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """422 with the names of the failing fields and a fixed sentence per kind of failure. Never
    the input (FastAPI's default body echoes it back) and never a message built from it."""
    problems = cast(RequestValidationError, exc).errors()
    issues: list[dict[str, str]] = []
    for problem in problems:
        kind = str(problem.get("type", ""))
        field = _field(tuple(problem.get("loc", ())))
        reason = _REASONS.get(kind, "Not valid")
        if not any(i["field"] == field and i["type"] == kind for i in issues):
            issues.append({"field": field, "type": kind, "reason": reason})
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
