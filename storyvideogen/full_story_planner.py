from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from .llm_json import extract_json_object
from .prompt_generator import build_image_prompt
from .zai_client import get_zai_api_key, load_zai_client, message_content

DEFAULT_SCENE_SECONDS = 30
MIN_SCENE_SECONDS = 15
MAX_SCENE_SECONDS = 120
NARRATION_WORDS_PER_MINUTE = 150
MAX_SCENES = 1000
WINDOW_SCENES = 16


@dataclass(frozen=True)
class SourceRange:
    index: int
    start: int
    end: int
    text: str


def plan_full_story(source_text: str, provider: str = "fixture", model: str = "glm-5.2", require_llm: bool = False, target_scene_seconds: int = DEFAULT_SCENE_SECONDS) -> dict[str, Any]:
    max_words = scene_word_target(target_scene_seconds)
    ranges = split_complete_source(source_text, max_words=max_words)
    if provider == "fixture":
        details = [_fixture_details(item) for item in ranges]
        planning_source = "fixture"
    elif provider == "zhipu":
        try:
            details = _plan_with_zhipu(ranges, source_text, model)
            planning_source = "zhipu"
        except (RuntimeError, ValueError, TypeError, KeyError):
            if require_llm:
                raise
            details = [_fixture_details(item) for item in ranges]
            planning_source = "deterministic_fallback"
    else:
        raise ValueError(f"Unsupported planning provider: {provider}")
    scenes = []
    for source_range, detail in zip(ranges, details, strict=True):
        word_count = len(re.findall(r"\S+", source_range.text))
        scenes.append({
            "sourceStart": source_range.start,
            "sourceEnd": source_range.end,
            "sourceText": source_range.text,
            "narrationText": detail["narrationText"],
            "estimatedDurationMs": round(word_count / 150 * 60_000),
            "prompts": detail["prompts"],
        })
    validate_complete_plan(source_text, scenes)
    return {"planningSource": planning_source, "provider": provider, "model": model if provider == "zhipu" else None, "targetSceneSeconds": target_scene_seconds, "scenes": scenes}


def scene_word_target(target_scene_seconds: int) -> int:
    if isinstance(target_scene_seconds, bool) or not isinstance(target_scene_seconds, int) or not MIN_SCENE_SECONDS <= target_scene_seconds <= MAX_SCENE_SECONDS:
        raise ValueError(f"Target scene duration must be between {MIN_SCENE_SECONDS} and {MAX_SCENE_SECONDS} seconds.")
    return max(1, round(NARRATION_WORDS_PER_MINUTE * target_scene_seconds / 60))


def split_complete_source(source_text: str, max_words: int = scene_word_target(DEFAULT_SCENE_SECONDS)) -> list[SourceRange]:
    if not source_text.strip():
        raise ValueError("The complete source story is empty.")
    words = list(re.finditer(r"\S+", source_text))
    if len(words) > 30_000:
        raise ValueError("The complete source story exceeds 30,000 words.")
    ranges: list[SourceRange] = []
    cursor = 0
    for word_index in range(max_words, len(words), max_words):
        boundary = words[word_index].start()
        ranges.append(SourceRange(len(ranges), cursor, boundary, source_text[cursor:boundary]))
        cursor = boundary
    ranges.append(SourceRange(len(ranges), cursor, len(source_text), source_text[cursor:]))
    if len(ranges) > MAX_SCENES:
        raise ValueError("The story creates too many scenes.")
    if any(not item.text.strip() for item in ranges):
        raise ValueError("A planned source range is empty.")
    return ranges


def validate_complete_plan(source_text: str, scenes: list[dict[str, Any]]) -> None:
    cursor = 0
    for index, scene in enumerate(scenes):
        start = scene.get("sourceStart")
        end = scene.get("sourceEnd")
        if start != cursor or not isinstance(end, int) or end <= start or end > len(source_text):
            raise ValueError(f"Scene {index + 1} has invalid source offsets.")
        if scene.get("sourceText") != source_text[start:end]:
            raise ValueError(f"Scene {index + 1} does not match its source range.")
        narration = scene.get("narrationText")
        prompts = scene.get("prompts")
        if not isinstance(narration, str) or not narration.strip():
            raise ValueError(f"Scene {index + 1} has no narration.")
        if not isinstance(prompts, list) or not 1 <= len(prompts) <= 5 or not all(isinstance(prompt, str) and prompt.strip() for prompt in prompts):
            raise ValueError(f"Scene {index + 1} has invalid prompts.")
        cursor = end
    if cursor != len(source_text):
        raise ValueError("The plan does not cover the complete source story.")


