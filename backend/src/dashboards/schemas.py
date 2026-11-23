"""Request and response models of the dashboards data API (REST bodies and MCP tool results).

Request models reject unknown fields. Validation messages are never sent back (the app's 422
handler answers a fixed sentence), so a rejected title or note is never echoed.
"""

from datetime import date, datetime
from typing import Annotated, Self
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, StringConstraints, model_validator

from src.dashboards.catalog import Source, TaskStatus

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
Notes = Annotated[str, StringConstraints(max_length=20_000)]
AreaRef = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]

DateValue = date  # for a field that is itself called `date`

_REQUEST = ConfigDict(extra="forbid")
_RESPONSE = ConfigDict(extra="forbid", frozen=True, from_attributes=True)


class TaskCreate(BaseModel):
    model_config = _REQUEST

    title: Title
    notes: Notes | None = None
    area_id: AreaRef | None = None
    priority: bool = False
    due_date: date | None = None


class TaskPatch(BaseModel):
    """Partial update: only the fields present in the body change. `notes`, `area_id` and
    `due_date` accept null to clear the value; the others cannot be null."""

    model_config = _REQUEST

    title: Title | None = None
    notes: Notes | None = None
    area_id: AreaRef | None = None
    priority: bool | None = None
    due_date: date | None = None
    status: TaskStatus | None = None

    @model_validator(mode="after")
    def _only_clearable_fields_are_null(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("no fields to change")
        for name in ("title", "priority", "status"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class EventCreate(BaseModel):
    model_config = _REQUEST

    title: Title
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    busy_only: bool = False

    @model_validator(mode="after")
    def _ends_after_start(self) -> Self:
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        return self


class EventPatch(BaseModel):
    model_config = _REQUEST

    title: Title | None = None
    starts_at: AwareDatetime | None = None
    ends_at: AwareDatetime | None = None
    busy_only: bool | None = None

    @model_validator(mode="after")
    def _no_nulls(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("no fields to change")
        for name in self.model_fields_set:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class TaskOut(BaseModel):
    model_config = _RESPONSE

    id: UUID
    space_id: str
    title: str
    notes: str | None
    area_id: str | None
    priority: bool
    due_date: date | None
    status: TaskStatus
    done_at: datetime | None
    source: Source
    url: str | None
    stage: str | None
    created_at: datetime
    updated_at: datetime


class EventOut(BaseModel):
    model_config = _RESPONSE

    id: UUID
    space_id: str
    title: str
    starts_at: datetime
    ends_at: datetime
    busy_only: bool
    source: Source


class AreaOut(BaseModel):
    model_config = _RESPONSE

    id: str
    space_id: str
    name_ru: str
    name_en: str
    sort: int


class SpaceRef(BaseModel):
    model_config = _RESPONSE

    id: str
    name: str
    icon: str | None


class BootstrapOut(BaseModel):
    model_config = _RESPONSE

    enabled: bool
    spaces: list[SpaceRef]
    areas: list[AreaOut]
    server_time: datetime


class NextEvent(BaseModel):
    model_config = _RESPONSE

    title: str
    starts_at: datetime


class SpaceSummary(BaseModel):
    model_config = _RESPONSE

    open: int
    priority: int
    overdue: int
    next_event: NextEvent | None


class SummaryOut(BaseModel):
    model_config = _RESPONSE

    spaces: dict[str, SpaceSummary]


class TasksOut(BaseModel):
    model_config = _RESPONSE

    tasks: list[TaskOut]


class EventsOut(BaseModel):
    model_config = _RESPONSE

    events: list[EventOut]


class TodaySpace(BaseModel):
    model_config = _RESPONSE

    space: str
    tasks: list[TaskOut]
    events: list[EventOut]


class TodayOut(BaseModel):
    model_config = _RESPONSE

    date: DateValue
    spaces: list[TodaySpace]
