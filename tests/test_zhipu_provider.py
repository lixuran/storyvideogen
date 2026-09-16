from __future__ import annotations

import unittest
import urllib.error
from pathlib import Path
from unittest.mock import MagicMock, patch, sentinel

from storyvideogen.image_search.providers import build_image_provider
from storyvideogen.image_search.zhipu import ZhipuImageProvider, _extract_image_url, _open_json_with_retry, _retry_after_seconds


class ZhipuProviderTest(unittest.TestCase):
    def test_extracts_generated_image_url(self) -> None:
        url = _extract_image_url({"data": [{"url": "https://example.com/generated.png"}]})

        self.assertEqual(url, "https://example.com/generated.png")

    def test_builds_zhipu_provider_with_fast_model(self) -> None:
        provider = build_image_provider("zhipu", "cogview-3-flash")

        self.assertIsInstance(provider, ZhipuImageProvider)
        self.assertEqual(provider.model, "cogview-3-flash")

    def test_fast_model_uses_standard_quality_and_landscape_size(self) -> None:
        provider = ZhipuImageProvider(api_key="test-key")
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"data": [{"url": "https://example.com/generated.png"}]}'

        with patch("storyvideogen.image_search.zhipu.urllib.request.urlopen", return_value=response) as open_url:
            provider._generate_image_url("a lighthouse", "test-key")

        payload = __import__("json").loads(open_url.call_args.args[0].data.decode("utf-8"))
        self.assertEqual(payload["model"], "cogview-3-flash")
        self.assertEqual(payload["size"], "1344x768")
        self.assertEqual(payload["quality"], "standard")

    def test_requires_api_key(self) -> None:
        provider = ZhipuImageProvider()

        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "ZHIPU_IMAGE_API_KEY"):
                provider.fetch_image("昏暗的异常收容室", Path("ignored"), 1)

    def test_parses_retry_after_seconds(self) -> None:
        error = urllib.error.HTTPError(
            url="https://open.bigmodel.cn",
            code=429,
            msg="Too Many Requests",
            hdrs={"Retry-After": "3"},
            fp=None,
        )

        self.assertEqual(_retry_after_seconds(error), 3.0)

    def test_image_request_allows_slow_generation(self) -> None:
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"data": [{"url": "https://example.com/generated.png"}]}'

        with patch("urllib.request.urlopen", return_value=response) as open_url:
            result = _open_json_with_retry(sentinel.request, max_retries=0)

        self.assertEqual(result["data"][0]["url"], "https://example.com/generated.png")
        open_url.assert_called_once_with(sentinel.request, timeout=600)


if __name__ == "__main__":
    unittest.main()
