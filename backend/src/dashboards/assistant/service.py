"""The assistant: a question in, a stream of events out.

One question is a loop of at most `assistant_max_rounds` calls to the Claude API. A call may ask for
tools: a read tool is run at once, a write tool waits for the owner (a `confirm` event; the model's
turn is parked in memory until `confirm()` decides it). Rules:

- the page's scope fixes the tools (`tools.tools_for`); `work-2` has none and is refused before
  anything is built or sent, and a scope the settings do not allow is refused the same way;
- nothing is sent to the API but a fixed system prompt, the owner's question and the scrubbed
  results of the tools; no secret, token or settings value is ever near a prompt;
- no database connection is held while the API is called: every tool opens its own short session;
- per local day there are caps on questions and tokens (`assistant_usage`), checked before each
  call; the key is a `SecretStr` that is never logged;
- nothing but counts is logged: never a question, an answer or a tool result.

Conversations live in memory only (30 minutes idle, 20 at most): a restart forgets them, and with
them any change that was waiting for a confirmation.
"""

import asyncio
import json
import logging
import secrets
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import date, tzinfo
from typing import Any

import httpx
from sqlalchemy.dialects.postgresql import insert

from src.core.config import Settings
from src.core.errors import AppError
from src.dashboards.assistant.claude_api import ApiError, MessageBuilder, stream_events
from src.dashboards.assistant.tools import Ctx, Tool, ToolFailed, render, tools_for
from src.dashboards.models import AssistantUsage
from src.dashboards.runtime import DashboardsRuntime, session_scope

logger = logging.getLogger("yuriodev.assistant")

MAX_OUTPUT_TOKENS = 2048
MAX_QUESTION = 2000
IDLE_SECONDS = 30 * 60
MAX_CONVERSATIONS = 20
CONFIRM_SECONDS = 5 * 60
SCOPES = ("personal", "work-1", "work-2", "money")

type Event = tuple[str, dict[str, Any]]

SYSTEM = """You are the assistant inside the owner's personal dashboard, on the "{scope}" page.
Today is {today} ({zone} time zone). Answer from the owner's own data using the tools you have; \
never state a figure, a date or a name that you did not get from a tool result in this \
conversation. If a tool cannot answer, say so plainly. Be brief and concrete, and reply in the \
language of the question. Amounts from tools are integers in minor units next to a currency code \
(1250 GBP is 12.50 GBP). Tools whose description says the owner confirms first only ask the owner: \
say what you propose, and never claim a change was made until a tool result says it was done. \
Money questions are answered with the owner's own data, never as investment or financial advice."""


@dataclass
class Pending:
    token: str
    block: dict[str, Any]  # the write tool_use block waiting for the owner
    results: dict[str, dict[str, Any]]  # tool_result blocks already made, by tool_use id
    order: list[str]  # the tool_use ids of the model's turn, in order
    expires_at: float


@dataclass
class Conversation:
    id: str
    scope: str
    messages: list[dict[str, Any]] = field(default_factory=list)
    pending: Pending | None = None
    last_used: float = field(default_factory=time.monotonic)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


def refuse_scope(settings: Settings, scope: str) -> None:
    """403 for work-2 always, and for any page the settings do not allow or without a key."""
    if scope not in SCOPES:
        raise AppError(422, "validation_error", "Invalid scope")
    if scope == "work-2" or not settings.assistant_enabled(scope):
        raise AppError(403, "assistant_scope_refused", "The assistant is not available here")


