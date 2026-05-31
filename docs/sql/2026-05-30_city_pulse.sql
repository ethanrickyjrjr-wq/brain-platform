-- data_lake.city_pulse — distilled daily city-grain current-events facts.
-- One row per distilled fact; TTL + dedup operate at fact grain (the flywheel).
-- Written by ingest/pipelines/city_pulse/distill.py (psycopg, non-dlt).
-- Read by refinery/sources/city-pulse-source.mts via getSupabase().schema("data_lake").
CREATE TABLE IF NOT EXISTS data_lake.city_pulse (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  city          TEXT        NOT NULL,   -- one of the 7 pipeline CITIES
  topic         TEXT        NOT NULL,   -- volatility class: breaking|transactions|development|business|structural
  fact          TEXT        NOT NULL,   -- distilled claim, numbers verbatim
  source_url    TEXT        NOT NULL,   -- backs the metric source receipt
  source_title  TEXT,
  cited_text    TEXT,                   -- <=150-char span from the web_search citation
  captured_at   TIMESTAMPTZ NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,   -- captured_at + TTL(topic) — drives the flywheel
  dedup_key     TEXT        NOT NULL,   -- sha256(city|topic|normalized-fact)
  superseded_by BIGINT      REFERENCES data_lake.city_pulse(id),  -- reserved (v2)
  run_at        TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS city_pulse_dedup_uidx ON data_lake.city_pulse (dedup_key);
CREATE INDEX        IF NOT EXISTS city_pulse_live_idx   ON data_lake.city_pulse (city, topic, expires_at);
GRANT SELECT ON data_lake.city_pulse TO service_role;  -- brain-platform read key (read-only)
