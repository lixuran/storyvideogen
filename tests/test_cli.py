from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
import os
from pathlib import Path

from storyvideogen.cli import build_parser


class CLITest(unittest.TestCase):
    def test_generate_defaults_to_chinese_zai_narration(self) -> None:
        args = build_parser().parse_args(
            [
                "generate",
                "--story",
                "input/test1.txt",
                "--title",
                "Story",
                "--out",
                "output/test",
            ]
        )

        self.assertEqual(args.translator, "zai")
        self.assertEqual(args.translation_model, "glm-5.2")
        self.assertEqual(args.chunk_seconds, 30)
        self.assertEqual(args.image_provider, "zhipu")
        self.assertEqual(args.image_model, "glm-image")
        self.assertEqual(args.voice, "zh-CN-XiaoxiaoNeural")

    def test_ui_command_defaults_to_localhost(self) -> None:
        args = build_parser().parse_args(["ui"])

        self.assertEqual(args.command, "ui")
        self.assertEqual(args.host, "127.0.0.1")
        self.assertEqual(args.port, 7860)

    def test_zai_prompt_provider_missing_key_reports_clean_error(self) -> None:
        root = Path(__file__).resolve().parents[1]

        with tempfile.TemporaryDirectory() as temp_dir:
            env = os.environ.copy()
            env.pop("ZAI_API_KEY", None)
            env.pop("ZHIPUAI_API_KEY", None)
            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "storyvideogen",
                    "generate",
                    "--story",
                    str(root / "samples" / "short_story.txt"),
                    "--title",
                    "Story",
                    "--out",
                    str(Path(temp_dir) / "out"),
                    "--translator",
                    "mock",
                    "--prompt-provider",
                    "zai",
                    "--dry-run",
                ],
                cwd=root,
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )

        self.assertEqual(result.returncode, 1)
        self.assertIn("ZAI_API_KEY", result.stdout)
        self.assertNotIn("Traceback", result.stderr)


if __name__ == "__main__":
    unittest.main()
