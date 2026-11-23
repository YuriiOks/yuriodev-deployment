"""Database plumbing shared by the app and Alembic's env.py: URLs and the migration runner."""

import threading
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy.engine import URL, make_url

MIGRATIONS_DIR = Path(__file__).with_name("migrations")

_ACCEPTED_DRIVERS = frozenset({"postgres", "postgresql", "postgresql+asyncpg"})

# Alembic keeps the running environment in one module-level proxy (`alembic.context`), so two
# runs in the same process must never overlap: the second would migrate on the first one's
# connection. Separate processes are kept apart by the advisory lock in env.py.
_ONE_RUN_PER_PROCESS = threading.Lock()


def to_async_url(url: str) -> URL:
    """The asyncpg form of a Postgres URL (`postgresql://...`, `postgres://...` or already
    `postgresql+asyncpg://...`).

    Raises ValueError for anything else. The message never contains the URL: it carries a
    password and would end up in the log.
    """
    parsed = make_url(url)
    if parsed.drivername not in _ACCEPTED_DRIVERS:
        raise ValueError("DATABASE_URL must be a postgresql:// URL")
    return parsed.set(drivername="postgresql+asyncpg")


def run_migrations(url: str) -> None:
    """`alembic upgrade head`, blocking: call it from a worker thread (`asyncio.to_thread`).

    Idempotent, and safe when several processes start at once: env.py takes a Postgres advisory
    lock inside the migration transaction, so the second one waits, then finds the schema at
    head and does nothing.
    """
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    # Not a main option: the URL holds a password and `%` would be read as interpolation.
    config.attributes["url"] = url
    with _ONE_RUN_PER_PROCESS:
        command.upgrade(config, "head")
