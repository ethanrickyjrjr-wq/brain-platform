"""KeywordVolumeProvider — a pluggable demand source whose `name` makes
provenance STRUCTURAL.

The pipeline stamps every row's `source` column from `provider.name`. That is
the whole point of the abstraction: cite-or-no-claim stops depending on anyone
remembering to label the source in prose — the citation rides in the data.

v1 wires `DataForSEOKeywordVolumeProvider`. `GoogleAdsKeywordVolumeProvider` is
defined but deliberately NOT exported from the package `__init__` and NOT in any
registry — reaching it takes an explicit `from .providers import ...`, never an
accidental pickup. Its swap-gate (see the class docstring) must clear first.
"""
from __future__ import annotations

import abc
from datetime import datetime, timezone
from typing import Any

import requests

from .constants import (
    DATAFORSEO_SEARCH_VOLUME_URL,
    LANGUAGE_CODE,
    MAX_KEYWORDS_PER_TASK,
)

# Provider-agnostic normalized row. The pipeline maps this dict -> DB columns.
# Keys: keyword, source, location, captured_month (date|None), avg_monthly_searches
# (int|None), competition (str|None), cpc (float|None), monthly_searches (list),
# is_bucketed (bool), fetched_at (str ISO).
NormalizedRow = dict[str, Any]


def _chunk(items: list[str], size: int) -> list[list[str]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def _captured_month(monthly_searches: list[dict[str, Any]]) -> str | None:
    """The latest (year, month) present in monthly_searches, as 'YYYY-MM-01'.

    This is the month the volume describes — it anchors the upsert key so a new
    data-month creates a new row instead of overwriting last month's reading.
    Returns None when monthly_searches is empty/malformed (caller falls back to
    the current UTC month).
    """
    best: tuple[int, int] | None = None
    for m in monthly_searches or []:
        try:
            ym = (int(m["year"]), int(m["month"]))
        except (KeyError, TypeError, ValueError):
            continue
        if best is None or ym > best:
            best = ym
    if best is None:
        return None
    return f"{best[0]:04d}-{best[1]:02d}-01"


def normalize_result_row(
    result: dict[str, Any],
    *,
    source: str,
    location_label: str,
    fetched_at: str,
    is_bucketed: bool,
) -> NormalizedRow:
    """Map ONE DataForSEO `result` object to a normalized row. Pure — unit-tested
    without a network call."""
    monthly = result.get("monthly_searches") or []
    captured = _captured_month(monthly) or fetched_at[:7] + "-01"
    sv = result.get("search_volume")
    cpc = result.get("cpc")
    return {
        "keyword": (result.get("keyword") or "").strip().lower(),
        "source": source,  # STRUCTURAL provenance — from provider.name
        "location": location_label,
        "captured_month": captured,
        "avg_monthly_searches": int(sv) if isinstance(sv, (int, float)) else None,
        "competition": result.get("competition"),  # HIGH/MEDIUM/LOW | None
        "cpc": float(cpc) if isinstance(cpc, (int, float)) else None,
        "monthly_searches": monthly,
        "is_bucketed": is_bucketed,
        "fetched_at": fetched_at,
    }


def parse_search_volume_response(
    body: dict[str, Any],
    *,
    source: str,
    location_label: str,
    fetched_at: str,
    is_bucketed: bool,
) -> list[NormalizedRow]:
    """Flatten a DataForSEO search_volume response (tasks[].result[]) to rows.

    Pure (no network) so the mapping is unit-tested against a fixture body.
    Rows with an empty keyword are dropped.
    """
    rows: list[NormalizedRow] = []
    for task in body.get("tasks") or []:
        for result in task.get("result") or []:
            row = normalize_result_row(
                result,
                source=source,
                location_label=location_label,
                fetched_at=fetched_at,
                is_bucketed=is_bucketed,
            )
            if row["keyword"]:
                rows.append(row)
    return rows


class KeywordVolumeProvider(abc.ABC):
    """A demand-volume source. `name` is stamped into every row's `source`."""

    name: str

    @abc.abstractmethod
    def fetch(
        self, keywords: list[str], location_label: str, location_query: str | int
    ) -> list[NormalizedRow]:
        """Return normalized rows for `keywords` at one SWFL location.

        `location_query` is a DataForSEO location_name (str) or location_code
        (int); `location_label` is our stable label stored in the `location`
        column.
        """
        raise NotImplementedError


class DataForSEOKeywordVolumeProvider(KeywordVolumeProvider):
    """v1 demand source: DataForSEO Google Ads search-volume (live).

    DataForSEO resells exact Google Ads volume, so `is_bucketed` is always False
    here. (The flag exists to guard the future Google Ads provider, whose
    spend-less accounts can return bucketed ranges.)
    """

    name = "dataforseo"

    def __init__(self, login: str, password: str, *, timeout: int = 120) -> None:
        self._auth = (login, password)
        self._timeout = timeout

    def fetch(
        self, keywords: list[str], location_label: str, location_query: str | int
    ) -> list[NormalizedRow]:
        fetched_at = datetime.now(timezone.utc).isoformat()
        rows: list[NormalizedRow] = []
        for batch in _chunk(keywords, MAX_KEYWORDS_PER_TASK):
            task: dict[str, Any] = {
                "keywords": batch,
                "language_code": LANGUAGE_CODE,
            }
            if isinstance(location_query, int):
                task["location_code"] = location_query
            else:
                task["location_name"] = location_query
            # DataForSEO request body is an ARRAY of task objects.
            resp = requests.post(
                DATAFORSEO_SEARCH_VOLUME_URL,
                auth=self._auth,
                json=[task],
                timeout=self._timeout,
            )
            resp.raise_for_status()
            body = resp.json()
            status = body.get("status_code")
            if status != 20000:  # DataForSEO success code
                raise RuntimeError(
                    f"DataForSEO error {status}: {body.get('status_message')}"
                )
            rows.extend(
                parse_search_volume_response(
                    body,
                    source=self.name,
                    location_label=location_label,
                    fetched_at=fetched_at,
                    is_bucketed=False,
                )
            )
        return rows


class GoogleAdsKeywordVolumeProvider(KeywordVolumeProvider):
    """STUB — not wired. Swap-gate: enable ONLY after (1) a Basic-Access Google
    Ads developer token is confirmed AND (2) a test pull returns EXACT volumes
    (is_bucketed=False), not bucketed ranges. Token-cleared alone is
    insufficient — bucketed ranges are a data-quality trap, same category as
    fixture data. Deliberately absent from __init__ exports so it can't be
    reached by accident.
    """

    name = "google_ads"

    def fetch(
        self, keywords: list[str], location_label: str, location_query: str | int
    ) -> list[NormalizedRow]:
        raise NotImplementedError(
            "GoogleAdsKeywordVolumeProvider is gated: wire in only after a "
            "Basic-Access developer token is confirmed AND a test pull returns "
            "exact (is_bucketed=False) volumes, not bucketed ranges. Use "
            "DataForSEOKeywordVolumeProvider until both hold."
        )
