from __future__ import annotations

import unittest
from dataclasses import dataclass

from storyvideogen.models import StoryChunk
from storyvideogen.subtitle_translator import _parse_zai_translations, translate_chunks


class SubtitleTranslatorTest(unittest.TestCase):
    def test_parse_zai_translations_accepts_json_code_fence(self) -> None:
        output = '```json\n{"translations":["门被锁上了。","雕像站在角落里。"]}\n```'

        translations = _parse_zai_translations(output, expected_count=2)

        self.assertEqual(translations, ["门被锁上了。", "雕像站在角落里。"])

    def test_translate_chunks_uses_batch_translator_output(self) -> None:
        @dataclass
        class FakeTranslator:
            name: str = "fake"

            def translate_texts(self, texts: list[str]) -> list[str]:
                return [f"译文 {index}" for index, _ in enumerate(texts, start=1)]

        chunks = [
            StoryChunk(index=1, text="The door was locked.", start_seconds=0, end_seconds=1),
            StoryChunk(index=2, text="The statue moved.", start_seconds=1, end_seconds=2),
        ]

        translated = translate_chunks(chunks, FakeTranslator())

        self.assertEqual([chunk.subtitle_text for chunk in translated], ["译文 1", "译文 2"])


if __name__ == "__main__":
    unittest.main()
