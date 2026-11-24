"""Alembic: the schema comes up from an empty database, idempotently and under concurrency."""

import asyncio

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy.exc import IntegrityError

from src.dashboards.db import MIGRATIONS_DIR, run_migrations
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
    assert version == "dashboards_0021"
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
    (
        "INSERT INTO finance.account (id, connection_id, provider, external_id, name, currency, "
        "balance, balance_at) "
        "VALUES ('ACCOUNT', 'LINK', 'sample', 'acc-1', 'Main', 'GBP', 12050, now())"
    )
    .replace("ACCOUNT", ACCOUNT_ID)
    .replace("LINK", LINK_ID)
)
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
    # four characters that are not four digits
    NEW_ACCOUNT.replace("balance_at)", "balance_at, mask_last4)")
    .replace("now())", "now(), '12ab')")
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
        "AND table_name IN ('connection', 'account', 'transaction', 'monzo_token')",
    )
    money = await scalar(
        empty_db_url,
        "SELECT string_agg(DISTINCT data_type, ',') FROM information_schema.columns "
        "WHERE table_schema = 'finance' AND column_name IN "
        "('amount', 'balance', 'credit_limit', 'original_amount', 'balance_after')",
    )

    assert inside == (
        "account,attention_state,connection,fx_rate,monzo_oauth_state,monzo_token,recurring,"
        "recurring_match,transaction"
    )
    assert outside == 0
    assert money == "bigint"


async def test_the_finance_tables_enforce_their_rules(empty_db_url):
    await migrate(empty_db_url)
    await execute(empty_db_url, NEW_LINK, NEW_ACCOUNT, NEW_TRANSACTION)

    assert await scalar(empty_db_url, "SELECT status FROM finance.connection") == "ok"
    assert await scalar(empty_db_url, "SELECT pending FROM finance.transaction") is False
    internal = "SELECT internal_transfer FROM finance.transaction"
    assert await scalar(empty_db_url, internal) is False
    for statement in BAD_FINANCE_ROWS:
        with pytest.raises(IntegrityError):
            await execute(empty_db_url, statement)


async def test_monzo_keeps_its_auth_state_in_tables_of_its_own(empty_db_url):
    await migrate(empty_db_url)

    columns = await scalar(
        empty_db_url,
        "SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns "
        "WHERE table_schema = 'finance' AND table_name = 'monzo_token'",
    )
    shared = await scalar(
        empty_db_url,
        "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'finance' "
        "AND table_name IN ('connection', 'account', 'transaction') "
        "AND (column_name LIKE '%token%' OR column_name LIKE '%secret%')",
    )
    extras = await scalar(
        empty_db_url,
        "SELECT string_agg(table_name || '.' || column_name, ',' ORDER BY table_name, column_name) "
        "FROM information_schema.columns WHERE table_schema = 'finance' AND column_name IN "
        "('opened_at', 'declined', 'settled_at')",
    )

    assert columns == (
        "access_token,approval_deadline,approved_at,connection_id,expires_at,refresh_token,"
        "revoked_at,updated_at,user_id"
    )
    assert shared == 0  # no token of any provider in a shared table
    assert extras == "account.opened_at,transaction.declined,transaction.settled_at"


async def test_collected_tasks_carry_the_sources_priority_time_and_draft_flag(empty_db_url):
    await migrate(empty_db_url)

    columns = await scalar(
        empty_db_url,
        "SELECT string_agg(column_name || ':' || is_nullable, ',' ORDER BY column_name) "
        "FROM information_schema.columns WHERE table_name = 'task' AND table_schema = 'public' "
        "AND column_name IN ('source_priority', 'source_updated_at', 'draft')",
    )
    await execute(empty_db_url, NEW_TASK)
    default = await scalar(empty_db_url, "SELECT draft FROM task")
    for level in ("urgent", "high", "medium", "low", "none"):
        statement = "UPDATE task SET source_priority = 'LEVEL'".replace("LEVEL", level)
        await execute(empty_db_url, statement)
    with pytest.raises(IntegrityError):
        await execute(empty_db_url, "UPDATE task SET source_priority = 'critical'")

    assert columns == "draft:NO,source_priority:YES,source_updated_at:YES"
    assert default is False


