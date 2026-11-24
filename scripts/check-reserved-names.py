#!/usr/bin/env python3
"""Fails when a reserved name is written anywhere in the repository (file contents or file paths).

The names themselves must not be in the repository, so this checks hashes: scripts/reserved-names.txt holds
one line per name, `<length>:<sha256>`, of the name lower-cased with everything but letters and digits removed
(so "Some Name", "some-name" and "somename" are one entry). Text is split into words (runs of letters and
digits); a name is found when a window of a word, or two or three adjacent words joined, has that length and
hash. Long words (data URIs, hashes) are only compared whole. Binary files and lock files are skipped.

To add a name: `python scripts/check-reserved-names.py --hash "Some Name"` prints the line to add.
"""

import hashlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIST = ROOT / "scripts" / "reserved-names.txt"
WORD = re.compile(r"[A-Za-z0-9]+")
LONG_WORD = 40
SKIP_NAMES = {"package-lock.json", "uv.lock", "poetry.lock"}


def normalise(text: str) -> str:
    return "".join(WORD.findall(text)).lower()


def digest(name: str) -> str:
    return hashlib.sha256(name.encode()).hexdigest()


def entry(name: str) -> str:
    cleaned = normalise(name)
    return f"{len(cleaned)}:{digest(cleaned)}"


def load() -> dict[int, set[str]]:
    by_length: dict[int, set[str]] = {}
    for line in LIST.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        length, _, value = line.partition(":")
        by_length.setdefault(int(length), set()).add(value)
    return by_length


def hits(text: str, reserved: dict[int, set[str]]) -> bool:
    words = [word.lower() for word in WORD.findall(text)]
    lengths = sorted(reserved)
    for index, word in enumerate(words):
        # Whole words, and adjacent words joined (a name of two or three words).
        joined = word
        for extra in range(3):
            if extra:
                if index + extra >= len(words):
                    break
                joined += words[index + extra]
            if len(joined) in reserved and digest(joined) in reserved[len(joined)]:
                return True
        if len(word) > LONG_WORD:
            continue
        # A name inside a longer word ("somenamebank").
        for length in lengths:
            for start in range(0, len(word) - length + 1):
                if length < len(word) and digest(word[start : start + length]) in reserved[length]:
                    return True
    return False


def main() -> int:
    if len(sys.argv) == 3 and sys.argv[1] == "--hash":
        print(entry(sys.argv[2]))
        return 0
    reserved = load()
    files = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True).stdout.split(b"\0")
    found: list[str] = []
    for raw in filter(None, files):
        relative = raw.decode()
        path = ROOT / relative
        if hits(relative, reserved):
            found.append(f"{relative} (its path)")
            continue
        if path.name in SKIP_NAMES or not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        if hits(text, reserved):
            found.append(relative)
    if found:
        print("A reserved name is written in tracked files (the name is not shown here):")
        for relative in found:
            print(f"  {relative}")
        return 1
    print(f"No reserved name in {len(files) - 1} tracked files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
