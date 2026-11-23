"""The REST API against a real Postgres: every endpoint, ordering, limits and space isolation."""

from datetime import timedelta
from uuid import UUID

import pytest

from tests.dashboards_support import AUTH, running

pytestmark = pytest.mark.anyio

BASE = "/api/dashboards/v1"
SPACES = ["personal", "work-1", "work-2"]
AREAS = [
    "money",
    "work-income",
    "court-paperwork",
    "health-sport",
    "romantic",
    "friends",
    "family",
    "travel",
    "home",
    "hobbies-growth",
]
T9 = "2026-11-23T09:00:00Z"
T10 = "2026-11-23T10:00:00Z"
MONEY_RU = "Деньги"


def error_of(response):
    body = response.json()
    assert set(body) == {"error", "message", "request_id"}
    return body["error"]


async def add_task(client, space="personal", **body):
    body.setdefault("title", "a task")
    response = await client.post(f"{BASE}/spaces/{space}/tasks", json=body)
    assert response.status_code == 201, response.text
    return response.json()


async def titles(client, space="personal", status=None):
    params = {} if status is None else {"status": status}
    response = await client.get(f"{BASE}/spaces/{space}/tasks", params=params)
    assert response.status_code == 200, response.text
    return [task["title"] for task in response.json()["tasks"]]


async def add_event(client, space, title, start, end, **extra):
    """start and end are 2026 UTC times as MM-DDTHH:MM."""
    body = {"title": title, "starts_at": f"2026-{start}:00Z", "ends_at": f"2026-{end}:00Z"}
    response = await client.post(f"{BASE}/spaces/{space}/events", json={**body, **extra})
    assert response.status_code == 201, response.text
    return response.json()


async def get_events(client, start, end):
    return await client.get(f"{BASE}/events", params={"from": start, "to": end})


async def event_titles(client, start, end):
    response = await get_events(client, start, end)
    assert response.status_code == 200, response.text
    return [event["title"] for event in response.json()["events"]]


async def test_bootstrap_lists_the_seeded_spaces_and_areas(db_url, make_dashboards_app):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        response = await client.get(f"{BASE}/bootstrap")

    body = response.json()
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert body["enabled"] is True
    assert body["server_time"] == "2026-11-22T12:00:00Z"
    assert [space["id"] for space in body["spaces"]] == SPACES
    assert [area["id"] for area in body["areas"]] == AREAS
    assert {area["space_id"] for area in body["areas"]} == {"personal"}
    assert body["areas"][0] == {
        "id": "money",
        "space_id": "personal",
        "name_ru": MONEY_RU,
        "name_en": "Money",
        "sort": 1,
    }


async def test_a_task_is_created_with_defaults(db_url, make_dashboards_app):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        task = await add_task(client, title="  Pay the invoice  ")

    UUID(task["id"])
    assert task["title"] == "Pay the invoice"
    assert task["space_id"] == "personal"
    assert task["status"] == "open"
    assert task["priority"] is False
    assert task["notes"] is None
    assert task["area_id"] is None
    assert task["due_date"] is None
    assert task["done_at"] is None
    assert task["source"] == "web"
    assert task["created_at"] == task["updated_at"] == "2026-11-22T12:00:00Z"
    assert set(task) == {
        "id",
        "space_id",
        "title",
        "notes",
        "area_id",
        "priority",
        "due_date",
        "status",
        "done_at",
        "source",
        "url",
        "created_at",
        "updated_at",
    }


async def test_a_task_keeps_every_field_it_was_given(db_url, make_dashboards_app):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        task = await add_task(
            client,
            title="Court letter",
            notes="line one\nline two",
            area_id="court-paperwork",
            priority=True,
            due_date="2026-12-01",
        )
        listed = (await client.get(f"{BASE}/spaces/personal/tasks")).json()["tasks"]

    assert listed == [task]
    assert task["notes"] == "line one\nline two"
    assert task["area_id"] == "court-paperwork"
    assert task["priority"] is True
    assert task["due_date"] == "2026-12-01"


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"title": ""},
        {"title": "   "},
        {"title": "x" * 301},
        {"title": 5},
        {"title": "ok", "priority": "maybe"},
        {"title": "ok", "due_date": "tomorrow"},
        {"title": "ok", "space_id": "work-1"},
        {"title": "ok", "status": "done"},
        {"title": "ok", "area_id": "no-such-area"},
        {"title": "ok", "notes": "n" * 20_001},
    ],
)
async def test_a_bad_task_is_422_and_nothing_is_stored(db_url, make_dashboards_app, body):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        response = await client.post(f"{BASE}/spaces/personal/tasks", json=body)
        stored = await titles(client, status="all")

    assert response.status_code == 422
    assert error_of(response) == "validation_error"
    assert stored == []


