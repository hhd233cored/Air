"""Small, single-process sliding-window rate limiter.

The Python backend is intentionally run with one Uvicorn worker. Keeping the
counter in memory avoids another dependency and avoids writing every request
to the authentication SQLite database. If the service later runs with
multiple workers or multiple instances, replace this module with a shared
Redis-backed implementation.
"""

from __future__ import annotations

import math
import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class RateLimitRule:
    limit: int
    window_seconds: int


class RateLimitError(Exception):
    """Raised when a request exceeds a configured rate limit."""

    def __init__(
        self,
        *,
        bucket: str,
        rule: RateLimitRule,
        retry_after: int,
    ) -> None:
        super().__init__(f"Rate limit exceeded for {bucket}")
        self.bucket = bucket
        self.limit = rule.limit
        self.retry_after = max(1, retry_after)
        self.reset_after = self.retry_after


class InMemoryRateLimiter:
    """Thread-safe sliding-window limiter with a bounded key cache."""

    def __init__(
        self,
        *,
        enabled: bool = True,
        max_keys: int = 10_000,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.enabled = enabled
        self.max_keys = max(100, max_keys)
        self._clock = clock
        self._lock = threading.Lock()
        self._buckets: dict[str, deque[float]] = {}

    def check(self, bucket: str, identifier: str, rule: RateLimitRule) -> None:
        """Consume one request or raise ``RateLimitError``.

        Invalid non-positive rules are treated as disabled so a bad optional
        deployment setting cannot accidentally make the whole API unusable.
        """

        if not self.enabled or rule.limit <= 0 or rule.window_seconds <= 0:
            return

        now = self._clock()
        key = f"{bucket}:{identifier}"
        with self._lock:
            events = self._buckets.setdefault(key, deque())
            cutoff = now - rule.window_seconds
            while events and events[0] <= cutoff:
                events.popleft()

            if len(events) >= rule.limit:
                retry_after = math.ceil(rule.window_seconds - (now - events[0]))
                raise RateLimitError(bucket=bucket, rule=rule, retry_after=retry_after)

            events.append(now)
            self._trim_keys()

    def _trim_keys(self) -> None:
        if len(self._buckets) <= self.max_keys:
            return
        # This path is only used when a large number of distinct IPs/IDs are
        # seen. Removing the least recently active key keeps memory bounded.
        oldest_key = min(
            self._buckets,
            key=lambda key: self._buckets[key][-1] if self._buckets[key] else float("inf"),
        )
        self._buckets.pop(oldest_key, None)

    def clear(self) -> None:
        with self._lock:
            self._buckets.clear()

