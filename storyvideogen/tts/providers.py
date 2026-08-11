from __future__ import annotations

from .base import TTSProvider
from .edge_tts_provider import EdgeTTSProvider
from .silent_provider import SilentTTSProvider


def build_tts_provider(name: str) -> TTSProvider:
    normalized = name.strip().lower()
    if normalized == "edge":
        return EdgeTTSProvider()
    if normalized == "silent":
        return SilentTTSProvider()
    raise ValueError(f"Unsupported TTS provider: {name}")

