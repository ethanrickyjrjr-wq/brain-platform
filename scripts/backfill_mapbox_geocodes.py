"""One-off: write Mapbox-geocoded lat/lon for the 34 Lee permits that Census missed,
then re-run corridor assignment on ALL rows that have lat/lon (clears partial coverage too).

Run:  python scripts/backfill_mapbox_geocodes.py
"""
from __future__ import annotations
import sys
import tomllib
from pathlib import Path

# ── Mapbox results (address as stored in DB → lat, lon) ─────────────────────
# Empty-address row FNC2026-02220 is excluded — nothing to geocode.
# Punta Gorda row OPN2026-02380 (3255 SUGARLOAF KEY RD, 32B) is included —
# it IS Lee County per Mapbox (Burnt Store Marina, Lee Co).
MAPBOX_GEO: dict[str, tuple[float, float]] = {
    "3439 MELOY DR, FORT MYERS FL 33905":                  (26.6898,    -81.72515),
    "3461 MELOY DR, FORT MYERS FL 33905":                  (26.68875,   -81.72514),
    "15101 SHELL POINT BLVD, FORT MYERS FL 33908":         (26.51684,   -81.9957),
    "16181 FAIRWAY WOODS DR, 1405, FORT MYERS FL 33908":   (26.504207,  -81.867347),
    "16881 DAVIS RD, 911, FORT MYERS FL 33908":            (26.495522,  -81.977473),
    "15687 CALOOSA CREEK CIR, FORT MYERS FL 33908":        (26.515458,  -81.971541),
    "7382 BLUE SALVIA DR, NORTH FORT MYERS FL 33917":      (26.7231,    -81.83833),
    "7020 TALL OAK TRCE, NORTH FORT MYERS FL 33917":       (26.721638,  -81.841418),
    "17002 THREE OAKS MARKETPLACE DR, FORT MYERS FL 33912":(26.49452,   -81.8053),
    "3210 COTTONWOOD BND, 802, FORT MYERS FL 33905":       (26.698157,  -81.762937),
    "1100 EAST RAILROAD AVE, BOCA GRANDE FL 33921":        (26.757745,  -82.26298),
    "950 MOODY RD, 107, NORTH FORT MYERS FL 33903":        (26.658877,  -81.898783),
    "7830 DREW CIRCLE, UNIT # 1, FORT MYERS FL 33967":     (26.488515,  -81.824264),
    "4451 ORANGE GROVE BLVD, NORTH FORT MYERS FL 33903":   (26.64309,   -81.915908),
    "5686 YOUNGQUIST RD, 111, FORT MYERS FL 33912":        (26.510565,  -81.85978),
    "14910 REFLECTION KEY CIR, 2321, FORT MYERS FL 33907": (26.525869,  -81.883943),
    "6300 SOUTH POINTE BLVD, 429, FORT MYERS FL 33919":    (26.550675,  -81.904785),
    "3255 SUGARLOAF KEY RD, 32B, PUNTA GORDA FL 33955":    (26.765124,  -82.057794),
    "12515 MCGREGOR BLVD, 114, FORT MYERS FL 33919":       (26.560709,  -81.90737),
    "19681 SUMMERLIN RD, FORT MYERS FL 33908":             (26.492077,  -81.961846),
    "21176 VERAWOOD LOOP, ESTERO FL 33928":                (26.444265,  -81.632695),
    "21195 VERAWOOD LOOP, ESTERO FL 33928":                (26.44533,   -81.632658),
    "326 LAKESIDE HIDEAWAY LN, LEHIGH ACRES FL 33936":     (26.584237,  -81.617303),
    "3344 MELOY DR, FORT MYERS FL 33905":                  (26.692595,  -81.724555),
    "3329 HAMMETT WAY, FORT MYERS FL 33905":               (26.69316,   -81.726427),
    "3340 MELOY DR, FORT MYERS FL 33905":                  (26.692718,  -81.72455),
    "350 RADIANT SUN LN, LEHIGH ACRES FL 33936":           (26.58196,   -81.626442),
    "22211 BRONZE LANTERN WAY, ESTERO FL 33928":           (26.44785,   -81.5887),
    "22199 BRONZE LANTERN WAY, ESTERO FL 33928":           (26.44754,   -81.58896),
    "2203 ANITA AVE S, LEHIGH ACRES FL 33976":             (26.593233,  -81.662775),
    "16011 SAINT JOHNS CT, NORTH FORT MYERS FL 33917":     (26.70815,   -81.85347),
}


