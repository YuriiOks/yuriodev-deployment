"""Projects: a Postgres schema each, the registry, the task endpoints and the MCP tools."""

import asyncio
import json
import logging
from datetime import timedelta
from urllib.parse import quote

import pytest
from mcp import Client
from sqlalchemy import text

from src.core.errors import AppError
from src.dashboards import projects
from src.dashboards.projects import PROJECT_STEPS, schema_name, slugify, upgrade_projects, valid_id
from tests.dashboards_support import AUTH, UNREACHABLE_URL, execute, running, scalar

pytestmark = pytest.mark.anyio

BASE = "/api/dashboards/v1"
TASK_KEYS = {
    "id",
    "project_id",
    "title",
    "notes",
    "area_id",
    "priority",
    "due_date",
    "status",
    "done_at",
    "source",
    "url",
    "stage",
    "created_at",
    "updated_at",
}
NO_TASK = "00000000-0000-4000-8000-000000000000"
HOSTILE = [
    'x"; drop schema public cascade; --',
    "../x",
    "..%2Fx",
    "project_garden",
    "Garden",
    "a b",
    "%",
    "a;b",
    "дело",
    "-garden",
    "g" * 40,
    "personal",
    "work-1",
    "calendar",
]


async def make_project(client, name="Garden"):
    response = await client.post(f"{BASE}/projects", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


async def task_in(client, project="garden", **body):
    body.setdefault("title", "a task")
    response = await client.post(f"{BASE}/projects/{project}/tasks", json=body)
    assert response.status_code == 201, response.text
    return response.json()


async def titles(client, project="garden", status=None):
    params = {} if status is None else {"status": status}
    response = await client.get(f"{BASE}/projects/{project}/tasks", params=params)
    assert response.status_code == 200, response.text
    return [task["title"] for task in response.json()["tasks"]]


async def schemas(url):
    """The project schemas and `public`, by name."""
    return await scalar(
        url,
        "SELECT array_agg(nspname ORDER BY nspname) FROM pg_namespace "
        "WHERE nspname = 'public' OR nspname LIKE 'project\\_%'",
    )


def error_of(response):
    body = response.json()
    assert set(body) == {"error", "message", "request_id"}
    return body["error"]


# pure functions -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "slug"),
    [
        ("Garden", "garden"),
        ("Side project", "side-project"),
        ("  Mixed   CASE__name!!  ", "mixed-case-name"),
        ("Café 22", "cafe-22"),
        ("дело", "delo"),
        ("Щука и ёж", "schuka-i-ezh"),
        ("!!!", ""),
        ("", ""),
        ("-" * 5 + "a", "a"),
    ],
)
def test_a_name_becomes_an_id(name, slug):
    assert slugify(name) == slug


def test_a_long_name_is_cut_without_a_dangling_hyphen():
    slug = slugify("word " * 20)

    assert len(slug) <= 31
    assert not slug.endswith("-")
    assert valid_id(slug)


@pytest.mark.parametrize("good", ["garden", "side-project", "a", "0x", "a" * 31, "a-b-c"])
def test_valid_ids(good):
    assert valid_id(good)
    assert schema_name(good) == "project_" + good.replace("-", "_")


@pytest.mark.parametrize("bad", [*HOSTILE, "", "a" * 32, "a_b", "UPPER", "-"])
def test_an_invalid_or_reserved_id_has_no_schema_name(bad):
    assert not valid_id(bad)
    with pytest.raises(ValueError, match="project id"):
        schema_name(bad)


def test_two_ids_never_share_a_schema():
    assert schema_name("a-b") != schema_name("a-c")
    assert len({schema_name(i) for i in ("a-b", "ab", "a-b-c", "a0b")}) == 4


# creating and listing -------------------------------------------------------------------------


async def test_a_project_gets_its_own_schema_and_table(db_url, make_dashboards_app):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        created = await make_project(client, "Side project")
        listed = (await client.get(f"{BASE}/projects")).json()

    assert created == {
        "id": "side-project",
        "name": "Side project",
        "archived": False,
        "open": 0,
        "priority": 0,
        "overdue": 0,
    }
    assert listed == {"projects": [created]}
    assert "project_side_project" in await schemas(db_url)
    tables = (
        "SELECT count(*) FROM information_schema.tables "
        "WHERE table_schema = 'project_side_project' AND table_name = 'task'"
    )
    assert await scalar(db_url, tables) == 1
    assert await scalar(db_url, "SELECT schema_version FROM project") == 1


