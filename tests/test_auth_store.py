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

            self.assertEqual(user["username"], "alice_01")
            self.assertEqual(authenticated, user)
            self.assertEqual(store.user_for_session(token), user)

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


if __name__ == "__main__":
    unittest.main()
