from __future__ import annotations

import unittest

from storyvideogen.image_search.download import _read_limited


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


if __name__ == "__main__":
    unittest.main()

