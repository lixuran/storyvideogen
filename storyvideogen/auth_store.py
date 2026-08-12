from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

DEFAULT_AUTH_DB = Path("output/ui_auth.sqlite3")
DEFAULT_USER_ROOT = Path("output/ui_users")
SESSION_COOKIE_NAME = "storyvideogen_session"
SESSION_TTL_SECONDS = 14 * 24 * 60 * 60
PASSWORD_HASH_ITERATIONS = 200_000


class AuthError(ValueError):
    pass


class AuthStore:
    def __init__(self, db_path: Path = DEFAULT_AUTH_DB) -> None:
        self.db_path = db_path
        self._lock = threading.Lock()

    def register_user(self, username: str, password: str) -> dict[str, object]:
        username = normalize_username(username)
        _validate_password(password)
        with self._lock:
            self._ensure_schema()
            try:
                with self._connection() as conn:
                    conn.execute(
                        "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
                        (username, hash_password(password), _now()),
                    )
                    row = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
                    user_id = int(row["id"])
            except sqlite3.IntegrityError as exc:
                raise AuthError("Username already exists.") from exc
        return {"id": user_id, "username": username}

    def authenticate_user(self, username: str, password: str) -> dict[str, object] | None:
        username = normalize_username(username)
        with self._lock:
            self._ensure_schema()
            with self._connection() as conn:
                row = conn.execute(
                    "SELECT id, username, password_hash FROM users WHERE username = ?",
                    (username,),
                ).fetchone()
        if row is None or not verify_password(password, str(row["password_hash"])):
            return None
        return {"id": int(row["id"]), "username": str(row["username"])}

    def create_session(self, user_id: int) -> str:
        token = secrets.token_urlsafe(32)
        now = int(time.time())
        with self._lock:
            self._ensure_schema()
            with self._connection() as conn:
                conn.execute(
                    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                    (_hash_token(token), user_id, _now(), now + SESSION_TTL_SECONDS),
                )
        return token

    def user_for_session(self, token: str) -> dict[str, object] | None:
        if not token:
            return None
        now = int(time.time())
        with self._lock:
            self._ensure_schema()
            with self._connection() as conn:
                row = conn.execute(
                    """
                    SELECT users.id, users.username
                    FROM sessions
                    JOIN users ON users.id = sessions.user_id
                    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
                    """,
                    (_hash_token(token), now),
                ).fetchone()
        if row is None:
            return None
        return {"id": int(row["id"]), "username": str(row["username"])}

    def delete_session(self, token: str) -> None:
        if not token:
            return
        with self._lock:
            self._ensure_schema()
            with self._connection() as conn:
                conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_hash_token(token),))

    def workspace_for_user(self, user: dict[str, object]) -> Path:
        return DEFAULT_USER_ROOT / str(user["username"]) / "stories"

    def _connect(self) -> sqlite3.Connection:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        conn = self._connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _ensure_schema(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at TEXT NOT NULL,
                    expires_at INTEGER NOT NULL
                );
                """
            )


def normalize_username(value: str) -> str:
    username = value.strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_.-]{2,39}", username):
        raise AuthError("Username must be 3-40 characters using letters, numbers, dot, dash, or underscore.")
    return username


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_HASH_ITERATIONS)
    return "pbkdf2_sha256${}${}${}".format(
        PASSWORD_HASH_ITERATIONS,
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(digest).decode("ascii"),
    )


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, iterations_text, salt_text, digest_text = stored_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iterations_text)
        salt = base64.b64decode(salt_text.encode("ascii"))
        expected = base64.b64decode(digest_text.encode("ascii"))
    except (ValueError, TypeError):
        return False

    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(actual, expected)


def _validate_password(password: str) -> None:
    if len(password) < 8:
        raise AuthError("Password must be at least 8 characters.")


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
