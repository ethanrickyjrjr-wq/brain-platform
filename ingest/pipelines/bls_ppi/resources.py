"""Fetch helpers for bls_ppi."""
from __future__ import annotations

import json
import os

import requests

from .constants import SERIES_IDS, SOURCE_URL, current_year_window


def fetch_bls_ppi() -> list[dict]:
    start_year, end_year = current_year_window()
    api_key = os.environ.get("BLS_API_KEY")

    payload: dict = {
        "seriesid": SERIES_IDS,
        "startyear": start_year,
        "endyear": end_year,
    }
    if api_key:
        payload["registrationkey"] = api_key

    resp = requests.post(
        SOURCE_URL,
        data=json.dumps(payload),
        headers={"Content-Type": "application/json"},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()

    if data.get("status") != "REQUEST_SUCCEEDED":
        raise RuntimeError(f"BLS API error: {data.get('message', data.get('status'))}")

    rows: list[dict] = []
    for series in data.get("Results", {}).get("series", []):
        sid = series["seriesID"]
        for obs in series.get("data", []):
            rows.append(
                {
                    "series_id": sid,
                    "year": obs["year"],
                    "period": obs["period"],
                    "period_name": obs.get("periodName", ""),
                    "value": float(obs["value"]),
                }
            )
    return rows
