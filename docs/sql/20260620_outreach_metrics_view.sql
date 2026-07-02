-- Outreach Increment 2 — the "what is working" rollup. Per-campaign funnel counts +
-- open/click rates over delivered. Read by the standalone swfldatagulf-ops board later
-- (not this repo). anon/authenticated revoked to match the repo's no-anon-on-views posture.
-- Idempotent (create or replace).

create or replace view public.outreach_campaign_metrics as
select
  campaign_id,
  count(*) filter (where event = 'sent')         as sent,
  count(*) filter (where event = 'delivered')    as delivered,
  count(*) filter (where event = 'opened')       as opened,
  count(*) filter (where event = 'clicked')      as clicked,
  count(*) filter (where event = 'unsubscribed') as unsubscribed,
  count(*) filter (where event = 'bounced')      as bounced,
  round(
    100.0 * count(*) filter (where event = 'opened')
      / nullif(count(*) filter (where event = 'delivered'), 0), 1
  ) as open_rate_pct,
  round(
    100.0 * count(*) filter (where event = 'clicked')
      / nullif(count(*) filter (where event = 'delivered'), 0), 1
  ) as click_rate_pct,
  -- Appended last: `create or replace view` only allows NEW columns at the end.
  count(*) filter (where event = 'complained')   as complaints
from public.outreach_events
group by campaign_id;

revoke all on public.outreach_campaign_metrics from anon, authenticated;