async def test_the_id_must_be_free_and_the_name_usable(db_url, make_dashboards_app):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        await make_project(client, "Garden")
        responses = {
            "again": await client.post(f"{BASE}/projects", json={"name": "Garden"}),
            "same id": await client.post(f"{BASE}/projects", json={"name": "  garden!! "}),
            "space": await client.post(f"{BASE}/projects", json={"name": "Personal"}),
            "space two": await client.post(f"{BASE}/projects", json={"name": "Work 1"}),
            "page": await client.post(f"{BASE}/projects", json={"name": "Calendar"}),
            "no letters": await client.post(f"{BASE}/projects", json={"name": "!!!"}),
            "blank": await client.post(f"{BASE}/projects", json={"name": "   "}),
            "long": await client.post(f"{BASE}/projects", json={"name": "x" * 41}),
            "missing": await client.post(f"{BASE}/projects", json={}),
            "extra": await client.post(f"{BASE}/projects", json={"name": "Ok", "id": "mine"}),
        }
        count = len((await client.get(f"{BASE}/projects")).json()["projects"])

    statuses = {name: response.status_code for name, response in responses.items()}
    assert statuses == {
        "again": 409,
        "same id": 409,
        "space": 409,
        "space two": 409,
        "page": 409,
        "no letters": 422,
        "blank": 422,
        "long": 422,
        "missing": 422,
        "extra": 422,
    }
    assert error_of(responses["again"]) == "project_exists"
    assert error_of(responses["no letters"]) == "validation_error"
    assert count == 1


async def test_a_failure_while_creating_leaves_no_schema_and_no_registry_row(
    db_url, make_dashboards_app, monkeypatch
):
    original = PROJECT_STEPS[1]

    async def breaks_halfway(connection, project_id):
        await original(connection, project_id)
        raise RuntimeError("boom")

    monkeypatch.setitem(PROJECT_STEPS, 1, breaks_halfway)
    async with running(make_dashboards_app(db_url), AUTH) as client:
        failed = await client.post(f"{BASE}/projects", json={"name": "Garden"})
        monkeypatch.setitem(PROJECT_STEPS, 1, original)
        listed = (await client.get(f"{BASE}/projects")).json()["projects"]
        during = await schemas(db_url)
        again = await client.post(f"{BASE}/projects", json={"name": "Garden"})

    assert failed.status_code == 500
    assert listed == []
    assert during == ["public"]
    assert again.status_code == 201  # the id was free: nothing of the failed one stayed
    assert "project_garden" in await schemas(db_url)


async def test_rename_archive_and_the_bootstrap_list(db_url, make_dashboards_app):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        await make_project(client, "Garden")
        await make_project(client, "Side project")
        renamed = await client.patch(f"{BASE}/projects/garden", json={"name": "  The garden "})
        archived = await client.patch(f"{BASE}/projects/side-project", json={"archived": True})
        listed = (await client.get(f"{BASE}/projects")).json()["projects"]
        boot = (await client.get(f"{BASE}/bootstrap")).json()
        back = await client.patch(f"{BASE}/projects/side-project", json={"archived": False})
        boot_after = (await client.get(f"{BASE}/bootstrap")).json()

    assert renamed.json()["name"] == "The garden"
    assert renamed.json()["id"] == "garden"
    assert archived.json()["archived"] is True
    assert [(p["id"], p["archived"]) for p in listed] == [("garden", False), ("side-project", True)]
    assert boot["projects"] == [{"id": "garden", "name": "The garden"}]
    assert back.json()["archived"] is False
    assert [p["id"] for p in boot_after["projects"]] == ["garden", "side-project"]


async def test_a_bad_project_patch_is_422_and_an_unknown_one_404(db_url, make_dashboards_app):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        await make_project(client)
        bad = [
            await client.patch(f"{BASE}/projects/garden", json=body)
            for body in ({}, {"name": None}, {"archived": None}, {"name": ""}, {"id": "x"})
        ]
        missing = await client.patch(f"{BASE}/projects/nothing", json={"name": "x"})

    assert [response.status_code for response in bad] == [422] * 5
    assert missing.status_code == 404
    assert error_of(missing) == "not_found"


# tasks ----------------------------------------------------------------------------------------


