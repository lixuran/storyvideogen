from __future__ import annotations

import unittest
from unittest.mock import patch

from storyvideogen.image_search.download import _read_limited, _validate_remote_url


class DownloadTest(unittest.TestCase):
    def test_read_limited_rejects_oversized_body(self) -> None:
        class Response:
            def __init__(self) -> None:
                self.calls = 0

            def read(self, size: int) -> bytes:
                self.calls += 1
                if self.calls <= 2:
                    return b"x" * size
                return b""

        with self.assertRaises(ValueError):
            _read_limited(Response(), max_bytes=65_536)

    def test_rejects_private_and_non_https_image_urls(self) -> None:
        with self.assertRaisesRegex(ValueError, "public HTTPS"):
            _validate_remote_url("http://example.com/image.png")
        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("127.0.0.1", 443))]):
            with self.assertRaisesRegex(ValueError, "not public"):
                _validate_remote_url("https://internal.example/image.png")


if __name__ == "__main__":
    unittest.main()

