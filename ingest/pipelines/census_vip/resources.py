"""Fetch helpers for census_vip."""
from __future__ import annotations

import os

import requests

from .constants import CATEGORY_CODES, DATA_TYPE_CODE, SEASONALLY_ADJ, SOURCE_URL, TIME_FROM, time_to


def fetch_census_vip() -> list[dict]:
    key = os.environ["CENSUS_API_KEY"]
    time_to_val = time_to()

    # NOTE: time_slot_id MUST be in get= only, NOT as a URL predicate.
    # Including it as a predicate (time_slot_id=1) causes HTTP 204 No Content.
    # NOTE: time= range uses literal "+" (from+2015-01); requests.get params= would
    # URL-encode "+" as "%2B" causing HTTP 400, so we embed time in the URL directly.
    get_fields = "cell_value,category_code,time_slot_id,data_type_code,seasonally_adj"
    url = f"{SOURCE_URL}?get={get_fields}&time={TIME_FROM}+to+{time_to_val}&key={key}"
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    raw = resp.json()

    header = raw[0]
    rows: list[dict] = []
    for rec in raw[1:]:
        d = dict(zip(header, rec))
        if d.get("data_type_code") != DATA_TYPE_CODE:
            continue
        if d.get("seasonally_adj") != SEASONALLY_ADJ:
            continue
        cat = d.get("category_code", "")
        if cat not in CATEGORY_CODES:
            continue
        try:
            value = float(d["cell_value"])
        except (ValueError, TypeError):
            continue
        rows.append(
            {
                "time": d["time"],
                "category_code": cat,
                "category_label": CATEGORY_CODES[cat],
                "cell_value": value,
                "time_slot_id": d.get("time_slot_id", ""),
                "data_type_code": d.get("data_type_code", ""),
                "seasonally_adj": d.get("seasonally_adj", ""),
            }
        )
    return rows
