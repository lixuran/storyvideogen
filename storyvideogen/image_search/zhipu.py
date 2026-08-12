from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from storyvideogen.image_search.download import download_image
from storyvideogen.models import ImageAsset


class ZhipuImageProvider:
    name = "zhipu"

    def __init__(self, model: str = "glm-image", size: str = "1280x1280", max_retries: int = 4) -> None:
        self.model = model
        self.size = size
        self.max_retries = max_retries

    def fetch_image(self, prompt: str, output_dir: Path, index: int) -> ImageAsset:
        api_key = _api_key()
        image_url = self._generate_image_url(prompt, api_key)
        local_path = download_image(image_url, output_dir, f"zhipu_{index:03}", timeout_seconds=45)
        return ImageAsset(
            index=index,
            prompt=prompt,
            local_path=local_path,
            source_url=image_url,
            creator=self.model,
            license_name="generated",
            license_url="",
            provider=self.name,
            title=prompt[:120],
        )

    def _generate_image_url(self, prompt: str, api_key: str) -> str:
        payload = {
            "model": self.model,
            "prompt": prompt,
            "size": self.size,
        }
        request = urllib.request.Request(
            "https://open.bigmodel.cn/api/paas/v4/images/generations",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        data = _open_json_with_retry(request, max_retries=self.max_retries)
        return _extract_image_url(data)


def _api_key() -> str:
    api_key = os.environ.get("ZHIPU_IMAGE_API_KEY") or os.environ.get("BIGMODEL_API_KEY") or os.environ.get("ZAI_API_KEY")
    if not api_key:
        raise RuntimeError("ZHIPU_IMAGE_API_KEY, BIGMODEL_API_KEY, or ZAI_API_KEY is required for --image-provider zhipu.")
    return api_key


def _extract_image_url(data: dict[str, Any]) -> str:
    images = data.get("data")
    if isinstance(images, list):
        for item in images:
            if isinstance(item, dict) and isinstance(item.get("url"), str):
                return item["url"]
    raise ValueError("Zhipu image response did not contain an image URL.")


def _open_json_with_retry(request: urllib.request.Request, max_retries: int) -> dict[str, Any]:
    for attempt in range(max_retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code != 429 or attempt >= max_retries:
                raise
            retry_after = _retry_after_seconds(exc)
            time.sleep(retry_after or min(2 ** attempt, 8))
    raise RuntimeError("Zhipu image request retry loop exited unexpectedly.")


def _retry_after_seconds(error: urllib.error.HTTPError) -> float | None:
    value = error.headers.get("Retry-After")
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None
