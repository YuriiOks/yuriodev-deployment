"""SnapshotStore: round trip, atomic write, invalid files ignored, memory-only fallback."""

import logging
import os
import stat

import pytest
from pydantic import BaseModel, ConfigDict

from src.core.snapshot import SnapshotStore


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    format: str = "test/1"
    value: int


def test_round_trip_with_mode_0600_and_no_temp_file_left(tmp_path):
    path = tmp_path / "snap.json"
    store = SnapshotStore(str(path), Model)

    store.save(Model(value=3))

    assert store.load() == Model(value=3)
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert [p.name for p in tmp_path.iterdir()] == ["snap.json"]


def test_save_replaces_atomically_in_the_same_directory(tmp_path, monkeypatch):
    path = tmp_path / "snap.json"
    store = SnapshotStore(str(path), Model)
    store.save(Model(value=1))
    replaced = []
    real_replace = os.replace

    def spy(src, dst):
        replaced.append((os.path.dirname(src), os.path.basename(src)))
        real_replace(src, dst)

    monkeypatch.setattr(os, "replace", spy)
    store.save(Model(value=2))

    ((directory, name),) = replaced
    assert directory == str(tmp_path)
    assert name.startswith(".snap.json.")
    assert name.endswith(".tmp")
    assert store.load().value == 2


def test_no_path_is_memory_only(tmp_path):
    store = SnapshotStore(None, Model)

    store.save(Model(value=1))

    assert store.load() is None
    assert store.persistent is False


def test_a_missing_file_loads_as_none(tmp_path):
    assert SnapshotStore(str(tmp_path / "none.json"), Model).load() is None


@pytest.mark.parametrize(
    "content",
    [b"not json", b'{"value": "x"}', b'{"value": 1, "extra": "field"}', b"[]"],
)
def test_an_invalid_file_is_ignored(tmp_path, content, caplog):
    path = tmp_path / "snap.json"
    path.write_bytes(content)

    assert SnapshotStore(str(path), Model).load() is None
    assert any(getattr(r, "event", "") == "snapshot.ignored" for r in caplog.records)


def test_an_oversized_file_is_ignored(tmp_path):
    path = tmp_path / "snap.json"
    path.write_bytes(b'{"value": 1}' + b" " * 100)

    assert SnapshotStore(str(path), Model, max_read_bytes=50).load() is None


def test_an_unreadable_path_is_ignored(tmp_path, caplog):
    assert SnapshotStore(str(tmp_path), Model).load() is None  # a directory
    assert any(getattr(r, "event", "") == "snapshot.read_failed" for r in caplog.records)


@pytest.mark.skipif(os.geteuid() == 0, reason="root ignores directory permissions")
def test_a_read_only_directory_goes_memory_only_with_one_warning(tmp_path, caplog):
    directory = tmp_path / "ro"
    directory.mkdir()
    directory.chmod(0o500)
    store = SnapshotStore(str(directory / "snap.json"), Model)
    try:
        store.save(Model(value=1))
        store.save(Model(value=2))
    finally:
        directory.chmod(0o700)

    warnings = [r for r in caplog.records if getattr(r, "event", "") == "snapshot.write_disabled"]
    assert len(warnings) == 1
    assert warnings[0].levelno == logging.WARNING
    assert store.persistent is False
    assert list(directory.iterdir()) == []


def test_a_failed_write_removes_its_temp_file(tmp_path, monkeypatch):
    path = tmp_path / "snap.json"
    store = SnapshotStore(str(path), Model)

    def fail(*args):
        raise OSError("disk full")

    monkeypatch.setattr(os, "replace", fail)
    store.save(Model(value=1))

    assert list(tmp_path.iterdir()) == []
    assert store.persistent is False
