"""Nothing a client sends, and no credential, ever reaches the log (at DEBUG, the loudest level)."""

import json
import logging

import pytest
from mcp import Client
from sqlalchemy.exc import SQLAlchemyError

from src.core.errors import AppError
from src.dashboards import service
from tests.dashboards_support import AUTH, CRED, running

pytestmark = pytest.mark.anyio

BASE = "/api/dashboards/v1"
TITLE = "TITLE-SENTINEL-8841"
NOTES = "NOTES-SENTINEL-5520"
OTHER = "OTHER-SENTINEL-3917"


def everything_logged(caplog, capsys):
    """Every record in every shape it can take: message, extra fields, traceback and the JSON
    line the stdout handler wrote."""
    parts = [caplog.text, capsys.readouterr().out]
    for record in caplog.records:
        parts.append(record.getMessage())
        parts.append(str(vars(record)))
    return "\n".join(parts)


async def test_titles_notes_and_tokens_stay_out_of_the_log(
    db_url, make_dashboards_app, caplog, capsys
):
    caplog.set_level(logging.DEBUG)
    app = make_dashboards_app(db_url, log_level="DEBUG", log_format="json")
    async with running(app, AUTH) as client, Client(app.state.mcp) as mcp:
        created = await client.post(
            f"{BASE}/spaces/personal/tasks", json={"title": TITLE, "notes": NOTES}
        )
        task_id = created.json()["id"]
        await client.patch(f"{BASE}/tasks/{task_id}", json={"title": OTHER, "notes": OTHER})
        await client.get(f"{BASE}/spaces/personal/tasks")
        await client.get(f"{BASE}/summary")
        rejected = await client.post(f"{BASE}/spaces/personal/tasks", json={"title": TITLE * 40})
        bad_area = await client.post(
            f"{BASE}/spaces/personal/tasks", json={"title": TITLE, "area_id": OTHER}
        )
        wrong_token = await client.get(f"{BASE}/summary", headers={"X-Dashboards-Token": OTHER})
        await mcp.call_tool("add_task", {"space": "personal", "title": TITLE, "notes": NOTES})
        await mcp.call_tool("add_task", {"space": "personal", "title": TITLE, "area": OTHER})
        await mcp.call_tool("add_task", {"space": OTHER, "title": TITLE})
        await mcp.call_tool("update_task", {"id": task_id, "title": TITLE * 40})
        await mcp.call_tool("list_tasks", {"space": "personal", "status": OTHER})
        await client.delete(f"{BASE}/tasks/{task_id}")

    assert created.status_code == 201
    assert (rejected.status_code, bad_area.status_code, wrong_token.status_code) == (422, 422, 401)
    logged = everything_logged(caplog, capsys)
    assert "http.request" in logged  # the access lines are there: the check can see logs
    for secret in (TITLE, NOTES, OTHER, CRED):
        assert secret not in logged, secret


async def test_the_access_line_has_ids_and_status_only(db_url, make_dashboards_app, capsys):
    app = make_dashboards_app(db_url, log_format="json")
    async with running(app, AUTH) as client:
        created = await client.post(f"{BASE}/spaces/personal/tasks", json={"title": TITLE})
        capsys.readouterr()
        await client.get(f"{BASE}/spaces/personal/tasks", params={"status": "all"})

    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line]
    (access,) = [line for line in lines if line.get("event") == "http.request"]
    assert created.status_code == 201
    assert access["path"] == f"{BASE}/spaces/personal/tasks"
    assert access["status"] == 200
    assert "status=all" not in json.dumps(access)  # no query string


class BrokenSession:
    def __init__(self, error):
        self.error = error

    async def scalars(self, *args, **kwargs):
        raise self.error


@pytest.mark.parametrize(
    "error",
    [
        SQLAlchemyError(f"statement failed [parameters: ('{TITLE}', '{NOTES}')]"),
        ConnectionRefusedError(f"connect to user {OTHER} failed"),
    ],
)
async def test_a_database_failure_is_503_and_only_its_class_is_logged(error, caplog):
    caplog.set_level(logging.DEBUG)

    with pytest.raises(AppError) as raised:
        await service.list_spaces(BrokenSession(error))

    assert (raised.value.status, raised.value.code) == (503, "dashboards_unavailable")
    assert raised.value.__cause__ is None
    assert raised.value.__suppress_context__ is True
    (record,) = [r for r in caplog.records if getattr(r, "event", "") == "dashboards.db_error"]
    assert record.operation == "list_spaces"
    assert record.error == type(error).__name__
    assert record.exc_info is None
    logged = "\n".join([caplog.text, str(vars(record))])
    for secret in (TITLE, NOTES, OTHER):
        assert secret not in logged


async def test_other_errors_are_not_swallowed():
    with pytest.raises(KeyError):
        await service.list_spaces(BrokenSession(KeyError("a bug")))


async def test_an_unexpected_tool_failure_is_logged_by_class_only(
    db_url, make_dashboards_app, caplog, monkeypatch
):
    async def broken(*args, **kwargs):
        raise RuntimeError(f"a bug that mentions {TITLE}")

    monkeypatch.setattr(service, "list_tasks", broken)
    caplog.set_level(logging.DEBUG)
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), Client(app.state.mcp) as mcp:
        result = await mcp.call_tool("list_tasks", {"space": "personal"})

    assert result.is_error
    assert "Internal error" in result.content[0].text
    (record,) = [r for r in caplog.records if getattr(r, "event", "") == "dashboards.tool_error"]
    assert (record.tool, record.error) == ("list_tasks", "RuntimeError")
    assert TITLE not in "\n".join([caplog.text, result.content[0].text, str(vars(record))])
