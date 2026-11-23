"""Projects: user-created dashboards, each in a Postgres schema of its own.

The three spaces keep their tables in the main schema. A project's tasks are physically apart:
`project_<id>` holds one `task` table (the space task's columns minus the space, area, link,
stage and collector fields; `source` is `web` or `mcp`). The registry (`project` in the main
schema) lists them.

How the schema name is made. It is built in exactly one place, `schema_name()`, from a project id
that matches `PROJECT_ID_PATTERN` (lower-case letters, digits and hyphens: nothing that needs
escaping and no way to inject anything), with `-` turned into `_`. It is then handed to SQLAlchemy
as a `Table(schema=...)` / `CreateSchema(...)`, which quote it. No request text is ever put into
SQL: the id in a URL is validated first, and an invalid one is a 404 before any query.

How the schemas are migrated. Alembic migrates the main schema only. Each registry row carries
`schema_version`; `SCHEMA_VERSION` is the latest in the code and `PROJECT_STEPS[n]` brings a
schema from n-1 to n. Creating a project runs the steps up to the latest in the same transaction
as the registry row and the schema; at startup `upgrade_projects` brings every project that is
behind up, one transaction each, under an advisory lock, re-reading the version once it holds
it. Nothing ever drops a schema: a project is archived, not deleted.
"""

import json
import logging
import re
import unicodedata
import uuid
from collections.abc import Awaitable, Callable
from datetime import date, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    MetaData,
    String,
    Table,
    Text,
    Uuid,
    bindparam,
    delete,
    false,
    func,
    insert,
    or_,
    select,
    text,
    update,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession, async_sessionmaker
from sqlalchemy.schema import CreateSchema

from src.core.errors import AppError
from src.dashboards.catalog import PROJECT_ID_PATTERN, RESERVED_PROJECT_IDS, TaskStatusFilter
from src.dashboards.models import Project
from src.dashboards.schemas import (
    ProjectOut,
    ProjectPatch,
    ProjectRef,
    ProjectTaskOut,
    TaskCreate,
    TaskPatch,
)
from src.dashboards.service import guarded, next_done_at, task_order

logger = logging.getLogger("yuriodev.dashboards")

_ID = re.compile(PROJECT_ID_PATTERN)
_TRANSLIT: dict[str, str] = json.loads(
    Path(__file__).with_name("translit.json").read_text(encoding="utf-8")
)
UPGRADE_LOCK_KEY = 5_194_021_735  # not the migration's or the collectors' key


def valid_id(project_id: str) -> bool:
    return _ID.fullmatch(project_id) is not None and project_id not in RESERVED_PROJECT_IDS


def schema_name(project_id: str) -> str:
    """The Postgres schema of a project. The only place the name is built."""
    if not valid_id(project_id):
        raise ValueError("not a project id")
    return "project_" + project_id.replace("-", "_")


def slugify(name: str) -> str:
    """A project id from its name: lower-case ASCII letters and digits joined by single hyphens
    (Cyrillic is transliterated), at most 31 characters. Empty when the name has none."""
    lowered = "".join(_TRANSLIT.get(ch, ch) for ch in name.lower())
    ascii_only = unicodedata.normalize("NFKD", lowered).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_only).strip("-")
    return slug[:31].strip("-")


# the per-project table ------------------------------------------------------------------------

_TABLES: dict[str, Table] = {}


def task_table(project_id: str) -> Table:
    """The `task` table of a project, in its schema (one Table object per project, cached)."""
    table = _TABLES.get(project_id)
    if table is None:
        metadata = MetaData(schema=schema_name(project_id))
        table = Table(
            "task",
            metadata,
            Column("id", Uuid, primary_key=True),
            Column("title", String(300), nullable=False),
            Column("notes", Text, nullable=True),
            Column("priority", Boolean, nullable=False, server_default=false()),
            Column("due_date", Date, nullable=True),
            Column("status", String(8), nullable=False, server_default="open"),
            Column("done_at", DateTime(timezone=True), nullable=True),
            Column("source", String(16), nullable=False, server_default="web"),
            Column("created_at", DateTime(timezone=True), nullable=False),
            Column("updated_at", DateTime(timezone=True), nullable=False),
            CheckConstraint("status IN ('open', 'done')", name="ck_task_status"),
            CheckConstraint("source IN ('web', 'mcp')", name="ck_task_source"),
        )
        _TABLES[project_id] = table
    return table