def _fixture_details(source_range: SourceRange) -> dict[str, Any]:
    base = build_image_prompt(source_range.text)
    return {"narrationText": source_range.text.strip(), "prompts": [f"{base}, cinematic wide shot", f"{base}, intimate close-up", f"{base}, atmospheric side lighting"]}


def _plan_with_zhipu(ranges: list[SourceRange], source_text: str, model: str) -> list[dict[str, Any]]:
    try:
        client_class = load_zai_client()
    except ImportError as exc:
        raise RuntimeError("The zai-sdk package is required for Zhipu planning.") from exc
    client = client_class(api_key=get_zai_api_key())
    results: list[dict[str, Any]] = []
    story_bible = ""
    for start in range(0, len(ranges), WINDOW_SCENES):
        window = ranges[start:start + WINDOW_SCENES]
        payload = {"storyBible": story_bible, "storyContext": source_text[:2000], "scenes": [{"index": item.index, "sourceText": item.text} for item in window]}
        last_error: Exception | None = None
        for _attempt in range(2):
            try:
                response = client.chat.completions.create(model=model, messages=[{"role": "system", "content": _PLANNING_INSTRUCTIONS}, {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}], max_tokens=8192, temperature=0.2)
                parsed, story_bible = _parse_window(message_content(response), window)
                results.extend(parsed)
                break
            except (ValueError, TypeError, KeyError) as exc:
                last_error = exc
        else:
            raise ValueError(f"Zhipu returned an invalid planning window: {last_error}")
    return results


def _parse_window(output_text: str, ranges: list[SourceRange]) -> tuple[list[dict[str, Any]], str]:
    payload = json.loads(extract_json_object(output_text))
    items = payload.get("scenes") if isinstance(payload, dict) else None
    if not isinstance(items, list) or len(items) != len(ranges):
        raise ValueError("Zhipu planning output has the wrong scene count.")
    results = []
    for expected, item in zip(ranges, items, strict=True):
        if not isinstance(item, dict) or item.get("index") != expected.index:
            raise ValueError("Zhipu planning output is out of order.")
        narration = item.get("narrationText")
        prompts = item.get("prompts")
        if not isinstance(narration, str) or not narration.strip() or len(narration) > 20_000:
            raise ValueError("Zhipu narration is invalid.")
        if not isinstance(prompts, list) or len(prompts) != 3 or not all(isinstance(prompt, str) and 1 <= len(prompt.strip()) <= 4000 for prompt in prompts):
            raise ValueError("Zhipu prompts are invalid.")
        results.append({"narrationText": narration.strip(), "prompts": [prompt.strip() for prompt in prompts]})
    bible = payload.get("storyBible", "")
    if not isinstance(bible, str):
        raise ValueError("Zhipu story bible is invalid.")
    return results, bible[:4000]


_PLANNING_INSTRUCTIONS = """You plan complete long-form visual podcast narration in Simplified Chinese.
Return only JSON: {"storyBible":"updated concise continuity notes","scenes":[{"index":0,"narrationText":"...","prompts":["...","...","..."]}]}
Rules:
- Return exactly one item for every supplied scene index, in the same order.
- Translate and narrate every fact in each sourceText without abridging or inventing events.
- narrationText must be natural Simplified Chinese suitable for TTS.
- Produce exactly three distinct Simplified Chinese image descriptions per scene, with subject, setting, composition, lighting, lens distance, and atmosphere.
- Preserve character, location, visual-style, chronology, and pronoun continuity using storyBible.
- Keep storyBible under 4000 characters.
- Do not return Markdown, source paths, credentials, or commentary.
"""
