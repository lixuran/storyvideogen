from __future__ import annotations

from pathlib import Path

from .models import Story


def load_story(
    path: Path,
    title: str,
    source_url: str | None = None,
    author: str | None = None,
    license_name: str | None = None,
) -> Story:
    if not path.exists():
        raise FileNotFoundError(f"Story file does not exist: {path}")
    if not path.is_file():
        raise ValueError(f"Story path is not a file: {path}")

    text = path.read_text(encoding="utf-8").strip()
    if not text:
        raise ValueError(f"Story file is empty: {path}")

    return Story(
        title=title.strip(),
        text=text,
        source_url=source_url,
        author=author,
        license_name=license_name,
    )


def select_target_excerpt(text: str, target_words: int) -> str:
    words = text.split()
    if len(words) <= target_words:
        return text.strip()
    return " ".join(words[:target_words]).strip()
