from __future__ import annotations

import base64
import hashlib
import hmac
import os
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
AUTH_DB_ENV = "STORYVIDEOGEN_AUTH_DB"
USER_ROOT_ENV = "STORYVIDEOGEN_USER_ROOT"
SESSION_COOKIE_NAME = "storyvideogen_session"
SESSION_TTL_SECONDS = 14 * 24 * 60 * 60
PASSWORD_HASH_ITERATIONS = 200_000


class AuthError(ValueError):
    pass


class AuthStore:
    def __init__(self, db_path: Path | None = None, user_root: Path | None = None) -> None:
        if db_path is None:
            db_path = Path(os.environ.get(AUTH_DB_ENV, str(DEFAULT_AUTH_DB)))
        if user_root is None:
            user_root = Path(os.environ.get(USER_ROOT_ENV, str(DEFAULT_USER_ROOT)))
        self.db_path = db_path
        self.user_root = user_root
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
        csrf_token = secrets.token_urlsafe(32)
        now = int(time.time())
        with self._lock:
            self._ensure_schema()
            with self._connection() as conn:
                conn.execute(
                    "INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
                    (_hash_token(token), user_id, csrf_token, _now(), now + SESSION_TTL_SECONDS),
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

    def csrf_token_for_session(self, token: str) -> str | None:
        if not token:
            return None
        now = int(time.time())
        with self._lock:
            self._ensure_schema()
            with self._connection() as conn:
                row = conn.execute(
                    "SELECT csrf_token FROM sessions WHERE token_hash = ? AND expires_at > ?",
                    (_hash_token(token), now),
                ).fetchone()
        return str(row["csrf_token"]) if row else None

    def check_csrf_token(self, session_token: str, csrf_token: str) -> bool:
        expected = self.csrf_token_for_session(session_token)
        return bool(expected and csrf_token and hmac.compare_digest(expected, csrf_token))

    def delete_session(self, token: str) -> None:
        if not token:
            return
        with self._lock:
            self._ensure_schema()
            with self._connection() as conn:
                conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_hash_token(token),))

    def workspace_for_user(self, user: dict[str, object]) -> Path:
        return self.user_root / str(user["username"]) / "stories"

    def account_settings(self, user_id: int) -> dict[str, object]:
        with self._lock:
            self._ensure_schema()
            with self._connection() as conn:
                rows = conn.execute(
                    "SELECT name, value FROM user_api_keys WHERE user_id = ?",
                    (user_id,),
                ).fetchall()
        names = {str(row["name"]) for row in rows if str(row["value"] or "")}
        return {
            "api_keys": {
                "zai": "ZAI_API_KEY" in names,
                "zhipu_image": "ZHIPU_IMAGE_API_KEY" in names,
                "siliconflow": "SILICONFLOW_API_KEY" in names,
                "pixabay": "PIXABAY_API_KEY" in names,
            }
        }

    def provider_credentials(self, user_id: int) -> dict[str, str]:
        with self._lock:
            self._ensure_schema()
            with self._connection() as conn:
                rows = conn.execute(
                    "SELECT name, value FROM user_api_keys WHERE user_id = ?",
                    (user_id,),
                ).fetchall()
        return {str(row["name"]): str(row["value"]) for row in rows if str(row["value"] or "")}

    def update_api_keys(self, user_id: int, values: dict[str, str], clear_names: set[str] | None = None) -> None:
        clear_names = clear_names or set()
        allowed_names = {"ZAI_API_KEY", "ZHIPU_IMAGE_API_KEY", "SILICONFLOW_API_KEY", "PIXABAY_API_KEY"}
        unknown_names = set(values) | clear_names
        unknown_names -= allowed_names
        if unknown_names:
            raise AuthError(f"Unsupported API key setting: {sorted(unknown_names)[0]}")

        now = _now()
        with self._lock:
            self._ensure_schema()
            with self._connection() as conn:
                for name in clear_names:
                    conn.execute("DELETE FROM user_api_keys WHERE user_id = ? AND name = ?", (user_id, name))
                for name, value in values.items():
                    clean_value = value.strip()
                    if not clean_value:
                        continue
                    conn.execute(
                        """
                        INSERT INTO user_api_keys (user_id, name, value, updated_at)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT(user_id, name) DO UPDATE SET
                            value = excluded.value,
                            updated_at = excluded.updated_at
                        """,
                        (user_id, name, clean_value, now),
                    )

    def change_password(self, user_id: int, current_password: str, new_password: str) -> None:
        _validate_password(new_password)
        with self._lock:
            self._ensure_schema()
            with self._connection() as conn:
                row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user_id,)).fetchone()
                if row is None or not verify_password(current_password, str(row["password_hash"])):
                    raise AuthError("Current password is incorrect.")
                conn.execute(
                    "UPDATE users SET password_hash = ? WHERE id = ?",
                    (hash_password(new_password), user_id),
                )

    def increment_daily_usage(self, user_id: int, action: str, max_count: int) -> int:
        day = datetime.now(timezone.utc).date().isoformat()
        with self._lock:
            self._ensure_schema()
            with self._connection() as conn:
                row = conn.execute(
                    "SELECT count FROM usage_counters WHERE user_id = ? AND action = ? AND day = ?",
                    (user_id, action, day),
                ).fetchone()
                count = int(row["count"]) if row else 0
                if count >= max_count:
                    raise AuthError(f"Daily {action} quota exceeded.")
                count += 1
                conn.execute(
                    """
                    INSERT INTO usage_counters (user_id, action, day, count)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(user_id, action, day) DO UPDATE SET count = excluded.count
                    """,
                    (user_id, action, day, count),
                )
        return count

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
                    csrf_token TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    expires_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS usage_counters (
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    action TEXT NOT NULL,
                    day TEXT NOT NULL,
                    count INTEGER NOT NULL,
                    PRIMARY KEY (user_id, action, day)
                );

                CREATE TABLE IF NOT EXISTS user_api_keys (
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, name)
                );
                """
            )
            columns = {row["name"] for row in conn.execute("PRAGMA table_info(sessions)").fetchall()}
            if "csrf_token" not in columns:
                conn.execute("ALTER TABLE sessions ADD COLUMN csrf_token TEXT NOT NULL DEFAULT ''")


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
