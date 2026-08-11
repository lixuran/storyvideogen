from __future__ import annotations

import html
import json
import os
import urllib.parse
import urllib.request
from pathlib import Path

from storyvideogen.image_search.download import download_image
from storyvideogen.models import ImageAsset


_QUERY_MAP = {
    "abstract concrete statue": "混凝土 抽象 雕塑",
    "biohazard warning sign wall": "生化 危险 警告 标志",
    "empty hallway": "空 走廊",
    "closed interior door": "关闭的 室内 门",
    "close up human eyes darkness": "黑暗 人眼 特写",
    "concrete prison cell": "混凝土 监狱 牢房",
    "concrete rebar statue": "混凝土 钢筋 雕像",
    "concrete sculpture": "混凝土 雕塑",
    "dark abandoned room": "废弃 房间 黑暗",
    "dirty concrete floor": "脏 混凝土 地面",
    "dirty stained concrete floor": "污渍 混凝土 地面",
    "empty concrete cell room": "空 混凝土 牢房",
    "flashlight illuminating dark statue": "手电筒 照亮 黑暗 雕像",
    "heavy steel vault door": "厚重 钢铁 门",
    "human eye macro photography": "人眼 特写 摄影",
    "human neck skull x-ray": "颈部 头骨 X光",
    "human skull dark room": "黑暗 骷髅 房间",
    "locked containment chamber door": "锁住的 门 密室",
    "scratched concrete wall": "划痕 混凝土 墙",
    "security camera empty room": "监控 摄像头 空房间",
    "security camera monitor screen": "监控 摄像头 屏幕",
    "security desk logbook clipboard": "安保 桌面 记录本",
}

_TERM_MAP = {
    "abandoned": "废弃",
    "biohazard": "生化 危险",
    "camera": "摄像头",
    "cell": "牢房",
    "chamber": "密室",
    "clipboard": "夹板",
    "concrete": "混凝土",
    "containment": "收容",
    "dark": "黑暗",
    "desk": "桌面",
    "dirty": "脏",
    "door": "门",
    "empty": "空",
    "eye": "眼睛",
    "eyes": "眼睛",
    "floor": "地面",
    "flashlight": "手电筒",
    "heavy": "厚重",
    "human": "人",
    "illuminating": "照亮",
    "locked": "锁住",
    "logbook": "记录本",
    "macro": "特写",
    "monitor": "监控",
    "neck": "颈部",
    "photography": "摄影",
    "rebar": "钢筋",
    "room": "房间",
    "screen": "屏幕",
    "sculpture": "雕塑",
    "security": "安保 监控",
    "sign": "标志",
    "skull": "头骨",
    "stained": "污渍",
    "statue": "雕像",
    "steel": "钢铁",
    "vault": "保险库",
    "wall": "墙",
    "warning": "警告",
    "x-ray": "X光",
}


class BaiduImageProvider:
    name = "baidu"

    def fetch_image(self, prompt: str, output_dir: Path, index: int) -> ImageAsset:
        for query_text in _query_candidates(prompt):
            results = self._search(query_text)
            for result in results[:20]:
                image_urls = [result.get("thumbURL"), result.get("middleURL"), result.get("hoverURL"), result.get("objURL")]
                local_path = None
                for image_url in [str(url) for url in image_urls if url]:
                    try:
                        local_path = download_image(image_url, output_dir, f"baidu_{index:03}", timeout_seconds=6)
                        break
                    except Exception:
                        continue
                if local_path is None:
                    continue

                return ImageAsset(
                    index=index,
                    prompt=prompt,
                    local_path=local_path,
                    source_url=str(result.get("fromURL") or result.get("replaceUrl", [{}])[0].get("ObjURL") or ""),
                    creator="unknown",
                    license_name="unverified",
                    license_url="",
                    provider=self.name,
                    title=_clean_title(str(result.get("fromPageTitleEnc") or result.get("fromPageTitle") or prompt)),
                    width=_int_or_none(result.get("width")),
                    height=_int_or_none(result.get("height")),
                )
        raise LookupError(f"No Baidu image found for prompt: {prompt}")

    def _search(self, prompt: str) -> list[dict[str, object]]:
        query = urllib.parse.urlencode(
            {
                "tn": "resultjson_com",
                "ipn": "rj",
                "ct": "201326592",
                "is": "",
                "fp": "result",
                "queryWord": prompt,
                "cl": "2",
                "lm": "-1",
                "ie": "utf-8",
                "oe": "utf-8",
                "st": "-1",
                "word": prompt,
                "face": "0",
                "istype": "2",
                "nc": "1",
                "pn": "0",
                "rn": "30",
            }
        )
        request = urllib.request.Request(
            f"https://image.baidu.com/search/acjson?{query}",
            headers=_headers(prompt),
        )
        with urllib.request.urlopen(request, timeout=12) as response:
            payload = json.loads(response.read().decode("utf-8", errors="ignore"))
        if payload.get("antiFlag") == 1:
            raise RuntimeError(
                "Baidu blocked automated image search. Set BAIDU_COOKIE from a logged-in browser session "
                "or use --image-provider pixabay/openverse."
            )
        return [item for item in payload.get("data", []) if isinstance(item, dict)]


def _clean_title(value: str) -> str:
    return html.unescape(" ".join(value.split()))


def _int_or_none(value: object) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _query_candidates(prompt: str) -> list[str]:
    normalized = " ".join(prompt.lower().split())
    candidates = []
    mapped = _QUERY_MAP.get(normalized)
    if mapped:
        candidates.append(mapped)

    translated = _translate_keywords(normalized)
    if translated:
        candidates.append(translated)

    candidates.append(normalized)
    candidates.extend(_broad_fallbacks(normalized))
    return _dedupe(candidates)


def _translate_keywords(prompt: str) -> str:
    translated = []
    for token in prompt.replace("-", " ").split():
        mapped = _TERM_MAP.get(token)
        if mapped:
            translated.append(mapped)
    return " ".join(translated)


def _broad_fallbacks(prompt: str) -> list[str]:
    if any(term in prompt for term in ("door", "chamber", "vault", "containment", "cell")):
        return ["密室 门", "监狱 牢房", "钢铁 门"]
    if any(term in prompt for term in ("statue", "sculpture", "rebar")):
        return ["混凝土 雕塑", "雕像 黑暗", "抽象 雕塑"]
    if any(term in prompt for term in ("camera", "monitor", "screen", "security")):
        return ["监控 摄像头", "监控 屏幕", "安防 监控"]
    if any(term in prompt for term in ("eye", "eyes", "blinking")):
        return ["人眼 特写", "眼睛 黑暗", "眼睛 摄影"]
    if any(term in prompt for term in ("skull", "neck", "x-ray")):
        return ["头骨 黑暗", "骷髅 房间", "颈部 X光"]
    if any(term in prompt for term in ("floor", "stain", "stained", "dirty")):
        return ["混凝土 地面", "地面 污渍", "脏 地面"]
    return ["恐怖 房间", "废弃 房间", "黑暗 室内"]


def _dedupe(values: list[str]) -> list[str]:
    deduped = []
    seen = set()
    for value in values:
        if value and value not in seen:
            deduped.append(value)
            seen.add(value)
    return deduped


def _headers(prompt: str) -> dict[str, str]:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
        ),
        "Referer": "https://image.baidu.com/search/index?tn=baiduimage&word="
        + urllib.parse.quote(prompt),
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    cookie = os.environ.get("BAIDU_COOKIE")
    if cookie:
        headers["Cookie"] = cookie
    return headers
