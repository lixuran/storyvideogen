from __future__ import annotations

import json
import re
from dataclasses import replace
from typing import Protocol

from .llm_json import extract_json_object
from .models import StoryChunk
from .zai_client import get_zai_api_key, load_zai_client, message_content


class PromptProvider(Protocol):
    name: str

    def generate_prompts(self, chunks: list[StoryChunk]) -> list[str]:
        ...


class HeuristicPromptProvider:
    name = "heuristic"

    def generate_prompts(self, chunks: list[StoryChunk]) -> list[str]:
        return [build_image_prompt(chunk.text) for chunk in chunks]


class ZAIPromptAgent:
    name = "zai"

    def __init__(self, model: str = "glm-5.2") -> None:
        self.model = model

    def generate_prompts(self, chunks: list[StoryChunk]) -> list[str]:
        if not chunks:
            return []
        try:
            client_class = load_zai_client()
        except ImportError as exc:
            raise RuntimeError("The zai-sdk package is required for --prompt-provider zai.") from exc

        client = client_class(api_key=get_zai_api_key())
        response = client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": _LLM_INSTRUCTIONS},
                {"role": "user", "content": _build_llm_input(chunks)},
            ],
            max_tokens=2048,
            temperature=0.2,
        )
        prompts = _parse_llm_prompts(message_content(response), expected_count=len(chunks))
        return [_sanitize_prompt(prompt) for prompt in prompts]

    def generate_prompt_candidates(
        self,
        chunks: list[StoryChunk],
        candidates_per_chunk: int,
        story_context: str = "",
    ) -> list[list[str]]:
        if not chunks:
            return []
        try:
            client_class = load_zai_client()
        except ImportError as exc:
            raise RuntimeError("The zai-sdk package is required for --prompt-provider zai.") from exc

        client = client_class(api_key=get_zai_api_key())
        response = client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": _LLM_CANDIDATE_INSTRUCTIONS},
                {"role": "user", "content": _build_candidate_input(chunks, candidates_per_chunk, story_context)},
            ],
            max_tokens=8192,
            temperature=0.4,
        )
        groups = _parse_llm_prompt_candidates(
            message_content(response),
            expected_count=len(chunks),
            candidates_per_chunk=candidates_per_chunk,
        )
        return [[_sanitize_prompt(prompt) for prompt in group] for group in groups]


_LLM_INSTRUCTIONS = """You generate fast image-search prompts for cozy-creepy story videos.

Return only JSON:
{"prompts":["prompt 1","prompt 2"]}

Rules:
- Do not use Markdown code fences.
- One prompt per input chunk, same order.
- Each prompt is 2-6 English words.
- Use concrete searchable visual nouns, not abstract mood words.
- Prefer fast image-search terms: "concrete sculpture", "security camera", "prison cell".
- For SCP-style entities, do not use exact SCP names. Use generic related visuals.
- Avoid copyrighted character names, site-specific names, and long sentences.
- Prefer real-photo searchable subjects over illustration terms.
"""


_LLM_CANDIDATE_INSTRUCTIONS = """你是恐怖睡前故事视频的分镜美术提示词规划师。

只返回 JSON：
{"prompt_groups":[["提示词1A","提示词1B"],["提示词2A","提示词2B"]]}

规则：
- 每个输入片段生成一组提示词，顺序必须一致。
- 每组必须包含要求数量的不同提示词。
- 提示词必须使用简体中文。
- 每条提示词应为 40-90 个中文字符，适合图像生成模型。
- 必须利用 story_context 理解全局故事、实体、地点、危险规则和前后文连续性。
- 每条提示词要具体描述主体、场景、构图、光线、质感、镜头距离和氛围。
- 同一片段内的候选提示词要在构图、焦点或视角上明显不同。
- 保持“温暖但诡异”的睡前恐怖氛围，避免血腥猎奇。
- SCP 类内容不要直接写 SCP 编号或专有站点名，改写成“异常混凝土雕像”“收容室”等通用视觉。
- 不要加入字幕、文字、水印、logo、解释、Markdown 代码块。
"""


_WORD_RE = re.compile(r"[A-Za-z][A-Za-z'-]{2,}|\d+")
_STOPWORDS = {
    "about",
    "after",
    "again",
    "against",
    "because",
    "before",
    "behind",
    "being",
    "between",
    "could",
    "every",
    "from",
    "have",
    "into",
    "just",
    "like",
    "more",
    "once",
    "only",
    "over",
    "same",
    "should",
    "some",
    "that",
    "their",
    "there",
    "though",
    "through",
    "under",
    "walked",
    "were",
    "when",
    "where",
    "with",
    "years",
    "your",
}

