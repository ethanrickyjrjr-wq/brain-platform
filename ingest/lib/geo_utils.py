import hashlib
import json
import math
import pathlib

FL_BBOX = (-87.6, 24.4, -79.9, 31.0)
LEE_COUNTY_BBOX = (-82.4, 26.3, -81.5, 26.8)
FL_FIPS_STATE = "12"

_CENTROID_FIXTURE = pathlib.Path(__file__).parents[2] / "fixtures" / "swfl-zip-centroids.json"

# Beyond this distance no SWFL ZIP centroid exists — point is outside the footprint.
_MAX_DIST_MI = 10.0

_CENTROIDS: dict[str, tuple[float, float]] | None = None


def _load_centroids() -> dict[str, tuple[float, float]]:
    data = json.loads(_CENTROID_FIXTURE.read_text())
    return {e["zip"]: (e["lat"], e["lng"]) for e in data["entries"]}


def _haversine_mi(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 3958.8
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlng / 2) ** 2
    )
    return R * 2 * math.asin(math.sqrt(a))


def coord_to_zip(lat: float, lng: float) -> str | None:
    """Return the nearest in-scope SWFL ZIP code for a coordinate pair.

    Uses centroid-nearest lookup (Census TIGER 2020 ZCTA5 centroids, ±1–3 mi).
    Returns None when the point is more than 10 miles from every centroid,
    meaning it is outside the 6-county SWFL footprint.
    """
    global _CENTROIDS
    if _CENTROIDS is None:
        _CENTROIDS = _load_centroids()
    best_zip: str | None = None
    best_dist = float("inf")
    for z, (clat, clng) in _CENTROIDS.items():
        d = _haversine_mi(lat, lng, clat, clng)
        if d < best_dist:
            best_dist, best_zip = d, z
    return best_zip if best_dist <= _MAX_DIST_MI else None


def geometry_hash(geojson_geometry: dict) -> str:
    stable = json.dumps(geojson_geometry, sort_keys=True, separators=(",", ":"))
    return hashlib.md5(stable.encode()).hexdigest()