async def test_accounts_and_transactions_get_their_presentation_and_category_columns(
    empty_db_url,
):
    await migrate(empty_db_url)
    await execute(empty_db_url, NEW_LINK, NEW_ACCOUNT, NEW_TRANSACTION)

    columns = await scalar(
        empty_db_url,
        "SELECT string_agg(table_name || '.' || column_name, ',' ORDER BY table_name, column_name) "
        "FROM information_schema.columns WHERE table_schema = 'finance' AND column_name IN "
        "('kind', 'parent_account_id', 'goal_amount', 'overdraft_limit', 'label', 'category', "
        "'category_override')",
    )
    kind = await scalar(empty_db_url, "SELECT kind FROM finance.account")
    category = await scalar(empty_db_url, "SELECT category IS NULL FROM finance.transaction")

    assert columns == (
        "account.goal_amount,account.kind,account.label,account.overdraft_limit,"
        "account.parent_account_id,recurring.category,recurring.kind,transaction.category,"
        "transaction.category_override"
    )
    assert kind == "current"
    assert category is True  # worked out at startup, not by the migration
    for statement in (
        "UPDATE finance.account SET kind = 'wallet'",
        "UPDATE finance.transaction SET category = 'fun'",
        "UPDATE finance.transaction SET category_override = 'fun'",
        "UPDATE finance.account SET parent_account_id = gen_random_uuid()",
    ):
        with pytest.raises(IntegrityError):
            await execute(empty_db_url, statement)
    await execute(empty_db_url, "UPDATE finance.transaction SET category_override = 'health'")


async def test_the_owners_overdraft_limit_is_its_own_nullable_column(empty_db_url):
    await migrate(empty_db_url)
    await execute(empty_db_url, NEW_LINK, NEW_ACCOUNT)

    column = await scalar(
        empty_db_url,
        "SELECT data_type || ':' || is_nullable FROM information_schema.columns "
        "WHERE table_schema = 'finance' AND column_name = 'overdraft_limit_override'",
    )
    await execute(empty_db_url, "UPDATE finance.account SET overdraft_limit_override = 0")
    with pytest.raises(IntegrityError):
        await execute(empty_db_url, "UPDATE finance.account SET overdraft_limit_override = -1")

    assert column == "bigint:YES"


NEW_PAYMENT = (
    "INSERT INTO finance.recurring (id, name, kind, amount, currency, frequency) "
    "VALUES (gen_random_uuid(), 'Acme', 'service', 100, 'GBP', 'monthly')"
)
NEW_PAYMENT_WITH_REF = (
    "INSERT INTO finance.recurring (id, name, kind, amount, currency, frequency, external_ref) "
    "VALUES (gen_random_uuid(), 'Acme', 'service', 100, 'GBP', 'monthly', 'r')"
)


async def test_recurring_payments_and_attention_state_are_checked_by_the_database(empty_db_url):
    await migrate(empty_db_url)
    await execute(empty_db_url, NEW_PAYMENT)
    columns = await scalar(
        empty_db_url,
        "SELECT count(*) FROM information_schema.columns "
        "WHERE table_schema = 'finance' AND table_name = 'recurring'",
    )

    for statement in (
        "UPDATE finance.recurring SET kind = 'gift'",
        "UPDATE finance.recurring SET frequency = 'never'",
        "UPDATE finance.recurring SET frequency_interval = 0",
        "UPDATE finance.recurring SET frequency_interval = 367",
        "UPDATE finance.recurring SET currency = 'gbp'",
        "UPDATE finance.recurring SET amount = -1",
        "UPDATE finance.recurring SET color = '#ABCDEF'",
        "UPDATE finance.recurring SET icon_url = 'http://example.test/a.png'",
        "UPDATE finance.recurring SET reminder_days = 91",
        "UPDATE finance.recurring SET account_id = gen_random_uuid()",
        "INSERT INTO finance.attention_state (key, state) VALUES ('k', 'gone')",
        "INSERT INTO finance.attention_state (key, state) VALUES ('k', 'snoozed')",
    ):
        with pytest.raises(IntegrityError):
            await execute(empty_db_url, statement)
    await execute(
        empty_db_url,
        "UPDATE finance.recurring SET color = '#12abef', icon_url = 'https://example.test/a.png'",
        "INSERT INTO finance.attention_state (key, state) VALUES ('k', 'dismissed')",
    )
    with pytest.raises(IntegrityError):  # a reference is unique
        await execute(
            empty_db_url,
            "UPDATE finance.recurring SET external_ref = 'r'",
            NEW_PAYMENT_WITH_REF,
        )

    assert columns == 43


