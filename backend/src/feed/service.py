"""FeedService: the social feed's state, refresh cycle, status and response bytes.

- The request path only reads memory: it never calls a provider, so visitors cannot drive
  upstream traffic, and upstream trouble never turns into a 5xx.
- State is immutable and swapped whole after a successful cycle; a failed cycle keeps serving
  the previous state.
- Status is computed per request: `fresh` within 2x the refresh interval of the last success,
  then `stale`, then `error` once no success has happened for SOCIAL_FEED_MAX_STALE_HOURS (or on
  rejected credentials or missing config). In `error`, imported posts are withheld and only
  hand-curated ones are served.
- Response bodies and weak ETags are computed once per (state, status). The status is part of
  the ETag, so a change from fresh to stale can never hide behind a 304.
"""

import asyncio
import hashlib
import logging
import random
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

from pydantic import TypeAdapter

from src.core.clock import Clock, utc_now
from src.core.config import Settings
from src.core.refresh import CycleOutcome, CycleResult, PeriodicRefresher
from src.core.snapshot import SnapshotStore
from src.feed.curation import CURATION_PATH, Curation, CurationError, load_curation
from src.feed.normalize import normalize_draft
from src.feed.providers.base import DraftSummary, FeedProvider, ProviderError
from src.feed.providers.fixture import FixtureProvider
from src.feed.schemas import (
    FeedItem,
    FeedSnapshot,
    FeedSource,
    PostsResponse,
    SnapshotEntry,
    SourceProvider,
    SourceStatus,
)

if TYPE_CHECKING:
    import httpx

logger = logging.getLogger("yuriodev.feed")

# Drops that are deliberate (fail-closed rules, exclusions) rather than signs of a changed
# upstream format; only the others count towards the schema-drift guard.
_INTENTIONAL_DROPS = frozenset(
    {"excluded", "not_published", "paid_partnership", "x_article", "no_valid_variant"}
)
DRIFT_MIN_FETCHED = 4

_ITEMS = TypeAdapter(tuple[FeedItem, ...])


@dataclass(frozen=True)
class CachedDraft:
    updated_at: datetime
    item: FeedItem | None
    reason: str | None = None


@dataclass(frozen=True)
class FeedState:
    entries: Mapping[int, CachedDraft]
    imported: tuple[FeedItem, ...]  # valid items, newest first
    last_success_at: datetime | None
    built_at: datetime
    generation: int = 0


@dataclass(frozen=True)
class View:
    status: SourceStatus
    etag: str
    body: bytes


@dataclass
class FeedConfig:
    enabled: bool = False
    refresh_seconds: int = 1800
    max_items: int = 12
    max_stale_hours: int = 72
    exclude_tag: str | None = "hide-from-site"
    social_set_id: int | None = None
    snapshot_path: str | None = None


@dataclass
class _Counts:
    listed: int = 0
    excluded: int = 0
    fetched: int = 0
    invalid: int = 0
    dropped: int = 0
    deferred: int = 0
    reasons: dict[str, int] = field(default_factory=dict)


