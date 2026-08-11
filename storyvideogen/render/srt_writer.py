from __future__ import annotations

from pathlib import Path

from storyvideogen.models import StoryChunk


def write_srt(path: Path, chunks: list[StoryChunk]) -> None:
    lines: list[str] = []
    for chunk in chunks:
        lines.append(str(chunk.index))
        lines.append(f"{_format_timestamp(chunk.start_seconds)} --> {_format_timestamp(chunk.end_seconds)}")
        lines.append(chunk.subtitle_text or chunk.text)
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def _format_timestamp(seconds: float) -> str:
    total_ms = max(0, round(seconds * 1000))
    hours, remainder = divmod(total_ms, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"

