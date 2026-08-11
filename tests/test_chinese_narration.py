from __future__ import annotations

import unittest

from storyvideogen.models import StoryChunk
from storyvideogen.pipeline import _build_narration_text


class ChineseNarrationTest(unittest.TestCase):
    def test_build_narration_text_prefers_chinese_subtitle_text(self) -> None:
        chunks = [
            StoryChunk(
                index=1,
                text="The door was locked.",
                start_seconds=0,
                end_seconds=1,
                subtitle_text="门被锁上了。",
            ),
            StoryChunk(
                index=2,
                text="The statue moved.",
                start_seconds=1,
                end_seconds=2,
                subtitle_text="雕像动了。",
            ),
        ]

        narration_text = _build_narration_text(chunks)

        self.assertEqual(narration_text, "门被锁上了。\n\n雕像动了。")

    def test_build_narration_text_falls_back_to_source_text(self) -> None:
        chunks = [
            StoryChunk(index=1, text="Already translated text.", start_seconds=0, end_seconds=1),
        ]

        narration_text = _build_narration_text(chunks)

        self.assertEqual(narration_text, "Already translated text.")


if __name__ == "__main__":
    unittest.main()
