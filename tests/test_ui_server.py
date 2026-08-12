from __future__ import annotations

import unittest
from pathlib import Path

from storyvideogen.interactive_workflow import InteractiveSettings, prepare_interactive_project
from storyvideogen.ui_server import _HTML


class UIServerTest(unittest.TestCase):
    def test_ui_exposes_chunk_seconds_control(self) -> None:
        self.assertIn('name="chunk_seconds"', _HTML)
        self.assertIn("Seconds per image chunk", _HTML)
        self.assertIn("120s video at 30s per chunk", _HTML)

    def test_ui_exposes_manual_image_picker(self) -> None:
        self.assertIn("Choose Local Image", _HTML)
        self.assertIn("/api/manual-image", _HTML)
        self.assertIn('input.type = "file"', _HTML)

    def test_ui_defaults_to_zhipu_image_provider(self) -> None:
        self.assertIn('<option value="zhipu" selected>zhipu</option>', _HTML)
        self.assertIn('name="image_model" value="glm-image"', _HTML)
        self.assertIn('name="image_workers" type="number" min="1" max="16" value="1"', _HTML)
        self.assertIn('name="candidates_per_chunk" type="number" min="1" max="6" value="2"', _HTML)
        self.assertIn("avoid HTTP 429 rate limits", _HTML)

    def test_zhipu_prepare_failure_does_not_fallback_to_baidu(self) -> None:
        settings = InteractiveSettings(
            story_text="The concrete statue waited in the locked room.",
            title="No Fallback Test",
            output_dir=Path("output/no_fallback_test"),
            translator="mock",
            prompt_provider="heuristic",
            image_provider="zhipu",
            image_model="glm-image",
            candidates_per_chunk=1,
        )

        project = prepare_interactive_project(settings)
        candidates = project["chunks"][0]["image_candidates"]

        self.assertIn("ZHIPU_IMAGE_API_KEY", candidates[0]["error"])
        self.assertIsNone(candidates[0]["asset"])


if __name__ == "__main__":
    unittest.main()
