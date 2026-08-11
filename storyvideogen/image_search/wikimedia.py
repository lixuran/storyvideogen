from __future__ import annotations

import html
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from storyvideogen.image_search.download import download_image
from storyvideogen.image_search.license_gate import is_allowed_license, normalize_license_name
from storyvideogen.models import ImageAsset


class WikimediaImageProvider:
    name = "wikimedia"

    def fetch_image(self, prompt: str, output_dir: Path, index: int) -> ImageAsset:
        pages = self._search(prompt)
        for page in pages:
            image_info = (page.get("imageinfo") or [{}])[0]
            metadata = image_info.get("extmetadata") or {}
            license_name = normalize_license_name(_metadata_value(metadata, "LicenseShortName"))
            license_url = _metadata_value(metadata, "LicenseUrl")
            if not is_allowed_license(license_name, license_url):
                continue
            image_url = image_info.get("thumburl") or image_info.get("url")
            if not image_url:
                continue

            try:
                local_path = download_image(str(image_url), output_dir, f"wikimedia_{index:03}")
            except Exception:
                continue
            return ImageAsset(
                index=index,
                prompt=prompt,
                local_path=local_path,
                source_url=str(image_info.get("descriptionurl") or image_url),
                creator=_clean_html(_metadata_value(metadata, "Artist")) or "unknown",
                license_name=license_name,
                license_url=license_url,
                provider=self.name,
                title=_clean_html(_metadata_value(metadata, "ObjectName")) or str(page.get("title") or ""),
                width=image_info.get("thumbwidth") or image_info.get("width"),
                height=image_info.get("thumbheight") or image_info.get("height"),
            )
        raise LookupError(f"No allowed Wikimedia image found for prompt: {prompt}")

    def _search(self, prompt: str) -> list[dict[str, Any]]:
        query = urllib.parse.urlencode(
            {
                "action": "query",
                "generator": "search",
                "gsrsearch": prompt,
                "gsrnamespace": "6",
                "gsrlimit": "12",
                "prop": "imageinfo",
                "iiprop": "url|extmetadata|size",
                "iiurlwidth": "1920",
                "format": "json",
                "origin": "*",
            }
        )
        request = urllib.request.Request(
            f"https://commons.wikimedia.org/w/api.php?{query}",
            headers={"User-Agent": "storyvideogen/0.1"},
        )
        with urllib.request.urlopen(request, timeout=45) as response:
            payload = json.loads(response.read().decode("utf-8"))
        pages = payload.get("query", {}).get("pages", {})
        return list(pages.values())


def _metadata_value(metadata: dict[str, Any], key: str) -> str:
    value = metadata.get(key, {})
    if isinstance(value, dict):
        return str(value.get("value") or "")
    return str(value or "")


def _clean_html(value: str) -> str:
    text = re.sub(r"<[^>]+>", "", value)
    return html.unescape(" ".join(text.split()))