async def test_an_area_belongs_to_the_personal_space_only(db_url, make_dashboards_app):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        response = await client.post(
            f"{BASE}/spaces/work-1/tasks", json={"title": "x", "area_id": "money"}
        )

    assert response.status_code == 422


async def test_a_body_that_is_not_json_is_422(db_url, make_dashboards_app):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        response = await client.post(
            f"{BASE}/spaces/personal/tasks",
            content=b"{not json",
            headers={"Content-Type": "application/json"},
        )

    assert response.status_code == 422
    assert error_of(response) == "validation_error"


async def test_unknown_spaces_and_ids_are_404(db_url, make_dashboards_app):
    missing = "00000000-0000-4000-8000-000000000000"
    async with running(make_dashboards_app(db_url), AUTH) as client:
        responses = [
            await client.get(f"{BASE}/spaces/nope/tasks"),
            await client.post(f"{BASE}/spaces/nope/tasks", json={"title": "x"}),
            await client.post(
                f"{BASE}/spaces/nope/events",
                json={"title": "x", "starts_at": T9, "ends_at": T10},
            ),
            await client.patch(f"{BASE}/tasks/{missing}", json={"title": "x"}),
            await client.patch(f"{BASE}/tasks/not-a-uuid", json={"title": "x"}),
            await client.delete(f"{BASE}/tasks/{missing}"),
            await client.delete(f"{BASE}/tasks/not-a-uuid"),
            await client.patch(f"{BASE}/events/{missing}", json={"title": "x"}),
            await client.delete(f"{BASE}/events/{missing}"),
            await client.delete(f"{BASE}/events/not-a-uuid"),
        ]

    assert [response.status_code for response in responses] == [404] * 10
    assert {error_of(response) for response in responses} == {"not_found"}


async def test_the_status_filter_is_validated(db_url, make_dashboards_app):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        response = await client.get(f"{BASE}/spaces/personal/tasks", params={"status": "late"})

    assert response.status_code == 422
    assert error_of(response) == "validation_error"


async def test_open_tasks_come_by_priority_then_due_date_then_age(
    db_url, make_dashboards_app, clock
):
    plans = [
        ("plain, no date", {}),
        ("plain, due the 30th", {"due_date": "2026-11-30"}),
        ("urgent, no date", {"priority": True}),
        ("urgent, due Dec 5", {"priority": True, "due_date": "2026-12-05"}),
        ("urgent, due the 25th", {"priority": True, "due_date": "2026-11-25"}),
        ("plain, due the 30th, later", {"due_date": "2026-11-30"}),
    ]
    async with running(make_dashboards_app(db_url), AUTH) as client:
        for title, fields in plans:
            await add_task(client, title=title, **fields)
            clock.now += timedelta(minutes=1)
        opened = await titles(client)

    assert opened == [
        "urgent, due the 25th",
        "urgent, due Dec 5",
        "urgent, no date",
        "plain, due the 30th",
        "plain, due the 30th, later",
        "plain, no date",
    ]


async def test_done_tasks_follow_the_open_ones_latest_first(db_url, make_dashboards_app, clock):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        first = await add_task(client, title="first")
        second = await add_task(client, title="second", priority=True)
        third = await add_task(client, title="third")
        for task in (first, second):
            clock.now += timedelta(minutes=5)
            await client.patch(f"{BASE}/tasks/{task['id']}", json={"status": "done"})

        everything = await titles(client, status="all")
        done = await titles(client, status="done")
        opened = await titles(client, status="open")
        default = await titles(client)

    assert third["status"] == "open"
    assert everything == ["third", "second", "first"]
    assert done == ["second", "first"]
    assert opened == default == ["third"]


