import unittest

from storyvideogen.models import StoryChunk
from storyvideogen.render.srt_writer import split_subtitle_cues


class SubtitleCueTest(unittest.TestCase):
    def test_splits_spaced_narration_into_ten_word_timed_cues(self) -> None:
        source = StoryChunk(index=1, text=" ".join(f"word{index}" for index in range(25)), start_seconds=0, end_seconds=30)

        cues = split_subtitle_cues([source])

        self.assertEqual([len(cue.text.split()) for cue in cues], [10, 10, 5])
        self.assertEqual(cues[0].start_seconds, 0)
        self.assertEqual(cues[-1].end_seconds, 30)
        self.assertTrue(all(left.end_seconds == right.start_seconds for left, right in zip(cues, cues[1:])))

    def test_splits_chinese_narration_into_short_cues(self) -> None:
        source = StoryChunk(index=1, text="这是一个用于验证中文字幕分段和 SCP-173 时间连续性的较长句子。" * 3, start_seconds=4, end_seconds=34)

        cues = split_subtitle_cues([source])

        self.assertGreater(len(cues), 1)
        self.assertTrue(all(len(cue.text) <= 22 for cue in cues))
        self.assertNotIn(" ", "".join(cue.text for cue in cues))
        self.assertEqual(cues[0].start_seconds, 4)
        self.assertEqual(cues[-1].end_seconds, 34)


if __name__ == "__main__":
    unittest.main()
