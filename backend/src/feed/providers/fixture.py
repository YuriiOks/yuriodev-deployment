"""Synthetic drafts for local, dev and stage: the real normalisation path, no network, no key.

`feed/fixtures/drafts.json` holds invented posts in Typefully's get_draft shape, including the
private fields (with sentinel values) and the edge cases the normaliser must drop.
"""

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Literal

from src.feed.normalize import parse_summary
from src.feed.providers.base import DraftSummary, ProviderError

FIXTURE_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "drafts.json"


class FixtureProvider:
    name: Literal["fixture"] = "fixture"
    polls = False

    def __init__(self, path: Path = FIXTURE_PATH) -> None:
        self.path = path
        self._drafts: dict[int, Mapping[str, Any]] | None = None

    def _load(self) -> dict[int, Mapping[str, Any]]:
        if self._drafts is None:
            try:
                data = json.loads(self.path.read_text(encoding="utf-8"))
                drafts = data["drafts"]
                self._drafts = {d["id"]: d for d in drafts}
            except (OSError, ValueError, KeyError, TypeError) as exc:
                raise ProviderError("transient") from exc
        return self._drafts

    async def list_published(self) -> list[DraftSummary]:
        summaries = [parse_summary(d) for d in self._load().values()]
        valid = [s for s in summaries if s is not None]
        if len(valid) != len(summaries):  # never a partial list, as for the real provider
            raise ProviderError("bad_response")
        return valid

    async def get_draft(self, draft_id: int) -> Mapping[str, Any]:
        try:
            return self._load()[draft_id]
        except KeyError:
            raise ProviderError("not_found") from None

    def should_defer(self) -> bool:
        return False
