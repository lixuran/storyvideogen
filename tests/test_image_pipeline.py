from __future__ import annotations

import tempfile
import threading
import time
import unittest
from pathlib import Path

from storyvideogen.image_search.pipeline import fetch_images
from storyvideogen.models import ImageAsset, StoryChunk


class CountingProvider:
    name = "counting"

    def __init__(self) -> None:
        self.calls = 0

    def fetch_image(self, prompt: str, output_dir: Path, index: int) -> ImageAsset:
        self.calls += 1
        output_dir.mkdir(parents=True, exist_ok=True)
        path = output_dir / f"image_{index}.jpg"
        path.write_bytes(b"fake")
        return ImageAsset(
            index=index,
            prompt=prompt,
            local_path=path,
            source_url="https://example.com/image",
            creator="creator",
            license_name="CC0",
            license_url="https://creativecommons.org/publicdomain/zero/1.0/",
            provider=self.name,
        )


class ImagePipelineTest(unittest.TestCase):
    def test_reuses_duplicate_prompt_result_without_refetching(self) -> None:
        provider = CountingProvider()
        chunks = [
            StoryChunk(index=1, text="a", start_seconds=0, end_seconds=1, image_prompt="abandoned interior"),
            StoryChunk(index=2, text="b", start_seconds=1, end_seconds=2, image_prompt="abandoned interior"),
        ]

        with tempfile.TemporaryDirectory() as temp_dir:
            assets = fetch_images(chunks, provider, Path(temp_dir))

        self.assertEqual(provider.calls, 1)
        self.assertEqual(len(assets), 2)
        self.assertEqual(assets[1].provider, "counting:cached")
        self.assertEqual(assets[0].local_path, assets[1].local_path)

    def test_fetches_unique_prompts_in_parallel(self) -> None:
        class SlowProvider(CountingProvider):
            name = "slow"

            def __init__(self) -> None:
                super().__init__()
                self.active = 0
                self.max_active = 0
                self.lock = threading.Lock()

            def fetch_image(self, prompt: str, output_dir: Path, index: int) -> ImageAsset:
                with self.lock:
                    self.active += 1
                    self.max_active = max(self.max_active, self.active)
                try:
                    time.sleep(0.05)
                    return super().fetch_image(prompt, output_dir, index)
                finally:
                    with self.lock:
                        self.active -= 1

        provider = SlowProvider()
        chunks = [
            StoryChunk(index=1, text="a", start_seconds=0, end_seconds=1, image_prompt="concrete sculpture"),
            StoryChunk(index=2, text="b", start_seconds=1, end_seconds=2, image_prompt="security camera"),
            StoryChunk(index=3, text="c", start_seconds=2, end_seconds=3, image_prompt="dark corridor"),
        ]

        with tempfile.TemporaryDirectory() as temp_dir:
            assets = fetch_images(chunks, provider, Path(temp_dir), max_workers=3)

        self.assertEqual(len(assets), 3)
        self.assertGreater(provider.max_active, 1)
        self.assertEqual([asset.provider for asset in assets], ["slow", "slow", "slow"])

    def test_first_failed_prompt_falls_back_to_successful_parallel_result(self) -> None:
        class SometimesFailingProvider(CountingProvider):
            name = "sometimes-failing"

            def fetch_image(self, prompt: str, output_dir: Path, index: int) -> ImageAsset:
                if prompt == "bad prompt":
                    raise LookupError("no image")
                return super().fetch_image(prompt, output_dir, index)

        chunks = [
            StoryChunk(index=1, text="a", start_seconds=0, end_seconds=1, image_prompt="bad prompt"),
            StoryChunk(index=2, text="b", start_seconds=1, end_seconds=2, image_prompt="good prompt"),
        ]

        with tempfile.TemporaryDirectory() as temp_dir:
            assets = fetch_images(chunks, SometimesFailingProvider(), Path(temp_dir), max_workers=2)

        self.assertEqual(len(assets), 2)
        self.assertEqual(assets[0].provider, "sometimes-failing:fallback")
        self.assertEqual(assets[1].provider, "sometimes-failing")


if __name__ == "__main__":
    unittest.main()
