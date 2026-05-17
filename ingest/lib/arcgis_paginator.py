import time
import requests


def paginate_arcgis(base_url, where="1=1", out_fields="*", bbox=None, page_size=2000):
    """Sync generator. Yields GeoJSON Feature dicts. Retries 3x on 5xx."""
    params = {
        "where": where,
        "outFields": out_fields,
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "outSR": "4326",
        "f": "geojson",
        "resultRecordCount": page_size,
    }
    if bbox is not None:
        params["geometry"] = f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}"

    offset = 0
    while True:
        params["resultOffset"] = offset
        resp = None
        for attempt in range(3):
            try:
                resp = requests.get(base_url, params=params, timeout=60)
                if resp.status_code >= 500 and attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                resp.raise_for_status()
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)

        data = resp.json()
        features = data.get("features", [])
        if not features:
            break
        yield from features
        if not data.get("exceededTransferLimit", False):
            break
        offset += len(features)
