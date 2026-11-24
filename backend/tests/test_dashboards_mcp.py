"""The MCP endpoint: every tool through the SDK's in-process client, and POST /api/mcp over HTTP."""

import json
from datetime import timedelta

import pytest
from mcp import Client

from tests.dashboards_support import AUTH, running

pytestmark = pytest.mark.anyio

BASE = "/api/dashboards/v1"
MCP_HEADERS = {"Accept": "application/json, text/event-stream", **AUTH}
TOOLS = {
    "list_tasks",
    "add_task",
    "update_task",
    "complete_task",
    "reopen_task",
    "delete_task",
    "today",
    "list_events",
    "add_event",
    "delete_event",
    "list_projects",
    "add_project",
    "finance_accounts",
    "finance_balances",
    "finance_transactions",
    "finance_categories",
    "finance_set_category",
    "finance_set_overdraft",
    "finance_recurring",
    "finance_add_recurring",
    "finance_update_recurring",
    "finance_upcoming",
    "finance_attention",
}


async def call(mcp, tool, **arguments):
    result = await mcp.call_tool(tool, arguments)
    return result.is_error, result.content[0].text


async def ok(mcp, tool, **arguments):
    failed, text = await call(mcp, tool, **arguments)
    assert not failed, text
    return json.loads(text)


async def test_the_server_offers_exactly_the_contract_tools(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), Client(app.state.mcp) as mcp:
        listed = await mcp.list_tools()

    assert {tool.name for tool in listed.tools} == TOOLS
    by_name = {tool.name: tool for tool in listed.tools}
    assert set(by_name["add_task"].input_schema["required"]) == {"space", "title"}
    assert set(by_name["list_events"].input_schema["required"]) == {"from_date", "to_date"}


async def test_tasks_added_over_mcp_carry_source_mcp_and_show_up_in_rest(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client, Client(app.state.mcp) as mcp:
        added = await ok(
            mcp,
            "add_task",
            space="personal",
            title="Book the flight",
            notes="window seat",
            area="travel",
            priority=True,
            due_date="2026-12-24",
        )
        listed = await ok(mcp, "list_tasks", space="personal")
        via_rest = (await client.get(f"{BASE}/spaces/personal/tasks")).json()["tasks"]

    assert added["source"] == "mcp"
    assert added["area_id"] == "travel"
    assert added["priority"] is True
    assert added["due_date"] == "2026-12-24"
    assert listed == {"space": "personal", "tasks": [added]}
    assert via_rest == [added]


async def test_update_complete_reopen_and_delete(db_url, make_dashboards_app, clock):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), Client(app.state.mcp) as mcp:
        task = await ok(mcp, "add_task", space="personal", title="Old", notes="n", area="money")
        clock.now += timedelta(hours=2)
        changed = await ok(mcp, "update_task", id=task["id"], title="New", priority=True)
        cleared = await ok(mcp, "update_task", id=task["id"], notes="", area="", due_date="")
        dated = await ok(mcp, "update_task", id=task["id"], due_date="2026-12-01")
        done = await ok(mcp, "complete_task", id=task["id"])
        reopened = await ok(mcp, "reopen_task", id=task["id"])
        by_status = await ok(mcp, "update_task", id=task["id"], status="done")
        deleted = await ok(mcp, "delete_task", id=task["id"])
        after = await ok(mcp, "list_tasks", space="personal", status="all")

    assert (changed["title"], changed["priority"], changed["notes"]) == ("New", True, "n")
    assert changed["updated_at"] == "2026-11-22T14:00:00Z"
    assert (cleared["notes"], cleared["area_id"], cleared["due_date"]) == (None, None, None)
    assert dated["due_date"] == "2026-12-01"
    assert (done["status"], done["done_at"]) == ("done", "2026-11-22T14:00:00Z")
    assert (reopened["status"], reopened["done_at"]) == ("open", None)
    assert by_status["status"] == "done"
    assert deleted == {"deleted": task["id"]}
    assert after["tasks"] == []


