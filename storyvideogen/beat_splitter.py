from __future__ import annotations

import re

from dataclasses import replace

from .models import StoryChunk


_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")


def split_into_chunks(text: str, target_seconds: int, words_per_minute: int, max_words: int = 26) -> list[StoryChunk]:
    sentences = [sentence.strip() for sentence in _SENTENCE_RE.split(text.strip()) if sentence.strip()]
    if not sentences:
        return []

    grouped = _group_sentences(sentences, max_words=max_words)
    durations = _scaled_durations([len(chunk.split()) for chunk in grouped], target_seconds, words_per_minute)

    chunks: list[StoryChunk] = []
    cursor = 0.0
    for index, (chunk_text, duration) in enumerate(zip(grouped, durations), start=1):
        start = cursor
        end = start + duration
        chunks.append(StoryChunk(index=index, text=chunk_text, start_seconds=start, end_seconds=end))
        cursor = end
    return chunks


def _group_sentences(sentences: list[str], max_words: int) -> list[str]:
    grouped: list[str] = []
    current: list[str] = []
    current_words = 0

    for sentence in sentences:
        sentence_words = len(sentence.split())
        if current and current_words + sentence_words > max_words:
            grouped.append(" ".join(current))
            current = []
            current_words = 0

        if sentence_words > max_words:
            words = sentence.split()
            for start in range(0, len(words), max_words):
                grouped.append(" ".join(words[start : start + max_words]))
            continue

        current.append(sentence)
        current_words += sentence_words

    if current:
        grouped.append(" ".join(current))

    return grouped


def _scaled_durations(word_counts: list[int], target_seconds: int, words_per_minute: int) -> list[float]:
    if not word_counts:
        return []

    estimated = [max(2.0, words / words_per_minute * 60) for words in word_counts]
    estimated_total = sum(estimated)
    scale = target_seconds / estimated_total if estimated_total > 0 else 1.0
    return [duration * scale for duration in estimated]


def retime_chunks(chunks: list[StoryChunk], total_seconds: float) -> list[StoryChunk]:
    if not chunks:
        return []
    word_counts = [max(1, chunk.word_count) for chunk in chunks]
    total_words = sum(word_counts)
    cursor = 0.0
    retimed: list[StoryChunk] = []
    for chunk, words in zip(chunks, word_counts):
        duration = total_seconds * words / total_words
        start = cursor
        end = start + duration
        retimed.append(replace(chunk, start_seconds=start, end_seconds=end))
        cursor = end
    return retimed
