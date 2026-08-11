from __future__ import annotations

import subprocess
from pathlib import Path

from storyvideogen.media import probe_duration, require_executable
from storyvideogen.models import AudioAsset


class SilentTTSProvider:
    name = "silent"

    def synthesize(self, text: str, output_dir: Path, voice: str, target_seconds: int) -> AudioAsset:
        require_executable("ffmpeg")
        output_dir.mkdir(parents=True, exist_ok=True)
        path = output_dir / "narration.wav"
        result = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "anullsrc=channel_layout=stereo:sample_rate=44100",
                "-t",
                str(target_seconds),
                "-c:a",
                "pcm_s16le",
                str(path),
            ],
            text=True,
            capture_output=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg failed to create silent narration: {result.stderr.strip()}")
        return AudioAsset(
            local_path=path,
            duration_seconds=probe_duration(path),
            provider=self.name,
            voice=voice,
        )

