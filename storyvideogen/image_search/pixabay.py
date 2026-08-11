from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from pathlib import Path

from storyvideogen.image_search.download import download_image
from storyvideogen.models import ImageAsset


class PixabayImageProvider:
    name = "pixabay"

    def __init__(self, api_key: str | None = None) -> None:
        self.api_key = api_key or os.environ.get("PIXABAY_API_KEY")

    def fetch_image(self, prompt: str, output_dir: Path, index: int) -> ImageAsset:
        if not self.api_key:
            raise RuntimeError("PIXABAY_API_KEY is required for --image-provider pixabay.")

        results = self._search(prompt)
        for result in results[:10]:
            image_urls = [result.get("webformatURL"), result.get("largeImageURL")]
            local_path = None
            for image_url in [str(url) for url in image_urls if url]:
                try:
                    local_path = download_image(image_url, output_dir, f"pixabay_{index:03}", timeout_seconds=10)
                    break
                except Exception:
                    continue
            if local_path is None:
                continue
            return ImageAsset(
                index=index,
                prompt=prompt,
                local_path=local_path,
                source_url=str(result.get("pageURL") or result.get("webformatURL") or ""),
                creator=str(result.get("user") or "unknown"),
                license_name="Pixabay Content License",
                license_url="https://pixabay.com/service/license-summary/",
                provider=self.name,
                title=str(result.get("tags") or prompt),
                width=_int_or_none(result.get("webformatWidth") or result.get("imageWidth")),
                height=_int_or_none(result.get("webformatHeight") or result.get("imageHeight")),
            )
        raise LookupError(f"No Pixabay image found for prompt: {prompt}")

    def _search(self, prompt: str) -> list[dict[str, object]]:
        query = urllib.parse.urlencode(
            {
                "key": self.api_key,
                "q": prompt,
                "image_type": "photo",
                "orientation": "horizontal",
                "safesearch": "false",
                "per_page": "20",
                "lang": "en",
            }
        )
        request = urllib.request.Request(
            f"https://pixabay.com/api/?{query}",
            headers={"User-Agent": "storyvideogen/0.1"},
        )
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return list(payload.get("hits", []))


def _int_or_none(value: object) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
