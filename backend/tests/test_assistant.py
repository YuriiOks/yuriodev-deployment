"""The assistant: a faked Messages API with the real wire shape (server-sent events), the tool
loop, confirmations, scopes and caps. Everything is invented; nothing leaves the test."""

import json
import logging
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from src.dashboards.assistant.claude_api import MessageBuilder
from src.dashboards.assistant.tools import Ctx, render, scrub, tools_for
from src.dashboards.models import Task
from tests.dashboards_support import AUTH, execute, running, scalar
from tests.finance_support import seed

pytestmark = pytest.mark.anyio

BASE = "/api/dashboards/v1"
KEY = "sk-ant-test-0000000000000000000000"
ALL = {"anthropic_api_key": KEY, "assistant_scopes": "personal,work-1,money,work-2"}
NOW = datetime(2026, 11, 22, 12, 0, tzinfo=UTC)


def sse_message(blocks, stop="end_turn", tokens=(100, 20)):
    """The bytes of a streamed message: `blocks` are ("text", str), ("thinking", signature) or
    ("tool", id, name, input)."""
    lines = []

    def event(name, data):
        lines.append(f"event: {name}\ndata: {json.dumps({'type': name, **data})}\n")

    message = {"id": "msg_1", "type": "message", "role": "assistant", "content": []}
    event("message_start", {"message": {**message, "usage": {"input_tokens": tokens[0]}}})
    for index, block in enumerate(blocks):
        kind = block[0]
        if kind == "text":
            start = {"type": "text", "text": ""}
            deltas = [{"type": "text_delta", "text": part} for part in (block[1][:5], block[1][5:])]
        elif kind == "thinking":
            start = {"type": "thinking", "thinking": "", "signature": ""}
            deltas = [{"type": "signature_delta", "signature": block[1]}]
        else:
            start = {"type": "tool_use", "id": block[1], "name": block[2], "input": {}}
            text = json.dumps(block[3])
            deltas = [{"type": "input_json_delta", "partial_json": text[:4]}]
            deltas.append({"type": "input_json_delta", "partial_json": text[4:]})
        event("content_block_start", {"index": index, "content_block": start})
        for delta in deltas:
            event("content_block_delta", {"index": index, "delta": delta})
        event("content_block_stop", {"index": index})
    event(
        "message_delta",
        {"delta": {"stop_reason": stop}, "usage": {"output_tokens": tokens[1]}},
    )
    event("message_stop", {})
    lines.append('event: ping\ndata: {"type": "ping"}\n')
    return "\n".join(lines).encode()


