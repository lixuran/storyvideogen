from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

from storyvideogen.image_search.providers import build_image_provider
from storyvideogen.image_search.siliconflow import SiliconFlowImageProvider, _extract_image_url


class SiliconFlowProviderTest(unittest.TestCase):
    def test_extracts_generated_image_url(self) -> None:
        url = _extract_image_url({"images": [{"url": "https://example.com/generated.png"}]})

        self.assertEqual(url, "https://example.com/generated.png")

    def test_builds_siliconflow_provider_with_model(self) -> None:
        provider = build_image_provider("siliconflow", "Kwai-Kolors/Kolors")

        self.assertIsInstance(provider, SiliconFlowImageProvider)
        self.assertEqual(provider.model, "Kwai-Kolors/Kolors")

    def test_requires_api_key(self) -> None:
        provider = SiliconFlowImageProvider()

        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "SILICONFLOW_API_KEY"):
                provider.fetch_image("concrete statue", Path("ignored"), 1)


if __name__ == "__main__":
    unittest.main()
