"""Runtime settings, read once from the process environment.

Sources, in order: code defaults <- env/<env>.env <- env/<env>.secrets.env. Compose injects
both files as container environment variables; nothing reads a dotenv file from disk.
"""

from functools import lru_cache
from typing import Any, Literal

from pydantic import Field, ValidationInfo, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
LogFormat = Literal["json", "console"]


class Settings(BaseSettings):
    """All runtime config.

    - Unknown variables are ignored, so a leftover key in an env file never stops the app.
    - An empty variable (``FOO=``) counts as unset and falls back to the code default.
    - Every field has a default that is safe on the public internet (docs off, no CORS).
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

    @field_validator("log_level", "log_format", mode="before")
    @classmethod
    def _normalise_case(cls, value: Any, info: ValidationInfo) -> Any:
        if not isinstance(value, str):
            return value
        value = value.strip()
        return value.upper() if info.field_name == "log_level" else value.lower()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """The process-wide settings, built on first use (never at import time)."""
    return Settings()
