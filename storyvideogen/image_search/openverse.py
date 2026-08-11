from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path

from storyvideogen.image_search.download import download_image
from storyvideogen.image_search.license_gate import is_allowed_license, normalize_license_name
from storyvideogen.models import ImageAsset


class OpenverseImageProvider:
    name = "openverse"

    def fetch_image(self, prompt: str, output_dir: Path, index: int) -> ImageAsset:
        results = self._search(prompt)
        for result in results[:8]:
            license_name = normalize_license_name(result.get("license"))
            license_url = result.get("license_url") or ""
            if not is_allowed_license(license_name, license_url):
                continue
            image_urls = [result.get("thumbnail"), result.get("url")]
            local_path = None
            for image_url in [str(url) for url in image_urls if url]:
                try:
                    local_path = download_image(image_url, output_dir, f"openverse_{index:03}", timeout_seconds=8)
                    break
                except Exception:
                    continue
            if local_path is None:
                continue
            return ImageAsset(
                index=index,
                prompt=prompt,
                local_path=local_path,
                source_url=result.get("foreign_landing_url") or str(result.get("url") or ""),
                creator=result.get("creator") or "unknown",
                license_name=license_name,
                license_url=license_url,
                provider=self.name,
                title=result.get("title"),
                width=result.get("width"),
                height=result.get("height"),
            )
        raise LookupError(f"No allowed Openverse image found for prompt: {prompt}")

    def _search(self, prompt: str) -> list[dict[str, object]]:
        query = urllib.parse.urlencode(
            {
                "q": prompt,
                "license": "cc0,by,pdm",
                "license_type": "commercial,modification",
                "page_size": "12",
            }
        )
        request = urllib.request.Request(
            f"https://api.openverse.org/v1/images/?{query}",
            headers={"User-Agent": "storyvideogen/0.1"},
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return list(payload.get("results", []))
