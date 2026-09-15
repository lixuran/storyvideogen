from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from storyvideogen.auth_store import AuthError, AuthStore, hash_password, verify_password


class AuthStoreTest(unittest.TestCase):
    def test_password_hash_verification(self) -> None:
        stored_hash = hash_password("correct horse battery staple")

        self.assertNotIn("correct horse", stored_hash)
        self.assertTrue(verify_password("correct horse battery staple", stored_hash))
        self.assertFalse(verify_password("wrong password", stored_hash))

    def test_register_authenticate_and_delete_session(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = AuthStore(Path(tmp) / "auth.sqlite3")

            user = store.register_user("Alice_01", "password123")
            authenticated = store.authenticate_user("alice_01", "password123")
            token = store.create_session(int(user["id"]))
            csrf_token = store.csrf_token_for_session(token)

            self.assertEqual(user["username"], "alice_01")
            self.assertEqual(authenticated, user)
            self.assertEqual(store.user_for_session(token), user)
            self.assertTrue(store.check_csrf_token(token, csrf_token or ""))

            store.delete_session(token)
            self.assertIsNone(store.user_for_session(token))

    def test_duplicate_username_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = AuthStore(Path(tmp) / "auth.sqlite3")

            store.register_user("alice", "password123")

            with self.assertRaises(AuthError):
                store.register_user("alice", "password123")

    def test_invalid_username_and_short_password_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = AuthStore(Path(tmp) / "auth.sqlite3")

            with self.assertRaises(AuthError):
                store.register_user("ab", "password123")
            with self.assertRaises(AuthError):
                store.register_user("valid-user", "short")

    def test_api_keys_are_persisted_without_exposing_values_in_settings(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = AuthStore(Path(tmp) / "auth.sqlite3")
            user = store.register_user("alice", "password123")
            user_id = int(user["id"])

            store.update_api_keys(user_id, {"ZAI_API_KEY": "zai-secret", "PEXELS_API_KEY": "pexels-secret", "PIXABAY_API_KEY": "pixabay-secret"})

            self.assertEqual(
                store.provider_credentials(user_id),
                {"ZAI_API_KEY": "zai-secret", "PEXELS_API_KEY": "pexels-secret", "PIXABAY_API_KEY": "pixabay-secret"},
            )
            self.assertEqual(
                store.account_settings(user_id),
                {
                    "api_keys": {
                        "zai": True,
                        "zhipu_image": False,
                        "siliconflow": False,
                        "pexels": True,
                        "pixabay": True,
                    }
                },
            )

            store.update_api_keys(user_id, {}, clear_names={"PIXABAY_API_KEY"})
            self.assertNotIn("PIXABAY_API_KEY", store.provider_credentials(user_id))

    def test_change_password_requires_current_password(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = AuthStore(Path(tmp) / "auth.sqlite3")
            user = store.register_user("alice", "password123")

            with self.assertRaises(AuthError):
                store.change_password(int(user["id"]), "wrong-password", "new-password123")

            store.change_password(int(user["id"]), "password123", "new-password123")

            self.assertIsNone(store.authenticate_user("alice", "password123"))
            self.assertEqual(store.authenticate_user("alice", "new-password123"), user)

    def test_custom_user_root_scopes_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            user_root = Path(tmp) / "users"
            store = AuthStore(Path(tmp) / "auth.sqlite3", user_root=user_root)
            user = store.register_user("alice", "password123")

            self.assertEqual(store.workspace_for_user(user), user_root / "alice" / "stories")


if __name__ == "__main__":
    unittest.main()
