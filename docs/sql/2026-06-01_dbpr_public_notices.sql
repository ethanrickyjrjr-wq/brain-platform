-- public.dbpr_public_notices — DBPR enforcement notices for SWFL counties.
-- Written by ingest/pipelines/dbpr_public_notices/pipeline.py (psycopg3, non-dlt).
-- Source: https://www2.myfloridalicense.com/public-notices/ — weekly update.
-- SWFL scope: Lee, Collier, Charlotte, Sarasota, Manatee, Hendry, Monroe.
--
-- Amendment pattern: DBPR corrects notices by publishing a new PDF alongside the old one.
-- Both rows live in this table; the corrected version has a later response_deadline.
-- A consuming brain should ORDER BY response_deadline DESC per (county, case_number)
-- group to get the active version. A superseded_by column is deferred until needed.
--
-- last_seen_at: updated every scrape for URLs found on the index page.
-- A gap in last_seen_at relative to the current run means the notice expired or was removed.

CREATE TABLE IF NOT EXISTS public.dbpr_public_notices (
  id                  bigint generated always as identity primary key,
  pdf_url             text unique not null,
  respondent_name     text,
  county              text not null,
  case_number         text,           -- first case number from CASE NO.: in PDF body
  all_case_numbers    text[],         -- full set from CASE NO.: line (some PDFs bundle multiple)
  violation_type      text,           -- 'unlicensed_activity' | 'disciplinary' | free text if ambiguous
  industry            text,           -- derived from BEFORE THE [BOARD] line
  pdf_summary         text,           -- 2-3 sentence Claude summary
  response_deadline   date,           -- parsed from "by Month DD, YYYY" in PDF body
  last_seen_at        timestamptz,    -- updated on every run; gap = notice expired/removed
  scraped_at          timestamptz,    -- first ingestion timestamp
  created_at          timestamptz     default now()
);

CREATE INDEX IF NOT EXISTS dbpr_public_notices_county_idx      ON public.dbpr_public_notices (county);
CREATE INDEX IF NOT EXISTS dbpr_public_notices_case_number_idx ON public.dbpr_public_notices (case_number);
CREATE INDEX IF NOT EXISTS dbpr_public_notices_last_seen_idx   ON public.dbpr_public_notices (last_seen_at);
CREATE INDEX IF NOT EXISTS dbpr_public_notices_deadline_idx    ON public.dbpr_public_notices (response_deadline);
