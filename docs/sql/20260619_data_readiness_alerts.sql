-- Data readiness alerts — records every verification ladder outcome before/during email blasts.
-- The /ops dashboard reads this table and surfaces amber/red cards when substitution occurred.
-- tier_used values: "brain_fresh" | "crawl_consensus" | "crawl_haiku" | "sonnet_only" | "last_known" | "omitted"

CREATE TABLE IF NOT EXISTS data_readiness_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  schedule_id     uuid,
  metric_slug     text NOT NULL,
  metric_label    text NOT NULL,
  scope_kind      text,
  scope_value     text,
  tier_used       text NOT NULL DEFAULT 'brain_fresh',
  value_used      text,
  source_urls     text[],
  snapshot_value  text,
  within_tolerance boolean,
  alert_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  send_at         timestamptz
);

CREATE INDEX IF NOT EXISTS data_readiness_alerts_project_id
  ON data_readiness_alerts(project_id, alert_at DESC);

CREATE INDEX IF NOT EXISTS data_readiness_alerts_open
  ON data_readiness_alerts(project_id, resolved_at)
  WHERE resolved_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON data_readiness_alerts TO service_role;
NOTIFY pgrst, 'reload schema';
