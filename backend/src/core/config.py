"""Runtime settings, read once from the process environment.

Sources, in order: code defaults <- env/<env>.env <- env/<env>.secrets.env. Compose injects
both files as container environment variables; nothing reads a dotenv file from disk.
"""

import base64
import json
from functools import lru_cache
from typing import Any, Literal
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from pydantic import Field, SecretStr, ValidationInfo, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from src.core.filetext import read_text_file
from src.dashboards.catalog import (
    DEFAULT_SPACE_NAMES,
    ICON_PREFIXES,
    MAX_ICON_LENGTH,
    MAX_SPACE_NAME,
)
from src.dashboards.finance.logos import parse_logo_options, parse_provider_logos

LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
LogFormat = Literal["json", "console"]
FeedProviderName = Literal["fixture", "typefully"]
# Spaces a collector may fill. `work-2` is deliberately absent: nothing may write there on its own.
CollectorSpace = Literal["personal", "work-1"]
MONZO_CALLBACK_PATH = "/api/dashboards/v1/finance/monzo/callback"


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
    # branch the image was built from (images.yml: GIT_REF build arg -> BUILD_REF), so dev
    # shows which branch it is running
    build_ref: str = "unknown"

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

    # dashboards data API (/api/dashboards/**, /api/mcp). Off unless DATABASE_URL is set: the API
    # then answers "disabled" and nothing else changes. Both secrets live in env/<env>.secrets.env.
    # DATABASE_URL is a postgresql:// (or postgresql+asyncpg://) URL, password included.
    database_url: SecretStr | None = None
    # Shared secret for the X-Dashboards-Token header (a full credential for the data). With no
    # token and no trusted proxy every dashboards request is refused (closed by default).
    dashboards_api_token: SecretStr | None = None
    # dev and stage only: nginx basic auth has already authenticated the caller, so the API
    # accepts requests without the token header. Never set it in prod.
    dashboards_trust_proxy_auth: bool = False
    # IANA zone that decides what "today" is (overdue, `today`, day ranges). Not secret.
    dashboards_timezone: str = "Europe/London"
    # Display names of the spaces, a JSON object like {"work-1": "Acme", "work-2": "Globex"}, so
    # real names can live in the untracked secrets file instead of the public repo. Kept as text
    # and read through `space_names`: a malformed value must never stop the app, so it is not
    # parsed (or echoed) by pydantic.
    dashboards_space_names: str | None = None
    # Icons of the spaces, a JSON object keyed by space id whose values are small base64 data URIs
    # (png, svg, ico, webp, at most 48 KiB each), so real logos can live in the untracked secrets
    # file. Text like the names, read through `space_icons`, never a startup error.
    dashboards_space_icons: str | None = None
    # A file of the same JSON (`DASHBOARDS_SPACE_ICONS_FILE`), for when the environment variable
    # would pass the 128 KiB the kernel allows one string: it is merged over the variable.
    dashboards_space_icons_file: str | None = None
    # Bank logos for the Money page, a JSON object `{"<provider id>": {"on_light": "<data URI>",
    # "on_dark": "<data URI>"}}` in the secrets file (src/dashboards/finance/logos.py has the
    # rules). Text, read through `provider_logos`, never a startup error.
    dashboards_provider_logos: str | None = None
    # More of the same object, for when one variable would pass the 128 KiB the kernel allows one
    # string (`_2`, `_3`), and a file of it (`_FILE`); every source is merged, later over earlier
    # (the variable, `_2`, `_3`, the file).
    dashboards_provider_logos_2: str | None = None
    dashboards_provider_logos_3: str | None = None
    dashboards_provider_logos_file: str | None = None

    # Collectors (src/dashboards/collectors/): background pollers that turn outside work items
    # into tasks. They run only with the dashboards API on (DATABASE_URL) and each one only when
    # its credential is set. Tokens come from env/<env>.secrets.env and are never logged.
    dashboards_collect_interval_seconds: int = Field(300, ge=30, le=86_400)
    # GitHub: pull requests you opened and pull requests waiting for your review. Needs a token
    # that can search the repositories (see deploy/README.md for the minimum scopes).
    github_token: SecretStr | None = None
    github_space: CollectorSpace = "work-1"
    # Appended to both searches, e.g. an `org:<name>` qualifier: it lives in the secrets file so no
    # organisation name is ever in a tracked file.
    github_search_scope: str = ""
    # Linear: issues assigned to the API key's user that are not completed or canceled.
    linear_api_key: SecretStr | None = None
    linear_space: CollectorSpace = "work-1"
    # Calendar: read-only secret iCal addresses (Google Calendar's "secret address in iCal format"),
    # a comma-separated list of https URLs per space, one per calendar. The URLs are credentials:
    # secrets file only, never logged, never validated here (an error would echo them). There is no
    # setting for work-2: that space stays manual.
    calendar_ics_personal: SecretStr | None = None
    calendar_ics_work_1: SecretStr | None = None
    # Your own address(es), comma-separated: an event you declined in the feed is skipped.
    calendar_owner_emails: SecretStr | None = None

    # Finance (src/dashboards/finance/): read-only bank data. Off unless the dashboards API is on
    # and a bank credential is set; the credential comes from env/<env>.secrets.env, is never
    # logged and the collector makes no outbound call without it.
    # Monobank personal API token (read-only by nature; the owner enters it).
    monobank_token: SecretStr | None = None
    # How far back the first import of a new account reaches, in months (0: none, only the
    # newest month). A slow background walk of one statement window at a time.
    finance_backfill_months: int = Field(12, ge=0, le=36)
    # Seconds between finance collector ticks; each tick makes at most one provider request, and
    # never two within the provider's own minimum gap, whatever this is set to.
    finance_poll_interval_seconds: int = Field(90, ge=60, le=3600)
    # The currency the Money page shows every amount in (beside the original, at the latest rate).
    finance_display_currency: str = Field("GBP", pattern=r"^[A-Z]{3}$")
    # Monzo: the OAuth client registered in Monzo's developer portal (a confidential one, so it
    # gets a refresh token). Both in the secrets file; unset means no Monzo.
    monzo_client_id: SecretStr | None = None
    monzo_client_secret: SecretStr | None = None
    # The address this backend is reached at from a browser, for OAuth redirects, for example
    # https://dev.yuriodev.co.uk. Not secret. Kept as text and read through `public_base_url`: a
    # malformed value must never stop the app, it only leaves Monzo off.
    dashboards_public_base_url: str | None = None

    @property
    def dashboards_enabled(self) -> bool:
        return self.database_url is not None

    @property
    def space_names(self) -> dict[str, str]:
        """The valid renames from DASHBOARDS_SPACE_NAMES: known space ids only, values trimmed,
        1 to 24 printable characters. Anything else is ignored per key; nothing is logged."""
        return parse_space_names(self.dashboards_space_names)

    @property
    def space_icons(self) -> dict[str, str]:
        """The valid icons from DASHBOARDS_SPACE_ICONS: known space ids, an allowed image data
        URI with a valid base64 payload, at most 48 KiB. Anything else is dropped per key."""
        icons = parse_space_icons(self.dashboards_space_icons)
        icons.update(parse_space_icons(read_text_file(self.dashboards_space_icons_file)))
        return icons

    @property
    def provider_logos(self) -> dict[str, dict[str, str]]:
        """The valid logos of DASHBOARDS_PROVIDER_LOGOS (and its `_2`, `_3` and `_FILE` parts,
        merged), dropped one by one when invalid."""
        merged: dict[str, dict[str, str]] = {}
        for raw in (
            self.dashboards_provider_logos,
            self.dashboards_provider_logos_2,
            self.dashboards_provider_logos_3,
            read_text_file(self.dashboards_provider_logos_file),
        ):
            for provider, variants in parse_provider_logos(raw).items():
                merged.setdefault(provider, {}).update(variants)
        return merged

    @property
    def provider_logo_options(self) -> dict[str, dict[str, float | bool]]:
        """The `scale` and `mono` of each provider in the same settings, merged like the logos."""
        merged: dict[str, dict[str, float | bool]] = {}
        for raw in (
            self.dashboards_provider_logos,
            self.dashboards_provider_logos_2,
            self.dashboards_provider_logos_3,
            read_text_file(self.dashboards_provider_logos_file),
        ):
            for provider, found in parse_logo_options(raw).items():
                merged.setdefault(provider, {}).update(found)
        return merged

    @property
    def collectors_enabled(self) -> bool:
        credentials = (
            self.github_token,
            self.linear_api_key,
            self.calendar_ics_personal,
            self.calendar_ics_work_1,
        )
        return self.dashboards_enabled and any(item is not None for item in credentials)

    @property
    def public_base_url(self) -> str | None:
        """DASHBOARDS_PUBLIC_BASE_URL when it is an https origin (http only for localhost), with no
        path, query or credentials; else None."""
        return parse_public_base(self.dashboards_public_base_url)

    @property
    def monzo_redirect_uri(self) -> str | None:
        base = self.public_base_url
        return None if base is None else f"{base}{MONZO_CALLBACK_PATH}"

    @property
    def monzo_enabled(self) -> bool:
        credentials = self.monzo_client_id is not None and self.monzo_client_secret is not None
        return self.dashboards_enabled and credentials and self.monzo_redirect_uri is not None

    @property
    def finance_enabled(self) -> bool:
        monobank = self.dashboards_enabled and self.monobank_token is not None
        return monobank or self.monzo_enabled

    @field_validator(
        "log_level",
        "log_format",
        "social_feed_provider",
        "github_space",
        "linear_space",
        mode="before",
    )
    @classmethod
    def _normalise_case(cls, value: Any, info: ValidationInfo) -> Any:
        if not isinstance(value, str):
            return value
        value = value.strip()
        return value.upper() if info.field_name == "log_level" else value.lower()

    @field_validator("dashboards_timezone")
    @classmethod
    def _known_zone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except KeyError, ValueError, OSError:  # an unknown name is a ZoneInfoNotFoundError
            raise ValueError("DASHBOARDS_TIMEZONE must be an IANA time zone name") from None
        return value

    @field_validator("github_search_scope")
    @classmethod
    def _clean_scope(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value) > 200 or not value.isprintable():
            raise ValueError("GITHUB_SEARCH_SCOPE must be a short printable search qualifier")
        return value

    @field_validator(
        "typefully_api_key",
        "database_url",
        "dashboards_api_token",
        "github_token",
        "linear_api_key",
        "calendar_ics_personal",
        "calendar_ics_work_1",
        "calendar_owner_emails",
        "monobank_token",
        "monzo_client_id",
        "monzo_client_secret",
        mode="before",
    )
    @classmethod
    def _strip_key(cls, value: Any) -> Any:
        # A pasted key often carries a trailing space or newline; blank means unset. Any other
        # odd character is left in place for the feed to report as misconfigured. Nothing here
        # validates a secret's content: a pydantic error would echo the rejected value into the
        # crash log.
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value


