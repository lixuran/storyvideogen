from __future__ import annotations

import json
import urllib.request
from pathlib import Path
from typing import Any

from storyvideogen.image_search.download import download_image
from storyvideogen.models import ImageAsset
from storyvideogen.provider_credentials import credential_value


class SiliconFlowImageProvider:
    name = "siliconflow"

    def __init__(self, model: str = "Kwai-Kolors/Kolors", image_size: str = "1024x1024", api_key: str | None = None) -> None:
        self.model = model
        self.image_size = image_size
        self.api_key = api_key or credential_value("SILICONFLOW_API_KEY")

    def fetch_image(self, prompt: str, output_dir: Path, index: int) -> ImageAsset:
        if not self.api_key:
            raise RuntimeError("SILICONFLOW_API_KEY is required for --image-provider siliconflow.")

        image_url = self._generate_image_url(prompt, self.api_key)
        local_path = download_image(image_url, output_dir, f"siliconflow_{index:03}", timeout_seconds=30)
        return ImageAsset(
            index=index,
            prompt=prompt,
            local_path=local_path,
            source_url=image_url,
            creator=self.model,
            license_name="generated",
            license_url="",
            provider=self.name,
            title=prompt,
        )

    def _generate_image_url(self, prompt: str, api_key: str) -> str:
        payload = {
            "model": self.model,
            "prompt": prompt,
            "image_size": self.image_size,
            "batch_size": 1,
        }
        request = urllib.request.Request(
            "https://api.siliconflow.cn/v1/images/generations",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=90) as response:
            data = json.loads(response.read().decode("utf-8"))
        return _extract_image_url(data)


def _extract_image_url(data: dict[str, Any]) -> str:
    for key in ("images", "data"):
        images = data.get(key)
        if isinstance(images, list):
            for item in images:
                if isinstance(item, dict) and isinstance(item.get("url"), str):
                    return item["url"]
    raise ValueError("SiliconFlow image response did not contain an image URL.")
