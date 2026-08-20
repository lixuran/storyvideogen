import unittest
from unittest.mock import patch

from storyvideogen.full_story_planner import plan_full_story, split_complete_source, validate_complete_plan


class FullStoryPlannerTest(unittest.TestCase):
    def test_splitter_covers_every_character_once_in_order(self) -> None:
        text = "  First repeated sentence.  " + " ".join(["echo"] * 145) + "\n第二段，带有中文标点。  "
        ranges = split_complete_source(text)
        self.assertEqual("".join(item.text for item in ranges), text)
        self.assertEqual(ranges[0].start, 0)
        self.assertEqual(ranges[-1].end, len(text))
        self.assertTrue(all(item.start == (ranges[index - 1].end if index else 0) for index, item in enumerate(ranges)))
        self.assertTrue(all(len(item.text.split()) <= 140 for item in ranges))

    def test_fixture_plan_has_narration_prompts_and_exact_coverage(self) -> None:
        text = "A hallway light flickered. The keeper continued downstairs."
        plan = plan_full_story(text, provider="fixture")
        self.assertEqual(plan["planningSource"], "fixture")
        validate_complete_plan(text, plan["scenes"])
        self.assertEqual("".join(scene["sourceText"] for scene in plan["scenes"]), text)
        self.assertTrue(all(len(scene["prompts"]) == 3 for scene in plan["scenes"]))

    def test_scene_duration_defaults_to_thirty_seconds_and_is_configurable(self) -> None:
        text = " ".join(f"word{index}" for index in range(160))
        default_plan = plan_full_story(text, provider="fixture")
        longer_plan = plan_full_story(text, provider="fixture", target_scene_seconds=60)

        self.assertEqual(default_plan["targetSceneSeconds"], 30)
        self.assertEqual(len(default_plan["scenes"]), 3)
        self.assertEqual(longer_plan["targetSceneSeconds"], 60)
        self.assertEqual(len(longer_plan["scenes"]), 2)
        with self.assertRaisesRegex(ValueError, "between 15 and 120"):
            plan_full_story(text, provider="fixture", target_scene_seconds=10)

    def test_invalid_zhipu_output_falls_back_only_when_allowed(self) -> None:
        with patch("storyvideogen.full_story_planner._plan_with_zhipu", side_effect=ValueError("partial output")):
            fallback = plan_full_story("Every source word remains.", provider="zhipu", require_llm=False)
            self.assertEqual(fallback["planningSource"], "deterministic_fallback")
            with self.assertRaisesRegex(ValueError, "partial output"):
                plan_full_story("Every source word remains.", provider="zhipu", require_llm=True)

    def test_maximum_word_limit_is_complete_and_overflow_is_rejected(self) -> None:
        accepted = " ".join(["word"] * 30_000)
        ranges = split_complete_source(accepted)
        self.assertEqual("".join(item.text for item in ranges), accepted)
        with self.assertRaisesRegex(ValueError, "30,000"):
            split_complete_source(f"{accepted} overflow")

    def test_validator_rejects_gaps_and_out_of_order_ranges(self) -> None:
        with self.assertRaisesRegex(ValueError, "offsets"):
            validate_complete_plan("abcdef", [{"sourceStart": 1, "sourceEnd": 6, "sourceText": "bcdef", "narrationText": "n", "prompts": ["p"]}])


if __name__ == "__main__":
    unittest.main()
