"""In-process sliding-window rate limiter for the public dashboard endpoints.

Clients are keyed by the socket peer address. That is correct only while nothing proxies the
gallery: a reverse proxy in front would collapse every visitor into one bucket and would need
trusted X-Forwarded-For handling. Synchronous and unlocked on purpose: the app runs one worker.
"""

from __future__ import annotations

import time
from collections import deque
from collections.abc import Callable


class RateLimiter:
    def __init__(
        self,
        per_client: int,
        total: int,
        window_s: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._per_client = per_client
        self._total = total
        self._window_s = window_s
        self._clock = clock
        self._all: deque[float] = deque()
        self._by_client: dict[str, deque[float]] = {}

    def allow(self, client: str) -> bool:
        """Record and allow a call, or deny it without counting it."""
        now = self._clock()
        cutoff = now - self._window_s
        self._prune(self._all, cutoff)
        mine = self._by_client.setdefault(client, deque())
        self._prune(mine, cutoff)
        if len(mine) >= self._per_client or len(self._all) >= self._total:
            if not mine:
                del self._by_client[client]
            return False
        mine.append(now)
        self._all.append(now)
        return True

    @staticmethod
    def _prune(stamps: deque[float], cutoff: float) -> None:
        while stamps and stamps[0] <= cutoff:
            stamps.popleft()
