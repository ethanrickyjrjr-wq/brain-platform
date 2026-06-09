-- Local CRE context table — government/EDC narrative context for Estero + FMB.
-- Sources: Village of Estero EDC, Town of FMB planning, Lee County recovery reports.
-- Consumer: refinery/sources/local-cre-context-source.mts → cre-swfl caveats[].

CREATE TABLE IF NOT EXISTS data_lake.local_cre_context (
  id           TEXT PRIMARY KEY,
  source_name  TEXT NOT NULL,
  city         TEXT NOT NULL,
  report_date  DATE,
  topic        TEXT,
  headline     TEXT,
  detail       TEXT,
  source_url   TEXT,
  _ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON data_lake.local_cre_context TO service_role;
NOTIFY pgrst, 'reload schema';