async def test_patch_changes_only_what_is_sent_and_null_clears(db_url, make_dashboards_app, clock):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        task = await add_task(
            client, title="old", notes="n", area_id="money", priority=True, due_date="2026-12-01"
        )
        clock.now += timedelta(hours=1)
        renamed = (await client.patch(f"{BASE}/tasks/{task['id']}", json={"title": " new "})).json()
        clearing = {"notes": None, "area_id": None, "due_date": None, "priority": False}
        response = await client.patch(f"{BASE}/tasks/{task['id']}", json=clearing)
        cleared = response.json()

    assert renamed["title"] == "new"
    assert renamed["notes"] == "n"
    assert renamed["area_id"] == "money"
    assert renamed["priority"] is True
    assert renamed["due_date"] == "2026-12-01"
    assert renamed["updated_at"] == "2026-11-22T13:00:00Z"
    assert renamed["created_at"] == "2026-11-22T12:00:00Z"
    assert cleared["title"] == "new"
    assert cleared["notes"] is None
    assert cleared["area_id"] is None
    assert cleared["due_date"] is None
    assert cleared["priority"] is False


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"title": None},
        {"priority": None},
        {"status": None},
        {"status": "someday"},
        {"space_id": "work-1"},
        {"id": "00000000-0000-4000-8000-000000000000"},
        {"area_id": "no-such-area"},
        {"due_date": "soon"},
    ],
)
async def test_a_bad_patch_is_422_and_changes_nothing(db_url, make_dashboards_app, body):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        task = await add_task(client, title="stays")
        response = await client.patch(f"{BASE}/tasks/{task['id']}", json=body)
        after = (await client.get(f"{BASE}/spaces/personal/tasks")).json()["tasks"]

    assert response.status_code == 422
    assert error_of(response) == "validation_error"
    assert after == [task]


async def test_status_maintains_done_at(db_url, make_dashboards_app, clock):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        task = await add_task(client)
        url = f"{BASE}/tasks/{task['id']}"
        clock.now += timedelta(minutes=10)
        done = (await client.patch(url, json={"status": "done"})).json()
        clock.now += timedelta(minutes=10)
        still_done = (await client.patch(url, json={"status": "done", "title": "renamed"})).json()
        clock.now += timedelta(minutes=10)
        reopened = (await client.patch(url, json={"status": "open"})).json()
        clock.now += timedelta(minutes=10)
        done_again = (await client.patch(url, json={"status": "done"})).json()

    assert task["done_at"] is None
    assert done["status"] == "done"
    assert done["done_at"] == "2026-11-22T12:10:00Z"
    assert still_done["done_at"] == "2026-11-22T12:10:00Z"
    assert still_done["updated_at"] == "2026-11-22T12:20:00Z"
    assert reopened["status"] == "open"
    assert reopened["done_at"] is None
    assert done_again["done_at"] == "2026-11-22T12:40:00Z"


async def test_a_task_can_be_deleted_once(db_url, make_dashboards_app):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        keep = await add_task(client, title="keep")
        gone = await add_task(client, title="gone")
        deleted = await client.delete(f"{BASE}/tasks/{gone['id']}")
        again = await client.delete(f"{BASE}/tasks/{gone['id']}")
        remaining = await titles(client, status="all")

    assert deleted.status_code == 204
    assert deleted.content == b""
    assert again.status_code == 404
    assert remaining == [keep["title"]]


async def test_a_spaces_task_list_never_holds_another_spaces_task(db_url, make_dashboards_app):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        for space in SPACES:
            await add_task(client, space, title=f"{space} one")
            await add_task(client, space, title="same title everywhere", priority=True)
        done = await add_task(client, "work-2", title="work-2 finished")
        await client.patch(f"{BASE}/tasks/{done['id']}", json={"status": "done"})
        lists = {
            space: await client.get(f"{BASE}/spaces/{space}/tasks", params={"status": "all"})
            for space in SPACES
        }
        moved = await client.patch(f"{BASE}/tasks/{done['id']}", json={"space_id": "personal"})

    for space, response in lists.items():
        body = response.json()
        assert {task["space_id"] for task in body["tasks"]} == {space}
    personal_titles = [t["title"] for t in lists["personal"].json()["tasks"]]
    assert personal_titles == ["same title everywhere", "personal one"]
    assert len(lists["work-2"].json()["tasks"]) == 3
    assert moved.status_code == 422  # a task cannot change space