async def test_a_task_has_the_space_task_shape_with_a_project_id(db_url, make_dashboards_app):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        await make_project(client)
        task = await task_in(client, title="  Plant beans ", notes="n", due_date="2026-12-01")
        listed = (await client.get(f"{BASE}/projects/garden/tasks")).json()

    assert set(task) == TASK_KEYS
    assert task["project_id"] == "garden"
    assert task["title"] == "Plant beans"
    assert (task["status"], task["source"], task["priority"]) == ("open", "web", False)
    assert task["notes"] == "n"
    assert task["due_date"] == "2026-12-01"
    assert (task["area_id"], task["url"], task["stage"], task["done_at"]) == (None,) * 4
    assert task["created_at"] == task["updated_at"] == "2026-11-22T12:00:00Z"
    assert listed == {"tasks": [task]}


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"title": ""},
        {"title": "x" * 301},
        {"title": "ok", "area_id": "money"},
        {"title": "ok", "priority": "maybe"},
        {"title": "ok", "due_date": "soon"},
        {"title": "ok", "project_id": "other"},
        {"title": "ok", "status": "done"},
    ],
)
async def test_a_bad_project_task_is_422_and_nothing_is_stored(db_url, make_dashboards_app, body):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        await make_project(client)
        response = await client.post(f"{BASE}/projects/garden/tasks", json=body)
        stored = await titles(client, status="all")

    assert response.status_code == 422
    assert error_of(response) == "validation_error"
    assert stored == []


async def test_open_tasks_are_ordered_like_the_spaces_and_done_ones_follow(
    db_url, make_dashboards_app, clock
):
    plans = [
        ("plain, no date", {}),
        ("plain, due the 30th", {"due_date": "2026-11-30"}),
        ("urgent, no date", {"priority": True}),
        ("urgent, due Dec 5", {"priority": True, "due_date": "2026-12-05"}),
        ("urgent, due the 25th", {"priority": True, "due_date": "2026-11-25"}),
    ]
    async with running(make_dashboards_app(db_url), AUTH) as client:
        await make_project(client)
        made = {}
        for title, fields in plans:
            made[title] = await task_in(client, title=title, **fields)
            clock.now += timedelta(minutes=1)
        for title in ("plain, no date", "urgent, no date"):
            clock.now += timedelta(minutes=5)
            await client.patch(
                f"{BASE}/projects/garden/tasks/{made[title]['id']}", json={"status": "done"}
            )
        everything = await titles(client, status="all")
        done = await titles(client, status="done")
        opened = await titles(client)

    assert opened == ["urgent, due the 25th", "urgent, due Dec 5", "plain, due the 30th"]
    assert done == ["urgent, no date", "plain, no date"]
    assert everything == [*opened, *done]


async def test_patch_changes_what_is_sent_null_clears_and_status_keeps_done_at(
    db_url, make_dashboards_app, clock
):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        await make_project(client)
        task = await task_in(client, title="old", notes="n", priority=True, due_date="2026-12-01")
        url = f"{BASE}/projects/garden/tasks/{task['id']}"
        clock.now += timedelta(minutes=10)
        done = (await client.patch(url, json={"status": "done", "title": " new "})).json()
        clock.now += timedelta(minutes=10)
        still = (await client.patch(url, json={"status": "done"})).json()
        clock.now += timedelta(minutes=10)
        cleared = (await client.patch(url, json={"notes": None, "due_date": None})).json()
        reopened = (await client.patch(url, json={"status": "open", "priority": False})).json()

    assert (done["title"], done["status"]) == ("new", "done")
    assert done["done_at"] == "2026-11-22T12:10:00Z"
    assert still["done_at"] == "2026-11-22T12:10:00Z"
    assert (cleared["notes"], cleared["due_date"]) == (None, None)
    assert cleared["done_at"] == "2026-11-22T12:10:00Z"
    assert (reopened["status"], reopened["done_at"], reopened["priority"]) == ("open", None, False)
    assert reopened["updated_at"] == "2026-11-22T12:30:00Z"


@pytest.mark.parametrize(
    "body",
    [{}, {"title": None}, {"priority": None}, {"status": None}, {"status": "x"}, {"area_id": "a"}],
)
async def test_a_bad_project_task_patch_is_422(db_url, make_dashboards_app, body):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        await make_project(client)
        task = await task_in(client, title="stays")
        response = await client.patch(f"{BASE}/projects/garden/tasks/{task['id']}", json=body)
        after = (await client.get(f"{BASE}/projects/garden/tasks")).json()["tasks"]

    assert response.status_code == 422
    assert after == [task]


