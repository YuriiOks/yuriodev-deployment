"""Alembic: the schema comes up from an empty database, idempotently and under concurrency."""

import asyncio

import pytest
from sqlalchemy.exc import IntegrityError

from src.dashboards.db import run_migrations
from tests.dashboards_support import (
    AUTH,
    execute,
    new_database_name,
    running,
    scalar,
    url_for,
)

pytestmark = pytest.mark.anyio

TABLES = ("space", "area", "task", "event")
NEW_TASK = "INSERT INTO task (id, space_id, title) VALUES (gen_random_uuid(), 'personal', 'x')"


@pytest.fixture
def empty_db_url(pg_server_url):
    name = new_database_name()
    asyncio.run(execute(pg_server_url, f'CREATE DATABASE "{name}"'))
    try:
        yield url_for(pg_server_url, name)
    finally:
        asyncio.run(execute(pg_server_url, f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))


async def migrate(url):
    await asyncio.to_thread(run_migrations, url)


async def test_an_empty_database_gets_the_schema_and_the_seed(empty_db_url):
    await migrate(empty_db_url)

    tables = await scalar(
        empty_db_url,
        "SELECT count(*) FROM information_schema.tables "
        "WHERE table_schema = 'public' AND table_name IN ('space', 'area', 'task', 'event')",
    )
    version = await scalar(empty_db_url, "SELECT version_num FROM alembic_version")
    spaces = await scalar(empty_db_url, "SELECT string_agg(id, ',' ORDER BY id) FROM space")
    areas = await scalar(empty_db_url, "SELECT count(*) FROM area WHERE space_id = 'personal'")
    sorts = await scalar(empty_db_url, "SELECT string_agg(sort::text, ',' ORDER BY sort) FROM area")
    names = await scalar(empty_db_url, "SELECT name_en FROM area WHERE id = 'court-paperwork'")

    assert tables == len(TABLES)
    assert version == "dashboards_0001"
    assert spaces == "personal,work-1,work-2"
    assert areas == 10
    assert sorts == "1,2,3,4,5,6,7,8,9,10"
    assert names == "Court and paperwork"


async def test_running_it_again_changes_nothing(empty_db_url):
    await migrate(empty_db_url)
    await migrate(empty_db_url)

    assert await scalar(empty_db_url, "SELECT count(*) FROM alembic_version") == 1
    assert await scalar(empty_db_url, "SELECT count(*) FROM space") == 3
    assert await scalar(empty_db_url, "SELECT count(*) FROM area") == 10


async def test_processes_starting_together_migrate_once(empty_db_url):
    await asyncio.gather(*(migrate(empty_db_url) for _ in range(4)))

    assert await scalar(empty_db_url, "SELECT count(*) FROM alembic_version") == 1
    assert await scalar(empty_db_url, "SELECT count(*) FROM space") == 3
    assert await scalar(empty_db_url, "SELECT count(*) FROM area") == 10


async def test_the_database_enforces_its_own_rules(empty_db_url):
    await migrate(empty_db_url)

    await execute(empty_db_url, NEW_TASK)
    assert await scalar(empty_db_url, "SELECT status FROM task") == "open"
    assert await scalar(empty_db_url, "SELECT priority FROM task") is False
    assert await scalar(empty_db_url, "SELECT source FROM task") == "web"
    assert await scalar(empty_db_url, "SELECT created_at IS NOT NULL FROM task") is True
    for statement in (
        NEW_TASK.replace("'personal'", "'nowhere'"),
        NEW_TASK.replace("title)", "title, status)").replace("'x')", "'x', 'bogus')"),
        NEW_TASK.replace("title)", "title, area_id)").replace("'x')", "'x', 'no-area')"),
        "INSERT INTO event (id, space_id, title, starts_at, ends_at) VALUES "
        "(gen_random_uuid(), 'work-1', 'x', now(), now())",
    ):
        with pytest.raises(IntegrityError):
            await execute(empty_db_url, statement)


async def test_the_app_migrates_an_empty_database_by_itself(empty_db_url, make_dashboards_app):
    async with running(make_dashboards_app(empty_db_url), AUTH) as client:
        response = await client.get("/api/dashboards/v1/bootstrap")

    assert response.status_code == 200
    assert len(response.json()["areas"]) == 10
