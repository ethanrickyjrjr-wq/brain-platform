import io
import ssl
import zipfile
import csv

import requests
from requests.adapters import HTTPAdapter
import dlt


class _LegacySSLAdapter(HTTPAdapter):
    """ORNL's server drops TLS cleanly — Python 3.12+ treats that as an error.
    OP_LEGACY_SERVER_CONNECT restores the pre-3.12 permissive behaviour."""
    def init_poolmanager(self, *args, **kwargs):
        ctx = ssl.create_default_context()
        ctx.options |= getattr(ssl, "OP_LEGACY_SERVER_CONNECT", 0)
        kwargs["ssl_context"] = ctx
        super().init_poolmanager(*args, **kwargs)

from .constants import (
    FAF5_DOWNLOAD_URL,
    FL_ZONE_IDS,
    FAF5_YEARS,
    FAF_ZONE_LOOKUP,
    SCTG_LOOKUP,
)

_YEAR_COLS: list[str] = (
    [f"tons_{y}"   for y in FAF5_YEARS]
    + [f"value_{y}"  for y in FAF5_YEARS]
    + [f"tmiles_{y}" for y in FAF5_YEARS]
)

_FLOW_COLUMNS: dict = {
    "dms_orig":   {"data_type": "bigint"},
    "dms_dest":   {"data_type": "bigint"},
    "sctg2":      {"data_type": "bigint"},
    "trade_type": {"data_type": "bigint"},
    **{col: {"data_type": "double"} for col in _YEAR_COLS},
}


def _download_faf5_rows() -> csv.DictReader:
    session = requests.Session()
    session.mount("https://", _LegacySSLAdapter())
    resp = session.get(FAF5_DOWNLOAD_URL, stream=True, timeout=180)
    resp.raise_for_status()
    raw = b"".join(resp.iter_content(chunk_size=1024 * 1024))
    zf = zipfile.ZipFile(io.BytesIO(raw))
    csv_name = next(n for n in zf.namelist() if n.lower().endswith(".csv"))
    return csv.DictReader(io.TextIOWrapper(zf.open(csv_name), encoding="utf-8"))


@dlt.resource(
    table_name="faf_flows",
    write_disposition="replace",
    columns=_FLOW_COLUMNS,
)
def faf_flows():
    for row in _download_faf5_rows():
        orig = int(row["dms_orig"])
        dest = int(row["dms_dest"])
        if orig not in FL_ZONE_IDS and dest not in FL_ZONE_IDS:
            continue
        out: dict = {
            "dms_orig":   orig,
            "dms_dest":   dest,
            "sctg2":      int(row["sctg2"]),
            "trade_type": int(row["trade_type"]),
        }
        for col in _YEAR_COLS:
            val = row.get(col, "")
            if val not in ("", None):
                out[col] = float(val)
        yield out


@dlt.resource(
    table_name="faf_zone_lookup",
    write_disposition="replace",
    columns={
        "zone_id":    {"data_type": "bigint"},
        "zone_name":  {"data_type": "text"},
        "state_abbr": {"data_type": "text"},
    },
)
def faf_zone_lookup():
    yield from FAF_ZONE_LOOKUP


@dlt.resource(
    table_name="faf_sctg_lookup",
    write_disposition="replace",
    columns={
        "sctg_code":      {"data_type": "bigint"},
        "commodity_name": {"data_type": "text"},
    },
)
def faf_sctg_lookup():
    yield from SCTG_LOOKUP