async def test_the_area_can_be_cleared_with_null_but_never_set(db_url, make_dashboards_app):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        await make_project(client)
        task = await task_in(client)
        response = await client.patch(
            f"{BASE}/projects/garden/tasks/{task['id']}", json={"area_id": None, "title": "x"}
        )

    assert response.status_code == 200


async def test_deleting_and_the_404s(db_url, make_dashboards_app):
    missing = "00000000-0000-4000-8000-000000000000"
    async with running(make_dashboards_app(db_url), AUTH) as client:
        await make_project(client)
        task = await task_in(client)
        url = f"{BASE}/projects/garden/tasks/{task['id']}"
        deleted = await client.delete(url)
        results = [
            await client.delete(url),
            await client.delete(f"{BASE}/projects/garden/tasks/{missing}"),
            await client.delete(f"{BASE}/projects/garden/tasks/not-a-uuid"),
            await client.patch(f"{BASE}/projects/garden/tasks/{missing}", json={"title": "x"}),
            await client.patch(f"{BASE}/projects/garden/tasks/not-a-uuid", json={"title": "x"}),
            await client.get(f"{BASE}/projects/nothing/tasks"),
            await client.post(f"{BASE}/projects/nothing/tasks", json={"title": "x"}),
            await client.delete(f"{BASE}/projects/nothing/tasks/{missing}"),
        ]
        invalid_filter = await client.get(f"{BASE}/projects/garden/tasks", params={"status": "x"})

    assert (deleted.status_code, deleted.content) == (204, b"")
    assert [response.status_code for response in results] == [404] * 8
    assert {error_of(response) for response in results} == {"not_found"}
    assert invalid_filter.status_code == 422


async def test_an_archived_project_can_be_read_but_not_written_to(db_url, make_dashboards_app):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        await make_project(client)
        task = await task_in(client, title="kept")
        await client.patch(f"{BASE}/projects/garden", json={"archived": True})
        url = f"{BASE}/projects/garden/tasks"
        writes = [
            await client.post(url, json={"title": "new"}),
            await client.patch(f"{url}/{task['id']}", json={"title": "x"}),
            await client.delete(f"{url}/{task['id']}"),
        ]
        readable = await titles(client)
        await client.patch(f"{BASE}/projects/garden", json={"archived": False})
        reopened = await client.post(url, json={"title": "new"})

    assert [response.status_code for response in writes] == [409] * 3
    assert {error_of(response) for response in writes} == {"project_archived"}
    assert readable == ["kept"]
    assert reopened.status_code == 201


async def test_the_list_counts_open_priority_and_overdue_tasks(db_url, make_dashboards_app):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        await make_project(client)
        await make_project(client, "Side project")
        await task_in(client, title="late", due_date="2026-11-20")
        await task_in(client, title="today", due_date="2026-11-22")
        await task_in(client, title="urgent", priority=True)
        finished = await task_in(client, title="finished", due_date="2026-11-01")
        finished_url = f"{BASE}/projects/garden/tasks/{finished['id']}"
        await client.patch(finished_url, json={"status": "done"})
        await task_in(client, "side-project", title="other")
        counts = {p["id"]: p for p in (await client.get(f"{BASE}/projects")).json()["projects"]}

    assert (counts["garden"]["open"], counts["garden"]["priority"]) == (3, 1)
    assert counts["garden"]["overdue"] == 1
    assert (counts["side-project"]["open"], counts["side-project"]["overdue"]) == (1, 0)


async def test_projects_and_spaces_never_see_each_others_tasks(db_url, make_dashboards_app):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        await make_project(client)
        await make_project(client, "Side project")
        await task_in(client, title="in the garden")
        await task_in(client, "side-project", title="in the side project")
        await client.post(f"{BASE}/spaces/personal/tasks", json={"title": "in a space"})
        garden = await titles(client, status="all")
        side = await titles(client, "side-project", status="all")
        space = (await client.get(f"{BASE}/spaces/personal/tasks")).json()["tasks"]

    assert garden == ["in the garden"]
    assert side == ["in the side project"]
    assert [task["title"] for task in space] == ["in a space"]
    assert await scalar(db_url, "SELECT count(*) FROM task") == 1
    assert await scalar(db_url, "SELECT count(*) FROM project_garden.task") == 1
    assert await scalar(db_url, "SELECT count(*) FROM project_side_project.task") == 1


