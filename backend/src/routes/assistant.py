"""The assistant ("Ask Claude"): a question in, a stream of server-sent events out.

Behind the same gate as the rest of the dashboards API (token or trusted proxy, the cross-site
check on writes). `work-2` is refused with 403 `assistant_scope_refused` before anything is built
or sent, and so is a page the settings do not allow or any page without the key. The rules and the
events are in `src/dashboards/assistant/service.py`.
"""

from collections.abc import AsyncIterator
from typing import Literal

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from src.dashboards.assistant.service import Assistant, Event, sse

router = APIRouter(prefix="/api/dashboards/v1/assistant", tags=["assistant"])


class AskIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope: Literal["personal", "work-1", "work-2", "money"]
    question: str = Field(min_length=1, max_length=2000)
    conversation_id: str | None = Field(default=None, max_length=64)


class ConfirmIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=1, max_length=100)
    decision: Literal["approve", "decline"]


async def stream(events: AsyncIterator[Event]) -> StreamingResponse:
    """Start the stream: the first event is fetched here so a refusal (403, 409, 410, 429) is an
    ordinary JSON error answer, not a half-open stream."""
    first = await anext(events)

    async def body() -> AsyncIterator[str]:
        yield sse(*first)
        async for event, data in events:
            yield sse(event, data)

    return StreamingResponse(
        body(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


def assistant_of(request: Request) -> Assistant:
    assistant: Assistant = request.app.state.assistant
    return assistant


@router.post("/ask")
async def ask(body: AskIn, request: Request) -> StreamingResponse:
    """Ask a question on a page. Events: `meta {conversation_id, model}`, `delta {text}`,
    `tool {name, state}`, `confirm {token, action, subject, changes, scope, expires_in}`,
    `error {code}` and `done {stop, usage, remaining}` (stop: end_turn, length, refused, confirm,
    cap, error)."""
    return await stream(assistant_of(request).ask(body.scope, body.question, body.conversation_id))


@router.post("/confirm")
async def confirm(body: ConfirmIn, request: Request) -> StreamingResponse:
    """Approve or decline the change a `confirm` event asked about; the turn then continues as a
    stream. An unknown, expired or used token is 410."""
    return await stream(assistant_of(request).confirm(body.token, body.decision))
