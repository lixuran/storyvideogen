from __future__ import annotations

import mimetypes
import urllib.request
from pathlib import Path


def download_image(
    url: str,
    output_dir: Path,
    stem: str,
    timeout_seconds: int = 15,
    max_bytes: int = 12_000_000,
) -> Path:
    request = urllib.request.Request(url, headers={"User-Agent": "storyvideogen/0.1"})
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        content_type = response.headers.get("Content-Type", "").split(";")[0].strip().lower()
        if not content_type.startswith("image/"):
            raise ValueError(f"URL did not return an image: {url}")
        content_length = response.headers.get("Content-Length")
        if content_length and int(content_length) > max_bytes:
            raise ValueError(f"Image exceeds maximum size: {url}")
        suffix = mimetypes.guess_extension(content_type) or ".jpg"
        data = _read_limited(response, max_bytes)

    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"{stem}{suffix}"
    path.write_bytes(data)
    return path


def _read_limited(response: object, max_bytes: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = response.read(65_536)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise ValueError("Image exceeds maximum size.")
        chunks.append(chunk)
    return b"".join(chunks)