def parse_public_base(raw: str | None) -> str | None:
    if not raw:
        return None
    value = raw.strip().rstrip("/")
    try:
        parts = urlsplit(value)
    except ValueError:
        return None
    local = parts.hostname in ("localhost", "127.0.0.1")
    scheme_ok = parts.scheme == "https" or (parts.scheme == "http" and local)
    clean = (
        parts.hostname
        and not parts.username
        and not parts.password
        and parts.path in ("", "/")
        and not parts.query
        and not parts.fragment
        and value.isprintable()
        and " " not in value
    )
    return value if scheme_ok and clean else None


def parse_space_names(raw: str | None) -> dict[str, str]:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except ValueError:
        return {}
    if not isinstance(data, dict):
        return {}
    names: dict[str, str] = {}
    for space_id in DEFAULT_SPACE_NAMES:
        value = data.get(space_id)
        if isinstance(value, str):
            name = value.strip()
            if 0 < len(name) <= MAX_SPACE_NAME and name.isprintable():
                names[space_id] = name
    return names


def parse_space_icons(raw: str | None) -> dict[str, str]:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except ValueError:
        return {}
    if not isinstance(data, dict):
        return {}
    icons: dict[str, str] = {}
    for space_id in DEFAULT_SPACE_NAMES:
        value = data.get(space_id)
        if isinstance(value, str) and _valid_icon(value):
            icons[space_id] = value
    return icons


def _valid_icon(value: str) -> bool:
    if len(value) > MAX_ICON_LENGTH:
        return False
    prefix = next((p for p in ICON_PREFIXES if value.startswith(p)), None)
    if prefix is None:
        return False
    try:
        return len(base64.b64decode(value[len(prefix) :], validate=True)) > 0
    except ValueError:  # binascii.Error is one
        return False


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """The process-wide settings, built on first use (never at import time)."""
    return Settings()
