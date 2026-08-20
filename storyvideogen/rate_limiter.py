from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass


@dataclass(frozen=True)
class RateLimit:
    max_events: int
    window_seconds: int


class InMemoryRateLimiter:
    def __init__(self) -> None:
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, limit: RateLimit) -> None:
        now = time.monotonic()
        cutoff = now - limit.window_seconds
        with self._lock:
            events = self._events[key]
            while events and events[0] < cutoff:
                events.popleft()
            if len(events) >= limit.max_events:
                raise RateLimitExceeded("Too many requests. Please wait and try again.")
            events.append(now)


class RateLimitExceeded(ValueError):
    pass