async def test_summary_counts_per_space_and_names_the_next_event(db_url, make_dashboards_app):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        await add_task(client, "personal", title="late", due_date="2026-11-21")
        await add_task(client, "personal", title="due today", due_date="2026-11-22")
        await add_task(client, "personal", title="urgent", priority=True)
        finished = await add_task(client, "personal", title="finished", due_date="2026-11-01")
        await client.patch(f"{BASE}/tasks/{finished['id']}", json={"status": "done"})
        await add_task(client, "work-1", title="one", priority=True, due_date="2026-11-10")
        await add_event(client, "work-1", "later", "11-25T08:00", "11-25T09:00")
        await add_event(client, "work-1", "soonest", "11-22T15:00", "11-22T16:00")
        await add_event(client, "work-1", "past", "11-22T08:00", "11-22T09:00")
        await add_event(client, "personal", "lunch", "11-22T11:30", "11-22T12:30")
        response = await client.get(f"{BASE}/summary")

    assert response.status_code == 200
    assert response.json() == {
        "spaces": {
            "personal": {
                "open": 3,
                "priority": 1,
                "overdue": 1,
                "next_event": {"title": "lunch", "starts_at": "2026-11-22T11:30:00Z"},
            },
            "work-1": {
                "open": 1,
                "priority": 1,
                "overdue": 1,
                "next_event": {"title": "soonest", "starts_at": "2026-11-22T15:00:00Z"},
            },
            "work-2": {"open": 0, "priority": 0, "overdue": 0, "next_event": None},
        }
    }


async def test_today_follows_the_configured_time_zone(db_url, make_dashboards_app):
    # 12:00 UTC on the 22nd is already 01:00 on the 23rd in Auckland (UTC+13 in November).
    app = make_dashboards_app(db_url, dashboards_timezone="Pacific/Auckland")
    async with running(app, AUTH) as client:
        await add_task(client, title="due the 22nd", due_date="2026-11-22")
        await add_task(client, title="due the 23rd", due_date="2026-11-23")
        await add_event(client, "work-1", "early on the 23rd", "11-22T11:00", "11-22T11:30")
        await add_event(client, "work-1", "late on the 23rd", "11-23T10:00", "11-23T10:30")
        await add_event(client, "work-1", "on the 24th", "11-23T11:00", "11-23T12:00")
        summary = (await client.get(f"{BASE}/summary")).json()
        on_the_23rd = await event_titles(client, "2026-11-23", "2026-11-23")

    assert summary["spaces"]["personal"]["overdue"] == 1  # only the 22nd is before the 23rd
    assert on_the_23rd == ["early on the 23rd", "late on the 23rd"]


async def test_events_are_created_and_listed_across_spaces_in_order(db_url, make_dashboards_app):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        late = await add_event(client, "work-2", "late", "11-24T15:00", "11-24T16:00")
        early = await add_event(client, "personal", "early", "11-23T08:00", "11-23T09:00")
        focus = await add_event(
            client, "work-1", "focus", "11-23T08:00", "11-23T10:00", busy_only=True
        )
        response = await get_events(client, "2026-11-23", "2026-11-24")

    UUID(late["id"])
    assert early["space_id"] == "personal"
    assert early["source"] == "web"
    assert early["busy_only"] is False
    assert focus["busy_only"] is True
    assert early["starts_at"] == "2026-11-23T08:00:00Z"
    assert set(early) == {
        "id",
        "space_id",
        "title",
        "starts_at",
        "ends_at",
        "busy_only",
        "source",
    }
    # by start, then end: "early" (ends 09:00) before "focus" (ends 10:00), then "late"
    assert [e["title"] for e in response.json()["events"]] == ["early", "focus", "late"]
    assert response.headers["cache-control"] == "no-store"


async def test_a_range_returns_what_intersects_it(db_url, make_dashboards_app):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        await add_event(client, "work-1", "ends at the start", "11-22T22:00", "11-23T00:00")
        await add_event(client, "work-1", "crosses the start", "11-22T23:00", "11-23T01:00")
        await add_event(client, "work-1", "inside", "11-24T10:00", "11-24T11:00")
        await add_event(client, "work-1", "crosses the end", "11-24T23:00", "11-25T01:00")
        await add_event(client, "work-1", "starts at the end", "11-25T00:00", "11-25T01:00")
        await add_event(client, "work-1", "spans it", "11-20T00:00", "11-30T00:00")
        found = await event_titles(client, "2026-11-23", "2026-11-24")
        one_day = await event_titles(client, "2026-11-24", "2026-11-24")

    assert found == ["spans it", "crosses the start", "inside", "crosses the end"]
    assert one_day == ["spans it", "inside", "crosses the end"]


