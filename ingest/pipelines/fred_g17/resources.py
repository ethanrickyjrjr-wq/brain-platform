"""Fetch helpers for fred_g17."""
from __future__ import annotations

import os
from datetime import date

import requests

from .constants import OBSERVATION_START, SERIES_IDS

SOURCE_URL = "https://api.stlouisfed.org/fred/series/observations"


def fetch_fred_g17() -> list[dict]:
    key = os.environ["FRED_API_KEY"]
    today = date.today().isoformat()
    rows: list[dict] = []
    for sid in SERIES_IDS:
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
                    "date": obs["date"],
                    "value": float(obs["value"]),
                    "vintage_date": today,
                }
            )
    return rows
