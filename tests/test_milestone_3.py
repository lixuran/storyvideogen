from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class MilestoneThreeE2ETest(unittest.TestCase):
    def test_generate_fetches_fixture_images_and_manifest(self) -> None:
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
            prompts_path = out_dir / "prompts.json"
            manifest_path = out_dir / "image_manifest.json"
            plan_path = out_dir / "run_plan.json"

            self.assertTrue(prompts_path.exists())
            self.assertTrue(manifest_path.exists())

            prompts = json.loads(prompts_path.read_text(encoding="utf-8"))
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            plan = json.loads(plan_path.read_text(encoding="utf-8"))

            self.assertEqual(len(prompts), len(manifest))
            self.assertEqual(plan["image_count"], len(manifest))
            self.assertGreater(len(manifest), 0)
            for asset in manifest:
                self.assertEqual(asset["license_name"], "CC0")
                self.assertTrue((out_dir / asset["local_path"]).exists() or Path(asset["local_path"]).exists())
                self.assertGreaterEqual(len(asset["prompt"].split()), 2)


if __name__ == "__main__":
    unittest.main()
