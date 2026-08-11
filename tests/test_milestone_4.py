from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class MilestoneFourE2ETest(unittest.TestCase):
    def test_generate_writes_silent_narration_manifest(self) -> None:
        root = Path(__file__).resolve().parents[1]
        story = root / "samples" / "short_story.txt"

        with tempfile.TemporaryDirectory() as temp_dir:
            out_dir = Path(temp_dir) / "demo"
            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "storyvideogen",
                    "generate",
                    "--story",
                    str(story),
                    "--title",
                    "The Amber Hallway",
                    "--out",
                    str(out_dir),
                    "--target-seconds",
                    "5",
                    "--translator",
                    "mock",
                    "--image-provider",
                    "fixture",
                    "--tts-provider",
                    "silent",
                    "--skip-video",
                ],
                cwd=root,
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            audio_manifest_path = out_dir / "audio_manifest.json"
            self.assertTrue(audio_manifest_path.exists())

            audio_manifest = json.loads(audio_manifest_path.read_text(encoding="utf-8"))
            narration_path = Path(audio_manifest["local_path"])
            self.assertTrue(narration_path.exists())
            self.assertEqual(audio_manifest["provider"], "silent")
            self.assertEqual(audio_manifest["voice"], "zh-CN-XiaoxiaoNeural")
            self.assertGreaterEqual(audio_manifest["duration_seconds"], 4.9)

            plan = json.loads((out_dir / "run_plan.json").read_text(encoding="utf-8"))
            self.assertGreaterEqual(plan["audio_seconds"], 4.9)


if __name__ == "__main__":
    unittest.main()
