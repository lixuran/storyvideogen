from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from storyvideogen.image_search.baidu import BaiduImageProvider, _headers, _query_candidates


class BaiduProviderTest(unittest.TestCase):
    def test_fetches_first_downloadable_thumbnail(self) -> None:
        provider = BaiduImageProvider()
        results = [
            {
                "thumbURL": "https://example.com/thumb.jpg",
                "fromURL": "https://example.com/page",
                "fromPageTitleEnc": "Concrete Sculpture",
                "width": "640",
                "height": "360",
            }
        ]

        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "thumb.jpg"
            image_path.write_bytes(b"fake")

            with patch.object(provider, "_search", return_value=results), patch(
                "storyvideogen.image_search.baidu.download_image",
                return_value=image_path,
            ):
                asset = provider.fetch_image("concrete sculpture", Path(temp_dir), 1)

            self.assertEqual(asset.provider, "baidu")
            self.assertEqual(asset.local_path, image_path)
            self.assertEqual(asset.license_name, "unverified")
            self.assertEqual(asset.width, 640)

    def test_maps_known_english_prompt_to_chinese_candidates(self) -> None:
        candidates = _query_candidates("concrete sculpture")

        self.assertIn("混凝土 雕塑", candidates)
        self.assertIn("concrete sculpture", candidates)

    def test_maps_arbitrary_zai_prompt_to_chinese_candidates(self) -> None:
        candidates = _query_candidates("locked containment chamber door")

        self.assertIn("锁住的 门 密室", candidates)
        self.assertIn("locked containment chamber door", candidates)
        self.assertIn("密室 门", candidates)

    def test_detects_baidu_anti_spider_response(self) -> None:
        provider = BaiduImageProvider()

        with patch("urllib.request.urlopen") as urlopen:
            response = urlopen.return_value.__enter__.return_value
            response.read.return_value = b'{"antiFlag":1,"message":"Forbid spider access"}'

            with self.assertRaisesRegex(RuntimeError, "Baidu blocked"):
                provider._search("locked containment chamber door")

    def test_adds_cookie_header_when_available(self) -> None:
        with patch.dict("os.environ", {"BAIDU_COOKIE": "BDUSS=test-cookie"}):
            headers = _headers("locked containment chamber door")

        self.assertEqual(headers["Cookie"], "BDUSS=test-cookie")


if __name__ == "__main__":
    unittest.main()
