"""Settings parsing. Each test builds a fresh Settings(_env_file=None) in a clean environment."""

import json

import pytest
from pydantic import ValidationError

from src.core.config import Settings, get_settings


def fresh():
    return Settings(_env_file=None)


def test_defaults_are_safe(clean_env):
    settings = fresh()

    assert settings.api_title == "YuriODev Website API"
    assert settings.api_version == "0.1.0"
    assert settings.environment == "unknown"
    assert settings.revision == "unknown"
    assert settings.cors_origins == []
    assert settings.api_docs_enabled is False
    assert settings.log_level == "INFO"
    assert settings.log_format == "json"
    assert settings.social_feed_enabled is False
    assert settings.social_feed_provider == "fixture"
    assert settings.social_feed_refresh_seconds == 1800
    assert settings.social_feed_snapshot_path is None
    assert settings.typefully_api_key is None
    assert settings.typefully_social_set_id is None


def test_cors_origins_parsed_from_json_list(clean_env):
    clean_env.setenv("CORS_ORIGINS", '["https://one.example", "https://two.example"]')

    assert fresh().cors_origins == ["https://one.example", "https://two.example"]


def test_empty_values_fall_back_to_defaults(clean_env):
    for name in ("CORS_ORIGINS", "LOG_LEVEL", "LOG_FORMAT", "API_DOCS_ENABLED", "ENVIRONMENT"):
        clean_env.setenv(name, "")

    settings = fresh()

    assert settings.cors_origins == []
    assert settings.log_level == "INFO"
    assert settings.log_format == "json"
    assert settings.api_docs_enabled is False
    assert settings.environment == "unknown"


def test_environment_and_revision_read_from_env(clean_env):
    clean_env.setenv("ENVIRONMENT", "stage")
    clean_env.setenv("REVISION", "abc1234")
    clean_env.setenv("BUILD_REF", "master")

    settings = fresh()

    assert settings.environment == "stage"
    assert settings.revision == "abc1234"
    assert settings.build_ref == "master"


def test_log_level_and_format_are_case_insensitive(clean_env):
    clean_env.setenv("LOG_LEVEL", " debug ")
    clean_env.setenv("LOG_FORMAT", "Console")

    settings = fresh()

    assert settings.log_level == "DEBUG"
    assert settings.log_format == "console"


@pytest.mark.parametrize(("name", "value"), [("LOG_LEVEL", "LOUD"), ("LOG_FORMAT", "xml")])
def test_invalid_logging_values_are_rejected(clean_env, name, value):
    clean_env.setenv(name, value)

    with pytest.raises(ValidationError):
        fresh()


def test_non_string_log_level_is_rejected(clean_env):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, log_level=10)


def test_api_docs_flag_read_from_env(clean_env):
    clean_env.setenv("API_DOCS_ENABLED", "true")

    assert fresh().api_docs_enabled is True


def test_unknown_env_var_is_ignored(clean_env):
    clean_env.setenv("SOME_UNRELATED_SETTING", "whatever")

    assert not hasattr(fresh(), "some_unrelated_setting")


def test_settings_are_frozen(clean_env):
    settings = fresh()

    with pytest.raises(ValidationError):
        settings.environment = "prod"


def test_get_settings_is_cached_and_reads_the_environment(clean_env):
    get_settings.cache_clear()
    clean_env.setenv("ENVIRONMENT", "cached-env")

    first = get_settings()

    assert first is get_settings()
    assert first.environment == "cached-env"


