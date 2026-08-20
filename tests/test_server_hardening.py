from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from storyvideogen.auth_store import AuthError, AuthStore
from storyvideogen.rate_limiter import InMemoryRateLimiter, RateLimit, RateLimitExceeded
from storyvideogen.server_config import is_admin_user, load_server_config
from storyvideogen.upload_validation import safe_upload_filename, validate_image_file, validate_upload_size


class ServerHardeningTest(unittest.TestCase):
    def test_load_server_config_from_environment(self) -> None:
        config = load_server_config(
            {
                "STORYVIDEOGEN_SECURE_COOKIES": "true",
                "STORYVIDEOGEN_MAX_UPLOAD_BYTES": "1234",
                "STORYVIDEOGEN_WORKER_COUNT": "3",
            }
        )

        self.assertTrue(config.secure_cookies)
        self.assertEqual(config.max_upload_bytes, 1234)
        self.assertEqual(config.worker_count, 3)

    def test_admin_usernames_come_from_environment(self) -> None:
        self.assertTrue(is_admin_user({"username": "alice"}, {"STORYVIDEOGEN_ADMIN_USERS": "alice,bob"}))
        self.assertFalse(is_admin_user({"username": "charlie"}, {"STORYVIDEOGEN_ADMIN_USERS": "alice,bob"}))

    def test_rate_limiter_rejects_excess_events(self) -> None:
        limiter = InMemoryRateLimiter()
        limiter.check("login:127.0.0.1", RateLimit(1, 60))

        with self.assertRaises(RateLimitExceeded):
            limiter.check("login:127.0.0.1", RateLimit(1, 60))

    def test_auth_store_csrf_and_daily_quota(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = AuthStore(Path(tmp) / "auth.sqlite3")
            user = store.register_user("alice", "password123")
            token = store.create_session(int(user["id"]))
            csrf_token = store.csrf_token_for_session(token)

            self.assertTrue(store.check_csrf_token(token, csrf_token or ""))
            self.assertFalse(store.check_csrf_token(token, "wrong"))
            self.assertEqual(store.increment_daily_usage(int(user["id"]), "prepare", 1), 1)

            with self.assertRaises(AuthError):
                store.increment_daily_usage(int(user["id"]), "prepare", 1)

    def test_upload_validation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            image = Path(tmp) / "sample.png"
            image.write_bytes(
                b"\x89PNG\r\n\x1a\n"
                b"\x00\x00\x00\rIHDR"
                b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00"
                b"\x90wS\xde"
            )

            validate_upload_size("10", 20)

            self.assertEqual(validate_image_file(image), ".png")
            self.assertEqual(safe_upload_filename("../bad name.png"), "bad-name")

            with self.assertRaises(ValueError):
                validate_upload_size("30", 20)


if __name__ == "__main__":
    unittest.main()
