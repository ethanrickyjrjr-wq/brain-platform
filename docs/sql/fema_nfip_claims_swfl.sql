-- SWFL view over the Tier 2 NFIP claims table.
--
-- ⚠️  IMPORTANT: this view is an ANALYST CONVENIENCE — NOT the path the brain reads.
--     The env-swfl brain's NFIP source connector (refinery/sources/fema-nfip-source.mts)
--     queries data_lake.fema_nfip_claims DIRECTLY, not this view. Same convention as
--     fdot_aadt_swfl_yearly.sql. If you ever wire the brain to read this view instead,
--     any future SWFL county-scope change in the connector (e.g. broadening to include
--     Monroe, or storm-specific subsets) will silently miss data. Keep them separate
--     on purpose.
--
-- County scope (this view only): 6 SWFL counties matching env-swfl-source.mts —
-- Lee (12071), Collier (12021), Charlotte (12015), Glades (12043), Hendry (12051),
-- Sarasota (12115). The full Tier 2 mirror is statewide+; this view filters to FL
-- + the 6-county set so an analyst running `SELECT * FROM data_lake.fema_nfip_claims_swfl`
-- gets the SWFL slice without re-typing the FIPS list.
--
-- Storm-year framing: this view does NOT separate storm-year claims from baseline —
-- that's done in the connector's hardcoded SWFL_STORM_YEARS list. Storm vs. non-storm
-- is brain-side logic, not view-side filtering, because the storm-year list has a
-- LAST_REVIEWED date that needs to track named hurricanes hitting SWFL.

CREATE OR REPLACE VIEW data_lake.fema_nfip_claims_swfl AS
SELECT
    id,
    year_of_loss,
    date_of_loss,
    state,
    county_code,
    reported_city,
    reported_zipcode,
    flood_zone,
    occupancy_type,
    number_of_floors_insured,
    amount_paid_on_building_claim,
    amount_paid_on_contents_claim,
    amount_paid_on_ico_claim,
    building_property_value,
    building_damage_amount
FROM data_lake.fema_nfip_claims
WHERE state = 'FL'
  AND county_code IN ('12071', '12021', '12015', '12043', '12051', '12115');

GRANT SELECT ON data_lake.fema_nfip_claims_swfl TO service_role;