async def test_a_manual_connection_has_its_own_flag_and_a_colour_pair(empty_db_url):
    await migrate(empty_db_url)
    await execute(empty_db_url, NEW_LINK)

    default = await scalar(empty_db_url, "SELECT manual FROM finance.connection")
    for statement in (
        "UPDATE finance.connection SET brand_bg = '#003087'",
        "UPDATE finance.connection SET brand_fg = '#ffffff'",
        "UPDATE finance.connection SET brand_bg = '#003087', brand_fg = 'white'",
        "UPDATE finance.connection SET brand_bg = '#ABCDEF', brand_fg = '#ffffff'",
    ):
        with pytest.raises(IntegrityError):
            await execute(empty_db_url, statement)
    await execute(
        empty_db_url,
        "UPDATE finance.connection SET manual = true, display_name = 'My Bank', "
        "brand_bg = '#003087', brand_fg = '#ffffff'",
    )

    assert default is False


async def test_the_category_checks_take_transfers_out_and_still_refuse_the_rest(empty_db_url):
    await migrate(empty_db_url)
    await execute(empty_db_url, NEW_LINK, NEW_ACCOUNT, NEW_TRANSACTION)

    checks = await scalar(
        empty_db_url,
        "SELECT count(*) FROM pg_constraint WHERE conrelid = 'finance.transaction'::regclass "
        "AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%category%'",
    )
    for statement in (
        "UPDATE finance.transaction SET category = 'fun'",
        "UPDATE finance.transaction SET category_override = 'fun'",
    ):
        with pytest.raises(IntegrityError):
            await execute(empty_db_url, statement)
    await execute(
        empty_db_url,
        "UPDATE finance.transaction SET category = 'transfers_out', "
        "category_override = 'transfers_out'",
    )

    assert checks == 2


def upgrade_to(url, revision):
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    config.attributes["url"] = url
    command.upgrade(config, revision)


async def test_csv_references_lose_their_row_numbers_and_every_payment_gets_its_day(empty_db_url):
    await asyncio.to_thread(upgrade_to, empty_db_url, "dashboards_0017")
    base = (
        "INSERT INTO finance.recurring (id, name, kind, amount, currency, frequency, "
        "external_ref, start_date, next_payment_date) "
        "VALUES (gen_random_uuid(), 'x', 'service', 1, 'GBP', 'monthly', 'REF', DATE1, DATE2)"
    )
    for ref, start, following in (
        ("csv:acme:gbp:5", "'2026-01-31'", "'2026-11-30'"),
        ("csv:acme:gbp:2", "NULL", "'2026-11-15'"),
        ("csv:beta:gbp:1", "NULL", "NULL"),
        ("by-hand", "NULL", "'2026-12-01'"),
    ):
        await execute(
            empty_db_url,
            base.replace("REF", ref).replace("DATE1", start).replace("DATE2", following),
        )

    await migrate(empty_db_url)

    refs = await scalar(
        empty_db_url,
        "SELECT string_agg(external_ref || '=' || COALESCE(anchor_day::text, '-'), ',' "
        "ORDER BY external_ref) FROM finance.recurring",
    )
    assert refs == "by-hand=1,csv:acme:gbp:1=15,csv:acme:gbp:2=31,csv:beta:gbp:1=-"


async def test_a_transaction_pays_one_due_date_once(empty_db_url):
    await migrate(empty_db_url)
    await execute(empty_db_url, NEW_LINK, NEW_ACCOUNT, NEW_TRANSACTION, NEW_PAYMENT)

    pairs = (
        "INSERT INTO finance.recurring_match (recurring_id, due_date, transaction_id) "
        "SELECT r.id, DATE 'DAY', t.id FROM finance.recurring r, finance.transaction t"
    )
    await execute(empty_db_url, pairs.replace("DAY", "2026-11-20"))
    for day in ("2026-11-20", "2026-12-20"):  # the same date again, and the same line again
        with pytest.raises(IntegrityError):
            await execute(empty_db_url, pairs.replace("DAY", day))
    await execute(empty_db_url, "DELETE FROM finance.recurring")
    count = await scalar(empty_db_url, "SELECT count(*) FROM finance.recurring_match")

    assert count == 0  # a match goes with its payment
