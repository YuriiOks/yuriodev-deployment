"""The Claude Messages API over plain httpx: one streaming call, its events, and what they add up
to. Nothing here knows about the dashboards.

The request shape follows the current API documentation (version header `2026-10-21`): no
`temperature`/`top_p`/`top_k`, no `thinking` field (thinking is on for the model and its blocks are
passed back unchanged), `output_config.effort`, tools with `auto` choice only. The stream is read
as server-sent events: `message_start`, `content_block_start|delta|stop`, `message_delta`,
`message_stop`, `ping` and `error`.
"""

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import httpx
from pydantic import SecretStr

logger = logging.getLogger("yuriodev.assistant")

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2026-10-21"
TIMEOUT = httpx.Timeout(60.0, connect=10.0)
INPUT_FIELDS = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")


class ApiError(Exception):
    """The API refused or failed. `kind` is a short code for the page; the text of an answer is
    never kept (a 400's own message is logged by the caller, never an answer or a question)."""

    def __init__(self, kind: str, status: int | None = None, detail: str | None = None) -> None:
        super().__init__(kind)
        self.kind = kind
        self.status = status
        self.detail = detail


def _kind(status: int) -> str:
    if status in (401, 403):
        return "auth"
    if status == 429:
        return "rate_limited"
    if status == 529 or status >= 500:
        return "overloaded"
    return "invalid_request"


async def stream_events(
    client: httpx.AsyncClient, key: SecretStr, body: dict[str, Any]
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """POST the request and yield `(event name, data)` for each server-sent event."""
    headers = {
        "x-api-key": key.get_secret_value(),
        "anthropic-version": API_VERSION,
        "content-type": "application/json",
    }
    try:
        async with client.stream("POST", API_URL, headers=headers, json=body) as response:
            if response.status_code != 200:
                detail = None
                if response.status_code == 400:  # the parameter the API refused, for the owner
                    detail = _error_text(await response.aread())
                raise ApiError(_kind(response.status_code), response.status_code, detail)
            name = ""
            async for line in response.aiter_lines():
                if line.startswith("event:"):
                    name = line[6:].strip()
                elif line.startswith("data:"):
                    data = json.loads(line[5:])
                    if name == "error" or data.get("type") == "error":
                        raise ApiError("overloaded", None)
                    yield name or str(data.get("type", "")), data
                    name = ""
    except httpx.TimeoutException:
        raise ApiError("timeout") from None
    except httpx.HTTPError:
        raise ApiError("connect") from None
    except ValueError:  # a line that is not JSON
        raise ApiError("bad_stream") from None


def _error_text(raw: bytes) -> str:
    try:
        error = json.loads(raw).get("error", {})
        return f"{error.get('type')}: {str(error.get('message'))[:300]}"
    except ValueError, AttributeError:
        return "unreadable"


class MessageBuilder:
    """Adds the events of one streamed message up to its content blocks, stop reason and usage."""

    def __init__(self) -> None:
        self.blocks: dict[int, dict[str, Any]] = {}
        self._json: dict[int, list[str]] = {}
        self.stop_reason: str | None = None
        self.input_tokens = 0
        self.output_tokens = 0

    def feed(self, name: str, data: dict[str, Any]) -> str | None:
        """Take one event; returns the text it added to the answer, if any."""
        if name == "message_start":
            usage = data.get("message", {}).get("usage", {})
            self.input_tokens = sum(int(usage.get(field) or 0) for field in INPUT_FIELDS)
        elif name == "content_block_start":
            block = dict(data["content_block"])
            index = int(data["index"])
            if block.get("type") == "tool_use":
                block["input"] = {}
                self._json[index] = []
            self.blocks[index] = block
        elif name == "content_block_delta":
            return self._delta(int(data["index"]), data["delta"])
        elif name == "content_block_stop":
            index = int(data["index"])
            if index in self._json:
                text = "".join(self._json[index])
                self.blocks[index]["input"] = json.loads(text) if text else {}
        elif name == "message_delta":
            self.stop_reason = data.get("delta", {}).get("stop_reason", self.stop_reason)
            self.output_tokens = int(data.get("usage", {}).get("output_tokens", self.output_tokens))
        return None

    def _delta(self, index: int, delta: dict[str, Any]) -> str | None:
        block = self.blocks[index]
        kind = delta.get("type")
        if kind == "text_delta":
            block["text"] = block.get("text", "") + delta["text"]
            return str(delta["text"])
        if kind == "input_json_delta":
            self._json[index].append(delta["partial_json"])
        elif kind == "thinking_delta":
            block["thinking"] = block.get("thinking", "") + delta["thinking"]
        elif kind == "signature_delta":
            block["signature"] = delta["signature"]
        return None

    def content(self) -> list[dict[str, Any]]:
        """The blocks in order, exactly as they must go back in the next request (thinking blocks
        included, unchanged)."""
        return [self.blocks[index] for index in sorted(self.blocks)]
