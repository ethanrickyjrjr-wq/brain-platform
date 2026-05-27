"""Census batch geocoder and corridor assignment for Collier permits.

Uses the US Census Geocoding API (free, no key required, 10k rows/batch).
Site addresses are in the format "3390 27th AVE NE, Naples" — city is appended
after the last comma, so we split on the last comma to get street vs. city.
"""
from __future__ import annotations

import csv
import io
import json
import math
from pathlib import Path

import requests

from .constants import CENSUS_BATCH_SIZE, CENSUS_GEOCODER_URL, MAX_RADIUS_MI

EARTH_RADIUS_MI = 3958.7613

_CENTROIDS_PATH = Path(__file__).resolve().parents[3] / "fixtures" / "corridor-centroids.json"


def load_collier_centroids() -> list[dict]:
    """Load the unified corridor centroids fixture and return only Collier rows.

    The fixture lives at `fixtures/corridor-centroids.json` (repo root) and holds
    both Lee and Collier corridors. Each row carries a `county` field
    (`"lee"` | `"collier"`); this loader filters to Collier so the existing
    geocoder + assign_corridor logic keeps a county-scoped centroid list.
    """
    with open(_CENTROIDS_PATH) as f:
        raw = json.load(f)
    return [c for c in raw if c.get("county") == "collier"]


def _haversine_mi(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return EARTH_RADIUS_MI * 2 * math.asin(math.sqrt(min(a, 1.0)))


def assign_corridor(
    lat: float | None,
    lon: float | None,
    centroids: list[dict],
) -> str | None:
    """Return nearest corridor_id within MAX_RADIUS_MI, or None."""
    if lat is None or lon is None or not math.isfinite(lat) or not math.isfinite(lon):
        return None
    best_id: str | None = None
    best_dist = float("inf")
    for c in centroids:
        d = _haversine_mi(lat, lon, c["center_lat"], c["center_lon"])
        if d < best_dist:
            best_dist = d
            best_id = c["corridor_id"]
    return best_id if best_dist <= MAX_RADIUS_MI else None


def _split_site_address(site_address: str) -> tuple[str, str]:
    """Split '3390 27th AVE NE, Naples' → ('3390 27th AVE NE', 'Naples')."""
    parts = site_address.rsplit(",", 1)
    if len(parts) == 2:
        return parts[0].strip(), parts[1].strip()
    return site_address.strip(), "Naples"


def geocode_batch(
    addresses: list[str],
    session: requests.Session | None = None,
) -> dict[str, tuple[float, float] | None]:
    """Geocode site addresses via Census batch API.

    Returns {address: (lat, lon) | None}. Addresses that don't match return None.
    Deduplicates before sending; chunks at CENSUS_BATCH_SIZE.
    """
    unique = list(dict.fromkeys(a for a in addresses if a))
    result: dict[str, tuple[float, float] | None] = {a: None for a in unique}
    if not unique:
        return result

    http = session or requests.Session()

    for start in range(0, len(unique), CENSUS_BATCH_SIZE):
        chunk = unique[start : start + CENSUS_BATCH_SIZE]

        csv_lines = []
        for i, addr in enumerate(chunk):
            street, city = _split_site_address(addr)
            # id, street address, city, state, zip (zip omitted — Census infers from city+state)
            csv_lines.append(f"{i},{street},{city},FL,")
        payload = "\n".join(csv_lines)

        try:
            r = http.post(
                CENSUS_GEOCODER_URL,
                data={
                    "benchmark": "Public_AR_Current",
                    "returntype": "locations",
                },
                files={"addressFile": ("addresses.csv", payload.encode("utf-8"), "text/plain")},
                timeout=120,
            )
            r.raise_for_status()
        except requests.RequestException as exc:
            print(f"[geocoder] Census API error for chunk {start}-{start+len(chunk)}: {exc}")
            continue

        # Response CSV: id, input_addr, match, match_type, matched_addr, lon_lat, tiger_id, side
        reader = csv.reader(io.StringIO(r.text))
        for row in reader:
            if len(row) < 6:
                continue
            idx_str = row[0].strip()
            match_status = row[2].strip().lower()
            coords = row[5].strip() if len(row) > 5 else ""

            if match_status != "match" or not coords:
                continue
            try:
                lon_str, lat_str = coords.split(",")
                lat, lon = float(lat_str.strip()), float(lon_str.strip())
                result[chunk[int(idx_str)]] = (lat, lon)
            except (ValueError, IndexError):
                continue

    return result
