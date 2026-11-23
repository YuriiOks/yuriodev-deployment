"""Dependency seams: handlers get collaborators here, so tests can override them."""

from typing import cast
from zoneinfo import ZoneInfo

from fastapi import Request

from src.core.clock import Clock
from src.core.config import Settings
from src.feed.service import FeedService


def get_settings_dep(request: Request) -> Settings:
    """The settings the running app was built with (not a fresh read of the environment)."""
    return cast(Settings, request.app.state.settings)


def get_feed_service(request: Request) -> FeedService:
    """The feed built in the app lifespan. Route tests override this dependency."""
    return cast(FeedService, request.app.state.feed)


def get_clock(request: Request) -> Clock:
    """The app's clock (`create_app(clock=...)`), so tests can fix the time."""
    return cast(Clock, request.app.state.clock)


def get_zone(request: Request) -> ZoneInfo:
    """The time zone that decides what "today" is (`DASHBOARDS_TIMEZONE`)."""
    return cast(ZoneInfo, request.app.state.zone)
