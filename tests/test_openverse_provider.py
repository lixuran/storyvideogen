from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from storyvideogen.image_search.openverse import OpenverseImageProvider


class OpenverseProviderTest(unittest.TestCase):
    def test_skips_failed_download_and_uses_next_allowed_result(self) -> None:
        provider = OpenverseImageProvider()
        results = [
            {
                "url": "https://example.com/bad.jpg",
                "foreign_landing_url": "https://example.com/bad",
                "creator": "Bad Creator",
                "license": "by",
                "license_url": "https://creativecommons.org/licenses/by/2.0/",
                "title": "Bad",
            },
            {
                "url": "https://example.com/good.jpg",
                "foreign_landing_url": "https://example.com/good",
                "creator": "Good Creator",
                "license": "cc0",
                "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
                "title": "Good",
            },
        ]

        with tempfile.TemporaryDirectory() as temp_dir:
            good_path = Path(temp_dir) / "good.jpg"
            good_path.write_bytes(b"fake")

            def fake_download(url: str, output_dir: Path, stem: str, **kwargs: object) -> Path:
                if "bad" in url:
                    raise TimeoutError("timeout")
                return good_path

            with patch.object(provider, "_search", return_value=results), patch(
                "storyvideogen.image_search.openverse.download_image",
                side_effect=fake_download,
            ):
                asset = provider.fetch_image("empty hallway", Path(temp_dir), 1)

            self.assertEqual(asset.source_url, "https://example.com/good")
            self.assertEqual(asset.creator, "Good Creator")

    def test_uses_thumbnail_when_full_image_download_fails(self) -> None:
        provider = OpenverseImageProvider()
        results = [
            {
                "url": "https://example.com/full.jpg",
                "thumbnail": "https://example.com/thumb.jpg",
                "foreign_landing_url": "https://example.com/source",
                "creator": "Creator",
                "license": "by",
                "license_url": "https://creativecommons.org/licenses/by/2.0/",
                "title": "Image",
            }
        ]

        with tempfile.TemporaryDirectory() as temp_dir:
            thumb_path = Path(temp_dir) / "thumb.jpg"
            thumb_path.write_bytes(b"fake")

            def fake_download(url: str, output_dir: Path, stem: str, **kwargs: object) -> Path:
                if "full" in url:
                    raise TimeoutError("timeout")
                return thumb_path

            with patch.object(provider, "_search", return_value=results), patch(
                "storyvideogen.image_search.openverse.download_image",
                side_effect=fake_download,
            ):
                asset = provider.fetch_image("empty hallway", Path(temp_dir), 1)

            self.assertEqual(asset.local_path, thumb_path)
            self.assertEqual(asset.source_url, "https://example.com/source")


if __name__ == "__main__":
    unittest.main()
