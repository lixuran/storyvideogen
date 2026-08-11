from __future__ import annotations

import json
import urllib.parse
import urllib.request
from dataclasses import replace
from typing import Protocol

from .llm_json import extract_json_object
from .models import StoryChunk
from .zai_client import get_zai_api_key, load_zai_client, message_content


class TranslationProvider(Protocol):
    name: str

    def translate_texts(self, texts: list[str]) -> list[str]:
        ...


class IdentityTranslator:
    name = "identity"

    def translate_texts(self, texts: list[str]) -> list[str]:
        return texts


class MockChineseTranslator:
    name = "mock"

    def translate_texts(self, texts: list[str]) -> list[str]:
        return [self._translate(text) for text in texts]

    def _translate(self, text: str) -> str:
        words = " ".join(text.split()[:8])
        return f"简体中文占位：{words}"


class GoogleTranslateProvider:
    """Small no-dependency provider for MVP automation; replace for production use."""

    name = "google"

    def translate_texts(self, texts: list[str]) -> list[str]:
        return [self._translate(text) for text in texts]

    def _translate(self, text: str) -> str:
        if not text.strip():
            return ""

        query = urllib.parse.urlencode(
            {
                "client": "gtx",
                "sl": "auto",
                "tl": "zh-CN",
                "dt": "t",
                "q": text,
            }
        )
        request = urllib.request.Request(
            f"https://translate.googleapis.com/translate_a/single?{query}",
            headers={"User-Agent": "storyvideogen/0.1"},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return "".join(part[0] for part in payload[0] if part and part[0]).strip()


class ZAIChineseTranslator:
    name = "zai"

    def __init__(self, model: str = "glm-5.2") -> None:
        self.model = model

    def translate_texts(self, texts: list[str]) -> list[str]:
        if not texts:
            return []

        try:
            client_class = load_zai_client()
        except ImportError as exc:
            raise RuntimeError("The zai-sdk package is required for --translator zai.") from exc

        client = client_class(api_key=get_zai_api_key())
        response = client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": _ZAI_TRANSLATION_INSTRUCTIONS},
                {"role": "user", "content": _build_translation_input(texts)},
            ],
            max_tokens=4096,
            temperature=0.2,
        )
        return _parse_zai_translations(message_content(response), expected_count=len(texts))


_ZAI_TRANSLATION_INSTRUCTIONS = """You translate story narration into natural Simplified Chinese.

Return only JSON:
{"translations":["translation 1","translation 2"]}

Rules:
- Same number of translations as input segments, in the same order.
- Preserve meaning, facts, names, pronouns, suspense, and horror tone.
- Translate idioms and context by meaning, not word-for-word.
- Keep narration subtitle-friendly and natural when read aloud.
- If source text is already Simplified Chinese, return a cleaned version of it.
- Use Simplified Chinese punctuation.
- Do not add explanations, Markdown fences, or censorship edits.
"""


def _build_translation_input(texts: list[str]) -> str:
    payload = {
        "segments": [
            {
                "index": index,
                "text": text,
            }
            for index, text in enumerate(texts, start=1)
        ]
    }
    return json.dumps(payload, ensure_ascii=False)


def _parse_zai_translations(output_text: str, expected_count: int) -> list[str]:
    try:
        payload = json.loads(extract_json_object(output_text))
    except json.JSONDecodeError as exc:
        raise ValueError(f"ZAI translator returned non-JSON output: {output_text[:200]}") from exc

    translations = payload.get("translations") if isinstance(payload, dict) else None
    if not isinstance(translations, list) or not all(isinstance(item, str) for item in translations):
        raise ValueError("ZAI translator output must be JSON with a string array field named 'translations'.")
    if len(translations) != expected_count:
        raise ValueError(f"ZAI translator returned {len(translations)} translations for {expected_count} segments.")
    return [translation.strip() for translation in translations]


def build_translator(name: str, model: str = "glm-5.2") -> TranslationProvider:
    normalized = name.strip().lower()
    if normalized == "google":
        return GoogleTranslateProvider()
    if normalized == "identity":
        return IdentityTranslator()
    if normalized == "mock":
        return MockChineseTranslator()
    if normalized == "zai":
        return ZAIChineseTranslator(model=model)
    raise ValueError(f"Unsupported translator: {name}")


def translate_chunks(chunks: list[StoryChunk], provider: TranslationProvider) -> list[StoryChunk]:
    translations = provider.translate_texts([chunk.text for chunk in chunks])
    if len(translations) != len(chunks):
        raise ValueError(f"Translator returned {len(translations)} translations for {len(chunks)} chunks.")
    return [replace(chunk, subtitle_text=translation) for chunk, translation in zip(chunks, translations)]