class FeedService:
    def __init__(
        self,
        config: FeedConfig,
        provider: FeedProvider | None,
        *,
        provider_name: SourceProvider,
        misconfigured: bool = False,
        curation: Curation | None = None,
        clock: Clock = utc_now,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        rng: random.Random | None = None,
    ) -> None:
        self.config = config
        self.provider = provider
        self.provider_name: SourceProvider = provider_name
        self.misconfigured = misconfigured
        self.curation = curation or Curation()
        self.clock = clock
        self._sleep = sleep
        self._rng = rng
        self._store = SnapshotStore(config.snapshot_path, FeedSnapshot)
        self._started_at = clock()
        self._auth_failed = False
        self._state = FeedState(entries={}, imported=(), last_success_at=None, built_at=clock())
        self._views: dict[tuple[int, SourceStatus], View] = {}

    # construction

    @classmethod
    def from_settings(
        cls,
        settings: Settings,
        http: "httpx.AsyncClient | None" = None,
        *,
        clock: Clock = utc_now,
        curation_path: Path = CURATION_PATH,
    ) -> "FeedService":
        config = FeedConfig(
            enabled=settings.social_feed_enabled,
            refresh_seconds=settings.social_feed_refresh_seconds,
            max_items=settings.social_feed_max_items,
            max_stale_hours=settings.social_feed_max_stale_hours,
            exclude_tag=settings.social_feed_exclude_tag or None,
            social_set_id=settings.typefully_social_set_id,
            snapshot_path=settings.social_feed_snapshot_path,
        )
        if not config.enabled:
            return cls(config, None, provider_name="none", clock=clock)

        curation = _load_curation_or_empty(curation_path)
        if settings.social_feed_provider == "fixture":
            return cls(
                config, FixtureProvider(), provider_name="fixture", curation=curation, clock=clock
            )

        key, set_id = settings.typefully_api_key, settings.typefully_social_set_id
        if key is None or set_id is None or http is None:
            missing = [
                name
                for name, value in (
                    ("TYPEFULLY_API_KEY", key),
                    ("TYPEFULLY_SOCIAL_SET_ID", set_id),
                    ("http client", http),
                )
                if value is None
            ]
            logger.error(
                "social feed misconfigured: serving curated posts only",
                extra={"event": "feed.misconfigured", "missing": missing},
            )
            return cls(
                config,
                None,
                provider_name="typefully",
                misconfigured=True,
                curation=curation,
                clock=clock,
            )
        if settings.environment != "prod":
            logger.warning(
                "the typefully provider is polling outside prod",
                extra={"event": "feed.non_prod_poller", "environment": settings.environment},
            )
        from src.feed.providers.typefully import TypefullyProvider  # httpx only when polling

        provider = TypefullyProvider(http, key, set_id)
        return cls(config, provider, provider_name="typefully", curation=curation, clock=clock)

    # properties

    @property
    def enabled(self) -> bool:
        return self.config.enabled

    @property
    def polls(self) -> bool:
        return self.enabled and self.provider is not None and self.provider.polls

    @property
    def is_static(self) -> bool:
        return self.enabled and self.provider is not None and not self.provider.polls

    @property
    def state(self) -> FeedState:
        return self._state

    def describe(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "provider": self.provider_name,
            "polls": self.polls,
            "persistent": self._store.persistent,
        }

    # status and response

    def status(self, now: datetime | None = None) -> SourceStatus:
        if not self.enabled:
            return "disabled"
        now = now or self.clock()
        last = self._state.last_success_at
        if self.misconfigured or self._auth_failed or self.provider is None:
            return "error"
        if not self.provider.polls:
            return "fresh" if last is not None else "error"
        if now - (last or self._started_at) > timedelta(hours=self.config.max_stale_hours):
            return "error"
        if last is not None and now - last <= timedelta(seconds=2 * self.config.refresh_seconds):
            return "fresh"
        return "stale"

    def items(self, status: SourceStatus) -> tuple[FeedItem, ...]:
        if status == "disabled":
            return ()
        imported = () if status == "error" else self._state.imported
        imported_ids = {v.id for item in imported for v in item.variants.values()}
        native = tuple(
            item
            for item in self.curation.native
            if not any(v.id in imported_ids for v in item.variants.values())
        )
        merged = [
            self.curation.apply(item)
            for item in (*imported, *native)
            if not self.curation.hidden(item)
        ]

        def order(item: FeedItem) -> tuple[int, int, float]:
            pin = self.curation.pin_of(item)
            newest_first = -item.published_at.timestamp()
            return (0, pin, newest_first) if pin is not None else (1, 0, newest_first)

        merged.sort(key=order)
        return tuple(merged[: self.config.max_items])

    def view(self) -> View:
        status = self.status()
        key = (self._state.generation, status)
        cached = self._views.get(key)
        if cached is not None:
            return cached
        items = self.items(status)
        digest = hashlib.sha256(_ITEMS.dump_json(items) + b"|" + status.encode()).hexdigest()
        response = PostsResponse(
            enabled=self.enabled,
            generated_at=self._state.built_at,
            source=FeedSource(
                provider=self.provider_name,
                status=status,
                last_success_at=self._state.last_success_at,
            ),
            items=items,
        )
        view = View(
            status=status, etag=f'W/"{digest[:16]}"', body=response.model_dump_json().encode()
        )
        self._views = {k: v for k, v in self._views.items() if k[0] == key[0]}
        self._views[key] = view
        return view

    # refresh

    async def refresh_once(self) -> CycleResult:
        """One cycle: list, fetch new or changed drafts, normalise, swap. Never raises
        ProviderError; returns what the refresh loop should do next."""
        provider = self.provider
        if provider is None:
            return CycleResult(CycleOutcome.AUTH)
        started = self.clock()
        try:
            summaries = await provider.list_published()
        except ProviderError as exc:
            return self._failed(exc, "list")

        counts = _Counts(listed=len(summaries))
        exclude = self.config.exclude_tag
        previous = self._state.entries
        entries: dict[int, CachedDraft] = {}
        for summary in summaries:
            if exclude and exclude in summary.tags:
                counts.excluded += 1
                continue
            old = previous.get(summary.draft_id)
            if old is not None and old.updated_at == summary.updated_at:
                entries[summary.draft_id] = old
                continue
            if provider.should_defer():
                counts.deferred += 1
                if old is not None:
                    entries[summary.draft_id] = old
                continue
            try:
                raw = await provider.get_draft(summary.draft_id)
            except ProviderError as exc:
                if exc.kind == "not_found":  # deleted between the listing and the fetch
                    continue
                return self._failed(exc, "get_draft")
            counts.fetched += 1
            entries[summary.draft_id] = self._normalize(summary.draft_id, raw, summary, counts)

        if counts.fetched >= DRIFT_MIN_FETCHED and counts.invalid * 2 > counts.fetched:
            logger.warning(
                "most fetched drafts failed validation: keeping the previous snapshot",
                extra={
                    "event": "feed.drift",
                    "fetched": counts.fetched,
                    "invalid": counts.invalid,
                    "reasons": counts.reasons,
                },
            )
            return CycleResult(CycleOutcome.DRIFT)

        now = self.clock()
        imported = sorted(
            (e.item for e in entries.values() if e.item is not None),
            key=lambda item: item.published_at,
            reverse=True,
        )
        self._swap(
            FeedState(
                entries=entries,
                imported=tuple(imported),
                last_success_at=now,
                built_at=now,
                generation=self._state.generation + 1,
            )
        )
        self._save()
        logger.info(
            "feed refreshed",
            extra={
                "event": "feed.refresh",
                "outcome": "ok",
                "duration_ms": round((self.clock() - started).total_seconds() * 1000),
                "listed": counts.listed,
                "excluded": counts.excluded,
                "fetched": counts.fetched,
                "invalid": counts.invalid,
                "dropped": counts.dropped,
                "deferred": counts.deferred,
                "reasons": counts.reasons,
                "items": len(imported),
            },
        )
        return CycleResult(CycleOutcome.OK)

    def _normalize(
        self, draft_id: int, raw: Mapping[str, Any], summary: DraftSummary, counts: _Counts
    ) -> CachedDraft:
        try:
            result = normalize_draft(raw, summary, self.config.exclude_tag)
            item, reason, skipped = result.item, result.reason, result.skipped
        except (ValueError, TypeError):  # pydantic ValidationError is a ValueError
            item, reason, skipped = None, "schema", ()
        for code in (*skipped, *([reason] if reason else [])):
            counts.reasons[code] = counts.reasons.get(code, 0) + 1
        if reason is not None:
            if reason in _INTENTIONAL_DROPS:
                counts.dropped += 1
            else:
                counts.invalid += 1
            logger.info(
                "draft skipped",
                extra={"event": "feed.skipped", "draft_id": draft_id, "reason": reason},
            )
        return CachedDraft(updated_at=summary.updated_at, item=item, reason=reason)

    def _failed(self, exc: ProviderError, step: str) -> CycleResult:
        if exc.kind in ("auth", "not_found"):
            # 401/403, or a listing 404 (wrong social set id): stop until a restart.
            self._auth_failed = True
            self._views.clear()
            logger.error(
                "feed source rejected the request: polling stopped",
                extra={"event": "feed.auth_failed", "step": step, "kind": exc.kind},
            )
            return CycleResult(CycleOutcome.AUTH)
        if exc.kind == "rate_limited":
            return CycleResult(CycleOutcome.RATE_LIMITED, retry_after=exc.retry_after)
        return CycleResult(CycleOutcome.TRANSIENT)

    def _swap(self, state: FeedState) -> None:
        self._state = state
        self._views = {}

    async def run_forever(self) -> None:
        refresher = PeriodicRefresher(
            self.refresh_once,
            float(self.config.refresh_seconds),
            name="feed",
            sleep=self._sleep,
            rng=self._rng,
        )
        await refresher.run_forever()

    # persistence

    def load_snapshot(self) -> bool:
        """Serve the last saved snapshot until the first refresh. True if one was loaded."""
        if not self.enabled or self.provider is None:
            return False
        snap = self._store.load()
        if (
            snap is None
            or snap.provider != self.provider_name
            or snap.social_set_id != self.config.social_set_id
        ):
            return False
        entries = {
            e.draft_id: CachedDraft(updated_at=e.updated_at, item=e.item, reason=e.reason)
            for e in snap.entries
        }
        imported = sorted(
            (e.item for e in entries.values() if e.item is not None),
            key=lambda item: item.published_at,
            reverse=True,
        )
        self._swap(
            FeedState(
                entries=entries,
                imported=tuple(imported),
                last_success_at=snap.last_success_at,
                built_at=snap.saved_at,
                generation=self._state.generation + 1,
            )
        )
        return True

    def _save(self) -> None:
        state = self._state
        self._store.save(
            FeedSnapshot(
                provider=self.provider_name,
                social_set_id=self.config.social_set_id,
                saved_at=state.built_at,
                last_success_at=state.last_success_at,
                entries=tuple(
                    SnapshotEntry(
                        draft_id=draft_id,
                        updated_at=entry.updated_at,
                        item=entry.item,
                        reason=entry.reason,
                    )
                    for draft_id, entry in sorted(state.entries.items())
                ),
            )
        )


def _load_curation_or_empty(path: Path) -> Curation:
    try:
        return load_curation(path)
    except CurationError as exc:
        logger.error(
            "curation file rejected: serving without curation",
            extra={"event": "feed.curation_invalid", "error": str(exc)},
        )
        return Curation()
