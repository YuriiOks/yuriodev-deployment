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

    settings = fresh()

    assert settings.environment == "stage"
    assert settings.revision == "abc1234"


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
