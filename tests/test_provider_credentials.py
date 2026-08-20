from __future__ import annotations

import unittest
from unittest.mock import patch

from storyvideogen.image_search.zhipu import ZhipuImageProvider
from storyvideogen.provider_credentials import provider_credentials
from storyvideogen.zai_client import get_zai_api_key


class ProviderCredentialsTest(unittest.TestCase):
    def test_scoped_credentials_override_environment(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            with provider_credentials({"ZAI_API_KEY": "scoped-key"}):
                self.assertEqual(get_zai_api_key(), "scoped-key")
                provider = ZhipuImageProvider()

        self.assertEqual(provider.api_key, "scoped-key")


if __name__ == "__main__":
    unittest.main()