class Assistant:
    def __init__(
        self,
        settings: Settings,
        runtime_of: Any,
        clock: Any,
        zone: tzinfo,
        transport_of: Any,
    ) -> None:
        self._settings = settings
        self._runtime_of = runtime_of
        self._clock = clock
        self._zone = zone
        self._transport_of = transport_of
        self._conversations: dict[str, Conversation] = {}
        self._tokens: dict[str, Conversation] = {}

    # ---- conversations ------------------------------------------------------------------------

    def _purge(self) -> None:
        cutoff = time.monotonic() - IDLE_SECONDS
        for key in [k for k, c in self._conversations.items() if c.last_used < cutoff]:
            self._drop(self._conversations[key])
        while len(self._conversations) > MAX_CONVERSATIONS:
            oldest = min(self._conversations.values(), key=lambda c: c.last_used)
            self._drop(oldest)

    def _drop(self, conversation: Conversation) -> None:
        self._conversations.pop(conversation.id, None)
        if conversation.pending is not None:
            self._tokens.pop(conversation.pending.token, None)

    def _conversation(self, scope: str, conversation_id: str | None) -> Conversation:
        self._purge()
        found = self._conversations.get(conversation_id or "")
        if found is not None and found.scope == scope:
            found.last_used = time.monotonic()
            return found
        fresh = Conversation(id=uuid.uuid4().hex, scope=scope)
        self._conversations[fresh.id] = fresh
        return fresh

    # ---- the day's caps -----------------------------------------------------------------------

    def _day(self) -> date:
        return self._clock().astimezone(self._zone).date()

    async def _usage(self, runtime: DashboardsRuntime) -> AssistantUsage | None:
        async with session_scope(runtime) as session:
            return await session.get(AssistantUsage, self._day())

    async def _add_usage(
        self, runtime: DashboardsRuntime, requests: int, tokens_in: int, tokens_out: int
    ) -> None:
        row = insert(AssistantUsage).values(
            day=self._day(), requests=requests, input_tokens=tokens_in, output_tokens=tokens_out
        )
        async with session_scope(runtime) as session:
            await session.execute(
                row.on_conflict_do_update(
                    index_elements=[AssistantUsage.day],
                    set_={
                        "requests": AssistantUsage.requests + requests,
                        "input_tokens": AssistantUsage.input_tokens + tokens_in,
                        "output_tokens": AssistantUsage.output_tokens + tokens_out,
                    },
                )
            )
            await session.commit()

    async def _remaining(self, runtime: DashboardsRuntime) -> dict[str, int]:
        row = await self._usage(runtime)
        used_requests = 0 if row is None else row.requests
        used_tokens = 0 if row is None else row.input_tokens + row.output_tokens
        return {
            "requests": max(self._settings.assistant_daily_requests - used_requests, 0),
            "tokens": max(self._settings.assistant_daily_tokens - used_tokens, 0),
        }

    # ---- the two entry points -----------------------------------------------------------------

    async def ask(
        self, scope: str, question: str, conversation_id: str | None
    ) -> AsyncIterator[Event]:
        """Stream the answer to a new question. Refuse (`AppError`) before the first event."""
        refuse_scope(self._settings, scope)
        runtime = self._runtime_of()
        if runtime is None:
            raise AppError(503, "dashboards_unavailable", "Dashboards are not ready")
        conversation = self._conversation(scope, conversation_id)
        if conversation.lock.locked() or conversation.pending is not None:
            raise AppError(409, "assistant_busy", "A question or a confirmation is still open")
        async with conversation.lock:
            yield self._meta(conversation)
            left = await self._remaining(runtime)
            if left["requests"] <= 0 or left["tokens"] <= 0:
                yield "done", _done("cap", 0, 0, left)
                return
            await self._add_usage(runtime, 1, 0, 0)
            conversation.messages.append({"role": "user", "content": question})
            async for event in self._drive(conversation, runtime):
                yield event

    async def confirm(self, token: str, decision: str) -> AsyncIterator[Event]:
        """Decide a waiting change and stream the rest of the turn. A token that is unknown,
        expired or already used is 410."""
        conversation = self._tokens.get(token)
        pending = None if conversation is None else conversation.pending
        if conversation is None or pending is None or pending.expires_at < time.monotonic():
            if conversation is not None:
                self._abandon(conversation)
            message = "That confirmation is no longer valid"
            raise AppError(410, "assistant_confirmation_gone", message)
        runtime = self._runtime_of()
        if runtime is None:
            raise AppError(503, "dashboards_unavailable", "Dashboards are not ready")
        if conversation.lock.locked():
            raise AppError(409, "assistant_busy", "A question or a confirmation is still open")
        async with conversation.lock:
            conversation.pending = None
            self._tokens.pop(token, None)
            yield self._meta(conversation)
            ctx = self._ctx(conversation.scope, runtime)
            tool = tools_for(conversation.scope)[pending.block["name"]]
            pending.results[pending.block["id"]] = await self._decide(
                tool, ctx, pending.block, decision == "approve"
            )
            conversation.messages.append(
                {"role": "user", "content": [pending.results[i] for i in pending.order]}
            )
            async for event in self._drive(conversation, runtime):
                yield event

    def _meta(self, conversation: Conversation) -> Event:
        model = self._settings.assistant_model
        return "meta", {"conversation_id": conversation.id, "model": model}

    def _abandon(self, conversation: Conversation) -> None:
        """A confirmation that expired: the turn cannot continue, so the conversation ends."""
        self._drop(conversation)

    # ---- the loop -----------------------------------------------------------------------------

    def _ctx(self, scope: str, runtime: DashboardsRuntime) -> Ctx:
        return Ctx(
            runtime, scope, self._clock(), self._zone, self._settings.finance_display_currency
        )

    def _system(self, scope: str) -> str:
        today = self._clock().astimezone(self._zone).date().isoformat()
        return SYSTEM.format(scope=scope, today=today, zone=str(self._zone))

    async def _drive(
        self, conversation: Conversation, runtime: DashboardsRuntime
    ) -> AsyncIterator[Event]:
        settings = self._settings
        tools = tools_for(conversation.scope)
        ctx = self._ctx(conversation.scope, runtime)
        spent_in = spent_out = 0
        timeout = httpx.Timeout(60.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout, transport=self._transport_of()) as client:
            for _ in range(settings.assistant_max_rounds):
                left = await self._remaining(runtime)
                if left["tokens"] <= 0:
                    yield "done", _done("cap", spent_in, spent_out, left)
                    return
                body = {
                    "model": settings.assistant_model,
                    "max_tokens": MAX_OUTPUT_TOKENS,
                    "stream": True,
                    "system": self._system(conversation.scope),
                    "tools": [tool.definition() for tool in tools.values()],
                    "messages": conversation.messages,
                    "output_config": {"effort": "low"},
                }
                builder = MessageBuilder()
                key = settings.anthropic_api_key
                if key is None:  # refused earlier: a key is part of being enabled
                    raise AppError(403, "assistant_scope_refused", "The assistant is not available")
                try:
                    async for name, data in stream_events(client, key, body):
                        text = builder.feed(name, data)
                        if text:
                            yield "delta", {"text": text}
                except ApiError as exc:
                    if exc.detail:  # a 400 names the parameter it refused: the owner must see it
                        logger.warning(
                            "assistant request refused",
                            extra={"event": "assistant.api_400", "detail": exc.detail},
                        )
                    await self._add_usage(runtime, 0, builder.input_tokens, builder.output_tokens)
                    yield "error", {"code": exc.kind}
                    left = await self._remaining(runtime)
                    yield "done", _done("error", spent_in, spent_out, left)
                    return
                spent_in += builder.input_tokens
                spent_out += builder.output_tokens
                await self._add_usage(runtime, 0, builder.input_tokens, builder.output_tokens)
                conversation.messages.append({"role": "assistant", "content": builder.content()})
                stop = builder.stop_reason
                if stop == "refusal":
                    left = await self._remaining(runtime)
                    yield "done", _done("refused", spent_in, spent_out, left)
                    return
                if stop != "tool_use":
                    left = await self._remaining(runtime)
                    ended = "end_turn" if stop == "end_turn" else "length"
                    yield "done", _done(ended, spent_in, spent_out, left)
                    return
                calls = [b for b in builder.content() if b.get("type") == "tool_use"]
                results: dict[str, dict[str, Any]] = {}
                waiting: dict[str, Any] | None = None
                for block in calls:
                    tool = tools.get(block["name"])
                    if tool is None:
                        results[block["id"]] = _result(block["id"], "Unknown tool", error=True)
                    elif tool.write:
                        if waiting is None:
                            waiting = block
                        else:
                            results[block["id"]] = _result(
                                block["id"], "Not run: one change at a time", error=True
                            )
                    else:
                        yield "tool", {"name": block["name"], "state": "running"}
                        results[block["id"]] = await self._run(tool, ctx, block)
                        yield "tool", {"name": block["name"], "state": "done"}
                if waiting is not None:
                    tool = tools[waiting["name"]]
                    asked = await self._ask_owner(conversation, tool, ctx, waiting, results, calls)
                    if asked is not None:
                        yield "confirm", asked
                        left = await self._remaining(runtime)
                        yield "done", _done("confirm", spent_in, spent_out, left)
                        return
                    results[waiting["id"]] = _result(
                        waiting["id"], "The change was not valid", error=True
                    )
                conversation.messages.append(
                    {"role": "user", "content": [results[c["id"]] for c in calls]}
                )
            left = await self._remaining(runtime)
            yield "done", _done("cap", spent_in, spent_out, left)

    async def _ask_owner(
        self,
        conversation: Conversation,
        tool: Tool,
        ctx: Ctx,
        block: dict[str, Any],
        results: dict[str, dict[str, Any]],
        calls: list[dict[str, Any]],
    ) -> dict[str, Any] | None:
        """Park the turn and describe the change for the owner, or None when it is not valid."""
        if tool.confirm is None:
            return None
        try:
            described = await tool.confirm(ctx, block.get("input") or {})
        except ToolFailed:
            return None
        token = secrets.token_urlsafe(24)
        pending = Pending(
            token=token,
            block=block,
            results=results,
            order=[c["id"] for c in calls],
            expires_at=time.monotonic() + CONFIRM_SECONDS,
        )
        conversation.pending = pending
        self._tokens[token] = conversation
        return {
            "token": token,
            "scope": conversation.scope,
            "expires_in": CONFIRM_SECONDS,
            **described,
        }

    async def _run(self, tool: Tool, ctx: Ctx, block: dict[str, Any]) -> dict[str, Any]:
        try:
            out = await tool.run(ctx, block.get("input") or {})
        except ToolFailed as exc:
            return _result(block["id"], exc.message, error=True)
        except AppError as exc:
            return _result(block["id"], exc.message, error=True)
        except Exception as exc:  # whatever it was, the model is told, nothing is quoted
            logger.warning(
                "assistant tool failed",
                extra={"event": "assistant.tool", "tool": tool.name, "error": type(exc).__name__},
            )
            return _result(block["id"], "The tool failed", error=True)
        return _result(block["id"], render(out))

    async def _decide(
        self, tool: Tool, ctx: Ctx, block: dict[str, Any], approved: bool
    ) -> dict[str, Any]:
        if not approved:
            return _result(block["id"], "The owner declined this change; nothing was done.")
        return await self._run(tool, ctx, block)


def _done(stop: str, tokens_in: int, tokens_out: int, left: dict[str, int]) -> dict[str, Any]:
    usage = {"input_tokens": tokens_in, "output_tokens": tokens_out}
    return {"stop": stop, "usage": usage, "remaining": left}


def _result(tool_use_id: str, content: str, error: bool = False) -> dict[str, Any]:
    block: dict[str, Any] = {"type": "tool_result", "tool_use_id": tool_use_id, "content": content}
    if error:
        block["is_error"] = True
    return block


def sse(event: str, data: dict[str, Any]) -> str:
    """One server-sent event."""
    body = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    return f"event: {event}\ndata: {body}\n\n"


