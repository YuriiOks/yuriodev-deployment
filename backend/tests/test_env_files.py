"""Every tracked env/<env>.env parses into Settings and carries no secret value.

A malformed value (LOG_LEVEL=verbose, LOG_FORMAT=text, a broken CORS_ORIGINS list) stops the
backend at startup, so it has to fail here, in CI, before the file reaches the box. CI checks
out the whole repository; where only backend/ is present (the local dev container) these
tests are skipped.
"""

import re
from pathlib import Path

import pytest
from dotenv import dotenv_values
from pydantic import ValidationError
from pydantic_settings import SettingsError

from src.core.config import Settings

ENV_DIR = Path(__file__).resolve().parents[2] / "env"
ENV_FILES = sorted(path for path in ENV_DIR.glob("*.env") if not path.name.endswith(".secrets.env"))
SECRET_SHAPED = re.compile(r"(_KEY|_TOKEN|_SECRET|_PASSWORD)$", re.IGNORECASE)

needs_env_files = pytest.mark.skipif(not ENV_FILES, reason=f"no tracked env files in {ENV_DIR}")


def secret_keys(path: Path) -> list[str]:
    return [
        key
        for key, value in dotenv_values(path).items()
        if SECRET_SHAPED.search(key) and value and value.strip()
    ]


@needs_env_files
@pytest.mark.parametrize("path", ENV_FILES, ids=lambda path: path.name)
def test_env_file_parses_into_settings(clean_env, path):
    # pydantic-settings strips quotes the way compose's env_file does.
    settings = Settings(_env_file=path)

    assert settings.environment == path.stem


@needs_env_files
@pytest.mark.parametrize("path", ENV_FILES, ids=lambda path: path.name)
def test_env_file_sets_no_secret(path):
    assert secret_keys(path) == [], f"{path.name} sets a secret; it belongs in a .secrets.env"


# The guards themselves, on scratch files, so they are exercised even where env/ is absent.


@pytest.mark.parametrize("line", ["LOG_FORMAT=text", "LOG_LEVEL=verbose", "CORS_ORIGINS=[oops"])
def test_a_malformed_value_is_caught(clean_env, tmp_path, line):
    path = tmp_path / "dev.env"
    path.write_text(f"ENVIRONMENT=dev\n{line}\n")

    with pytest.raises((ValidationError, SettingsError)):
        Settings(_env_file=path)


def test_quoted_values_are_unquoted_like_compose(clean_env, tmp_path):
    path = tmp_path / "dev.env"
    path.write_text('ENVIRONMENT=dev\nAPI_TITLE="YuriODev Website API (dev)"\n')

    assert Settings(_env_file=path).api_title == "YuriODev Website API (dev)"


def test_a_secret_value_is_flagged_and_an_empty_one_is_not(tmp_path):
    path = tmp_path / "dev.env"
    path.write_text("TYPEFULLY_API_KEY=abc\nGITHUB_TOKEN=\nDB_PASSWORD= \nLOG_LEVEL=INFO\n")

    assert secret_keys(path) == ["TYPEFULLY_API_KEY"]
