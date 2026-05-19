"""Pure parser for the NOAA NHC HURDAT2 best-track text format.

Format reference: https://www.nhc.noaa.gov/data/hurdat/hurdat2-format-atl-2021.pdf

Layout: alternating header + observation blocks.

  Header line (3 comma-separated fields, trailing comma):
    AL092022,                IAN,   39,
    └ basin+number+year   └ name  └ num obs lines that follow

  Observation lines (21 comma-separated fields):
    20220928, 1900,  L, HU, 26.7N,  82.1W, 130,  937, ... (radii fields)
    └ yyyymmdd └ hhmm └ record_id (L = landfall, blank otherwise)
       └ status (TD/TS/HU/EX/SD/SS/LO/WV/DB)
       └ lat (NS suffix) └ lon (EW suffix)
       └ max_wind_kt └ min_pressure_mb
       └ 16 radii / RMW fields (ignored here)

Storm names may be `UNNAMED`. Wind/pressure use -999 for unknown — converted to
None so downstream SQL (MIN/AVG/MAX) doesn't poison aggregates.
"""
from dataclasses import dataclass
from typing import Iterable, Iterator

from ingest.duckdb_pipelines.hurdat2_fl.constants import (
    HURDAT2_MISSING_SENTINEL,
    SAFFIR_CUTS_KT,
)


@dataclass(frozen=True)
class TrackPoint:
    storm_id: str          # e.g. "AL092022"
    storm_name: str        # e.g. "IAN" or "UNNAMED"
    storm_year: int        # e.g. 2022
    obs_date: str          # ISO date "YYYY-MM-DD"
    obs_time: str          # "HH:MM" (24h UTC)
    record_id: str | None  # "L" = landfall, "P" = min pressure, etc. None if blank.
    status: str            # "HU", "TS", "TD", "EX", "SD", "SS", "LO", "WV", "DB"
    lat: float             # decimal degrees, positive N
    lon: float             # decimal degrees, positive E (negative for W)
    max_wind_kt: int | None
    min_pressure_mb: int | None
    category_saffir: int | None  # 1..5 or None (below cat-1 or wind missing)


def _decode_lat(raw: str) -> float:
    """`24.8N` -> 24.8, `12.3S` -> -12.3."""
    raw = raw.strip()
    suffix = raw[-1].upper()
    value = float(raw[:-1])
    if suffix == "S":
        return -value
    if suffix == "N":
        return value
    raise ValueError(f"unexpected lat suffix in {raw!r}")


def _decode_lon(raw: str) -> float:
    """`82.5W` -> -82.5, `10.1E` -> 10.1."""
    raw = raw.strip()
    suffix = raw[-1].upper()
    value = float(raw[:-1])
    if suffix == "W":
        return -value
    if suffix == "E":
        return value
    raise ValueError(f"unexpected lon suffix in {raw!r}")


def _coerce_int_or_none(raw: str) -> int | None:
    """Strip, parse int, return None for HURDAT2's -999 sentinel."""
    raw = raw.strip()
    if not raw:
        return None
    value = int(raw)
    if value == HURDAT2_MISSING_SENTINEL:
        return None
    return value


def _saffir_category(max_wind_kt: int | None) -> int | None:
    """Map max sustained wind (kt) to Saffir-Simpson cat 1..5. None below cat 1."""
    if max_wind_kt is None:
        return None
    for cut_kt, cat in SAFFIR_CUTS_KT:
        if max_wind_kt >= cut_kt:
            return cat
    return None


def _parse_header(line: str) -> tuple[str, str, int]:
    parts = [p.strip() for p in line.split(",")]
    if len(parts) < 3:
        raise ValueError(f"header line has <3 fields: {line!r}")
    storm_id = parts[0]
    storm_name = parts[1]
    num_obs = int(parts[2])
    return storm_id, storm_name, num_obs


def _parse_obs(line: str, storm_id: str, storm_name: str, storm_year: int) -> TrackPoint:
    parts = [p.strip() for p in line.split(",")]
    if len(parts) < 9:
        raise ValueError(f"obs line has <9 fields: {line!r}")
    date_raw = parts[0]               # YYYYMMDD
    time_raw = parts[1]               # HHMM
    record_id_raw = parts[2]          # may be empty
    status = parts[3]
    lat = _decode_lat(parts[4])
    lon = _decode_lon(parts[5])
    max_wind_kt = _coerce_int_or_none(parts[6])
    min_pressure_mb = _coerce_int_or_none(parts[7])

    iso_date = f"{date_raw[0:4]}-{date_raw[4:6]}-{date_raw[6:8]}"
    iso_time = f"{time_raw[0:2]}:{time_raw[2:4]}"
    record_id = record_id_raw if record_id_raw else None

    return TrackPoint(
        storm_id=storm_id,
        storm_name=storm_name,
        storm_year=storm_year,
        obs_date=iso_date,
        obs_time=iso_time,
        record_id=record_id,
        status=status,
        lat=lat,
        lon=lon,
        max_wind_kt=max_wind_kt,
        min_pressure_mb=min_pressure_mb,
        category_saffir=_saffir_category(max_wind_kt),
    )


def parse_hurdat2(lines: Iterable[str]) -> Iterator[TrackPoint]:
    """Stream `TrackPoint` rows from raw HURDAT2 text lines.

    Strict header/obs alternation: each header declares N, then exactly N
    observation lines follow. ValueError on count mismatch — the file is
    NHC-published and well-formed; surprises mean the format changed.
    """
    pending: int | None = None  # number of obs still expected for current storm
    storm_id = ""
    storm_name = ""
    storm_year = 0

    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        if pending is None or pending == 0:
            storm_id, storm_name, pending = _parse_header(line)
            # Year is encoded as last 4 chars of the storm_id (e.g. AL092022 -> 2022).
            storm_year = int(storm_id[-4:])
            continue
        yield _parse_obs(line, storm_id, storm_name, storm_year)
        pending -= 1

    if pending is not None and pending != 0:
        raise ValueError(
            f"HURDAT2 ended mid-storm: {storm_id} expected {pending} more obs lines"
        )
