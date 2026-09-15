from __future__ import annotations

from .baidu import BaiduImageProvider
from .base import ImageProvider
from .fixture import FixtureImageProvider
from .openverse import OpenverseImageProvider
from .pexels import PexelsImageProvider
from .pixabay import PixabayImageProvider
from .siliconflow import SiliconFlowImageProvider
from .wikimedia import WikimediaImageProvider
from .zhipu import ZhipuImageProvider


def build_image_provider(name: str, model: str = "glm-image") -> ImageProvider:
    normalized = name.strip().lower()
    if normalized == "baidu":
        return BaiduImageProvider()
    if normalized == "fixture":
        return FixtureImageProvider()
    if normalized == "openverse":
        return OpenverseImageProvider()
    if normalized == "pexels":
        return PexelsImageProvider()
    if normalized == "pixabay":
        return PixabayImageProvider()
    if normalized == "siliconflow":
        return SiliconFlowImageProvider(model=model)
    if normalized == "wikimedia":
        return WikimediaImageProvider()
    if normalized == "zhipu":
        return ZhipuImageProvider(model=model)
    raise ValueError(f"Unsupported image provider: {name}")