async def _create_v1(connection: AsyncConnection, project_id: str) -> None:
    await connection.execute(CreateSchema(schema_name(project_id)))
    await connection.run_sync(task_table(project_id).create)


# step n takes a project's schema from version n-1 to n; version 1 is the creation above
PROJECT_STEPS: dict[int, Callable[[AsyncConnection, str], Awaitable[None]]] = {1: _create_v1}
SCHEMA_VERSION = 1


# registry -------------------------------------------------------------------------------------


def _not_found() -> AppError:
    return AppError(404, "not_found", "Project not found")


def _archived() -> AppError:
    return AppError(409, "project_archived", "Project is archived")


async def _project(session: AsyncSession, project_id: str) -> Project:
    """The registry row, or 404 (an id that is not even valid never reaches the database)."""
    row = await session.get(Project, project_id) if valid_id(project_id) else None
    if row is None:
        raise _not_found()
    return row


async def _writable(session: AsyncSession, project_id: str) -> Project:
    project = await _project(session, project_id)
    if project.archived:
        raise _archived()
    return project


async def _counts(session: AsyncSession, project_id: str, today: date) -> tuple[int, int, int]:
    table = task_table(project_id)
    is_open = table.c.status == "open"
    query = select(
        func.count().filter(is_open),
        func.count().filter(is_open, table.c.priority),
        func.count().filter(is_open, table.c.due_date < today),
    )
    total, urgent, late = (await session.execute(query)).one()
    return int(total), int(urgent), int(late)


async def _out(session: AsyncSession, project: Project, today: date) -> ProjectOut:
    total, urgent, late = await _counts(session, project.id, today)
    return ProjectOut(
        id=project.id,
        name=project.name,
        archived=project.archived,
        open=total,
        priority=urgent,
        overdue=late,
    )


@guarded
async def list_projects(session: AsyncSession, today: date) -> list[ProjectOut]:
    """Every project, archived ones included and flagged, oldest first."""
    rows = (await session.scalars(select(Project).order_by(Project.created_at, Project.id))).all()
    return [await _out(session, project, today) for project in rows]


@guarded
async def active_projects(session: AsyncSession) -> list[ProjectRef]:
    query = select(Project).where(Project.archived.is_(False)).order_by(Project.created_at)
    rows = (await session.scalars(query)).all()
    return [ProjectRef(id=row.id, name=row.name) for row in rows]


@guarded
async def create_project(session: AsyncSession, name: str, now: datetime) -> ProjectOut:
    """The registry row, the schema and its tables, in one transaction. 409 when the id the name
    makes is taken (or reserved)."""
    project_id = slugify(name)
    if _ID.fullmatch(project_id) is None:
        raise AppError(422, "validation_error", "The name needs a letter or a digit")
    if project_id in RESERVED_PROJECT_IDS or await session.get(Project, project_id) is not None:
        raise AppError(409, "project_exists", "A project with this id exists")
    entry = Project(
        id=project_id,
        name=name,
        archived=False,
        schema_version=SCHEMA_VERSION,
        created_at=now,
    )
    session.add(entry)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise AppError(409, "project_exists", "A project with this id exists") from None
    connection = await session.connection()
    for version in range(1, SCHEMA_VERSION + 1):
        await PROJECT_STEPS[version](connection, project_id)
    await session.commit()
    return ProjectOut(id=project_id, name=name, archived=False, open=0, priority=0, overdue=0)


@guarded
async def update_project(
    session: AsyncSession, project_id: str, patch: ProjectPatch, today: date
) -> ProjectOut:
    project = await _project(session, project_id)
    if patch.name is not None:
        project.name = patch.name
    if patch.archived is not None:
        project.archived = patch.archived
    await session.commit()
    return await _out(session, project, today)


async def upgrade_projects(sessions: async_sessionmaker[AsyncSession]) -> None:
    """Bring every project's schema up to `SCHEMA_VERSION`: one transaction per project, under an
    advisory lock, re-reading the version once the lock is held (another process may have done
    it). Runs after the main migrations; a failure is retried with them."""
    async with sessions() as session:
        query = select(Project.id).where(Project.schema_version < SCHEMA_VERSION)
        behind = (await session.scalars(query)).all()
    lock = text("SELECT pg_advisory_xact_lock(:key)").bindparams(
        bindparam("key", UPGRADE_LOCK_KEY, type_=BigInteger)
    )
    for project_id in behind:
        async with sessions() as session:
            await session.execute(lock)
            project = await session.get(Project, project_id, populate_existing=True)
            if project is None or project.schema_version >= SCHEMA_VERSION:
                continue
            connection = await session.connection()
            for version in range(project.schema_version + 1, SCHEMA_VERSION + 1):
                await PROJECT_STEPS[version](connection, project_id)
            project.schema_version = SCHEMA_VERSION
            await session.commit()
        logger.info("project schema upgraded", extra={"event": "projects.upgraded"})


