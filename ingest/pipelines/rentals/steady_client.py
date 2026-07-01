"""Throttled SteadyAPI GET helper for rentals. Mirrors market_aggregates/steady_client.py verbatim —
network lives ONLY here so the pure parsers + `--dry-run` never touch it. Throttles below the verified
15 req/sec cap. A missing key or any non-200/exception returns a sentinel the caller treats as a gap
(never fabricates a row)."""
from __future__ import annotations

import os
import time
from typing import Any

from .constants import RATE_LIMIT_RPS, STEADYAPI_BASE, STEADYAPI_HEADERS

_MIN_INTERVAL = 1.0 / RATE_LIMIT_RPS
_last_call = [0.0]


def _throttle() -> None:
    now = time.monotonic()
    wait = _MIN_INTERVAL - (now - _last_call[0])
    if wait > 0:
        time.sleep(wait)
    _last_call[0] = time.monotonic()


def get_json(path: str, params: dict, *, key: str | None = None, timeout: int = 30) -> tuple[int, Any]:
    """(status_code, json | None). status 0 = no key; -1 = network/parse error. Import of requests is
    lazy so pure callers + dry-runs don't require it installed."""
    key = key or os.environ.get("PHOTOS_API")
    if not key:
        return 0, None
    import requests

    _throttle()
    try:
        r = requests.get(
            f"{STEADYAPI_BASE}/{path}",
            params=params,
            headers={**STEADYAPI_HEADERS, "Authorization": f"Bearer {key}"},
            timeout=timeout,
        )
        if r.status_code != 200:
            return r.status_code, None
        return 200, r.json()
    except Exception:
        return -1, None
