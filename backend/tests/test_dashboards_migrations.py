"""Alembic: the schema comes up from an empty database, idempotently and under concurrency."""

import asyncio

import pytest
from sqlalchemy.exc import IntegrityError

from src.dashboards.db import run_migrations
from src.dashboards.runtime import run_in_thread
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
EVENT_WITH_SOURCE = (
    "INSERT INTO event (id, space_id, title, starts_at, ends_at, source) "
    "VALUES (gen_random_uuid(), 'work-1', 'x', now(), now() + interval '1 hour', 'SOURCE')"
)
WITH_SOURCE = (
    "INSERT INTO task (id, space_id, title, source) "
    "VALUES (gen_random_uuid(), 'personal', 'x', 'SOURCE')"
)
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
    await run_in_thread(run_migrations, url)


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
    assert version == "dashboards_0007"
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


async def test_the_collected_task_columns_and_tombstone_table_exist(empty_db_url):
    await migrate(empty_db_url)

    tombstones = await scalar(
        empty_db_url,
        "SELECT count(*) FROM information_schema.columns "
        "WHERE table_name = 'task_tombstone' AND column_name IN "
        "('source', 'source_ref', 'fingerprint', 'deleted_at')",
    )
    link = await scalar(
        empty_db_url,
        "SELECT count(*) FROM information_schema.columns "
        "WHERE table_name = 'task' AND column_name = 'url'",
    )
    unique = await scalar(
        empty_db_url,
        "SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_task_source_source_ref'",
    )

    assert tombstones == 4
    assert link == 1
    assert "UNIQUE" in unique
    assert "source_ref IS NOT NULL" in unique


async def test_collectors_may_write_their_own_sources_and_nobody_else_is_invented(empty_db_url):
    await migrate(empty_db_url)

    for source in ("github", "linear", "web"):
        await execute(empty_db_url, WITH_SOURCE.replace("SOURCE", source))
    with pytest.raises(IntegrityError):
        await execute(empty_db_url, WITH_SOURCE.replace("SOURCE", "slack"))


async def test_calendar_events_have_a_unique_external_id_and_their_own_source(empty_db_url):
    await migrate(empty_db_url)

    unique = await scalar(
        empty_db_url,
        "SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_event_source_source_ref'",
    )
    for source in ("calendar", "web", "mcp"):
        await execute(empty_db_url, EVENT_WITH_SOURCE.replace("SOURCE", source))
    with pytest.raises(IntegrityError):
        await execute(empty_db_url, EVENT_WITH_SOURCE.replace("SOURCE", "github"))

    assert "UNIQUE" in unique
    assert "source_ref IS NOT NULL" in unique
    assert await scalar(empty_db_url, "SELECT count(*) FROM event") == 3


async def test_the_task_stage_column_is_short_nullable_text(empty_db_url):
    await migrate(empty_db_url)

    column = await scalar(
        empty_db_url,
        "SELECT data_type || ':' || character_maximum_length || ':' || is_nullable "
        "FROM information_schema.columns WHERE table_name = 'task' AND column_name = 'stage'",
    )
    await execute(empty_db_url, NEW_TASK)

    assert column == "character varying:16:YES"
    assert await scalar(empty_db_url, "SELECT stage IS NULL FROM task") is True


async def test_the_project_registry_exists_and_starts_empty(empty_db_url):
    await migrate(empty_db_url)

    columns = await scalar(
        empty_db_url,
        "SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns "
        "WHERE table_name = 'project' AND table_schema = 'public'",
    )

    assert columns == "archived,created_at,icon,id,name,schema_version"
    assert await scalar(empty_db_url, "SELECT count(*) FROM project") == 0


LINK_ID = "00000000-0000-0000-0000-0000000000c1"
ACCOUNT_ID = "00000000-0000-0000-0000-0000000000a1"
NEW_LINK = (
    "INSERT INTO finance.connection (id, provider, ref) VALUES ('LINK', 'sample', 'one')"
).replace("LINK", LINK_ID)
NEW_ACCOUNT = (
    "INSERT INTO finance.account (id, connection_id, provider, external_id, name, currency, "
    "balance, balance_at) "
    "VALUES ('ACCOUNT', 'LINK', 'sample', 'acc-1', 'Main', 'GBP', 12050, now())"
).replace("ACCOUNT", ACCOUNT_ID).replace("LINK", LINK_ID)
NEW_TRANSACTION = (
    "INSERT INTO finance.transaction (id, account_id, external_id, booked_at, amount, currency) "
    "VALUES (gen_random_uuid(), 'ACCOUNT', 'tx-1', now(), -250, 'GBP')"
).replace("ACCOUNT", ACCOUNT_ID)
BAD_FINANCE_ROWS = (
    NEW_TRANSACTION,  # the same external id twice in one account
    NEW_TRANSACTION.replace("'tx-1'", "'tx-2'").replace("'GBP'", "'gbp'"),  # not an ISO code
    # an original amount without its currency
    NEW_TRANSACTION.replace("currency)", "currency, original_amount)")
    .replace("'tx-1'", "'tx-3'")
    .replace("'GBP')", "'GBP', 100)"),
    # a full card number where four digits belong
    NEW_ACCOUNT.replace("balance_at)", "balance_at, mask_last4)")
    .replace("now())", "now(), '1234567890123456')")
    .replace("'acc-1'", "'acc-2'")
    .replace(ACCOUNT_ID, ACCOUNT_ID[:-1] + "2"),
    NEW_LINK.replace("ref)", "ref, status)").replace("'one')", "'two', 'broken')"),
)


async def test_finance_lives_in_its_own_schema_and_keeps_money_as_integers(empty_db_url):
    await migrate(empty_db_url)

    inside = await scalar(
        empty_db_url,
        "SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables "
        "WHERE table_schema = 'finance'",
    )
    outside = await scalar(
        empty_db_url,
        "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' "
        "AND table_name IN ('connection', 'account', 'transaction')",
    )
    money = await scalar(
        empty_db_url,
        "SELECT string_agg(DISTINCT data_type, ',') FROM information_schema.columns "
        "WHERE table_schema = 'finance' AND column_name IN "
        "('amount', 'balance', 'credit_limit', 'original_amount', 'balance_after')",
    )

    assert inside == "account,connection,transaction"
    assert outside == 0
    assert money == "bigint"


async def test_the_finance_tables_enforce_their_rules(empty_db_url):
    await migrate(empty_db_url)
    await execute(empty_db_url, NEW_LINK, NEW_ACCOUNT, NEW_TRANSACTION)

    assert await scalar(empty_db_url, "SELECT status FROM finance.connection") == "ok"
    assert await scalar(empty_db_url, "SELECT pending FROM finance.transaction") is False
    for statement in BAD_FINANCE_ROWS:
        with pytest.raises(IntegrityError):
            await execute(empty_db_url, statement)
