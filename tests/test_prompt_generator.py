from __future__ import annotations

import unittest
from dataclasses import dataclass
from unittest.mock import patch

from storyvideogen.models import StoryChunk
from storyvideogen.prompt_generator import (
    ZAIPromptAgent,
    _parse_llm_prompts,
    _parse_llm_prompt_candidates,
    add_image_prompts,
    build_image_prompt,
    build_prompt_provider,
    generate_prompt_candidates,
)


class PromptGeneratorTest(unittest.TestCase):
    def test_generates_search_friendly_scene_prompt(self) -> None:
        prompt = build_image_prompt("The hallway smelled faintly of rain, though no window had been opened.")

        self.assertEqual(prompt, "empty hallway")
        self.assertNotIn("cozy creepy", prompt)
        self.assertLessEqual(len(prompt.split()), 4)

    def test_generates_scp_173_related_visual_prompt(self) -> None:
        prompt = build_image_prompt(
            "Origin is as of yet unknown. It is constructed from concrete and rebar with traces of Krylon brand spray paint. SCP-173 is animate and extremely hostile."
        )

        self.assertEqual(prompt, "concrete sculpture")

    def test_generates_containment_prompt_before_generic_scp_prompt(self) -> None:
        prompt = build_image_prompt("Item SCP-173 is to be kept in a locked container at all times.")

        self.assertEqual(prompt, "concrete prison cell")

    def test_specific_visual_cue_beats_container_word(self) -> None:
        prompt = build_image_prompt(
            "Personnel report sounds of scraping stone originating from within the container when no one is present inside."
        )

        self.assertEqual(prompt, "scratched concrete wall")

    def test_zai_provider_requires_api_key(self) -> None:
        agent = ZAIPromptAgent()
        chunks = [StoryChunk(index=1, text="SCP-173 is concrete.", start_seconds=0, end_seconds=1)]

        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "ZAI_API_KEY"):
                agent.generate_prompts(chunks)

    def test_add_image_prompts_accepts_agent_provider(self) -> None:
        @dataclass
        class FakePromptAgent:
            name: str = "fake"

            def generate_prompts(self, chunks: list[StoryChunk]) -> list[str]:
                return [f"prompt {chunk.index}" for chunk in chunks]

        chunks = [
            StoryChunk(index=1, text="a", start_seconds=0, end_seconds=1),
            StoryChunk(index=2, text="b", start_seconds=1, end_seconds=2),
        ]

        prompted = add_image_prompts(chunks, FakePromptAgent())

        self.assertEqual([chunk.image_prompt for chunk in prompted], ["prompt 1", "prompt 2"])

    def test_builds_zai_prompt_provider(self) -> None:
        provider = build_prompt_provider("zai", "test-model")

        self.assertIsInstance(provider, ZAIPromptAgent)
        self.assertEqual(provider.model, "test-model")

    def test_parse_llm_prompts_accepts_json_code_fence(self) -> None:
        output = '```json\n{"prompts":["locked chamber door","concrete statue"]}\n```'

        prompts = _parse_llm_prompts(output, expected_count=2)

        self.assertEqual(prompts, ["locked chamber door", "concrete statue"])

    def test_parse_llm_prompt_candidates_accepts_groups(self) -> None:
        output = '{"prompt_groups":[["locked door","steel chamber"],["concrete statue","rebar closeup"]]}'

        groups = _parse_llm_prompt_candidates(output, expected_count=2, candidates_per_chunk=2)

        self.assertEqual(groups, [["locked door", "steel chamber"], ["concrete statue", "rebar closeup"]])

    def test_generate_prompt_candidates_uses_heuristic_diversity(self) -> None:
        chunks = [StoryChunk(index=1, text="SCP-173 is made of concrete and rebar.", start_seconds=0, end_seconds=1)]

        groups = generate_prompt_candidates(chunks, candidates_per_chunk=3)

        self.assertEqual(len(groups), 1)
        self.assertEqual(len(groups[0]), 3)
        self.assertGreaterEqual(len(set(groups[0])), 2)


if __name__ == "__main__":
    unittest.main()
