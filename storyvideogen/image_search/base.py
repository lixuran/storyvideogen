from __future__ import annotations

from pathlib import Path
from typing import Protocol

from storyvideogen.models import ImageAsset


class ImageProvider(Protocol):
    name: str

    def fetch_image(self, prompt: str, output_dir: Path, index: int) -> ImageAsset:
        ...

