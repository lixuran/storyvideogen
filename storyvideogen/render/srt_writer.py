from __future__ import annotations

import re
from pathlib import Path

from storyvideogen.models import StoryChunk


def split_subtitle_cues(chunks: list[StoryChunk], max_words: int = 10, max_characters: int = 22) -> list[StoryChunk]:
    cues: list[StoryChunk] = []
    for chunk in chunks:
        text = (chunk.subtitle_text or chunk.text).strip()
        segments = _segments(text, max_words, max_characters)
        weights = [max(1, len(segment.replace(" ", ""))) for segment in segments]
        total_weight = sum(weights)
        duration = max(0, chunk.end_seconds - chunk.start_seconds)
        cursor = chunk.start_seconds
        for position, (segment, weight) in enumerate(zip(segments, weights, strict=True)):
            end = chunk.end_seconds if position == len(segments) - 1 else cursor + duration * weight / total_weight
            cues.append(StoryChunk(index=len(cues) + 1, text=segment, subtitle_text=segment, start_seconds=cursor, end_seconds=end))
            cursor = end
    return cues


def write_srt(path: Path, chunks: list[StoryChunk]) -> None:
    lines: list[str] = []
    for chunk in chunks:
        lines.append(str(chunk.index))
        lines.append(f"{_format_timestamp(chunk.start_seconds)} --> {_format_timestamp(chunk.end_seconds)}")
        lines.append(chunk.subtitle_text or chunk.text)
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def _segments(text: str, max_words: int, max_characters: int) -> list[str]:
    visible = re.sub(r"\s+", "", text)
    cjk_count = len(re.findall(r"[\u3400-\u9fff]", visible))
    if cjk_count >= max(1, len(visible) // 4):
        return [visible[start:start + max_characters] for start in range(0, len(visible), max_characters)] or [visible]
    words = text.split()
    if len(words) > 1:
        return [" ".join(words[start:start + max_words]) for start in range(0, len(words), max_words)]
    return [text[start:start + max_characters] for start in range(0, len(text), max_characters)] or [text]


def _format_timestamp(seconds: float) -> str:
    total_ms = max(0, round(seconds * 1000))
    hours, remainder = divmod(total_ms, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"

