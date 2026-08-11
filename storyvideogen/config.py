from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class GenerationSettings:
    story_path: Path
    title: str
    output_dir: Path
    target_seconds: int = 90
    width: int = 1920
    height: int = 1080
    words_per_minute: int = 145
    subtitle_language: str = "zh-CN"
    translator: str = "zai"
    translation_model: str = "glm-5.2"
    prompt_provider: str = "heuristic"
    prompt_model: str = "glm-5.2"
    image_provider: str = "openverse"
    image_workers: int = 4
    tts_provider: str = "edge"
    voice: str = "zh-CN-XiaoxiaoNeural"
    source_url: str | None = None
    author: str | None = None
    story_license: str | None = None
    background_music: Path | None = None
    music_volume: float = 0.18
    skip_video: bool = False
    dry_run: bool = False

    @property
    def target_words(self) -> int:
        return max(1, round(self.target_seconds * self.words_per_minute / 60))
