from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from storyvideogen.interactive_workflow import (
    InteractiveSettings,
    compose_interactive_project,
    prepare_interactive_project,
)
from storyvideogen.tts.silent_provider import SilentTTSProvider


class InteractiveWorkflowTest(unittest.TestCase):
    def test_prepare_downloads_multiple_image_candidates_per_chunk(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            out_dir = Path(temp_dir) / "project"
            project = prepare_interactive_project(
                InteractiveSettings(
                    story_text="The locked door waited. The concrete statue watched.",
                    title="Test Story",
                    output_dir=out_dir,
                    target_seconds=4,
                    translator="mock",
                    prompt_provider="heuristic",
                    image_provider="fixture",
                    candidates_per_chunk=2,
                )
            )

            self.assertTrue((out_dir / "interactive_project.json").exists())
            self.assertTrue((out_dir / "image_candidates_manifest.json").exists())
            self.assertGreaterEqual(len(project["chunks"]), 1)
            for chunk in project["chunks"]:
                self.assertEqual(len(chunk["image_candidates"]), 2)
                self.assertTrue(any(candidate["asset"] for candidate in chunk["image_candidates"]))

    def test_compose_uses_selected_images_and_looped_background_music(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            music_dir = root / "music"
            music_asset = SilentTTSProvider().synthesize("", music_dir, "silent", 1)
            out_dir = root / "project"
            project = prepare_interactive_project(
                InteractiveSettings(
                    story_text="The locked door waited. The concrete statue watched.",
                    title="Test Story",
                    output_dir=out_dir,
                    target_seconds=4,
                    translator="mock",
                    prompt_provider="heuristic",
                    image_provider="fixture",
                    candidates_per_chunk=2,
                    tts_provider="silent",
                )
            )
            selections = {
                int(chunk["index"]): int(chunk["image_candidates"][0]["candidate_index"])
                for chunk in project["chunks"]
            }

            result = compose_interactive_project(
                out_dir,
                selections,
                background_music=music_asset.local_path,
                music_volume=0.1,
                tts_provider="silent",
            )

            self.assertTrue(Path(result["video_path"]).exists())
            self.assertTrue((out_dir / "video_manifest.json").exists())
            image_manifest = json.loads((out_dir / "image_manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(len(image_manifest), len(project["chunks"]))


if __name__ == "__main__":
    unittest.main()
