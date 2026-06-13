"""Idempotent migration: add data_lake.fema_nfip_claims.flood_zone_current and
refresh the SWFL convenience view to expose it. Safe to re-run.

Creds: DESTINATION__POSTGRES__CREDENTIALS env, else .dlt/secrets.toml (same
resolution as ingest/pipelines/fema/resources.py:_current_tier2_count).
"""
from __future__ import annotations

import os
import re

import psycopg

DDL = """
ALTER TABLE data_lake.fema_nfip_claims
    ADD COLUMN IF NOT EXISTS flood_zone_current text;

-- DROP+CREATE (not OR REPLACE): inserting a column mid-list is a column rename to
-- Postgres. The view has no dependents (analyst convenience). Re-grant after.
DROP VIEW IF EXISTS data_lake.fema_nfip_claims_swfl;
CREATE VIEW data_lake.fema_nfip_claims_swfl AS
SELECT
    id, year_of_loss, date_of_loss, state, county_code, reported_city,
    reported_zipcode, flood_zone, flood_zone_current, occupancy_type,
    number_of_floors_insured, amount_paid_on_building_claim,
    amount_paid_on_contents_claim, amount_paid_on_ico_claim,
    building_property_value, building_damage_amount
FROM data_lake.fema_nfip_claims
WHERE state = 'FL'
  AND county_code IN ('12071', '12021', '12015', '12043', '12051', '12115');

GRANT SELECT ON data_lake.fema_nfip_claims_swfl TO service_role;
"""


def _uri() -> str:
    uri = os.environ.get("DESTINATION__POSTGRES__CREDENTIALS")
    if uri:
        return uri
    secrets = os.path.join(os.path.dirname(__file__), "..", "..", ".dlt", "secrets.toml")
    txt = open(secrets, encoding="utf-8").read()

    def _v(k: str) -> str | None:
        m = re.search(r"^\s*" + k + r'\s*=\s*"?([^"\r\n]+?)"?\s*$', txt, re.M)
        return m.group(1) if m else None

    return f"postgresql://{_v('username')}:{_v('password')}@{_v('host')}:{_v('port')}/{_v('database')}"


def main() -> None:
    with psycopg.connect(_uri(), connect_timeout=30) as conn:
        with conn.cursor() as cur:
            cur.execute(DDL)
            cur.execute("NOTIFY pgrst, 'reload schema';")
        conn.commit()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema='data_lake' AND table_name='fema_nfip_claims' "
                "AND column_name IN ('flood_zone','flood_zone_current') ORDER BY column_name;"
            )
            cols = [r[0] for r in cur.fetchall()]
    print(f"columns present: {cols}")
    assert "flood_zone_current" in cols, "flood_zone_current column missing after migration"
    print("migration OK")


if __name__ == "__main__":
    main()