_TEXT_RULES = (
    (("eye contact", "line of sight"), "security camera empty room"),
    (("blinking",), "close up human eyes darkness"),
    (("neck", "skull", "strangulation"), "human skull dark room"),
    (("scraping stone", "stone"), "scratched concrete wall"),
    (("reddish brown", "substance", "floor"), "dirty concrete floor"),
    (("feces", "blood"), "dirty concrete floor"),
    (("sculpture", "statue"), "concrete sculpture"),
    (("rebar",), "concrete sculpture"),
    (("spray paint",), "abstract concrete statue"),
    (("concrete",), "concrete sculpture"),
    (("containment", "container"), "concrete prison cell"),
)

_TOKEN_RULES = (
    (("sculpture", "statue"), "concrete sculpture"),
    (("concrete", "rebar"), "concrete sculpture"),
    (("paint", "spray"), "abstract concrete statue spray paint"),
    (("container", "containment", "cell"), "concrete prison cell"),
    (("camera", "surveillance"), "security camera empty room"),
    (("personnel", "security"), "security guards dark corridor"),
    (("skull", "neck"), "dark anatomy skull neck shadow"),
    (("stone", "scraping"), "scratched concrete wall dark room"),
    (("floor", "substance", "stain"), "dirty concrete floor stain"),
    (("hallway", "corridor"), "empty hallway"),
    (("stairwell", "stairs", "staircase"), "empty stairwell"),
    (("apartment", "brass", "number"), "apartment door number"),
    (("door",), "closed interior door"),
    (("window", "rain", "storm"), "rainy window"),
    (("light", "lights", "amber", "fluorescent"), "dim hallway light"),
    (("gramophone", "music", "tune"), "old gramophone"),
    (("wall", "walls", "wallpaper"), "empty room wall"),
)


def build_prompt_provider(name: str, model: str = "glm-5.2") -> PromptProvider:
    normalized = name.strip().lower()
    if normalized == "heuristic":
        return HeuristicPromptProvider()
    if normalized in {"llm", "zai"}:
        return ZAIPromptAgent(model=model)
    raise ValueError(f"Unsupported prompt provider: {name}")


def add_image_prompts(chunks: list[StoryChunk], provider: PromptProvider | None = None) -> list[StoryChunk]:
    prompt_provider = provider or HeuristicPromptProvider()
    prompts = prompt_provider.generate_prompts(chunks)
    if len(prompts) != len(chunks):
        raise ValueError(f"Prompt provider returned {len(prompts)} prompts for {len(chunks)} chunks.")
    return [replace(chunk, image_prompt=prompt) for chunk, prompt in zip(chunks, prompts)]


def generate_prompt_candidates(
    chunks: list[StoryChunk],
    provider: PromptProvider | None = None,
    candidates_per_chunk: int = 3,
    story_context: str = "",
) -> list[list[str]]:
    prompt_provider = provider or HeuristicPromptProvider()
    count = max(1, candidates_per_chunk)
    generator = getattr(prompt_provider, "generate_prompt_candidates", None)
    if callable(generator):
        groups = generator(chunks, count, story_context)
    else:
        groups = [_diversify_prompt(build_image_prompt(chunk.text), chunk.text, count) for chunk in chunks]

    if len(groups) != len(chunks):
        raise ValueError(f"Prompt provider returned {len(groups)} prompt groups for {len(chunks)} chunks.")
    return [_normalize_prompt_group(group, count) for group in groups]


def build_image_prompt(text: str) -> str:
    lower_text = text.lower()
    for phrases, prompt in _TEXT_RULES:
        if any(phrase in lower_text for phrase in phrases):
            return prompt

    tokens = {
        token.lower()
        for token in _WORD_RE.findall(text)
        if token.lower() not in _STOPWORDS
    }
    if "scp" in tokens and "173" in tokens:
        return "concrete sculpture"

    for keywords, prompt in _TOKEN_RULES:
        if any(keyword in tokens for keyword in keywords):
            return prompt
    return "dark abandoned room"


def _build_llm_input(chunks: list[StoryChunk]) -> str:
    payload = {
        "chunks": [
            {
                "index": chunk.index,
                "text": chunk.text,
            }
            for chunk in chunks
        ]
    }
    return json.dumps(payload, ensure_ascii=False)


def _build_candidate_input(chunks: list[StoryChunk], candidates_per_chunk: int, story_context: str = "") -> str:
    payload = {
        "candidates_per_chunk": candidates_per_chunk,
        "story_context": story_context,
        "chunks": [
            {
                "index": chunk.index,
                "text": chunk.text,
            }
            for chunk in chunks
        ],
    }
    return json.dumps(payload, ensure_ascii=False)


