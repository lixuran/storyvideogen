from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Story:
    title: str
    text: str
    source_url: str | None = None
    author: str | None = None
    license_name: str | None = None

    @property
    def word_count(self) -> int:
        return len(self.text.split())


@dataclass(frozen=True)
class StoryChunk:
    index: int
    text: str
    start_seconds: float
    end_seconds: float
    subtitle_text: str = ""
    image_prompt: str = ""

    @property
    def duration_seconds(self) -> float:
        return self.end_seconds - self.start_seconds

    @property
    def word_count(self) -> int:
        return len(self.text.split())


@dataclass(frozen=True)
class ImageAsset:
    index: int
    prompt: str
    local_path: Path
    source_url: str
    creator: str
    license_name: str
    license_url: str
    provider: str
    title: str | None = None
    width: int | None = None
    height: int | None = None

    def to_json_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["local_path"] = str(self.local_path)
        return data


@dataclass(frozen=True)
class AudioAsset:
    local_path: Path
    duration_seconds: float
    provider: str
    voice: str

    def to_json_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["local_path"] = str(self.local_path)
        return data


@dataclass(frozen=True)
class VideoAsset:
    local_path: Path
    duration_seconds: float
    width: int
    height: int

    def to_json_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["local_path"] = str(self.local_path)
        return data


@dataclass(frozen=True)
class GenerationPlan:
    title: str
    source_story_path: Path
    output_dir: Path
    target_seconds: int
    target_words: int
    story_words: int
    selected_words: int
    chunk_count: int
    image_count: int
    audio_seconds: float
    video_seconds: float
    width: int
    height: int
    artifacts: dict[str, str] = field(default_factory=dict)

    def to_json_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["source_story_path"] = str(self.source_story_path)
        data["output_dir"] = str(self.output_dir)
        return data
