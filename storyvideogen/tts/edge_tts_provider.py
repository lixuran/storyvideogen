from __future__ import annotations

import asyncio
from pathlib import Path

from storyvideogen.media import probe_duration
from storyvideogen.models import AudioAsset


class EdgeTTSProvider:
    name = "edge"

    def synthesize(self, text: str, output_dir: Path, voice: str, target_seconds: int) -> AudioAsset:
        try:
            import edge_tts
        except ImportError as exc:
            raise RuntimeError("edge-tts is not installed. Install the optional edge-tts dependency.") from exc

        output_dir.mkdir(parents=True, exist_ok=True)
        path = output_dir / "narration.mp3"
        asyncio.run(_save_edge_tts(edge_tts, text, voice, path))
        return AudioAsset(
            local_path=path,
            duration_seconds=probe_duration(path),
            provider=self.name,
            voice=voice,
        )


async def _save_edge_tts(edge_tts_module: object, text: str, voice: str, path: Path) -> None:
    communicate = edge_tts_module.Communicate(text=text, voice=voice)
    await communicate.save(str(path))

