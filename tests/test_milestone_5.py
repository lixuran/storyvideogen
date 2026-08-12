from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class MilestoneFiveE2ETest(unittest.TestCase):
    def test_generate_renders_video_and_attribution(self) -> None:
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
                    "--prompt-provider",
                    "heuristic",
                    "--image-provider",
                    "fixture",
                    "--tts-provider",
                    "silent",
                    "--author",
                    "Test Author",
                    "--source-url",
                    "https://example.com/story",
                    "--story-license",
                    "CC BY-SA 3.0",
                ],
                cwd=root,
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            video_path = out_dir / "video.mp4"
            credits_path = out_dir / "credits.txt"
            license_manifest_path = out_dir / "license_manifest.json"
            plan_path = out_dir / "run_plan.json"

            self.assertTrue(video_path.exists())
            self.assertGreater(video_path.stat().st_size, 10_000)
            self.assertTrue(credits_path.exists())
            self.assertTrue(license_manifest_path.exists())

            credits = credits_path.read_text(encoding="utf-8")
            self.assertIn("The Amber Hallway", credits)
            self.assertIn("Test Author", credits)

            manifest = json.loads(license_manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["story"]["license_name"], "CC BY-SA 3.0")
            self.assertEqual(manifest["video"]["width"], 1920)
            self.assertEqual(manifest["video"]["height"], 1080)

            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            self.assertGreater(plan["video_seconds"], 0)
            self.assertEqual(plan["artifacts"]["video_manifest"], "video_manifest.json")


if __name__ == "__main__":
    unittest.main()
