"""Collected tasks in the database: upsert, ownership, closing and tombstones (real Postgres)."""

from datetime import UTC, date, datetime, timedelta

import pytest
from mcp import Client
from sqlalchemy.exc import IntegrityError

from src.dashboards.collectors.base import ExternalItem
from src.dashboards.collectors.sync import sync_items
from tests.dashboards_support import AUTH, execute, running, scalar

pytestmark = pytest.mark.anyio

BASE = "/api/dashboards/v1"
ROWS = (
    "INSERT INTO task (id, space_id, title, source, source_ref) "
    "VALUES (gen_random_uuid(), 'work-1', 'a', 'github', 'ref-9')",
    "INSERT INTO task (id, space_id, title, source, source_ref) "
    "VALUES (gen_random_uuid(), 'work-1', 'b', 'linear', 'ref-9')",
    "INSERT INTO task (id, space_id, title, source, source_ref) "
    "VALUES (gen_random_uuid(), 'work-1', 'c', 'web', NULL)",
    "INSERT INTO task (id, space_id, title, source, source_ref) "
    "VALUES (gen_random_uuid(), 'work-1', 'd', 'web', NULL)",
)
DUPLICATE = (
    "INSERT INTO task (id, space_id, title, source, source_ref) "
    "VALUES (gen_random_uuid(), 'work-1', 'e', 'github', 'ref-9')"
)


def item(number, title=None, due=None, stage=None):
    url = f"https://example.test/{number}"
    return ExternalItem(f"ref-{number}", title or f"Item {number}", url, due, stage)


async def sync(app, items, source="github", space="work-1"):
    async with app.state.dashboards.sessions() as session:
        return await sync_items(session, source, space, items, app.state.clock())


async def tasks(client, space="work-1", status="all"):
    response = await client.get(f"{BASE}/spaces/{space}/tasks", params={"status": status})
    return response.json()["tasks"]


