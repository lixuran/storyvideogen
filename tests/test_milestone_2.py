from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class MilestoneTwoE2ETest(unittest.TestCase):
    def test_generate_writes_srt_with_mock_translation(self) -> None:
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
                    "90",
                    "--translator",
                    "mock",
                    "--prompt-provider",
                    "heuristic",
                    "--dry-run",
                ],
                cwd=root,
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            srt_path = out_dir / "subtitles.zh-CN.srt"
            narration_path = out_dir / "narration.zh-CN.txt"
            selected_story_path = out_dir / "selected_story.txt"
            plan_path = out_dir / "run_plan.json"

            self.assertTrue(srt_path.exists())
            self.assertTrue(narration_path.exists())
            self.assertTrue(selected_story_path.exists())

            srt = srt_path.read_text(encoding="utf-8")
            self.assertIn("00:00:00,000 -->", srt)
            self.assertIn("简体中文占位", srt)
            self.assertIn("简体中文占位", narration_path.read_text(encoding="utf-8"))

            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            self.assertGreaterEqual(plan["chunk_count"], 2)
            self.assertEqual(plan["artifacts"]["narration_script"], "narration.zh-CN.txt")
            self.assertEqual(plan["artifacts"]["subtitles"], "subtitles.zh-CN.srt")


if __name__ == "__main__":
    unittest.main()