def test_feed_settings_read_from_env(clean_env):
    clean_env.setenv("SOCIAL_FEED_ENABLED", "true")
    clean_env.setenv("SOCIAL_FEED_PROVIDER", " Typefully ")
    clean_env.setenv("TYPEFULLY_SOCIAL_SET_ID", "334563")
    clean_env.setenv("TYPEFULLY_API_KEY", "tf-secret-value")
    clean_env.setenv("SOCIAL_FEED_REFRESH_SECONDS", "900")
    clean_env.setenv("SOCIAL_FEED_SNAPSHOT_PATH", "/app/data/posts-snapshot.json")

    settings = fresh()

    assert settings.social_feed_enabled is True
    assert settings.social_feed_provider == "typefully"
    assert settings.typefully_social_set_id == 334563
    assert settings.typefully_api_key.get_secret_value() == "tf-secret-value"
    assert settings.social_feed_refresh_seconds == 900
    assert settings.social_feed_snapshot_path == "/app/data/posts-snapshot.json"


def test_the_api_key_is_masked(clean_env):
    clean_env.setenv("TYPEFULLY_API_KEY", "tf-secret-value")

    settings = fresh()

    assert "tf-secret-value" not in repr(settings)
    assert "tf-secret-value" not in str(settings)
    assert "tf-secret-value" not in settings.model_dump_json()


def test_an_empty_api_key_line_means_unset(clean_env):
    clean_env.setenv("TYPEFULLY_API_KEY", "")
    clean_env.setenv("TYPEFULLY_SOCIAL_SET_ID", "")

    settings = fresh()

    assert settings.typefully_api_key is None
    assert settings.typefully_social_set_id is None


@pytest.mark.parametrize(("raw", "expected"), [(" tf-key\n", "tf-key"), (" \t\n", None)])
def test_the_api_key_is_stripped_and_blank_means_unset(clean_env, raw, expected):
    clean_env.setenv("TYPEFULLY_API_KEY", raw)

    key = fresh().typefully_api_key

    assert (key.get_secret_value() if key else None) == expected


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("SOCIAL_FEED_PROVIDER", "x-api"),
        ("SOCIAL_FEED_REFRESH_SECONDS", "10"),
        ("SOCIAL_FEED_MAX_ITEMS", "0"),
        ("TYPEFULLY_SOCIAL_SET_ID", "0"),
        ("TYPEFULLY_SOCIAL_SET_ID", "abc"),
    ],
)
def test_invalid_feed_values_are_rejected(clean_env, name, value):
    clean_env.setenv(name, value)

    with pytest.raises(ValidationError):
        fresh()


def test_dashboards_are_off_and_closed_by_default(clean_env):
    settings = fresh()

    assert settings.database_url is None
    assert settings.dashboards_api_token is None
    assert settings.dashboards_trust_proxy_auth is False
    assert settings.dashboards_enabled is False
    assert settings.dashboards_timezone == "Europe/London"


def test_dashboards_settings_are_read_from_the_environment(clean_env):
    clean_env.setenv("DATABASE_URL", "  postgresql://u:pw-in-url@h/d\n")
    clean_env.setenv("DASHBOARDS_API_TOKEN", " tok-123 ")
    clean_env.setenv("DASHBOARDS_TRUST_PROXY_AUTH", "true")

    settings = fresh()

    assert settings.dashboards_enabled is True
    assert settings.database_url.get_secret_value() == "postgresql://u:pw-in-url@h/d"
    assert settings.dashboards_api_token.get_secret_value() == "tok-123"
    assert settings.dashboards_trust_proxy_auth is True
    assert "pw-in-url" not in repr(settings)
    assert "tok-123" not in repr(settings)


def test_blank_dashboards_secrets_mean_unset(clean_env):
    for name in ("DATABASE_URL", "DASHBOARDS_API_TOKEN"):
        clean_env.setenv(name, "")
    settings = fresh()

    assert settings.database_url is None
    assert settings.dashboards_api_token is None

    clean_env.setenv("DATABASE_URL", "   ")
    assert fresh().database_url is None


def test_the_dashboards_time_zone_must_be_an_iana_name(clean_env):
    clean_env.setenv("DASHBOARDS_TIMEZONE", "Pacific/Auckland")
    assert fresh().dashboards_timezone == "Pacific/Auckland"

    for bad in ("Mars/Olympus", "../etc/passwd", "BST"):
        clean_env.setenv("DASHBOARDS_TIMEZONE", bad)
        with pytest.raises(ValidationError):
            fresh()


