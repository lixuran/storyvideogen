from __future__ import annotations

from pathlib import Path
from typing import Protocol

from storyvideogen.models import AudioAsset


class TTSProvider(Protocol):
    name: str

    def synthesize(self, text: str, output_dir: Path, voice: str, target_seconds: int) -> AudioAsset:
        ...

