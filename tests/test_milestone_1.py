from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class MilestoneOneE2ETest(unittest.TestCase):
    def test_generate_dry_run_writes_plan(self) -> None:
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
                    "--translator",
                    "mock",
                    "--dry-run",
                ],
                cwd=root,
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            plan_path = out_dir / "run_plan.json"
            self.assertTrue(plan_path.exists())

            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            self.assertEqual(plan["title"], "The Amber Hallway")
            self.assertEqual(plan["width"], 1920)
            self.assertEqual(plan["height"], 1080)
            self.assertGreater(plan["selected_words"], 0)


if __name__ == "__main__":
    unittest.main()
