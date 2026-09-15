from __future__ import annotations

import json
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from unittest.mock import patch

from storyvideogen.image_search.pexels import PexelsImageProvider


class _Response:
    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload

    def __enter__(self) -> _Response:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self) -> bytes:
        return json.dumps(self.payload).encode("utf-8")


class PexelsProviderTest(unittest.TestCase):
    def test_search_uses_official_endpoint_and_authorization_header(self) -> None:
        provider = PexelsImageProvider(api_key="test-pexels-key")

        with patch("storyvideogen.image_search.pexels.urllib.request.urlopen", return_value=_Response({"photos": []})) as urlopen:
            self.assertEqual(provider._search("moonlit lighthouse"), [])

        request = urlopen.call_args.args[0]
        parsed = urllib.parse.urlsplit(request.full_url)
        self.assertEqual(f"{parsed.scheme}://{parsed.netloc}{parsed.path}", "https://api.pexels.com/v1/search")
        self.assertEqual(urllib.parse.parse_qs(parsed.query), {"query": ["moonlit lighthouse"], "orientation": ["landscape"], "per_page": ["20"]})
        self.assertEqual(request.get_header("Authorization"), "test-pexels-key")

    def test_fetches_landscape_result_with_attribution(self) -> None:
        provider = PexelsImageProvider(api_key="test-pexels-key")
        results = [
            {
                "width": 4000,
                "height": 2667,
                "url": "https://www.pexels.com/photo/moonlit-lighthouse-123/",
                "photographer": "Test Photographer",
                "alt": "A lighthouse above the sea",
                "src": {"landscape": "https://images.pexels.com/photos/123/landscape.jpeg"},
            }
        ]

        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "image.jpeg"
            image_path.write_bytes(b"fake")
            with patch.object(provider, "_search", return_value=results), patch(
                "storyvideogen.image_search.pexels.download_image", return_value=image_path
            ):
                asset = provider.fetch_image("moonlit lighthouse", Path(temp_dir), 1)

        self.assertEqual(asset.provider, "pexels")
        self.assertEqual(asset.creator, "Test Photographer")
        self.assertEqual(asset.source_url, "https://www.pexels.com/photo/moonlit-lighthouse-123/")
        self.assertEqual(asset.license_name, "Pexels License")
        self.assertEqual(asset.license_url, "https://www.pexels.com/license/")

    def test_requires_api_key(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            provider = PexelsImageProvider()
        with tempfile.TemporaryDirectory() as temp_dir:
            with self.assertRaisesRegex(RuntimeError, "PEXELS_API_KEY"):
                provider.fetch_image("lighthouse", Path(temp_dir), 1)


if __name__ == "__main__":
    unittest.main()
