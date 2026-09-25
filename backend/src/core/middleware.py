"""Pure-ASGI request context: request id, one access log line, and a last-resort 500."""

import logging
import re
import time
import uuid

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from src.core.errors import error_response
from src.core.logging import reset_request_id, set_request_id

REQUEST_ID_HEADER = "X-Request-ID"
_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9-]{8,64}$")
_VALID_CF_RAY = re.compile(r"^[A-Za-z0-9-]{1,40}$")
_MAX_PATH_LOGGED = 200

# The container HEALTHCHECK polls this every 30 s; its access lines only show at DEBUG.
_QUIET_PATHS = frozenset({"/health"})

access_logger = logging.getLogger("yuriodev.access")
error_logger = logging.getLogger("yuriodev.error")


def _request_id_from(headers: Headers) -> str:
    incoming = headers.get(REQUEST_ID_HEADER, "")
    return incoming if _VALID_REQUEST_ID.match(incoming) else uuid.uuid4().hex


class RequestContextMiddleware:
    """Tags each HTTP request with an id and logs one line for it.

    - Accepts a well-formed incoming X-Request-ID, otherwise generates one, and echoes it.
    - The access line has method, path, status, duration and request id: no client IP,
      no user agent and no query string.
    - An exception that escapes the app becomes a JSON 500 with the same id; the traceback
      goes to the log, never to the client.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        request_id = _request_id_from(headers)
        token = set_request_id(request_id)
        started = time.perf_counter()
        status = 500
        response_started = False

        async def send_with_id(message: Message) -> None:
            nonlocal status, response_started
            if message["type"] == "http.response.start":
                status = message["status"]
                response_started = True
                MutableHeaders(scope=message)[REQUEST_ID_HEADER] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        except Exception:
            error_logger.exception("unhandled error", extra={"event": "http.error"})
            if response_started:
                raise
            status = 500
            response = error_response(500, "internal_error", "Internal error", request_id)
            await response(scope, receive, send_with_id)
        finally:
            self._log(scope, headers, status, started)
            reset_request_id(token)

    @staticmethod
    def _log(scope: Scope, headers: Headers, status: int, started: float) -> None:
        path = str(scope.get("path", ""))[:_MAX_PATH_LOGGED]
        if status >= 500:
            level = logging.ERROR
        elif path in _QUIET_PATHS:
            level = logging.DEBUG
        else:
            level = logging.INFO
        fields: dict[str, object] = {
            "event": "http.request",
            "method": scope.get("method"),
            "path": path,
            "status": status,
            "duration_ms": round((time.perf_counter() - started) * 1000, 1),
        }
        cf_ray = headers.get("cf-ray", "")
        if _VALID_CF_RAY.match(cf_ray):
            fields["cf_ray"] = cf_ray
        access_logger.log(level, "%s %s %s", fields["method"], path, status, extra=fields)