class FakeApi:
    """The Messages API: answers each call with the next prepared answer and keeps the requests."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.requests = []

    def __call__(self, request):
        body = json.loads(request.content)
        self.requests.append({"headers": dict(request.headers), "body": body})
        status, body = 200, self.answers.pop(0)
        if isinstance(body, tuple):
            status, body = body
        return httpx.Response(status, content=body, headers={"content-type": "text/event-stream"})


def events_of(response):
    found = []
    for chunk in response.text.strip().split("\n\n"):
        name, data = chunk.split("\n", 1)
        found.append((name.removeprefix("event: "), json.loads(data.removeprefix("data: "))))
    return found


def names(events):
    return [name for name, _ in events]


def make_app(make_dashboards_app, db_url, api, clock, **extra):
    clock.now = NOW
    app = make_dashboards_app(db_url, **{**ALL, **extra})
    app.state.assistant_transport = httpx.MockTransport(api)
    return app


async def ask(client, scope, question="What is on?", conversation_id=None):
    body = {"scope": scope, "question": question}
    if conversation_id:
        body["conversation_id"] = conversation_id
    return await client.post(f"{BASE}/assistant/ask", json=body)


def task(title, space="personal", **extra):
    return Task(
        id=uuid.uuid4(),
        space_id=space,
        title=title,
        status="open",
        priority=False,
        draft=False,
        source="web",
        created_at=NOW - timedelta(days=2),
        **extra,
    )


async def add(app, *rows):
    async with app.state.dashboards.sessions() as session, session.begin():
        session.add_all(rows)


async def test_a_plain_answer_streams_and_the_request_has_the_documented_shape(
    db_url, make_dashboards_app, clock
):
    api = FakeApi(sse_message([("text", "Nothing is due.")], tokens=(120, 8)))
    app = make_app(make_dashboards_app, db_url, api, clock)
    async with running(app, AUTH) as client:
        response = await ask(client, "personal", "What is due?")

    events = events_of(response)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert names(events) == ["meta", "delta", "delta", "done"]
    assert "".join(d["text"] for n, d in events if n == "delta") == "Nothing is due."
    done = events[-1][1]
    assert (done["stop"], done["usage"]) == ("end_turn", {"input_tokens": 120, "output_tokens": 8})
    assert done["remaining"] == {"requests": 29, "tokens": 400_000 - 128}
    (call,) = api.requests
    body = call["body"]
    assert call["headers"]["x-api-key"] == KEY
    assert call["headers"]["anthropic-version"] == "2026-10-21"
    assert (body["model"], body["stream"], body["max_tokens"]) == ("claude-opus-5-5", True, 2048)
    assert body["output_config"] == {"effort": "low"}
    assert not {"temperature", "top_p", "top_k", "thinking", "tool_choice"} & set(body)
    assert "personal" in body["system"]
    assert "2026-11-22" in body["system"]
    assert "financial advice" in body["system"]
    assert "did not get from a tool result" in body["system"]
    assert body["messages"] == [{"role": "user", "content": "What is due?"}]
    assert [t["name"] for t in body["tools"]] == [
        "today",
        "list_tasks",
        "list_events",
        "add_task",
        "update_task",
        "complete_task",
        "reopen_task",
        "add_event",
    ]


async def test_a_read_tool_runs_at_once_and_thinking_blocks_go_back_unchanged(
    db_url, make_dashboards_app, clock
):
    api = FakeApi(
        sse_message(
            [("thinking", "sig-abc"), ("tool", "toolu_1", "list_tasks", {"status": "open"})],
            stop="tool_use",
        ),
        sse_message([("text", "You have one task: Pay rent.")]),
    )
    app = make_app(make_dashboards_app, db_url, api, clock)
    async with running(app, AUTH) as client:
        await add(
            app,
            task("Pay rent"),
            task("Work secret thing", "work-1"),
            task("Other", "work-2"),
        )
        response = await ask(client, "personal")

    events = events_of(response)
    assert names(events).count("tool") == 2
    assert events[-1][1]["stop"] == "end_turn"
    first, second = (r["body"] for r in api.requests)
    assert len(second["messages"]) == 3
    assistant, results = second["messages"][1], second["messages"][2]
    assert assistant["role"] == "assistant"
    assert assistant["content"][0] == {"type": "thinking", "thinking": "", "signature": "sig-abc"}
    assert assistant["content"][1]["input"] == {"status": "open"}
    (result,) = results["content"]
    assert result["tool_use_id"] == "toolu_1"
    assert "Pay rent" in result["content"]
    assert "Work secret thing" not in result["content"]  # another page's data is not here
    assert "Other" not in result["content"]
    assert first["tools"] == second["tools"]


async def test_a_write_waits_for_the_owner_and_then_runs_or_not(db_url, make_dashboards_app, clock):
    wanted = {"title": "Call the dentist", "due_date": "2026-11-25"}
    add_call = ("tool", "toolu_1", "add_task", wanted)
    api = FakeApi(
        sse_message([add_call], stop="tool_use"),
        sse_message([("text", "Done, it is on your list.")]),
        sse_message([add_call], stop="tool_use"),
        sse_message([("text", "Alright, I left it.")]),
    )
    app = make_app(make_dashboards_app, db_url, api, clock)
    async with running(app, AUTH) as client:
        first = events_of(await ask(client, "personal", "Add a task to call the dentist"))
        before = await scalar(db_url, "SELECT count(*) FROM task")
        asked = next(d for n, d in first if n == "confirm")
        approved = events_of(
            await client.post(
                f"{BASE}/assistant/confirm", json={"token": asked["token"], "decision": "approve"}
            )
        )
        after = await scalar(db_url, "SELECT count(*) FROM task")
        source = await scalar(db_url, "SELECT source FROM task")
        reused = await client.post(
            f"{BASE}/assistant/confirm", json={"token": asked["token"], "decision": "approve"}
        )
        second = events_of(await ask(client, "personal", "Again", first[0][1]["conversation_id"]))
        declined_token = next(d for n, d in second if n == "confirm")["token"]
        declined = events_of(
            await client.post(
                f"{BASE}/assistant/confirm", json={"token": declined_token, "decision": "decline"}
            )
        )
        final = await scalar(db_url, "SELECT count(*) FROM task")

    assert first[-1][1]["stop"] == "confirm"
    assert (asked["action"], asked["scope"], asked["expires_in"]) == ("add_task", "personal", 300)
    assert asked["subject"] == {"type": "task", "id": None, "name": "Call the dentist"}
    assert asked["changes"]["due_date"] == "2026-11-25"
    assert before == 0  # nothing was created before the owner agreed
    assert (after, source) == (1, "mcp")
    assert approved[-1][1]["stop"] == "end_turn"
    assert reused.status_code == 410
    assert reused.json()["error"] == "assistant_confirmation_gone"
    assert declined[-1][1]["stop"] == "end_turn"
    assert final == 1  # declined: still one
    approved_result = api.requests[1]["body"]["messages"][-1]["content"][0]["content"]
    declined_result = api.requests[3]["body"]["messages"][-1]["content"][0]["content"]
    assert '"title":"Call the dentist"' in approved_result
    assert "declined" in declined_result


async def test_an_event_is_confirmed_with_exactly_what_will_be_stored(
    db_url, make_dashboards_app, clock
):
    wanted = {
        "title": "Dentist",
        "starts_at": "2026-11-20T09:30:00+01:00",
        "ends_at": "2026-11-20T10:15:00+01:00",
    }
    call = ("tool", "toolu_1", "add_event", wanted)
    api = FakeApi(sse_message([call], stop="tool_use"))
    app = make_app(make_dashboards_app, db_url, api, clock)
    async with running(app, AUTH) as client:
        events = events_of(await ask(client, "work-1", "Book the dentist"))

    changes = next(d for n, d in events if n == "confirm")["changes"]
    assert changes == {
        "title": "Dentist",
        "starts_at": "2026-11-20T08:30:00+00:00",
        "ends_at": "2026-11-20T09:15:00+00:00",
        "local_date": "2026-11-20",
        "local_start": "08:30",
        "local_end": "09:15",
        "local_end_date": "2026-11-20",
        "in_the_past": True,  # two days before the test's today
    }


async def test_work_2_is_refused_whatever_the_settings_say_and_nothing_is_sent(
    db_url, make_dashboards_app, clock
):
    api = FakeApi()
    app = make_app(make_dashboards_app, db_url, api, clock)
    async with running(app, AUTH) as client:
        refused = await ask(client, "work-2", "What are my work-2 tasks?")
        today = (await client.get(f"{BASE}/today?scope=work-2")).json()

    assert (refused.status_code, refused.json()["error"]) == (403, "assistant_scope_refused")
    assert api.requests == []
    assert today["assistant"] == {"enabled": False}
    assert tools_for("work-2") == {}


async def test_a_page_the_settings_do_not_allow_and_a_missing_key_are_refused(
    db_url, make_dashboards_app, clock
):
    api = FakeApi()
    default_scopes = make_app(
        make_dashboards_app, db_url, api, clock, assistant_scopes="personal,money"
    )
    async with running(default_scopes, AUTH) as client:
        work_1 = await ask(client, "work-1")
        personal = (await client.get(f"{BASE}/today?scope=personal")).json()
        work = (await client.get(f"{BASE}/today?scope=work-1")).json()
    keyless = make_dashboards_app(db_url, assistant_scopes="personal")
    async with running(keyless, AUTH) as client:
        nokey = await ask(client, "personal")
        flag = (await client.get(f"{BASE}/today?scope=personal")).json()

    assert work_1.status_code == 403
    assert (personal["assistant"], work["assistant"]) == ({"enabled": True}, {"enabled": False})
    assert (nokey.status_code, flag["assistant"]) == (403, {"enabled": False})
    assert api.requests == []


async def test_a_tool_cannot_reach_another_pages_task(db_url, make_dashboards_app, clock):
    other = task("Hidden", "work-1")
    api = FakeApi(
        sse_message([("tool", "toolu_1", "complete_task", {"id": str(other.id)})], stop="tool_use"),
        sse_message([("text", "I cannot find it.")]),
    )
    app = make_app(make_dashboards_app, db_url, api, clock)
    async with running(app, AUTH) as client:
        await add(app, other)
        events = events_of(await ask(client, "personal", "Complete the hidden one"))
        status = await scalar(db_url, "SELECT status FROM task")

    assert "confirm" not in names(events)  # not a valid change here: no confirmation is offered
    assert status == "open"
    result = api.requests[1]["body"]["messages"][-1]["content"][0]
    assert result["is_error"] is True


async def test_the_daily_caps_stop_the_call_before_it_is_made(db_url, make_dashboards_app, clock):
    api = FakeApi(sse_message([("text", "One.")], tokens=(60, 40)))
    app = make_app(
        make_dashboards_app,
        db_url,
        api,
        clock,
        assistant_daily_requests=1,
        assistant_daily_tokens=1000,
    )
    async with running(app, AUTH) as client:
        first = events_of(await ask(client, "personal"))
        second = events_of(await ask(client, "personal"))
        await execute(db_url, "UPDATE assistant_usage SET requests = 0, input_tokens = 990")
        third = events_of(await ask(client, "personal"))

    assert first[-1][1]["stop"] == "end_turn"
    assert second[-1][1]["stop"] == "cap"
    assert second[-1][1]["remaining"]["requests"] == 0
    assert third[-1][1]["stop"] == "cap"
    assert len(api.requests) == 1  # the capped questions made no call


async def test_a_refusal_ends_the_turn_and_an_api_error_is_a_code(
    db_url, make_dashboards_app, clock, caplog
):
    refusal = {
        "type": "error",
        "error": {"type": "invalid_request_error", "message": "temperature: not allowed"},
    }
    api = FakeApi(
        sse_message([], stop="refusal"),
        (400, json.dumps(refusal).encode()),
        (529, b"{}"),
    )
    app = make_app(make_dashboards_app, db_url, api, clock)
    caplog.set_level(logging.DEBUG)
    async with running(app, AUTH) as client:
        refused = events_of(await ask(client, "personal", "SENTINEL-QUESTION"))
        bad = events_of(await ask(client, "personal", "SENTINEL-QUESTION"))
        busy = events_of(await ask(client, "personal", "SENTINEL-QUESTION"))

    assert refused[-1][1]["stop"] == "refused"
    assert ("error", {"code": "invalid_request"}) in bad
    assert ("error", {"code": "overloaded"}) in busy
    logged = " ".join(r.getMessage() + str(r.__dict__) for r in caplog.records)
    assert "invalid_request_error: temperature: not allowed" in logged  # the exact refusal
    assert "SENTINEL-QUESTION" not in logged
    assert KEY not in logged


async def test_no_question_answer_or_result_is_logged(db_url, make_dashboards_app, clock, caplog):
    api = FakeApi(
        sse_message([("tool", "toolu_1", "list_tasks", {})], stop="tool_use"),
        sse_message([("text", "SENTINEL-ANSWER is here")]),
    )
    app = make_app(make_dashboards_app, db_url, api, clock)
    caplog.set_level(logging.DEBUG)
    async with running(app, AUTH) as client:
        await add(app, task("SENTINEL-TITLE"))
        await ask(client, "personal", "SENTINEL-QUESTION")

    logged = " ".join(r.getMessage() + str(r.__dict__) for r in caplog.records)
    for sentinel in ("SENTINEL-QUESTION", "SENTINEL-ANSWER", "SENTINEL-TITLE", KEY):
        assert sentinel not in logged


async def test_a_conversation_waiting_for_a_confirmation_is_busy_and_an_old_token_is_gone(
    db_url, make_dashboards_app, clock
):
    call = ("tool", "toolu_1", "add_task", {"title": "X"})
    api = FakeApi(sse_message([call], stop="tool_use"))
    app = make_app(make_dashboards_app, db_url, api, clock)
    async with running(app, AUTH) as client:
        first = events_of(await ask(client, "personal"))
        conversation = first[0][1]["conversation_id"]
        busy = await ask(client, "personal", "More", conversation)
        token = next(d for n, d in first if n == "confirm")["token"]
        app.state.assistant._tokens[token].pending.expires_at = 0.0
        gone = await client.post(
            f"{BASE}/assistant/confirm", json={"token": token, "decision": "approve"}
        )
        unknown = await client.post(
            f"{BASE}/assistant/confirm", json={"token": "nope", "decision": "approve"}
        )

    assert (busy.status_code, busy.json()["error"]) == (409, "assistant_busy")
    assert (gone.status_code, unknown.status_code) == (410, 410)


async def test_the_money_page_has_the_finance_tools_and_no_task_tools(
    db_url, make_dashboards_app, clock
):
    api = FakeApi(
        sse_message([("tool", "toolu_1", "finance_balances", {})], stop="tool_use"),
        sse_message([("text", "Done.")]),
    )
    app = make_app(make_dashboards_app, db_url, api, clock)
    async with running(app, AUTH) as client:
        await seed(app)
        events = events_of(await ask(client, "money", "What do I have?"))

    sent = {t["name"] for t in api.requests[0]["body"]["tools"]}
    assert "finance_accounts" in sent
    assert "set_category" in sent
    assert not sent & {"add_task", "list_tasks", "add_event"}
    assert events[-1][1]["stop"] == "end_turn"
    result = api.requests[1]["body"]["messages"][-1]["content"][0]["content"]
    assert '"currencies"' in result


def test_tool_results_are_scrubbed_and_capped():
    data = {
        "name": "Main",
        "mask_last4": "1234",
        "api_token": "SECRET-1",
        "Authorization": "SECRET-2",
        "iban": "GB00SECRET3",
        "nested": [{"password": "SECRET-4", "ok": 1}],
    }

    text = render(data)

    assert "SECRET" not in text
    assert json.loads(text) == {"name": "Main", "mask_last4": "1234", "nested": [{"ok": 1}]}
    assert scrub({"a": 1}) == {"a": 1}
    assert render({"x": "y" * 50_000}).endswith("[truncated]")


def test_the_message_builder_adds_events_up_to_blocks_usage_and_a_stop_reason():
    builder = MessageBuilder()
    stream = sse_message(
        [("thinking", "sig"), ("text", "Hello world"), ("tool", "t1", "today", {"a": 1})],
        stop="tool_use",
        tokens=(7, 3),
    ).decode()
    for chunk in stream.strip().split("\n\n"):
        name, data = chunk.split("\n", 1)
        builder.feed(name.removeprefix("event: "), json.loads(data.removeprefix("data: ")))

    assert builder.stop_reason == "tool_use"
    assert (builder.input_tokens, builder.output_tokens) == (7, 3)
    kinds = [b["type"] for b in builder.content()]
    assert kinds == ["thinking", "text", "tool_use"]
    assert builder.content()[1]["text"] == "Hello world"
    assert builder.content()[2]["input"] == {"a": 1}


async def test_every_read_tool_answers_with_json_on_its_own_page(
    db_url, make_dashboards_app, clock
):
    app = make_app(make_dashboards_app, db_url, FakeApi(), clock)
    async with running(app, AUTH):
        await seed(app)
        for scope in ("personal", "work-1", "money"):
            ctx = Ctx(app.state.dashboards, scope, NOW, app.state.zone, "GBP")
            for tool in tools_for(scope).values():
                if not tool.write:
                    args = {"from_date": "2026-11-22", "to_date": "2026-11-23"}
                    out = await tool.run(ctx, args if tool.name == "list_events" else {})
                    assert json.loads(render(out)) is not None, tool.name
