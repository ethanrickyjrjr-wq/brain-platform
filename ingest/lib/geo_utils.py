import hashlib
import json

FL_BBOX = (-87.6, 24.4, -79.9, 31.0)
LEE_COUNTY_BBOX = (-82.4, 26.3, -81.5, 26.8)
FL_FIPS_STATE = "12"


def geometry_hash(geojson_geometry: dict) -> str:
    stable = json.dumps(geojson_geometry, sort_keys=True, separators=(",", ":"))
    return hashlib.md5(stable.encode()).hexdigest()