# hostile ids ----------------------------------------------------------------------------------


@pytest.mark.parametrize("hostile", HOSTILE)
async def test_a_hostile_project_id_never_reaches_sql(db_url, make_dashboards_app, hostile):
    path = quote(hostile, safe="")
    async with running(make_dashboards_app(db_url), AUTH) as client:
        await make_project(client)
        responses = [
            await client.get(f"{BASE}/projects/{path}/tasks"),
            await client.post(f"{BASE}/projects/{path}/tasks", json={"title": "x"}),
            await client.patch(f"{BASE}/projects/{path}", json={"name": "x"}),
            await client.delete(f"{BASE}/projects/{path}/tasks/{NO_TASK}"),
        ]
        still_there = await titles(client, status="all")

    assert {response.status_code for response in responses} == {404}
    assert still_there == []
    assert await schemas(db_url) == ["project_garden", "public"]
    assert await scalar(db_url, "SELECT count(*) FROM project") == 1


def test_the_table_of_a_project_is_quoted_by_sqlalchemy():
    table = projects.task_table("side-project")
    compiled = str(table.select().compile())

    assert table.schema == "project_side_project"
    assert compiled.startswith("SELECT project_side_project.task.id")
    with pytest.raises(ValueError, match="project id"):
        projects.task_table('x"; drop schema public; --')


# upgrades -------------------------------------------------------------------------------------


async def test_projects_behind_the_code_are_brought_up_once_under_a_lock(
    db_url, make_dashboards_app, monkeypatch
):
    ran = []

    async def add_column(connection, project_id):
        ran.append(project_id)
        await asyncio.sleep(0.05)
        schema = schema_name(project_id)
        await connection.execute(text(f'ALTER TABLE "{schema}".task ADD COLUMN extra text'))

    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await make_project(client)
        monkeypatch.setattr(projects, "SCHEMA_VERSION", 2)
        monkeypatch.setitem(PROJECT_STEPS, 2, add_column)
        sessions = app.state.dashboards.sessions
        await asyncio.gather(*(upgrade_projects(sessions) for _ in range(3)))
        await upgrade_projects(sessions)

    assert ran == ["garden"]
    assert await scalar(db_url, "SELECT schema_version FROM project") == 2
    column = (
        "SELECT count(*) FROM information_schema.columns "
        "WHERE table_schema = 'project_garden' AND column_name = 'extra'"
    )
    assert await scalar(db_url, column) == 1


async def test_the_app_upgrades_the_projects_at_startup(db_url, make_dashboards_app, monkeypatch):
    async def add_column(connection, project_id):
        schema = schema_name(project_id)
        await connection.execute(text(f'ALTER TABLE "{schema}".task ADD COLUMN extra text'))

    async with running(make_dashboards_app(db_url), AUTH) as client:
        await make_project(client)
    monkeypatch.setattr(projects, "SCHEMA_VERSION", 2)
    monkeypatch.setitem(PROJECT_STEPS, 2, add_column)
    async with running(make_dashboards_app(db_url), AUTH):
        pass

    assert await scalar(db_url, "SELECT schema_version FROM project") == 2


# the gate, logs, MCP --------------------------------------------------------------------------


def test_the_projects_routes_are_behind_the_gate(client, make_client):
    off = client.get(f"{BASE}/projects")
    closed = make_client(database_url=UNREACHABLE_URL).get(f"{BASE}/projects")

    assert (off.status_code, off.json()["error"]) == (503, "dashboards_disabled")
    assert (closed.status_code, closed.json()["error"]) == (401, "unauthorized")


