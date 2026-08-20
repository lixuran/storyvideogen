from __future__ import annotations

import unittest

from storyvideogen.image_search.providers import build_image_provider


class ImageProviderContractTest(unittest.TestCase):
    def test_every_retained_provider_exposes_the_fetch_contract(self) -> None:
        for name in ("zhipu", "siliconflow", "baidu", "pixabay", "openverse", "wikimedia", "fixture"):
            with self.subTest(provider=name):
                provider = build_image_provider(name)
                self.assertEqual(provider.name, name)
                self.assertTrue(callable(provider.fetch_image))

    def test_unknown_provider_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unsupported image provider"):
            build_image_provider("new-search-backend")


if __name__ == "__main__":
    unittest.main()
