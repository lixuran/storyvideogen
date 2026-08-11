from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from storyvideogen.image_search.pixabay import PixabayImageProvider


class PixabayProviderTest(unittest.TestCase):
    def test_fetches_first_downloadable_result(self) -> None:
        provider = PixabayImageProvider(api_key="test-key")
        results = [
            {
                "webformatURL": "https://example.com/image.jpg",
                "pageURL": "https://pixabay.com/photos/example",
                "user": "photographer",
                "tags": "concrete, statue",
                "webformatWidth": 960,
                "webformatHeight": 540,
            }
        ]

        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "image.jpg"
            image_path.write_bytes(b"fake")

            with patch.object(provider, "_search", return_value=results), patch(
                "storyvideogen.image_search.pixabay.download_image",
                return_value=image_path,
            ):
                asset = provider.fetch_image("concrete humanoid sculpture", Path(temp_dir), 1)

            self.assertEqual(asset.provider, "pixabay")
            self.assertEqual(asset.creator, "photographer")
            self.assertEqual(asset.source_url, "https://pixabay.com/photos/example")


if __name__ == "__main__":
    unittest.main()
