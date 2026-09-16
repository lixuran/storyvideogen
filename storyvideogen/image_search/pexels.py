from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from storyvideogen.image_search.download import download_image
from storyvideogen.llm_json import extract_json_object
from storyvideogen.models import ImageAsset
from storyvideogen.provider_credentials import credential_value
from storyvideogen.zai_client import load_zai_client, message_content


# This is deliberately only a fallback. The semantic query preparer below handles
# arbitrary languages and subjects when the configured Zhipu text key is available.
_FALLBACK_CONCEPTS: tuple[tuple[tuple[str, ...], str, tuple[str, ...]], ...] = (
    (("lighthouse", "灯塔"), "lighthouse", ("lighthouse",)),
    (("boat", "ship", "船", "帆船"), "boat", ("boat", "ship", "sailboat")),
    (("forest", "树林", "森林"), "forest", ("forest", "woods", "woodland")),
    (("mountain", "山脉", "高山", "山峰"), "mountain", ("mountain", "peak", "alpine")),
    (("castle", "城堡", "古堡"), "castle", ("castle",)),
    (("city", "城市", "都市", "街道"), "city", ("city", "urban", "street", "skyline")),
    (("beach", "沙滩", "海滩"), "beach", ("beach",)),
    (("sea", "ocean", "海岸", "海边", "大海", "海面", "海浪", "浪涛"), "sea", ("sea", "ocean", "coast", "coastal", "shore")),
)
_ENGLISH_STOP_WORDS = frozenset("a an and at by for from in into of on the to with cinematic scene shot view image photo dramatic detailed composition background".split())


class PexelsImageProvider:
    name = "pexels"

    def __init__(self, api_key: str | None = None, query_model: str = "glm-5.2") -> None:
        self.api_key = api_key or credential_value("PEXELS_API_KEY")
        self.query_model = query_model
        self._query_plans: dict[str, tuple[list[str], tuple[str, ...]]] = {}

    def fetch_image(self, prompt: str, output_dir: Path, index: int) -> ImageAsset:
        if not self.api_key:
            raise RuntimeError("PEXELS_API_KEY is required for --image-provider pexels.")

        queries, required_concepts = self._query_plan(prompt)
        for photo in _rank_photos(self._search_variants(queries), required_concepts):
            source = photo.get("src")
            if not isinstance(source, dict):
                continue
            image_urls = [source.get("landscape"), source.get("large2x"), source.get("original")]
            local_path = None
            for image_url in [str(url) for url in image_urls if url]:
                try:
                    local_path = download_image(image_url, output_dir, f"pexels_{index:03}", timeout_seconds=15)
                    break
                except Exception:
                    continue
            if local_path is None:
                continue
            return ImageAsset(
                index=index,
                prompt=prompt,
                local_path=local_path,
                source_url=str(photo.get("url") or "https://www.pexels.com"),
                creator=str(photo.get("photographer") or "unknown"),
                license_name="Pexels License",
                license_url="https://www.pexels.com/license/",
                provider=self.name,
                title=str(photo.get("alt") or prompt),
                width=_int_or_none(photo.get("width")),
                height=_int_or_none(photo.get("height")),
            )
        required = ", ".join(required_concepts)
        if required:
            raise LookupError(f"No Pexels image matched required concepts ({required}) for prompt: {prompt}")
        raise LookupError(f"No downloadable Pexels image found for prompt: {prompt}")

    def _query_plan(self, prompt: str) -> tuple[list[str], tuple[str, ...]]:
        cached = self._query_plans.get(prompt)
        if cached:
            return cached
        try:
            plan = self._semantic_query_plan(prompt)
        except Exception:
            plan = _fallback_query_plan(prompt)
        self._query_plans[prompt] = plan
        return plan

    def _semantic_query_plan(self, prompt: str) -> tuple[list[str], tuple[str, ...]]:
        api_key = credential_value("ZAI_API_KEY", "ZHIPUAI_API_KEY")
        if not api_key:
            raise RuntimeError("No Zhipu text key is available for semantic Pexels query preparation.")
        client = load_zai_client()(api_key=api_key)
        response = client.chat.completions.create(
            model=self.query_model,
            messages=[
                {"role": "system", "content": _QUERY_PREPARATION_INSTRUCTIONS},
                {"role": "user", "content": json.dumps({"scene": prompt}, ensure_ascii=False)},
            ],
            temperature=0,
            max_tokens=180,
        )
        return _parse_semantic_query_plan(message_content(response))

    def _search_variants(self, queries: list[str]) -> list[dict[str, object]]:
        photos: list[dict[str, object]] = []
        seen: set[str] = set()
        for query in queries:
            for photo in self._search(query):
                key = str(photo.get("id") or photo.get("url") or "")
                if not key or key in seen:
                    continue
                seen.add(key)
                photos.append(photo)
        return photos

    def _search(self, query_text: str) -> list[dict[str, object]]:
        query = urllib.parse.urlencode({"query": query_text, "orientation": "landscape", "per_page": "20"})
        request = urllib.request.Request(
            f"https://api.pexels.com/v1/search?{query}",
            headers={"Authorization": self.api_key or "", "User-Agent": "storyvideogen/0.1"},
        )
        payload: dict[str, object] | None = None
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, timeout=20) as response:
                    parsed = json.loads(response.read().decode("utf-8"))
                if not isinstance(parsed, dict):
                    raise ValueError("Pexels search response was not an object.")
                payload = parsed
                break
            except (urllib.error.URLError, TimeoutError, OSError) as error:
                last_error = error
                if attempt < 2:
                    time.sleep(1 + attempt)
        if payload is None:
            raise RuntimeError("Pexels search could not be reached after 3 attempts.") from last_error
        photos = payload.get("photos", [])
        return list(photos) if isinstance(photos, list) else []