async def test_new_items_become_open_tasks_with_a_link(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        counts = await sync(app, [item(1, due=date(2026, 12, 24)), item(2)])
        listed = await tasks(client)

    assert (counts.created, counts.updated, counts.closed, counts.skipped) == (2, 0, 0, 0)
    first = next(task for task in listed if task["title"] == "Item 1")
    assert first["source"] == "github"
    assert first["url"] == "https://example.test/1"
    assert first["status"] == "open"
    assert first["priority"] is False
    assert first["due_date"] == "2026-12-24"
    assert first["space_id"] == "work-1"
    assert len(listed) == 2


async def test_a_second_sync_of_the_same_items_changes_nothing(db_url, make_dashboards_app, clock):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await sync(app, [item(1)])
        before = await tasks(client)
        clock.now += timedelta(hours=1)
        counts = await sync(app, [item(1)])
        after = await tasks(client)

    assert (counts.created, counts.updated, counts.closed, counts.skipped) == (0, 0, 0, 0)
    assert after == before


async def test_the_collector_owns_title_link_and_status_the_user_owns_the_rest(
    db_url, make_dashboards_app, clock
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await sync(app, [item(1, due=date(2026, 12, 24))], space="personal")
        task = (await tasks(client, "personal"))[0]
        mine = {"priority": True, "notes": "my notes", "area_id": "money", "due_date": "2027-01-15"}
        await client.patch(f"{BASE}/tasks/{task['id']}", json=mine)
        clock.now += timedelta(hours=1)
        moved = "https://example.test/moved"
        renamed = ExternalItem("ref-1", "Renamed upstream", moved, date(2026, 1, 1))
        counts = await sync(app, [renamed], space="personal")
        after = (await tasks(client, "personal"))[0]

    assert counts.updated == 1
    assert after["title"] == "Renamed upstream"
    assert after["url"] == "https://example.test/moved"
    assert after["priority"] is True
    assert after["notes"] == "my notes"
    assert after["area_id"] == "money"
    assert after["due_date"] == "2027-01-15"  # the source's date is only used at creation
    assert after["updated_at"] == "2026-11-22T13:00:00Z"
    assert after["id"] == task["id"]


async def test_a_task_whose_item_is_gone_is_marked_done_not_deleted(
    db_url, make_dashboards_app, clock
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await sync(app, [item(1), item(2)])
        clock.now += timedelta(hours=2)
        counts = await sync(app, [item(2)])
        listed = {task["title"]: task for task in await tasks(client)}
        again = await sync(app, [item(2)])

    assert counts.closed == 1
    assert again.closed == 0
    assert listed["Item 1"]["status"] == "done"
    assert listed["Item 1"]["done_at"] == "2026-11-22T14:00:00Z"
    assert listed["Item 2"]["status"] == "open"


async def test_an_item_that_comes_back_reopens_its_task(db_url, make_dashboards_app, clock):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await sync(app, [item(1)])
        await sync(app, [])
        clock.now += timedelta(hours=1)
        counts = await sync(app, [item(1)])
        (task,) = await tasks(client)

    assert (counts.updated, counts.reopened, counts.created) == (1, 1, 0)
    assert task["status"] == "open"
    assert task["done_at"] is None


async def test_finishing_a_collected_task_by_hand_does_not_stick_while_it_is_open_upstream(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await sync(app, [item(1)])
        (task,) = await tasks(client)
        await client.patch(f"{BASE}/tasks/{task['id']}", json={"status": "done"})
        await sync(app, [item(1)])
        (after,) = await tasks(client)

    assert after["status"] == "open"  # status belongs to the collector


async def test_other_sources_and_other_collectors_are_left_alone(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        web = await client.post(f"{BASE}/spaces/work-1/tasks", json={"title": "by hand"})
        await sync(app, [item(1)], source="github")
        await sync(app, [item(1)], source="linear")  # the same external id, another source
        await sync(app, [], source="github")
        by_title = {(t["source"], t["title"]): t for t in await tasks(client)}

    assert by_title[("web", "by hand")]["id"] == web.json()["id"]
    assert by_title[("web", "by hand")]["status"] == "open"
    assert by_title[("github", "Item 1")]["status"] == "done"
    assert by_title[("linear", "Item 1")]["status"] == "open"


async def test_a_deleted_collected_task_stays_deleted_while_the_item_is_unchanged(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await sync(app, [item(1), item(2)])
        (gone,) = [t for t in await tasks(client) if t["title"] == "Item 1"]
        deleted = await client.delete(f"{BASE}/tasks/{gone['id']}")
        counts = await sync(app, [item(1), item(2)])
        titles = sorted(t["title"] for t in await tasks(client))

    assert deleted.status_code == 204
    assert (counts.created, counts.skipped) == (0, 1)
    assert titles == ["Item 2"]
    assert await scalar(db_url, "SELECT count(*) FROM task_tombstone") == 1


async def test_a_deleted_task_comes_back_when_the_item_changed(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await sync(app, [item(1)])
        (gone,) = await tasks(client)
        await client.delete(f"{BASE}/tasks/{gone['id']}")
        counts = await sync(app, [item(1, title="Item 1, reworded")])
        listed = await tasks(client)

    assert counts.created == 1
    assert [t["title"] for t in listed] == ["Item 1, reworded"]
    assert listed[0]["id"] != gone["id"]
    assert await scalar(db_url, "SELECT count(*) FROM task_tombstone") == 0


async def test_a_tombstone_is_dropped_once_the_item_is_gone_upstream(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await sync(app, [item(1)])
        (gone,) = await tasks(client)
        await client.delete(f"{BASE}/tasks/{gone['id']}")
        await sync(app, [])
        stones = await scalar(db_url, "SELECT count(*) FROM task_tombstone")
        counts = await sync(app, [item(1)])  # the same item opens again later

    assert stones == 0
    assert counts.created == 1


async def test_deleting_over_mcp_also_leaves_a_tombstone_and_a_web_task_leaves_none(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client, Client(app.state.mcp) as mcp:
        await sync(app, [item(1)])
        (collected,) = await tasks(client)
        web = (await client.post(f"{BASE}/spaces/work-1/tasks", json={"title": "mine"})).json()
        await mcp.call_tool("delete_task", {"id": web["id"]})
        assert await scalar(db_url, "SELECT count(*) FROM task_tombstone") == 0
        await mcp.call_tool("delete_task", {"id": collected["id"]})
        counts = await sync(app, [item(1)])

    assert await scalar(db_url, "SELECT count(*) FROM task_tombstone") == 1
    assert counts.skipped == 1


async def test_the_link_is_in_the_mcp_task_output(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), Client(app.state.mcp) as mcp:
        await sync(app, [item(1)])
        result = await mcp.call_tool("list_tasks", {"space": "work-1"})

    assert '"url":"https://example.test/1"' in result.content[0].text
    assert '"source":"github"' in result.content[0].text


async def test_a_task_made_by_hand_has_no_link(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        response = await client.post(f"{BASE}/spaces/work-1/tasks", json={"title": "by hand"})

    assert response.json()["url"] is None


async def test_the_database_keeps_one_row_per_external_item(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH):
        for statement in ROWS:
            await execute(db_url, statement)
        with pytest.raises(IntegrityError):
            await execute(db_url, DUPLICATE)


async def test_the_stage_is_written_on_create_and_a_stage_change_alone_is_an_update(
    db_url, make_dashboards_app, clock
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await sync(app, [item(1, stage="unstarted")])
        (first,) = await tasks(client)
        mine = {"priority": True, "notes": "kept"}
        await client.patch(f"{BASE}/tasks/{first['id']}", json=mine)
        clock.now += timedelta(hours=1)
        counts = await sync(app, [item(1, stage="started")])
        (second,) = await tasks(client)
        same = await sync(app, [item(1, stage="started")])

    assert first["stage"] == "unstarted"
    assert counts.updated == 1
    assert (second["stage"], second["title"], second["id"]) == ("started", "Item 1", first["id"])
    assert (second["priority"], second["notes"]) == (True, "kept")
    assert second["updated_at"] == "2026-11-22T13:00:00Z"
    assert same.updated == 0


async def test_a_stage_that_goes_away_is_cleared(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await sync(app, [item(1, stage="started")])
        await sync(app, [item(1, stage=None)])
        (task,) = await tasks(client)

    assert task["stage"] is None


async def test_a_state_change_does_not_bring_a_deleted_task_back(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await sync(app, [item(1, stage="unstarted")])
        (gone,) = await tasks(client)
        await client.delete(f"{BASE}/tasks/{gone['id']}")
        counts = await sync(app, [item(1, stage="started")])
        listed = await tasks(client)

    assert (counts.created, counts.skipped) == (0, 1)
    assert listed == []


async def test_the_user_cannot_set_the_stage_and_manual_tasks_have_none(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await sync(app, [item(1, stage="started")])
        (collected,) = await tasks(client)
        by_hand = (await client.post(f"{BASE}/spaces/work-1/tasks", json={"title": "x"})).json()
        patch = await client.patch(f"{BASE}/tasks/{collected['id']}", json={"stage": "review"})
        create = await client.post(f"{BASE}/spaces/work-1/tasks", json={"title": "y", "stage": "z"})
        (after,) = [t for t in await tasks(client) if t["source"] == "github"]

    assert by_hand["stage"] is None
    assert patch.status_code == 422
    assert create.status_code == 422
    assert after["stage"] == "started"


async def test_the_stage_is_in_the_mcp_task_output(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), Client(app.state.mcp) as mcp:
        await sync(app, [item(1, stage="review")])
        result = await mcp.call_tool("list_tasks", {"space": "work-1"})

    assert '"stage":"review"' in result.content[0].text


def sourced(number, **fields):
    url = f"https://example.test/{number}"
    return ExternalItem(f"ref-{number}", f"Item {number}", url, **fields)


async def test_the_sources_own_priority_time_and_draft_flag_are_kept_but_never_set_the_flag(
    db_url, make_dashboards_app, clock
):
    seen = datetime(2026, 11, 20, 9, 0, tzinfo=UTC)
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        await sync(
            app, [sourced(1, priority="urgent", updated_at=seen, draft=True)], source="linear"
        )
        (task,) = await tasks(client)
        clock.now += timedelta(hours=1)
        later = datetime(2026, 11, 21, 9, 0, tzinfo=UTC)
        counts = await sync(
            app, [sourced(1, priority="low", updated_at=later, draft=False)], source="linear"
        )
        (changed,) = await tasks(client)
        same = await sync(
            app, [sourced(1, priority="low", updated_at=later, draft=False)], source="linear"
        )

    assert (task["source_priority"], task["source_updated_at"], task["draft"]) == (
        "urgent",
        "2026-11-20T09:00:00Z",
        True,
    )
    assert task["priority"] is False  # an urgent issue is not in the hand-picked Priority panel
    assert (changed["source_priority"], changed["source_updated_at"], changed["draft"]) == (
        "low",
        "2026-11-21T09:00:00Z",
        False,
    )
    assert (counts.updated, same.updated) == (1, 0)
    assert changed["priority"] is False


async def test_manual_tasks_have_no_source_fields_and_nobody_can_set_them(
    db_url, make_dashboards_app
):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        manual = (await client.post(f"{BASE}/spaces/work-1/tasks", json={"title": "x"})).json()
        await sync(app, [sourced(1, priority="high")], source="linear")
        (collected,) = [t for t in await tasks(client) if t["source"] == "linear"]
        attempts = [
            await client.patch(f"{BASE}/tasks/{collected['id']}", json={field: value})
            for field, value in (
                ("source_priority", "urgent"),
                ("source_updated_at", "2026-11-20T09:00:00Z"),
                ("draft", True),
            )
        ]
        create = await client.post(
            f"{BASE}/spaces/work-1/tasks", json={"title": "y", "source_priority": "urgent"}
        )

    assert (manual["source_priority"], manual["source_updated_at"], manual["draft"]) == (
        None,
        None,
        False,
    )
    assert [r.status_code for r in attempts] == [422, 422, 422]
    assert create.status_code == 422
    assert collected["source_priority"] == "high"


async def test_collected_tasks_come_most_urgent_first_then_most_recently_updated(
    db_url, make_dashboards_app
):
    def when(day):
        return datetime(2026, 11, day, 9, 0, tzinfo=UTC)

    app = make_dashboards_app(db_url)
    async with running(app, AUTH) as client:
        manual = (await client.post(f"{BASE}/spaces/work-1/tasks", json={"title": "mine"})).json()
        flagged = await client.post(
            f"{BASE}/spaces/work-1/tasks", json={"title": "flagged", "priority": True}
        )
        await sync(
            app,
            [
                sourced(1, priority="low", updated_at=when(20)),
                sourced(2, priority="urgent", updated_at=when(10)),
                sourced(3, priority="urgent", updated_at=when(15)),
                sourced(4, priority="none", updated_at=when(21)),
                sourced(5, priority="high", updated_at=when(1)),
                sourced(6, priority="high", updated_at=None),
            ],
            source="linear",
        )
        listed = [t["title"] for t in await tasks(client, status="open")]
        await sync(app, [], source="linear")
        done = [t["title"] for t in await tasks(client, status="done")]

    assert flagged.status_code == 201
    assert listed == [
        "flagged",  # the hand-picked Priority flag still comes first
        "Item 3",
        "Item 2",  # urgent: the more recently updated first
        "Item 5",
        "Item 6",  # high: one with a time before one without
        "Item 1",
        "Item 4",  # none after low
        manual["title"],  # and a manual task after every collected one
    ]
    assert sorted(done) == ["Item 1", "Item 2", "Item 3", "Item 4", "Item 5", "Item 6"]


async def test_the_source_fields_are_in_the_mcp_task_output(db_url, make_dashboards_app):
    app = make_dashboards_app(db_url)
    async with running(app, AUTH), Client(app.state.mcp) as mcp:
        await sync(app, [sourced(1, priority="urgent", draft=True)], source="linear")
        result = await mcp.call_tool("list_tasks", {"space": "work-1"})

    text = result.content[0].text
    assert '"source_priority":"urgent"' in text
    assert '"draft":true' in text
