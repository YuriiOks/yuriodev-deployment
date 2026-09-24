# Website API Tests - Settings parsing
# File: tests/test_settings.py
#
# Each test builds a FRESH Settings() instance (the module-level `settings`
# singleton in src.core.config is created once at import time and must not
# be reused here). Tests run with cwd pointed at an empty tmp_path and pass
# _env_file=None so no real .env file (in particular backend/.env) is ever
# read.

from src.core.config import Settings


def test_cors_origins_parsed_from_json_list(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv(
        "CORS_ORIGINS", '["https://one.example", "https://two.example"]'
    )

    fresh_settings = Settings(_env_file=None)

    assert fresh_settings.cors_origins == [
        "https://one.example",
        "https://two.example",
    ]


def test_unknown_env_var_is_ignored(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SOME_UNRELATED_SETTING", "whatever")

    fresh_settings = Settings(_env_file=None)

    assert not hasattr(fresh_settings, "some_unrelated_setting")


def test_defaults_when_env_unset(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    monkeypatch.delenv("API_TITLE", raising=False)
    monkeypatch.delenv("API_VERSION", raising=False)
    monkeypatch.delenv("LOG_LEVEL", raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.delenv("REVISION", raising=False)

    fresh_settings = Settings(_env_file=None)

    assert fresh_settings.cors_origins == [
        "https://yuriodev.co.uk",
        "http://localhost:5173",
    ]
    assert fresh_settings.api_title == "YuriODev Website API"
    assert fresh_settings.api_version == "0.1.0"
    assert fresh_settings.log_level == "INFO"
    assert fresh_settings.environment == "unknown"
    assert fresh_settings.revision == "unknown"


def test_environment_and_revision_read_from_env(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("ENVIRONMENT", "stage")
    monkeypatch.setenv("REVISION", "abc1234")

    fresh_settings = Settings(_env_file=None)

    assert fresh_settings.environment == "stage"
    assert fresh_settings.revision == "abc1234"
