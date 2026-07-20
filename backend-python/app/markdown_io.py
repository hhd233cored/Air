"""Read and write Markdown without platform-specific newline expansion."""

from __future__ import annotations

import re
from pathlib import Path


def normalize_markdown(value: str) -> str:
    """Use LF line endings and repair duplicated carriage returns from old saves."""

    return re.sub(r"\r+\n", "\n", value).replace("\r", "\n")


def read_markdown(path: Path) -> str:
    """Read UTF-8 Markdown while preserving intentional blank lines."""

    return normalize_markdown(path.read_bytes().decode("utf-8"))


def write_markdown(path: Path, value: str) -> None:
    """Write UTF-8 Markdown with stable LF line endings on every platform."""

    path.write_bytes(normalize_markdown(value or "").encode("utf-8"))
