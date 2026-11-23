"""Settings parsing. Each test builds a fresh Settings(_env_file=None) in a clean environment."""

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
