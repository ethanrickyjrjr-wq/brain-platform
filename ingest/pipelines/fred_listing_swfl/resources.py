"""Fetch helpers for fred_listing_swfl."""
from __future__ import annotations

import os
from datetime import date

import requests

from .constants import OBSERVATION_START, SERIES_MAP

SOURCE_URL = "https://api.stlouisfed.org/fred/series/observations"


def fetch_fred_listing_swfl() -> list[dict]:
    """Pull all monthly observations for the 8 Realtor.com listing series from FRED."""
    key = os.environ["FRED_API_KEY"]
    today = date.today().isoformat()
    rows: list[dict] = []
    for sid, meta in SERIES_MAP.items():
        resp = requests.get(
            SOURCE_URL,
            params={
                "series_id": sid,
                "api_key": key,
                "file_type": "json",
                "observation_start": OBSERVATION_START,
                "sort_order": "asc",
            },
            timeout=30,
        )
        resp.raise_for_status()
        for obs in resp.json().get("observations", []):
            if obs["value"] == ".":
                continue
            rows.append(
                {
                    "series_id": sid,
                    "area": meta["area"],
                    "metric": meta["metric"],
                    "msa_code": meta["msa_code"],
                    "date": obs["date"],
                    "value": float(obs["value"]),
                    "vintage_date": today,
                }
            )
    return rows