async def test_tool_errors_are_fixed_sentences(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    missing = "00000000-0000-4000-8000-000000000000"
    async with running(app, AUTH), Client(app.state.mcp) as mcp:
        task = await ok(mcp, "add_task", space="personal", title="Exists")
        results = {
            "space": await call(mcp, "list_tasks", space="nowhere"),
            "add space": await call(mcp, "add_task", space="nowhere", title="x"),
            "title": await call(mcp, "add_task", space="personal", title=""),
            "long title": await call(mcp, "add_task", space="personal", title="x" * 301),
            "due": await call(mcp, "add_task", space="personal", title="x", due_date="soon"),
            "area": await call(mcp, "add_task", space="personal", title="x", area="nope"),
            "task": await call(mcp, "update_task", id=missing, title="x"),
            "bad id": await call(mcp, "complete_task", id="not-a-uuid"),
            "nothing": await call(mcp, "update_task", id=task["id"]),
            "status": await call(mcp, "update_task", id=task["id"], status="late"),
            "delete": await call(mcp, "delete_task", id=missing),
        }

    assert all(failed for failed, _ in results.values())
    assert "Space or project not found" in results["space"][1]
    assert "Space or project not found" in results["add space"][1]
    for name in ("title", "long title", "due", "nothing"):
        assert "Invalid arguments" in results[name][1], name
    assert "Unknown area for this space" in results["area"][1]
    assert "Task not found" in results["task"][1]
    assert "Task not found" in results["bad id"][1]
    assert "Task not found" in results["delete"][1]
    assert results["status"][0] is True


async def test_today_lists_priority_and_due_tasks_and_todays_events_per_space(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client, Client(app.state.mcp) as mcp:
        for title, fields in (
            ("urgent", {"priority": True}),
            ("late", {"due_date": "2026-11-20"}),
            ("today", {"due_date": "2026-11-22"}),
            ("future", {"due_date": "2026-12-01"}),
            ("someday", {}),
        ):
            await client.post(f"{BASE}/spaces/personal/tasks", json={"title": title, **fields})
        finished = await client.post(
            f"{BASE}/spaces/personal/tasks", json={"title": "finished", "priority": True}
        )
        await client.patch(f"{BASE}/tasks/{finished.json()['id']}", json={"status": "done"})
        await client.post(f"{BASE}/spaces/work-1/tasks", json={"title": "w1", "priority": True})
        standup = {"title": "standup", "starts_at": "2026-11-22T15:00:00Z"}
        standup["ends_at"] = "2026-11-22T15:30:00Z"
        tomorrow = {"title": "tomorrow", "starts_at": "2026-11-23T15:00:00Z"}
        tomorrow["ends_at"] = "2026-11-23T16:00:00Z"
        await client.post(f"{BASE}/spaces/work-1/events", json=standup)
        await client.post(f"{BASE}/spaces/personal/events", json=tomorrow)
        everything = await ok(mcp, "today")
        only_work = await ok(mcp, "today", space="work-1")
        failed, text = await call(mcp, "today", space="nowhere")

    assert everything["date"] == "2026-11-22"
    names = [group["space"] for group in everything["spaces"]]
    assert names == ["personal", "work-1", "work-2"]
    personal, work_1, work_2 = everything["spaces"]
    assert [t["title"] for t in personal["tasks"]] == ["urgent", "late", "today"]
    assert personal["events"] == []
    assert [t["title"] for t in work_1["tasks"]] == ["w1"]
    assert [e["title"] for e in work_1["events"]] == ["standup"]
    assert work_2 == {"space": "work-2", "tasks": [], "events": []}
    assert [group["space"] for group in only_work["spaces"]] == ["work-1"]
    assert failed
    assert "Space or project not found" in text


async def test_events_over_mcp(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), Client(app.state.mcp) as mcp:
        event = await ok(
            mcp,
            "add_event",
            space="work-2",
            title="Review",
            starts_at="2026-11-24T10:00:00+01:00",
            ends_at="2026-11-24T11:00:00+01:00",
            busy_only=True,
        )
        listed = await ok(mcp, "list_events", from_date="2026-11-24", to_date="2026-11-24")
        empty = await ok(mcp, "list_events", from_date="2026-11-25", to_date="2026-11-26")
        naive = await call(
            mcp,
            "add_event",
            space="work-2",
            title="x",
            starts_at="2026-11-24T10:00:00",
            ends_at="2026-11-24T11:00:00",
        )
        backwards = await call(mcp, "list_events", from_date="2026-11-26", to_date="2026-11-24")
        too_long = await call(mcp, "list_events", from_date="2026-01-01", to_date="2026-12-31")
        deleted = await ok(mcp, "delete_event", id=event["id"])
        gone = await call(mcp, "delete_event", id=event["id"])

    assert event["source"] == "mcp"
    assert event["busy_only"] is True
    assert event["starts_at"] == "2026-11-24T09:00:00Z"
    assert listed == {"events": [event]}
    assert empty == {"events": []}
    assert naive[0] is True
    assert "Invalid arguments" in naive[1]
    assert backwards[0] is True
    assert too_long[0] is True
    assert deleted == {"deleted": event["id"]}
    assert gone[0] is True
    assert "Event not found" in gone[1]


async def rpc(client, method, params=None, headers=MCP_HEADERS):
    body = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}
    return await client.post("/api/mcp", json=body, headers=headers)


async def test_the_endpoint_answers_json_rpc_over_http(db_url, make_dashboards_app):
    init = {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "test", "version": "1"},
    }
    async with running(make_dashboards_app(db_url)) as client:
        initialised = await rpc(client, "initialize", init)
        added = await rpc(
            client,
            "tools/call",
            {"name": "add_task", "arguments": {"space": "work-2", "title": "Via HTTP"}},
        )
        listed = await client.get(f"{BASE}/spaces/work-2/tasks", headers=AUTH)
        anonymous = {"Accept": MCP_HEADERS["Accept"]}
        unauthenticated = await rpc(client, "tools/list", headers=anonymous)
        streamed = await client.get("/api/mcp", headers=MCP_HEADERS)

    assert initialised.status_code == 200
    assert initialised.headers["content-type"].startswith("application/json")
    assert initialised.json()["result"]["serverInfo"]["name"] == "yuriodev-dashboards"
    assert initialised.headers["cache-control"] == "no-store"
    assert added.status_code == 200
    task = json.loads(added.json()["result"]["content"][0]["text"])
    assert task["title"] == "Via HTTP"
    assert task["source"] == "mcp"
    assert listed.json()["tasks"] == [task]
    assert unauthenticated.status_code == 401
    assert unauthenticated.json()["error"] == "unauthorized"
    assert streamed.status_code == 405
    assert streamed.json()["error"] == "method_not_allowed"