async def test_a_range_is_at_most_62_days(db_url, make_dashboards_app):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        await add_event(client, "work-1", "one", "11-23T09:00", "11-23T10:00")
        longest = await get_events(client, "2026-11-01", "2027-01-01")
        too_long = await get_events(client, "2026-11-01", "2027-01-02")
        backwards = await get_events(client, "2026-11-05", "2026-11-04")
        same_day = await get_events(client, "2026-11-23", "2026-11-23")

    assert longest.status_code == 200  # 62 days, both ends included
    assert too_long.status_code == 422  # 63 days
    assert backwards.status_code == 422
    assert same_day.status_code == 200
    assert error_of(too_long) == "validation_error"


@pytest.mark.parametrize(
    "params",
    [{}, {"from": "2026-11-01"}, {"to": "2026-11-02"}, {"from": "x", "to": "2026-11-02"}],
)
async def test_the_range_needs_two_valid_dates(db_url, make_dashboards_app, params):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        response = await client.get(f"{BASE}/events", params=params)

    assert response.status_code == 422
    assert error_of(response) == "validation_error"


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"title": "x"},
        {"title": "", "starts_at": T9, "ends_at": T10},
        {"title": "x", "starts_at": "2026-11-23T09:00:00", "ends_at": "2026-11-23T10:00:00"},
        {"title": "x", "starts_at": T10, "ends_at": T10},
        {"title": "x", "starts_at": T10, "ends_at": T9},
        {"title": "x", "starts_at": "soon", "ends_at": "later"},
        {"title": "x", "starts_at": T9, "ends_at": T10, "extra": 1},
    ],
)
async def test_a_bad_event_is_422(db_url, make_dashboards_app, body):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        response = await client.post(f"{BASE}/spaces/work-1/events", json=body)
        stored = await event_titles(client, "2026-11-01", "2026-12-15")

    assert response.status_code == 422
    assert error_of(response) == "validation_error"
    assert stored == []


async def test_an_event_offset_is_converted_to_utc(db_url, make_dashboards_app):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        event = await add_event(client, "work-1", "berlin", "11-23T10:00", "11-23T11:00")
        body = {"starts_at": "2026-11-23T10:00:00+01:00", "ends_at": "2026-11-23T11:30:00+01:00"}
        response = await client.patch(f"{BASE}/events/{event['id']}", json=body)

    assert response.status_code == 200
    assert response.json()["starts_at"] == "2026-11-23T09:00:00Z"
    assert response.json()["ends_at"] == "2026-11-23T10:30:00Z"


async def test_an_event_can_be_changed_and_deleted(db_url, make_dashboards_app, clock):
    async with running(make_dashboards_app(db_url), AUTH) as client:
        event = await add_event(client, "work-1", "old", "11-23T09:00", "11-23T10:00")
        url = f"{BASE}/events/{event['id']}"
        clock.now += timedelta(hours=1)
        renamed = await client.patch(url, json={"title": " new ", "busy_only": True})
        later_end = await client.patch(url, json={"ends_at": "2026-11-23T12:00:00Z"})
        before_start = await client.patch(url, json={"ends_at": "2026-11-23T08:00:00Z"})
        no_change = await client.patch(url, json={})
        null_title = await client.patch(url, json={"title": None})
        moved_space = await client.patch(url, json={"space_id": "work-2"})
        deleted = await client.delete(url)
        again = await client.delete(url)
        left = await event_titles(client, "2026-11-01", "2026-11-30")

    assert renamed.status_code == 200
    assert renamed.json()["title"] == "new"
    assert renamed.json()["busy_only"] is True
    assert renamed.json()["starts_at"] == "2026-11-23T09:00:00Z"
    assert later_end.json()["ends_at"] == "2026-11-23T12:00:00Z"
    assert before_start.status_code == 422  # merged with the stored start
    assert no_change.status_code == 422
    assert null_title.status_code == 422
    assert moved_space.status_code == 422
    assert deleted.status_code == 204
    assert again.status_code == 404
    assert left == []
