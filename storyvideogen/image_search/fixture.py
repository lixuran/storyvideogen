from __future__ import annotations

import hashlib
from pathlib import Path

from storyvideogen.models import ImageAsset


class FixtureImageProvider:
    name = "fixture"

    def fetch_image(self, prompt: str, output_dir: Path, index: int) -> ImageAsset:
        output_dir.mkdir(parents=True, exist_ok=True)
        path = output_dir / f"fixture_{index:03}.ppm"
        width = 640
        height = 360
        _write_ppm(path, prompt, width=width, height=height)
        return ImageAsset(
            index=index,
            prompt=prompt,
            local_path=path,
            source_url=f"fixture://image/{index}",
            creator="storyvideogen fixture",
            license_name="CC0",
            license_url="https://creativecommons.org/publicdomain/zero/1.0/",
            provider=self.name,
            title=f"Fixture image {index}",
            width=width,
            height=height,
        )


def _write_ppm(path: Path, prompt: str, width: int, height: int) -> None:
    digest = hashlib.sha256(prompt.encode("utf-8")).digest()
    left = digest[0], digest[1], digest[2]
    right = digest[3], digest[4], digest[5]

    with path.open("wb") as file:
        file.write(f"P6\n{width} {height}\n255\n".encode("ascii"))
        row = bytearray()
        for x in range(width):
            mix = x / max(1, width - 1)
            row.extend(
                [
                    round(left[channel] * (1 - mix) + right[channel] * mix)
                    for channel in range(3)
                ]
            )
        for _y in range(height):
            file.write(row)
