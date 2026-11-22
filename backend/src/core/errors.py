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


async def validation_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    # FastAPI's default body echoes the offending input back; this one never does.
    return error_response(422, "validation_error", "Invalid request")


def install_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(AppError, app_error_handler)
