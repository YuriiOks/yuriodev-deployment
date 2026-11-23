"""The fixed vocabulary of the dashboards data: spaces, life areas and the enum-like columns."""

import json
from pathlib import Path
from typing import Literal, NamedTuple

SpaceId = Literal["personal", "work-1", "work-2"]
TaskStatus = Literal["open", "done"]
TaskStatusFilter = Literal["open", "done", "all"]
Source = Literal["web", "mcp", "telegram", "import", "github", "linear", "calendar"]
# Sources whose tasks a collector owns (title, url and status); `source_ref` holds the external id.
COLLECTED_SOURCES: tuple[Source, ...] = ("github", "linear")

# The order spaces are listed in everywhere (bootstrap, summary, `today`).
SPACE_IDS: tuple[SpaceId, ...] = ("personal", "work-1", "work-2")

# What each space is called when DASHBOARDS_SPACE_NAMES does not rename it.
DEFAULT_SPACE_NAMES: dict[str, str] = {
    "personal": "Personal",
    "work-1": "Work 1",
    "work-2": "Work 2",
}
MAX_SPACE_NAME = 24
# DASHBOARDS_SPACE_ICONS: the only data URIs a space icon may be, and the longest one (the whole
# string, prefix included).
ICON_PREFIXES: tuple[str, ...] = (
    "data:image/png;base64,",
    "data:image/svg+xml;base64,",
    "data:image/x-icon;base64,",
    "data:image/vnd.microsoft.icon;base64,",
    "data:image/webp;base64,",
)
MAX_ICON_LENGTH = 48 * 1024

# Projects (user-created dashboards, one Postgres schema each).
PROJECT_ID_PATTERN = r"^[a-z0-9][a-z0-9-]{0,30}$"
# Never a project id: the three spaces, and the one fixed page under /dashboards.
RESERVED_PROJECT_IDS: frozenset[str] = frozenset({"personal", "work-1", "work-2", "calendar"})
MAX_PROJECT_NAME = 40
# A project's icon is a key into the frontend's drawings: the backend only checks its shape, so a
# new drawing needs no backend change.
PROJECT_ICON_PATTERN = r"^[a-z0-9-]{1,24}$"

MAX_RANGE_DAYS = 62  # GET /events and the list_events tool: at most this many days, inclusive


class AreaSeed(NamedTuple):
    id: str
    name_ru: str
    name_en: str


def _load_areas() -> tuple[AreaSeed, ...]:
    rows = json.loads(Path(__file__).with_name("areas.json").read_text(encoding="utf-8"))
    return tuple(AreaSeed(row["id"], row["name_ru"], row["name_en"]) for row in rows)


# Seed of the `area` table (first migration), in `sort` order. Areas belong to the personal
# space only. The Russian names live in a JSON file so this module stays plain ASCII.
PERSONAL_AREAS: tuple[AreaSeed, ...] = _load_areas()
