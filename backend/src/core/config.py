"""Runtime settings, read once from the process environment.

Sources, in order: code defaults <- env/<env>.env <- env/<env>.secrets.env. Compose injects
both files as container environment variables; nothing reads a dotenv file from disk.
"""

from functools import lru_cache
from typing import Any, Literal

from pydantic import Field, SecretStr, ValidationInfo, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
LogFormat = Literal["json", "console"]
FeedProviderName = Literal["fixture", "typefully"]


class Settings(BaseSettings):
    """All runtime config.

    - Unknown variables are ignored, so a leftover key in an env file never stops the app.
    - An empty variable (``FOO=``) counts as unset and falls back to the code default.
    - Every field has a default that is safe on the public internet (docs off, no CORS,
      social feed off).
    """

    model_config = SettingsConfigDict(
        extra="ignore",
        env_ignore_empty=True,
        frozen=True,
    )

    # identity, reported by /health
    api_title: str = "YuriODev Website API"
    api_version: str = "0.1.0"
    environment: str = "unknown"
    revision: str = "unknown"

    # http surface
    # JSON list, e.g. CORS_ORIGINS=["http://localhost:5173"]. Empty means no CORS middleware:
    # every deployed environment is same-origin through the proxy.
    cors_origins: list[str] = Field(default_factory=list)
    # OpenAPI schema and Swagger UI under /api/, meant for dev only.
    api_docs_enabled: bool = False

    # logging
    log_level: LogLevel = "INFO"
    log_format: LogFormat = "json"

    # social feed (GET /api/posts). Off unless SOCIAL_FEED_ENABLED=true. The typefully
    # provider also needs TYPEFULLY_API_KEY (secrets file only) and TYPEFULLY_SOCIAL_SET_ID;
    # without them the feed reports status "error" and serves curated posts only.
    social_feed_enabled: bool = False
    social_feed_provider: FeedProviderName = "fixture"
    social_feed_refresh_seconds: int = Field(1800, ge=300, le=86_400)
    social_feed_max_items: int = Field(12, ge=1, le=50)
    social_feed_max_stale_hours: int = Field(72, ge=1, le=720)
    social_feed_exclude_tag: str = "hide-from-site"
    # A JSON copy of the last good snapshot, so a restarted process has posts before its
    # first refresh. None keeps everything in memory.
    social_feed_snapshot_path: str | None = None
    typefully_social_set_id: int | None = Field(None, gt=0)
    # Able to publish as the account owner: treat as a full credential. Never logged.
    typefully_api_key: SecretStr | None = None

    @field_validator("log_level", "log_format", "social_feed_provider", mode="before")
    @classmethod
    def _normalise_case(cls, value: Any, info: ValidationInfo) -> Any:
        if not isinstance(value, str):
            return value
        value = value.strip()
        return value.upper() if info.field_name == "log_level" else value.lower()

    @field_validator("typefully_api_key", mode="before")
    @classmethod
    def _strip_key(cls, value: Any) -> Any:
        # A pasted key often carries a trailing space or newline; blank means unset. Any other
        # odd character is left in place for the feed to report as misconfigured.
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """The process-wide settings, built on first use (never at import time)."""
    return Settings()
