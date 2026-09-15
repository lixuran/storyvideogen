from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path

from storyvideogen.image_search.download import download_image
from storyvideogen.models import ImageAsset
from storyvideogen.provider_credentials import credential_value


class PexelsImageProvider:
    name = "pexels"

    def __init__(self, api_key: str | None = None) -> None:
        self.api_key = api_key or credential_value("PEXELS_API_KEY")

    def fetch_image(self, prompt: str, output_dir: Path, index: int) -> ImageAsset:
        if not self.api_key:
            raise RuntimeError("PEXELS_API_KEY is required for --image-provider pexels.")

        for photo in self._search(prompt)[:10]:
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
        raise LookupError(f"No Pexels image found for prompt: {prompt}")

    def _search(self, prompt: str) -> list[dict[str, object]]:
        query = urllib.parse.urlencode(
            {
                "query": prompt,
                "orientation": "landscape",
                "per_page": "20",
            }
        )
        request = urllib.request.Request(
            f"https://api.pexels.com/v1/search?{query}",
            headers={"Authorization": self.api_key or "", "User-Agent": "storyvideogen/0.1"},
        )
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
        photos = payload.get("photos", [])
        return list(photos) if isinstance(photos, list) else []


def _int_or_none(value: object) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