def test_collectors_are_off_by_default(clean_env):
    settings = fresh()

    assert settings.github_token is None
    assert settings.linear_api_key is None
    assert settings.github_space == "work-1"
    assert settings.linear_space == "work-1"
    assert settings.github_search_scope == ""
    assert settings.dashboards_collect_interval_seconds == 300
    assert settings.collectors_enabled is False


def test_collectors_need_the_database_and_a_credential(clean_env):
    clean_env.setenv("GITHUB_TOKEN", "gh-value")
    assert fresh().collectors_enabled is False  # no DATABASE_URL

    clean_env.setenv("DATABASE_URL", "postgresql://u:p@h/d")
    assert fresh().collectors_enabled is True

    clean_env.delenv("GITHUB_TOKEN")
    assert fresh().collectors_enabled is False
    clean_env.setenv("LINEAR_API_KEY", " lin-value \n")
    settings = fresh()
    assert settings.collectors_enabled is True
    assert settings.linear_api_key.get_secret_value() == "lin-value"
    assert "lin-value" not in repr(settings)


def test_collector_spaces_never_include_work_2(clean_env):
    for name in ("GITHUB_SPACE", "LINEAR_SPACE"):
        for bad in ("work-2", "elsewhere"):
            clean_env.setenv(name, bad)
            with pytest.raises(ValidationError):
                fresh()
        clean_env.setenv(name, " Personal ")
        settings = fresh()
        assert getattr(settings, name.lower()) == "personal"
        clean_env.delenv(name)


def test_the_collect_interval_is_bounded(clean_env):
    clean_env.setenv("DASHBOARDS_COLLECT_INTERVAL_SECONDS", "30")
    assert fresh().dashboards_collect_interval_seconds == 30

    for bad in ("29", "86401", "soon"):
        clean_env.setenv("DASHBOARDS_COLLECT_INTERVAL_SECONDS", bad)
        with pytest.raises(ValidationError):
            fresh()


def test_the_github_scope_is_a_short_printable_qualifier(clean_env):
    clean_env.setenv("GITHUB_SEARCH_SCOPE", "  org:example-org   repo:example-org/x ")
    assert fresh().github_search_scope == "org:example-org repo:example-org/x"

    for bad in ("x" * 201, "bell\x07"):
        clean_env.setenv("GITHUB_SEARCH_SCOPE", bad)
        with pytest.raises(ValidationError):
            fresh()


def test_calendar_feeds_are_secrets_and_count_as_a_credential(clean_env):
    settings = fresh()
    assert settings.calendar_ics_personal is None
    assert settings.calendar_ics_work_1 is None
    assert settings.calendar_owner_emails is None

    clean_env.setenv("DATABASE_URL", "postgresql://u:p@h/d")
    pasted = "  https://calendar.example.test/secret-feed/basic.ics\n"
    clean_env.setenv("CALENDAR_ICS_WORK_1", pasted)
    settings = fresh()

    assert settings.collectors_enabled is True
    assert settings.calendar_ics_work_1.get_secret_value().endswith("/basic.ics")
    assert "secret-feed" not in repr(settings)
    clean_env.setenv("CALENDAR_ICS_WORK_1", "   ")
    assert fresh().calendar_ics_work_1 is None


def test_a_malformed_calendar_address_is_never_echoed_by_the_settings(clean_env):
    clean_env.setenv("CALENDAR_ICS_PERSONAL", "not even a url, secret-token-text")

    settings = fresh()  # accepted here: the collector drops what it cannot use, silently

    assert "secret-token-text" not in repr(settings)


def test_space_names_default_to_nothing(clean_env):
    assert fresh().dashboards_space_names is None
    assert fresh().space_names == {}


