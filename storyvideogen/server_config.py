from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping


@dataclass(frozen=True)
class ServerConfig:
    secure_cookies: bool = False
    max_upload_bytes: int = 10 * 1024 * 1024
    worker_count: int = 2
    login_rate_limit: int = 10
    login_rate_window_seconds: int = 5 * 60
    register_rate_limit: int = 5
    register_rate_window_seconds: int = 60 * 60
    generation_rate_limit: int = 6
    generation_rate_window_seconds: int = 60 * 60
    max_stories_per_user: int = 20
    max_active_jobs_per_user: int = 2
    max_prepare_jobs_per_day: int = 20
    max_compose_jobs_per_day: int = 20


def load_server_config(environ: Mapping[str, str] | None = None) -> ServerConfig:
    env = environ or os.environ
    return ServerConfig(
        secure_cookies=_env_bool(env, "STORYVIDEOGEN_SECURE_COOKIES", False),
        max_upload_bytes=_env_int(env, "STORYVIDEOGEN_MAX_UPLOAD_BYTES", 10 * 1024 * 1024),
        worker_count=_env_int(env, "STORYVIDEOGEN_WORKER_COUNT", 2),
        login_rate_limit=_env_int(env, "STORYVIDEOGEN_LOGIN_RATE_LIMIT", 10),
        login_rate_window_seconds=_env_int(env, "STORYVIDEOGEN_LOGIN_RATE_WINDOW_SECONDS", 5 * 60),
        register_rate_limit=_env_int(env, "STORYVIDEOGEN_REGISTER_RATE_LIMIT", 5),
        register_rate_window_seconds=_env_int(env, "STORYVIDEOGEN_REGISTER_RATE_WINDOW_SECONDS", 60 * 60),
        generation_rate_limit=_env_int(env, "STORYVIDEOGEN_GENERATION_RATE_LIMIT", 6),
        generation_rate_window_seconds=_env_int(env, "STORYVIDEOGEN_GENERATION_RATE_WINDOW_SECONDS", 60 * 60),
        max_stories_per_user=_env_int(env, "STORYVIDEOGEN_MAX_STORIES_PER_USER", 20),
        max_active_jobs_per_user=_env_int(env, "STORYVIDEOGEN_MAX_ACTIVE_JOBS_PER_USER", 2),
        max_prepare_jobs_per_day=_env_int(env, "STORYVIDEOGEN_MAX_PREPARE_JOBS_PER_DAY", 20),
        max_compose_jobs_per_day=_env_int(env, "STORYVIDEOGEN_MAX_COMPOSE_JOBS_PER_DAY", 20),
    )


def admin_usernames(environ: Mapping[str, str] | None = None) -> set[str]:
    env = environ or os.environ
    return {username.strip().lower() for username in env.get("STORYVIDEOGEN_ADMIN_USERS", "").split(",") if username.strip()}


def is_admin_user(user: dict[str, object] | None, environ: Mapping[str, str] | None = None) -> bool:
    if user is None:
        return False
    return str(user.get("username") or "").lower() in admin_usernames(environ)


def _env_int(env: Mapping[str, str], name: str, default: int) -> int:
    try:
        return max(1, int(env.get(name, str(default))))
    except ValueError:
        return default


def _env_bool(env: Mapping[str, str], name: str, default: bool) -> bool:
    value = env.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}