# tasks ----------------------------------------------------------------------------------------


def _task_out(project_id: str, row: Any) -> ProjectTaskOut:
    return ProjectTaskOut(
        id=row.id,
        project_id=project_id,
        title=row.title,
        notes=row.notes,
        priority=row.priority,
        due_date=row.due_date,
        status=row.status,
        done_at=row.done_at,
        source=row.source,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _parse_task_id(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError:
        raise AppError(404, "not_found", "Task not found") from None


def _no_areas(area_id: str | None) -> None:
    if area_id is not None:
        raise AppError(422, "validation_error", "Projects have no areas")


@guarded
async def list_project_tasks(
    session: AsyncSession, project_id: str, status: TaskStatusFilter = "open"
) -> list[ProjectTaskOut]:
    await _project(session, project_id)  # archived projects can still be read
    table = task_table(project_id)
    query = select(table)
    if status != "all":
        query = query.where(table.c.status == status)
    rows = (await session.execute(query.order_by(*task_order(table.c)))).all()
    return [_task_out(project_id, row) for row in rows]


@guarded
async def due_project_tasks(
    session: AsyncSession, project_id: str, day: date
) -> list[ProjectTaskOut]:
    """Open tasks that are priority or due on `day` or earlier (the project's `today`)."""
    await _project(session, project_id)
    table = task_table(project_id)
    query = select(table).where(
        table.c.status == "open", or_(table.c.priority.is_(True), table.c.due_date <= day)
    )
    rows = (await session.execute(query.order_by(*task_order(table.c)))).all()
    return [_task_out(project_id, row) for row in rows]


@guarded
async def create_project_task(
    session: AsyncSession, project_id: str, data: TaskCreate, source: str, now: datetime
) -> ProjectTaskOut:
    await _writable(session, project_id)
    _no_areas(data.area_id)
    table = task_table(project_id)
    values = {
        "id": uuid.uuid4(),
        "title": data.title,
        "notes": data.notes,
        "priority": data.priority,
        "due_date": data.due_date,
        "status": "open",
        "done_at": None,
        "source": source,
        "created_at": now,
        "updated_at": now,
    }
    row = (await session.execute(insert(table).values(**values).returning(table))).one()
    await session.commit()
    return _task_out(project_id, row)


@guarded
async def update_project_task(
    session: AsyncSession, project_id: str, task_id: str, patch: TaskPatch, now: datetime
) -> ProjectTaskOut:
    await _writable(session, project_id)
    table = task_table(project_id)
    key = _parse_task_id(task_id)
    current = (await session.execute(select(table).where(table.c.id == key))).first()
    if current is None:
        raise AppError(404, "not_found", "Task not found")
    fields = patch.model_fields_set
    if "area_id" in fields:
        _no_areas(patch.area_id)
    values: dict[str, Any] = {"updated_at": now}
    if "title" in fields and patch.title is not None:
        values["title"] = patch.title
    if "notes" in fields:
        values["notes"] = patch.notes
    if "priority" in fields and patch.priority is not None:
        values["priority"] = patch.priority
    if "due_date" in fields:
        values["due_date"] = patch.due_date
    if "status" in fields and patch.status is not None:
        values["status"] = patch.status
        values["done_at"] = next_done_at(current.status, current.done_at, patch.status, now)
    query = update(table).where(table.c.id == key).values(**values).returning(table)
    row = (await session.execute(query)).one()
    await session.commit()
    return _task_out(project_id, row)


@guarded
async def delete_project_task(session: AsyncSession, project_id: str, task_id: str) -> None:
    await _writable(session, project_id)
    table = task_table(project_id)
    gone = delete(table).where(table.c.id == _parse_task_id(task_id)).returning(table.c.id)
    if (await session.execute(gone)).first() is None:
        raise AppError(404, "not_found", "Task not found")
    await session.commit()
