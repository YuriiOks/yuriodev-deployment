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
