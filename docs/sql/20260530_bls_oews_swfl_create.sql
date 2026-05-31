-- BLS OEWS SWFL MSA table — Cape Coral-Fort Myers (15980) + Naples (34940)
-- Major occupation groups, annual (May survey).
-- Run once in Supabase SQL editor before first bls_oews_swfl pipeline execution.

CREATE TABLE IF NOT EXISTS data_lake.bls_oews_swfl (
    id              TEXT PRIMARY KEY,                   -- "{area_code}|{occ_code}|{ref_year}"
    area_code       TEXT NOT NULL,                      -- '15980' | '34940'
    area_name       TEXT NOT NULL,                      -- short MSA display name
    prim_state      TEXT,                               -- 'FL'
    occ_code        TEXT NOT NULL,                      -- SOC code e.g. '47-0000'
    occ_title       TEXT NOT NULL,                      -- 'Construction and Extraction Occupations'
    o_group         TEXT NOT NULL,                      -- 'major' (only value loaded)
    tot_emp         BIGINT,                             -- total employment; NULL if BLS-suppressed
    jobs_1000       DOUBLE PRECISION,                   -- jobs per 1,000 in reference area
    loc_quotient    DOUBLE PRECISION,                   -- concentration vs national (1.0 = parity)
    h_median        DOUBLE PRECISION,                   -- hourly median wage; NULL if suppressed
    a_median        BIGINT,                             -- annual median wage; NULL if suppressed
    ref_year        INTEGER NOT NULL,                   -- BLS OEWS survey year (May)
    source_url      TEXT,
    _ingested_at    TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS bls_oews_swfl_area_occ_year
    ON data_lake.bls_oews_swfl (area_code, occ_code, ref_year);

GRANT SELECT ON data_lake.bls_oews_swfl TO service_role;
