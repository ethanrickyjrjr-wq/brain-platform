# n8n setup — SWFL Firecrawl pipelines

> **Orchestration policy:** GitHub Actions is the default for all cron-driven ingest. n8n/Railway is reserved for workloads that need: (a) long-running browser sessions (Playwright, Accela login flows), (b) cron jobs that exceed GHA's 6-hour timeout, or (c) interactive auth that can't be scripted via secrets. Pipelines already on GHA: `news-daily`, `marketbeat-quarterly`, `corridor-narratives-quarterly`, `county-planning-monthly`, and the six dlt pipelines (`bls-laus`, `census-cbp`, `fdot-aadt`, `fema-nfip`, `fhfa-hpi`, `leepa-parcels`). See `docs/standards/pipeline-freshness.md §5` for the full delineation.

Operational runbook for Plan steps 9–14 (the human-driven half of the
[2026-05-25 firecrawl-pipeline-skeleton plan](../superpowers/plans/2026-05-25-firecrawl-pipeline-skeleton/README.md)).
The workflow JSONs in `workflows/` are draft starters — import order + credential
order matters. Follow this file top-to-bottom on first setup.

> **What's already done (PR #15, code-side):** `data_lake.marketbeat_swfl` table
>
> - `corridor_profiles.character_broker_narrative` column applied; cre-swfl
>   wired to read both; provenance allowlist updated. The n8n flows have
>   somewhere to land the moment they run.

---

## 1. Deploy n8n on Railway

1. Sign into Railway, **New Project → Deploy a Template → search "n8n"** (the
   official `n8n-io/n8n` template). Confirm template owner is n8n-io.
2. **Persistent volume must be enabled** — the template defaults to one mounted
   at `/home/node/.n8n`. Without it, every Railway dropout wipes credentials.
3. Set env vars (Railway "Variables" tab):
   - `N8N_BASIC_AUTH_ACTIVE=true`
   - `N8N_BASIC_AUTH_USER=<pick a username>`
   - `N8N_BASIC_AUTH_PASSWORD=<long random string>`
   - `WEBHOOK_URL=<the Railway public URL the deploy gives you>` (n8n needs to
     know its own external URL for cron and webhook nodes)
   - `GENERIC_TIMEZONE=America/New_York` (so cron expressions display in ET in
     the editor, even though they execute in UTC — see step 3 caveat)
4. Wait for deploy. Visit the Railway-provided URL, log in with basic-auth.
5. **Owner setup:** the first user becomes the n8n owner — pick the same
   credentials you used for basic-auth or a separate set, either works.

**Cost rough-cut:** $5/month base for the n8n container + ~$0.10/month for the
persistent volume. Below the $20 Railway free-tier threshold for the first
month if you have no other Railway services.

---

## 2. Credentials (create in this order)

In n8n: **Settings → Credentials → Add credential**. The order matters because
the workflow JSONs reference these by their _credential ID_; after creating
each one, copy the credential ID (visible in the URL after you open the
credential — `…/credentials/{id}/edit`) and substitute it for the matching
`REPLACE_WITH_*_CRED_ID` placeholder in the workflow JSONs **before** import.

