"""Stdlib logging to stdout: JSON lines by default, a readable console format for local work.

Docker's json-file driver is the only log store; nothing is written to the filesystem.
"""

import json
import logging
import sys
from contextvars import ContextVar, Token
from datetime import UTC, datetime
from typing import Any

from src.core.config import Settings

_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)

# Attributes every LogRecord has; anything else on a record came in through `extra=`.
# uvicorn adds `color_message` (the message with ANSI colour codes): noise in a log line.
_RECORD_ATTRS = frozenset(vars(logging.makeLogRecord({}))) | {
    "message",
    "asctime",
    "taskName",
    "color_message",
}

# Loggers that must stay quiet whatever LOG_LEVEL says (they log full URLs at DEBUG/INFO).
_QUIET_LOGGERS = ("httpx", "httpcore")


def get_request_id() -> str | None:
    """The id of the request being handled in this context, if any."""
    return _request_id.get()


def set_request_id(value: str | None) -> Token[str | None]:
    """Bind a request id to the current context; returns a token for `reset_request_id`."""
    return _request_id.set(value)


def reset_request_id(token: Token[str | None]) -> None:
    _request_id.reset(token)


def _extras(record: logging.LogRecord) -> dict[str, Any]:
    return {
        key: value
        for key, value in vars(record).items()
        if key not in _RECORD_ATTRS and not key.startswith("_")
    }


class JsonFormatter(logging.Formatter):
    """One JSON object per line: timestamp, level, logger, message, request_id, then extras."""

    def format(self, record: logging.LogRecord) -> str:
        timestamp = datetime.fromtimestamp(record.created, tz=UTC)
        out: dict[str, Any] = {
            "timestamp": timestamp.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": get_request_id(),
        }
        for key, value in _extras(record).items():
            out.setdefault(key, value)
        if record.exc_info:
            out["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(out, default=str, ensure_ascii=False)


class ConsoleFormatter(logging.Formatter):
    """Human-readable single lines for a local terminal (LOG_FORMAT=console)."""

    def __init__(self) -> None:
        super().__init__("%(asctime)s %(levelname)-8s %(name)s: %(message)s")

    def format(self, record: logging.LogRecord) -> str:
        line = super().format(record)
        extras = " ".join(f"{key}={value}" for key, value in _extras(record).items())
        request_id = get_request_id()
        if request_id:
            extras = f"request_id={request_id} {extras}".rstrip()
        if not extras:
            return line
        head, sep, rest = line.partition("\n")  # keep a traceback below the fields
        return f"{head} [{extras}]{sep}{rest}"


def configure_logging(settings: Settings) -> None:
    """Route every log record to one stdout handler at LOG_LEVEL. Safe to call repeatedly."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if settings.log_format == "json" else ConsoleFormatter())
    handler.setLevel(settings.log_level)
    handler.set_name("yuriodev")

    root = logging.getLogger()
    for old in [h for h in root.handlers if h.get_name() == "yuriodev"]:
        root.removeHandler(old)
    root.addHandler(handler)
    root.setLevel(settings.log_level)

    # uvicorn installs its own stderr handlers before importing the app: send its server and
    # error logs through ours instead, and silence its access log, which records client IPs.
    for name in ("uvicorn", "uvicorn.error"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True
    access = logging.getLogger("uvicorn.access")
    access.handlers.clear()
    access.propagate = False

    for name in _QUIET_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
