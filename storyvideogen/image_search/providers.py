from __future__ import annotations

from .baidu import BaiduImageProvider
from .base import ImageProvider
from .fixture import FixtureImageProvider
from .openverse import OpenverseImageProvider
from .pixabay import PixabayImageProvider
from .wikimedia import WikimediaImageProvider


def build_image_provider(name: str) -> ImageProvider:
    normalized = name.strip().lower()
    if normalized == "baidu":
        return BaiduImageProvider()
    if normalized == "fixture":
        return FixtureImageProvider()
    if normalized == "openverse":
        return OpenverseImageProvider()
    if normalized == "pixabay":
        return PixabayImageProvider()
    if normalized == "wikimedia":
        return WikimediaImageProvider()
    raise ValueError(f"Unsupported image provider: {name}")
