from __future__ import annotations

import os
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar

_CREDENTIALS: ContextVar[dict[str, str]] = ContextVar("storyvideogen_provider_credentials", default={})


@contextmanager
def provider_credentials(credentials: Mapping[str, str]) -> Iterator[None]:
    clean_credentials = {str(key): str(value) for key, value in credentials.items() if value}
    token = _CREDENTIALS.set(clean_credentials)
    try:
        yield
    finally:
        _CREDENTIALS.reset(token)


def credential_value(*names: str) -> str | None:
    credentials = _CREDENTIALS.get()
    for name in names:
        value = credentials.get(name)
        if value:
            return value
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return None