async def test_project_names_and_titles_stay_out_of_the_log(
    db_url, make_dashboards_app, caplog, capsys
):
    caplog.set_level(logging.DEBUG)
    name, title = "NAME-SENTINEL-7731", "TITLE-SENTINEL-7731"
    app = make_dashboards_app(db_url, log_level="DEBUG", log_format="json")
    async with running(app, AUTH) as client, Client(app.state.mcp) as mcp:
        made = await client.post(f"{BASE}/projects", json={"name": name})
        project = made.json()["id"]
        await client.post(f"{BASE}/projects/{project}/tasks", json={"title": title})
        await client.post(f"{BASE}/projects/{project}/tasks", json={"title": title * 40})
        await client.patch(f"{BASE}/projects/{project}", json={"archived": True})
        await client.post(f"{BASE}/projects/{project}/tasks", json={"title": title})
        await mcp.call_tool("add_project", {"name": name})
        await mcp.call_tool("add_task", {"space": project, "title": title})

    logged = caplog.text + capsys.readouterr().out + str([vars(r) for r in caplog.records])
    assert "http.request" in logged
    assert name not in logged
    assert title not in logged
    assert "name-sentinel-7731" not in logged.replace("/projects/name-sentinel-7731", "")


async def call(mcp, tool, **arguments):
    result = await mcp.call_tool(tool, arguments)
    return result.is_error, result.content[0].text


async def ok(mcp, tool, **arguments):
    failed, body = await call(mcp, tool, **arguments)
    assert not failed, body
    return json.loads(body)


async def test_the_mcp_tools_manage_projects_and_their_tasks(db_url, make_dashboards_app, clock):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client, Client(app.state.mcp) as mcp:
        made = await ok(mcp, "add_project", name="Garden")
        added = await ok(mcp, "add_task", space="garden", title="Plant beans", priority=True)
        await ok(mcp, "add_task", space="garden", title="Water", due_date="2026-11-22")
        listed = await ok(mcp, "list_tasks", space="garden")
        today = await ok(mcp, "today", space="garden")
        everything = await ok(mcp, "today")
        clock.now += timedelta(hours=1)
        done = await ok(mcp, "complete_task", id=added["id"], project="garden")
        again = await ok(mcp, "reopen_task", id=added["id"], project="garden")
        changed = await ok(mcp, "update_task", id=added["id"], project="garden", title="Plant")
        projects_list = await ok(mcp, "list_projects")
        deleted = await ok(mcp, "delete_task", id=added["id"], project="garden")
        after = await titles(client)

    assert made["id"] == "garden"
    assert (added["project_id"], added["source"]) == ("garden", "mcp")
    assert listed["project"] == "garden"
    assert [t["title"] for t in listed["tasks"]] == ["Plant beans", "Water"]
    assert [t["title"] for t in today["spaces"][0]["tasks"]] == ["Plant beans", "Water"]
    assert today["spaces"][0]["events"] == []
    assert [group["space"] for group in everything["spaces"]] == ["personal", "work-1", "work-2"]
    assert (done["status"], again["status"], changed["title"]) == ("done", "open", "Plant")
    assert projects_list["projects"][0]["open"] == 2
    assert deleted == {"deleted": added["id"]}
    assert after == ["Water"]


async def test_the_mcp_tools_refuse_with_fixed_sentences(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    missing = "00000000-0000-4000-8000-000000000000"
    async with running(app, AUTH) as client, Client(app.state.mcp) as mcp:
        await make_project(client)
        await make_project(client, "Side project")
        task = await task_in(client)
        await client.patch(f"{BASE}/projects/garden", json={"archived": True})
        results = {
            "unknown": await call(mcp, "list_tasks", space="nothing"),
            "unknown add": await call(mcp, "add_task", space="nothing", title="x"),
            "archived": await call(mcp, "add_task", space="garden", title="x"),
            "area": await call(mcp, "add_task", space="side-project", title="x", area="money"),
            "clash": await call(mcp, "add_project", name="Garden"),
            "empty": await call(mcp, "add_project", name="   "),
            "no letters": await call(mcp, "add_project", name="!!!"),
            "no project": await call(mcp, "delete_task", id=task["id"]),
            "wrong project": await call(mcp, "delete_task", id=task["id"], project="nothing"),
            "missing": await call(mcp, "complete_task", id=missing, project="garden"),
        }

    assert all(failed for failed, _ in results.values())
    assert "Project not found" in results["unknown"][1]
    assert "Project not found" in results["unknown add"][1]
    assert "Project is archived" in results["archived"][1]
    assert "Invalid arguments" in results["empty"][1]
    assert "A project with this id exists" in results["clash"][1]
    assert "needs a letter or a digit" in results["no letters"][1]
    assert "Task not found" in results["no project"][1]
    assert "Project not found" in results["wrong project"][1]
    assert "Project is archived" in results["missing"][1]
    assert "Projects have no areas" in results["area"][1]