def _parse_llm_prompts(output_text: str, expected_count: int) -> list[str]:
    json_text = extract_json_object(output_text)
    try:
        payload = json.loads(json_text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"LLM prompt agent returned non-JSON output: {output_text[:200]}") from exc

    prompts = payload.get("prompts") if isinstance(payload, dict) else None
    if not isinstance(prompts, list) or not all(isinstance(prompt, str) for prompt in prompts):
        raise ValueError("LLM prompt agent output must be JSON with a string array field named 'prompts'.")
    if len(prompts) != expected_count:
        raise ValueError(f"LLM prompt agent returned {len(prompts)} prompts for {expected_count} chunks.")
    return prompts


def _parse_llm_prompt_candidates(
    output_text: str,
    expected_count: int,
    candidates_per_chunk: int,
) -> list[list[str]]:
    try:
        payload = json.loads(extract_json_object(output_text))
    except json.JSONDecodeError as exc:
        raise ValueError(f"LLM prompt agent returned non-JSON output: {output_text[:200]}") from exc

    groups = payload.get("prompt_groups") if isinstance(payload, dict) else None
    if not isinstance(groups, list) or not all(isinstance(group, list) for group in groups):
        raise ValueError("LLM prompt agent output must be JSON with a list field named 'prompt_groups'.")
    if len(groups) != expected_count:
        raise ValueError(f"LLM prompt agent returned {len(groups)} prompt groups for {expected_count} chunks.")

    normalized_groups: list[list[str]] = []
    for group in groups:
        if not all(isinstance(prompt, str) for prompt in group):
            raise ValueError("Each LLM prompt group must contain only strings.")
        if len(group) < candidates_per_chunk:
            raise ValueError(
                f"LLM prompt group returned {len(group)} prompts; expected at least {candidates_per_chunk}."
            )
        normalized_groups.append(group[:candidates_per_chunk])
    return normalized_groups


def _sanitize_prompt(prompt: str) -> str:
    if re.search(r"[\u4e00-\u9fff]", prompt):
        return _sanitize_chinese_prompt(prompt)
    words = re.findall(r"[A-Za-z0-9'-]+", prompt.lower())
    if not words:
        return "dark abandoned room"
    return " ".join(words[:6])


def _sanitize_chinese_prompt(prompt: str) -> str:
    clean = re.sub(r"\s+", "，", prompt.strip())
    clean = re.sub(r"[`#*_{}\[\]<>]", "", clean)
    clean = clean.strip("，。；; ")
    return clean[:140] or "昏暗的异常收容室，柔和暖光，诡异安静的氛围"


def _normalize_prompt_group(prompts: list[str], count: int) -> list[str]:
    normalized = []
    seen = set()
    for prompt in prompts:
        clean = _sanitize_prompt(prompt)
        if clean not in seen:
            normalized.append(clean)
            seen.add(clean)
        if len(normalized) >= count:
            return normalized

    fallback = normalized[0] if normalized else "dark abandoned room"
    while len(normalized) < count:
        variant = _sanitize_prompt(f"{fallback} detail {len(normalized) + 1}")
        if variant not in seen:
            normalized.append(variant)
            seen.add(variant)
        else:
            normalized.append(fallback)
    return normalized


def _diversify_prompt(base_prompt: str, text: str, count: int) -> list[str]:
    lower_text = text.lower()
    variants = [base_prompt]
    if any(term in lower_text for term in ("scp-173", "sculpture", "statue", "rebar", "concrete")):
        variants.extend(["concrete statue close up", "dark sculpture room", "rebar concrete texture"])
    elif any(term in lower_text for term in ("camera", "security", "monitor", "surveillance")):
        variants.extend(["security monitor screen", "surveillance camera hallway", "empty guard desk"])
    elif any(term in lower_text for term in ("door", "container", "containment", "cell", "chamber")):
        variants.extend(["locked steel door", "concrete containment room", "industrial chamber entrance"])
    elif any(term in lower_text for term in ("eye", "blink", "stare", "look")):
        variants.extend(["human eye close up", "staring eyes darkness", "face shadow portrait"])
    elif any(term in lower_text for term in ("floor", "blood", "stain", "feces", "substance")):
        variants.extend(["stained concrete floor", "dirty floor close up", "dark room floor"])
    else:
        variants.extend(["dark concrete room", "empty eerie corridor", "dim industrial interior"])
    return _normalize_prompt_group(variants, count)
