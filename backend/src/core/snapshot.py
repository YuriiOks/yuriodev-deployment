"""Optional on-disk copy of an in-memory snapshot: validated load, atomic save, memory-only
fallback.

The snapshot itself lives in memory and is replaced as a whole. Persisting it only lets a
restarted process serve the last good data before its first refresh finishes. Without a
configured path everything stays in memory, which is the default.
"""

import contextlib
import logging
import os
import tempfile
from pathlib import Path
from typing import Generic, TypeVar

from pydantic import BaseModel, ValidationError

logger = logging.getLogger("yuriodev.snapshot")

M = TypeVar("M", bound=BaseModel)

MAX_READ_BYTES = 1_048_576


class SnapshotStore(Generic[M]):
    """Stores one pydantic model as JSON at `path` (None: memory only).

    The model is expected to use extra="forbid" and to carry only data that is already
    allow-listed and normalised: this class writes whatever it is given.
    """

    def __init__(
        self, path: str | None, model: type[M], max_read_bytes: int = MAX_READ_BYTES
    ) -> None:
        self.path = Path(path) if path else None
        self.model = model
        self.max_read_bytes = max_read_bytes
        self._writable = self.path is not None

    @property
    def persistent(self) -> bool:
        return self._writable

    def load(self) -> M | None:
        """The stored model, or None when the file is missing, too big or invalid. Never raises."""
        if self.path is None:
            return None
        try:
            with self.path.open("rb") as handle:
                data = handle.read(self.max_read_bytes + 1)
        except FileNotFoundError:
            return None
        except OSError as exc:
            logger.warning(
                "snapshot unreadable",
                extra={"event": "snapshot.read_failed", "error": type(exc).__name__},
            )
            return None
        if len(data) > self.max_read_bytes:
            logger.warning("snapshot too large, ignored", extra={"event": "snapshot.ignored"})
            return None
        try:
            return self.model.model_validate_json(data)
        except ValidationError:
            logger.warning("snapshot invalid, ignored", extra={"event": "snapshot.ignored"})
            return None

    def save(self, snapshot: M) -> None:
        """Write atomically (temp file in the same directory, fsync, os.replace, mode 0600).

        On the first OSError (read-only filesystem, missing directory, disk full) log once and
        stay memory-only for the rest of the process.
        """
        if self.path is None or not self._writable:
            return
        data = snapshot.model_dump_json().encode()
        tmp_name: str | None = None
        try:
            fd, tmp_name = tempfile.mkstemp(
                dir=self.path.parent, prefix=f".{self.path.name}.", suffix=".tmp"
            )
            with os.fdopen(fd, "wb") as handle:  # mkstemp creates the file with mode 0600
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_name, self.path)
            tmp_name = None
        except OSError as exc:
            self._writable = False
            logger.warning(
                "snapshot not writable, running memory-only",
                extra={
                    "event": "snapshot.write_disabled",
                    "path": str(self.path),
                    "error": type(exc).__name__,
                },
            )
        finally:
            if tmp_name is not None:
                with contextlib.suppress(OSError):
                    os.unlink(tmp_name)
