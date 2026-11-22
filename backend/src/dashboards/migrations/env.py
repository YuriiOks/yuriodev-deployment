"""Alembic environment of the dashboards schema: async (asyncpg), online only.

Run by `src.dashboards.db.run_migrations` (the URL arrives in `config.attributes["url"]`) and by
the `alembic` command from backend/ (the URL comes from DATABASE_URL).
"""

import asyncio
import os

from alembic import context
from sqlalchemy import BigInteger, bindparam, pool, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from src.dashboards.db import to_async_url
from src.dashboards.models import Base

# Held until the migration transaction ends: a second process started at the same moment waits
# here, then finds the schema at head and has nothing to do.
ADVISORY_LOCK_KEY = 5_194_021_733

config = context.config


def _database_url() -> str:
    url = config.attributes.get("url") or os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("no database URL: set DATABASE_URL")
    return str(url)


def _migrate(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=Base.metadata)
    with context.begin_transaction():
        # Typed as bigint: an untyped Python int is bound as int32, which this key exceeds.
        lock = text("SELECT pg_advisory_xact_lock(:key)").bindparams(
            bindparam("key", ADVISORY_LOCK_KEY, type_=BigInteger)
        )
        connection.execute(lock)
        context.run_migrations()


async def _run(url: str) -> None:
    engine = create_async_engine(
        to_async_url(url), poolclass=pool.NullPool, connect_args={"timeout": 10}
    )
    try:
        async with engine.connect() as connection:
            await connection.run_sync(_migrate)
    finally:
        await engine.dispose()


asyncio.run(_run(_database_url()))
