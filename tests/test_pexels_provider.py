from __future__ import annotations

import json
import tempfile
import unittest
import urllib.error
import urllib.parse
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from storyvideogen.image_search.pexels import PexelsImageProvider, _parse_semantic_query_plan


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

    def test_retries_transient_pexels_search_failures(self) -> None:
        provider = PexelsImageProvider(api_key="test-pexels-key")

        with patch("storyvideogen.image_search.pexels.urllib.request.urlopen", side_effect=[urllib.error.URLError("temporary EOF"), _Response({"photos": []})]) as urlopen, patch(
            "storyvideogen.image_search.pexels.time.sleep"
        ) as sleep:
            self.assertEqual(provider._search("lighthouse"), [])

        self.assertEqual(urlopen.call_count, 2)
        sleep.assert_called_once_with(1)

    def test_uses_semantic_plan_for_an_unfamiliar_chinese_subject(self) -> None:
        provider = PexelsImageProvider(api_key="test-pexels-key")
        plan = (["astronaut greenhouse mars", "mars greenhouse", "astronaut mars"], ("astronaut", "greenhouse"))
        photo = {
            "id": 55,
            "url": "https://www.pexels.com/photo/astronaut-greenhouse-55/",
            "alt": "An astronaut in a greenhouse",
            "src": {"landscape": "https://images.pexels.com/photos/55/landscape.jpeg"},
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "image.jpeg"
            image_path.write_bytes(b"fake")
            with patch.object(provider, "_semantic_query_plan", return_value=plan), patch.object(
                provider, "_search", return_value=[photo]
            ) as search, patch("storyvideogen.image_search.pexels.download_image", return_value=image_path):
                asset = provider.fetch_image("火星宇航员在温室中照料植物。", Path(temp_dir), 1)

        self.assertEqual(asset.source_url, photo["url"])
        self.assertEqual([call.args[0] for call in search.call_args_list], plan[0])

    def test_semantic_plan_requires_short_english_queries_and_concepts(self) -> None:
        queries, required = _parse_semantic_query_plan(
            '{"queries":["astronaut greenhouse mars","mars greenhouse"],"requiredConcepts":["astronaut","greenhouse"]}'
        )

        self.assertEqual(queries, ["astronaut greenhouse mars", "mars greenhouse"])
        self.assertEqual(required, ("astronaut", "greenhouse"))
        with self.assertRaisesRegex(ValueError, "incomplete"):
            _parse_semantic_query_plan('{"queries":["火星 温室"],"requiredConcepts":[]}')

    def test_semantic_preparation_uses_saved_zhipu_key_once_per_scene(self) -> None:
        provider = PexelsImageProvider(api_key="test-pexels-key")
        response = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='{"queries":["volcanic island coast"],"requiredConcepts":["volcano","island"]}'))])
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=lambda **_kwargs: response)))

        with patch.dict("os.environ", {"ZAI_API_KEY": "test-zhipu-key"}, clear=True), patch(
            "storyvideogen.image_search.pexels.load_zai_client", return_value=lambda **_kwargs: client
        ) as load_client:
            first = provider._query_plan("一座火山岛从海面升起。")
            second = provider._query_plan("一座火山岛从海面升起。")

        self.assertEqual(first, (["volcanic island coast"], ("volcano", "island")))
        self.assertEqual(second, first)
        load_client.assert_called_once()

    def test_ranks_relevant_metadata_above_first_city_result(self) -> None:
        provider = PexelsImageProvider(api_key="test-pexels-key")
        city = {"id": 1, "url": "https://www.pexels.com/photo/city-1/", "alt": "A city skyline at night", "src": {"landscape": "https://images.pexels.com/photos/city/landscape.jpeg"}}
        lighthouse = {"id": 2, "url": "https://www.pexels.com/photo/lighthouse-2/", "alt": "A lighthouse on the sea coast", "src": {"landscape": "https://images.pexels.com/photos/lighthouse/landscape.jpeg"}}

        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "image.jpeg"
            image_path.write_bytes(b"fake")
            with patch.object(provider, "_semantic_query_plan", return_value=(["lighthouse sea"], ("lighthouse",))), patch.object(
                provider, "_search", return_value=[city, lighthouse]
            ), patch("storyvideogen.image_search.pexels.download_image", return_value=image_path) as download:
                asset = provider.fetch_image("灯塔和海浪", Path(temp_dir), 1)

        self.assertEqual(asset.source_url, lighthouse["url"])
        self.assertEqual(download.call_args.args[0], lighthouse["src"]["landscape"])

    def test_requires_api_key(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            provider = PexelsImageProvider()
        with tempfile.TemporaryDirectory() as temp_dir:
            with self.assertRaisesRegex(RuntimeError, "PEXELS_API_KEY"):
                provider.fetch_image("lighthouse", Path(temp_dir), 1)


if __name__ == "__main__":
    unittest.main()