def test_space_names_are_read_trimmed_and_limited_to_the_known_spaces(clean_env):
    clean_env.setenv(
        "DASHBOARDS_SPACE_NAMES",
        '{"work-1": "  Acme  ", "work-2": "Globex", "personal": "Home", "work-3": "Nope"}',
    )

    assert fresh().space_names == {"work-1": "Acme", "work-2": "Globex", "personal": "Home"}


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ('{"work-1": "x"}', {"work-1": "x"}),
        ('{"work-1": "a" }', {"work-1": "a"}),
        ('{"work-1": "' + "n" * 24 + '"}', {"work-1": "n" * 24}),
        ('{"work-1": "' + "n" * 25 + '"}', {}),
        ('{"work-1": ""}', {}),
        ('{"work-1": "   "}', {}),
        ('{"work-1": 5, "work-2": null, "personal": ["x"]}', {}),
        ('{"work-1": "bad\\nname", "work-2": "Fine"}', {"work-2": "Fine"}),
        ('{"work-1": "\\u0410\\u043a\\u043c\\u0435"}', {"work-1": "\u0410\u043a\u043c\u0435"}),
        ("[]", {}),
        ('"just a string"', {}),
        ("not json at all", {}),
        ('{"work-1": "unterminated', {}),
        ("", {}),
    ],
)
def test_a_bad_space_name_is_ignored_and_never_stops_startup(clean_env, raw, expected):
    clean_env.setenv("DASHBOARDS_SPACE_NAMES", raw)

    assert fresh().space_names == expected


PNG_DATA = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4"
    "2mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
PNG = "data:image/png;base64," + PNG_DATA
SVG = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4="


def icons_from(clean_env, data):
    clean_env.setenv("DASHBOARDS_SPACE_ICONS", data if isinstance(data, str) else json.dumps(data))
    return fresh().space_icons


def test_space_icons_default_to_nothing(clean_env):
    assert fresh().dashboards_space_icons is None
    assert fresh().space_icons == {}


@pytest.mark.parametrize(
    "prefix",
    [
        "data:image/png;base64,",
        "data:image/svg+xml;base64,",
        "data:image/x-icon;base64,",
        "data:image/vnd.microsoft.icon;base64,",
        "data:image/webp;base64,",
    ],
)
def test_every_allowed_image_type_is_accepted(clean_env, prefix):
    uri = prefix + "AAAA"

    assert icons_from(clean_env, {"work-1": uri}) == {"work-1": uri}


def test_icons_are_kept_per_known_space_and_the_bad_ones_dropped_one_by_one(clean_env):
    data = {"personal": PNG, "work-1": SVG, "work-2": "https://example.test/logo.png", "other": PNG}

    assert icons_from(clean_env, data) == {"personal": PNG, "work-1": SVG}


@pytest.mark.parametrize(
    "value",
    [
        "https://example.test/logo.png",
        "data:image/gif;base64,AAAA",
        "data:image/png,AAAA",
        "data:image/png;base64,",
        "data:image/png;base64,not base64!",
        "data:image/png;base64,AAA",
        "data:image/png;base64,AA AA",
        "data:text/html;base64,AAAA",
        "javascript:alert(1)",
        "",
        5,
        None,
        ["data:image/png;base64,AAAA"],
    ],
)
def test_a_value_that_is_not_an_allowed_data_uri_is_dropped(clean_env, value):
    assert icons_from(clean_env, {"work-1": value}) == {}


def test_the_size_limit_is_48_kib_for_the_whole_value(clean_env):
    prefix = "data:image/png;base64,"
    fits = prefix + "A" * 49_128  # a valid payload: a multiple of 4 characters
    too_big = fits + "AAAA"

    assert len(fits) <= 48 * 1024 < len(too_big)
    assert icons_from(clean_env, {"work-1": fits, "work-2": too_big}) == {"work-1": fits}


@pytest.mark.parametrize("raw", ["[]", '"x"', "not json", '{"work-1": "unterminated', ""])
def test_a_malformed_icons_setting_is_ignored_and_never_stops_startup(clean_env, raw):
    assert icons_from(clean_env, raw) == {}
