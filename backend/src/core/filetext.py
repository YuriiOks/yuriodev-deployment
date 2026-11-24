"""Settings text that does not fit in an environment variable, read from a file.

The kernel refuses a single environment string of 128 KiB or more, which a dozen inline images
exceed, so a setting such as the bank logos may name a file instead (`*_FILE`). The file is read
whole (at most 4 MiB, UTF-8) and cached until its size or modification time changes, so a request
never pays for the disk twice. A path that is missing, unreadable, too large or not text is
simply no text: never an error and never logged (a path or content may be private).
"""

from pathlib import Path

MAX_FILE_BYTES = 4 * 1024 * 1024
_cache: dict[str, tuple[tuple[int, int], str | None]] = {}


def read_text_file(path: str | None) -> str | None:
    if not path:
        return None
    try:
        info = Path(path).stat()
    except OSError:
        return None
    stamp = (info.st_mtime_ns, info.st_size)
    cached = _cache.get(path)
    if cached is not None and cached[0] == stamp:
        return cached[1]
    text: str | None = None
    if 0 < info.st_size <= MAX_FILE_BYTES:
        try:
            text = Path(path).read_text(encoding="utf-8")
        except OSError, UnicodeDecodeError:
            text = None
    _cache[path] = (stamp, text)
    return text