| #   | Credential name (use this exact label) | Type                 | What to paste                                                                                                                                                                                                                                |
| --- | -------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `Firecrawl API`                        | **HTTP Header Auth** | Header `Authorization`, value `Bearer fc-…` (the same key in `ingest/.env`).                                                                                                                                                                 |
| 2   | `Supabase Postgres`                    | **Postgres**         | Connection details from `ingest/.dlt/secrets.toml` — host, port `5432`, db `postgres`, user `postgres`, the password.                                                                                                                        |
| 3   | `Supabase service-role JWT`            | **HTTP Header Auth** | Header `Authorization`, value `Bearer <service-role JWT>`. Copy from Supabase dashboard → Settings → API → `service_role`.                                                                                                                   |
| 4   | `GitHub PAT (workflow scope)`          | **HTTP Header Auth** | Header `Authorization`, value `Bearer ghp_…`. Generate at [github.com/settings/tokens](https://github.com/settings/tokens) — fine-grained PAT, repo `ethanrickyjrjr-wq/brain-platform`, permissions `Actions: read/write`, `Contents: read`. |

**Slack incoming webhook** is NOT a credential — it's a URL pasted directly
into the error workflow JSON.

### Slack webhook setup

In Slack admin: **Apps → Incoming Webhooks → Add to Slack → pick the alert
channel (e.g. `#brain-alerts`) → Allow → copy the webhook URL**. You'll paste
this directly into `_error-workflow.json` (the `POST Slack incoming webhook`
node) before import.

---

## 3. Cron format caveat

All four production workflow JSONs use **6-field cron** (`Second Minute Hour
DayOfMonth Month DayOfWeek`) which is what n8n's Schedule Trigger expects on
typeVersion ≥ 1.2. If you hit a "cron expression invalid" error on import,
n8n is running an older typeVersion that expects 5-field; drop the leading
`0 ` to fix:

```
6-field (n8n 1.2+):   0 0 13 1 1,4,7,10 *      # the workflow JSONs use this
5-field (older n8n):    0 13 1 1,4,7,10 *      # fallback if validation fails
```

All times are UTC even though the editor displays in ET (per
`GENERIC_TIMEZONE`). The JSON expressions correspond to the plan's
ET intent:

| Flow                          | Cron (6-field)        | UTC time  | ET time                        |
| ----------------------------- | --------------------- | --------- | ------------------------------ |
| MarketBeat quarterly          | `0 0 13 1 1,4,7,10 *` | 13:00 UTC | 9 AM ET, Jan/Apr/Jul/Oct day 1 |
| Corridor narratives quarterly | `0 0 13 2 1,4,7,10 *` | 13:00 UTC | 9 AM ET, Jan/Apr/Jul/Oct day 2 |
| News daily                    | `0 0 11 * * *`        | 11:00 UTC | 7 AM ET daily                  |
| County PDFs monthly           | `0 0 14 3 * *`        | 14:00 UTC | 10 AM ET, 3rd of each month    |

The corridor narratives flow runs one day after MarketBeat to avoid hammering
Firecrawl's quarterly burst budget.

---

## 4. Import each workflow

For **each** `workflows/*.json`:

1. n8n editor → **Workflows → Import from File**.
2. Before clicking "Import", do these find-and-replaces in the JSON:
   - `REPLACE_WITH_FIRECRAWL_CRED_ID` → your Firecrawl credential ID
   - `REPLACE_WITH_SUPABASE_PG_CRED_ID` → your Postgres credential ID
   - `REPLACE_WITH_SUPABASE_JWT_CRED_ID` → your service-role JWT credential ID
   - `REPLACE_WITH_GITHUB_PAT_CRED_ID` → your GitHub PAT credential ID
   - `YOUR_PROJECT_REF` (in `news-daily.json` + `county-pdfs-monthly.json`) →
     your Supabase project ref (the `abc123xyz` part of `abc123xyz.supabase.co`)
   - In `_error-workflow.json`, paste the Slack incoming webhook URL into
     the `POST Slack incoming webhook` node's URL field
3. After import: **open each node, verify the credential dropdown selected
   the right one** — sometimes IDs don't round-trip cleanly across n8n
   instances. If the dropdown is empty, pick the right credential manually.
4. **Save** the workflow. Leave inactive for now.

Import order is not load-bearing, but the convention I'd follow:

1. `_error-workflow.json` (so the production flows have something to throw to)
2. `marketbeat-quarterly.json`
3. `corridor-narratives-quarterly.json`
4. `news-daily.json`
5. `county-pdfs-monthly.json`

---

## 5. Wire the error workflow

After importing `_error-workflow.json`:

1. **Settings → Error Workflow → select "SWFL — Error workflow (Slack alert)"**
2. Save.

Without this wiring, `throw new Error(…)` inside the Code nodes will die
silently in n8n's execution log. Slack alerts go through the error workflow,
not via direct posts from the production flows.

**Verify it fires:** manually trigger the MarketBeat flow once with a
synthetically broken response (easiest: change the URL to a 404), confirm the
flow fails AND the Slack channel receives the alert.

---

## 6. Smoke-test each flow

Order: error workflow first (already done in step 5), then MarketBeat (the
most consequential — closes a real brain gap), then the other three.

### 6a. MarketBeat (Flow 2)

1. Open the workflow → **Test workflow** (manual trigger).
2. Expect Firecrawl to extract 3–10 submarkets across the three broker pages.
3. SQL check the row landed:
   ```sql
   SELECT submarket, quarter, vacancy_rate, asking_rent_nnn, absorption_sqft, verified
   FROM data_lake.marketbeat_swfl
   ORDER BY _ingested_at DESC LIMIT 20;
   ```
4. Eyeball the numbers against the broker reports. If they look right, flip the
   verified flag for that quarter:
   ```sql
   UPDATE data_lake.marketbeat_swfl SET verified = true WHERE quarter = '2026-Q3';
   ```
5. Confirm GitHub Actions dispatch fired: `gh run list --workflow=daily-rebuild.yml --limit 3`
6. Once the rebuild finishes, confirm `brains/cre-swfl.md` now has the new
   key_metrics:
   ```bash
   grep -E "vacancy_rate_marketbeat_swfl|asking_rent_nnn_marketbeat_swfl" brains/cre-swfl.md
   ```
7. If happy, toggle the workflow **Active**. Next firing: per the cron above.

### 6b. Corridor narratives (Flow 3)

1. Manual trigger.
2. Confirm rows landed in the JSONB column:
   ```sql
   SELECT corridor_name,
          character IS NOT NULL                  AS has_hand_authored,
          character_broker_narrative IS NOT NULL AS has_broker_narrative,
          character_broker_narrative->>'quarter' AS broker_quarter
   FROM corridor_profiles
   WHERE deleted_at IS NULL
   ORDER BY corridor_name;
   ```
3. **Critical diff check** — the hand-authored `character` column must NOT
   have been touched. Compare against the most recent backup, or eyeball a
   handful of corridors you know carry hand-authored text:
   ```sql
   SELECT corridor_name, character FROM corridor_profiles
   WHERE corridor_name IN ('Immokalee Rd North Naples', 'US-41 / Cleveland Ave Fort Myers');
   ```
4. Trigger a cre-swfl rebuild (the workflow does this automatically) and
   confirm `brains/cre-swfl.md` quotes the existing `character` text verbatim
   AND surfaces `Broker positioning (Qn YYYY): …` where broker narrative is
   present.
5. Check the audit step's output for unmatched corridors. Grow the alias table
   in the Code node accordingly, and **mirror those aliases into the corridor
   pipeline's master alias table** (per `[[corridor-pipeline-mcp-bundle]]`).
6. Toggle Active.

### 6c. News daily (Flow 4)

1. Manual trigger.
2. Confirm NDJSON landed in Supabase Storage:
   - Storage → `lake-tier1` bucket → `news/year=2026/month=05/day=…/`
   - Click the file, eyeball: should be one JSON-per-line, ~5–50 articles.
3. Confirm inventory row:
   ```sql
   SELECT id, path, byte_size, pack_id, updated_at
   FROM data_lake._tier1_inventory
   WHERE bucket = 'lake-tier1' AND path LIKE 'news/%'
   ORDER BY updated_at DESC LIMIT 5;
   ```
4. `pack_id` should be NULL (no consumer yet — that's the Tier 1 cold-storage
   gate, intentional).
5. Toggle Active.

### 6d. County PDFs monthly (Flow 5)

Same pattern as Flow 4. Storage path: `county-planning/year=…/month=…/`.

If the Lee/Collier landing URLs in the Code node return zero rows, both
counties have re-shuffled their planning sites before — update the URLs in
the Code node and re-run.

---

## 7. After all four are active

- **Update `MEMORY.md`** with a project note that the firecrawl pipeline is
  live, including the Railway project URL and any custom credential IDs you
  picked (so a future session can find them quickly).
- **Re-export workflow JSONs from n8n and commit** — the imported workflows
  will have populated `id` fields, `versionId`s, and your real credential IDs.
  These exports are the canonical reference; the drafts in this PR are
  starter templates. Replace the draft files with the production exports.

---

## Troubleshooting

| Symptom                                                               | Cause                                                                 | Fix                                                                                                 |
| --------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| "Cron expression invalid"                                             | n8n typeVersion < 1.2 expects 5-field                                 | Drop the leading `0 ` from the expression                                                           |
| "credential not found"                                                | Credential ID in JSON doesn't match a credential in this n8n instance | Open the node, pick the credential from the dropdown manually                                       |
| Firecrawl returns 401                                                 | Wrong Authorization header value or expired API key                   | Re-check the `Bearer fc-…` prefix; rotate the key in `ingest/.env` if needed                        |
| Postgres errors `relation "data_lake.marketbeat_swfl" does not exist` | SQL migration wasn't applied                                          | Re-run `docs/sql/20260525_marketbeat_swfl.sql` in Supabase SQL editor                               |
| `permission denied for table marketbeat_swfl`                         | `GRANT SELECT … TO service_role` didn't take                          | Re-run the GRANT statement from the migration                                                       |
| GitHub Actions dispatch returns 404                                   | PAT scope missing `Actions: read/write` OR wrong repo path            | Regenerate PAT with the right scope; verify the URL hardcoded in the HTTP node matches `OWNER/REPO` |
| Slack alerts never fire                                               | Error workflow not wired in Settings → Error Workflow                 | Wire it; trigger an intentional failure to verify                                                   |
| Storage PUT returns `Object exists`                                   | `x-upsert: true` header not sent                                      | Confirm the HTTP node has the header parameter set                                                  |
| Brain rebuild doesn't reflect new MarketBeat rows                     | Rows still `verified = false`                                         | The cre-swfl source filters `verified = true`; flip the flag after eyeballing                       |
| Brain rebuild fired but no new key_metrics in cre-swfl.md             | dispatch fired before `verified = true` was flipped                   | Re-dispatch: `gh workflow run daily-rebuild.yml -f pack_id=cre-swfl -f force=true`                  |