def _load_db_url() -> str:
    secrets_path = Path(__file__).resolve().parents[1] / ".dlt" / "secrets.toml"
    with open(secrets_path, "rb") as f:
        secrets = tomllib.load(f)
    pg = secrets["destination"]["postgres"]["credentials"]
    return (
        f"postgresql://{pg.get('username','postgres')}:{pg['password']}"
        f"@{pg['host']}:{pg.get('port',5432)}/{pg.get('database','postgres')}"
    )


def main() -> int:
    try:
        import psycopg
    except ImportError:
        print("psycopg3 not installed", file=sys.stderr)
        return 1

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from ingest.pipelines.lee_permits.geocoder import assign_corridor, load_lee_centroids

    db_url = _load_db_url()
    centroids = load_lee_centroids()

    with psycopg.connect(db_url) as conn:
        # ── Phase 1: write Mapbox coords for the 34 null rows ────────────────
        null_rows = conn.execute(
            "SELECT permit_id, address FROM data_lake.lee_building_permits WHERE lat IS NULL"
        ).fetchall()
        print(f"Phase 1: {len(null_rows)} rows with lat IS NULL")

        geo_updates: list[tuple] = []
        skipped = 0
        for permit_id, address in null_rows:
            coords = MAPBOX_GEO.get(address or "")
            if coords:
                lat, lon = coords
                corridor = assign_corridor(lat, lon, centroids)
                geo_updates.append((lat, lon, corridor, permit_id))
            else:
                skipped += 1

        print(f"  matched {len(geo_updates)} via Mapbox, skipped {skipped} (empty address)")
        with conn.cursor() as cur:
            cur.executemany(
                "UPDATE data_lake.lee_building_permits SET lat=%s, lon=%s, corridor=%s WHERE permit_id=%s",
                geo_updates,
            )
        conn.commit()
        print(f"  wrote {len(geo_updates)} rows")

        # ── Phase 2: corridor assignment for all geocoded rows missing it ────
        geocoded_rows = conn.execute(
            "SELECT permit_id, lat, lon FROM data_lake.lee_building_permits"
            " WHERE lat IS NOT NULL AND corridor IS NULL AND permit_id != '< Prev'"
        ).fetchall()
        print(f"\nPhase 2: {len(geocoded_rows)} geocoded rows still missing corridor")

        corr_updates: list[tuple] = []
        for permit_id, lat, lon in geocoded_rows:
            corridor = assign_corridor(lat, lon, centroids)
            corr_updates.append((corridor, permit_id))

        corridor_counts: dict = {}
        for corridor, _ in corr_updates:
            corridor_counts[corridor] = corridor_counts.get(corridor, 0) + 1
        print("  assignment preview:")
        for cid, n in sorted(corridor_counts.items(), key=lambda x: -(x[1])):
            print(f"    {cid or '(none)'}: {n}")

        with conn.cursor() as cur:
            cur.executemany(
                "UPDATE data_lake.lee_building_permits SET corridor=%s WHERE permit_id=%s",
                corr_updates,
            )
        conn.commit()
        print(f"  wrote {len(corr_updates)} corridor assignments")

        # ── Final tally ───────────────────────────────────────────────────────
        total, geo, corr = conn.execute(
            "SELECT count(*), count(lat), count(corridor)"
            " FROM data_lake.lee_building_permits WHERE permit_id != '< Prev'"
        ).fetchone()
        print(f"\nFinal: {total} total | {geo} geocoded | {corr} with corridor")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