def _parse_semantic_query_plan(output_text: str) -> tuple[list[str], tuple[str, ...]]:
    payload = json.loads(extract_json_object(output_text))
    if not isinstance(payload, dict):
        raise ValueError("Pexels query plan is not an object.")
    queries = _english_phrases(payload.get("queries"), maximum=3, maximum_words=8)
    required = tuple(_english_phrases(payload.get("requiredConcepts"), maximum=2, maximum_words=3))
    if not queries or not required:
        raise ValueError("Pexels query plan is incomplete.")
    return queries, required


def _english_phrases(value: object, maximum: int, maximum_words: int) -> list[str]:
    if not isinstance(value, list):
        return []
    phrases: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        words = re.findall(r"[a-z]+", item.casefold())
        if not words or len(words) > maximum_words:
            continue
        phrase = " ".join(words)
        if phrase not in phrases:
            phrases.append(phrase)
        if len(phrases) == maximum:
            break
    return phrases


def _fallback_query_plan(prompt: str) -> tuple[list[str], tuple[str, ...]]:
    normalized = prompt.casefold()
    concepts: list[str] = []
    for terms, label, _aliases in _FALLBACK_CONCEPTS:
        if any(term.casefold() in normalized for term in terms):
            concepts.append(label)
    for word in re.findall(r"[a-z]{3,}", normalized):
        if word not in _ENGLISH_STOP_WORDS and word not in concepts:
            concepts.append(word)
    if not concepts:
        return ["cinematic landscape"], ()
    primary = concepts[:3]
    queries = [" ".join(primary), primary[0]]
    if len(primary) > 1:
        queries.insert(1, " ".join((primary[0], primary[-1])))
    return _unique(queries), (primary[0],)


def _rank_photos(photos: list[dict[str, object]], required_concepts: tuple[str, ...]) -> list[dict[str, object]]:
    ranked: list[tuple[int, int, dict[str, object]]] = []
    for position, photo in enumerate(photos):
        metadata = _photo_metadata(photo)
        matching_required = sum(_metadata_has_concept(metadata, concept) for concept in required_concepts)
        if required_concepts and matching_required != len(required_concepts):
            continue
        score = matching_required * 100
        for _terms, label, _aliases in _FALLBACK_CONCEPTS:
            if label not in required_concepts and _metadata_has_concept(metadata, label):
                score += 5
        ranked.append((score, -position, photo))
    ranked.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [photo for _score, _position, photo in ranked]


def _photo_metadata(photo: dict[str, object]) -> str:
    return " ".join(str(photo.get(key) or "") for key in ("alt", "url", "photographer")).casefold()


def _metadata_has_concept(metadata: str, concept: str) -> bool:
    aliases = next((aliases for _terms, label, aliases in _FALLBACK_CONCEPTS if label == concept), (concept,))
    return any(re.search(rf"\b{re.escape(alias)}s?\b", metadata) for alias in aliases)


def _int_or_none(value: object) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _unique(values: list[str]) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))


_QUERY_PREPARATION_INSTRUCTIONS = """Convert one story scene into a Pexels stock-photo search plan.
Return only JSON: {"queries":["..."],"requiredConcepts":["..."]}.
Rules:
- queries: 1 to 3 short, natural English stock-photo searches, 2 to 8 words each.
- requiredConcepts: 1 or 2 short English nouns that are indispensable, visible subjects and likely to appear in a Pexels title or alt description.
- Translate any language into English; do not copy prose, names, dialogue, camera direction, emotions, or style adjectives.
- Prefer concrete subjects and places. Do not make weather, colour, lighting, or mood required unless it is the physical subject.
- The first query must include every required concept. Return no Markdown or commentary."""
