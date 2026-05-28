# /ops Build Spec — derived from the inventory sweep (2026-05-28)

> Output of Section 2 Step 1 (inventory sweep). The build (Steps 2–5) follows this.
> Companion to `build-tracker.md`. Delete both when Section 2 ships.

## Repo-layout decision (made — flag if you disagree)

`/ops` lives as a **top-level `ops/` directory in this repo, deployed as its own Vercel project** (Vercel "Root Directory" = `ops`). Rationale: stays on the GitHub bus (one repo = the cross-session memory the whole system relies on) while deploying independently from swfldatagulf.com. A separate repo would fragment the bus. The main app's CI/build must NOT pick up `ops/` (own package.json, own node_modules; exclude from root tsconfig/CI).

## Operator-dependent steps (cannot be done headless — need you)

- Create the Vercel project, set **Root Directory = `ops`**.
- Set env vars in that Vercel project: `GITHUB_PAT` (repo read + actions:read), `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `OPS_BASIC_AUTH` (single `user:pass` gate).
- First deploy / domain. (Interactive `vercel login` → run via `! vercel ...` in the prompt.)

## Signals (everything is derived from these — never hand-typed)

| Signal          | Source                                                             | Gives                                                        |
| --------------- | ------------------------------------------------------------------ | ------------------------------------------------------------ |
| GHA runs        | `gh api repos/ethanrickyjrjr-wq/brain-platform/actions/runs` (PAT) | last run + success/failure per workflow (28 workflows)       |
| Pipelines       | `ingest/cadence_registry.yaml` (raw via GitHub API)                | 22 active + 2 not_yet_running; lane, cadence_days, tolerance |
| Brain freshness | `brains/*.md` frontmatter (raw)                                    | freshness token, refined_at, ttl → fresh/stale/missing       |
| Pack registry   | `refinery/packs/index.mts` (raw)                                   | which brains exist + DAG edges                               |
| Incidents       | `docs/cron-rebuild-failures.md` (raw)                              | open/resolved incident rows                                  |
| Activity        | `SESSION_LOG.md` (raw)                                             | last 10 entries                                              |
| DB loads        | Supabase `data_lake._dlt_loads` MAX(inserted_at) per schema        | tier-2 pipeline last-load freshness                          |
| MCP health      | ping `https://www.swfldatagulf.com/api/mcp`                        | green/red                                                    |
| Notion          | last `notion-sync-weekly` run (GHA)                                | last sync + link                                             |

## Categories (each = its own page/section; derived, not pre-decided)

1. **Brains** — 17 packs: cre-swfl, env-swfl, franchise-outcomes, housing-swfl, logistics-swfl, logistics-swfl-nowcast, macro-florida, macro-swfl, macro-us, master, permits-swfl, properties-lee-value, rentals-swfl, sector-credit-swfl, storm-history-swfl, tourism-tdt, traffic-swfl (+ hurricane-tracks-fl pack). Status = brain freshness.
2. **Pipelines / Cron** — 28 GHA workflows ↔ cadence_registry entries. Status = last GHA run + age vs cadence×tolerance.
3. **Data Sources** — upstream feeds (Census ACS/CBP/BPS, BLS LAUS/QCEW/PPI, FRED G17, FEMA NFIP, FDOT AADT, LeePA, Redfin, Zillow ZORI, FL DOR TDT + Sales Tax, USGS, HURDAT2, FHFA, FAF5, news). Columns per the design reference: Source · What We Get · Method · Auth · Pipeline/EF · Cadence · Status · Notes.
4. **Services / Health** — Supabase, MCP `/api/mcp`, Vercel main site, Notion sync, /ops itself.
5. **Logs / Incidents** — SESSION_LOG tail + cron-rebuild-failures + project-state-sync drift.
6. **Build Queue** — the one human input (`_AUDIT_AND_ROADMAP/build-queue.md`).

## Status model

- **GREEN** = done / fresh / last run succeeded (derived boolean).
- **RED** = not done / missing / failing / never-run (derived boolean).
- **YELLOW** = currently being built (from `build-queue.md`, the one human input).
- Reds are _ordered_ by `build-queue.md` priority (ordering is the human call; existence/done-ness is derived).

## The read (top of every section + overall)

> **last 2 GREENS** (just-completed) · **next 3–6 REDS** (up next) · **any YELLOWS** (currently being built)

## Routes (the ops Next.js app)

- `/` — overall read + category summary cards.
- `/c/[category]` — one categorized table per category (8-col, GREEN/YELLOW/RED pills, method/auth chips), with the read at top + row click-through detail.
- `/queue` — renders `build-queue.md` (the "what needs built next" view; editable by operator).
- `/api/ledger` — ONE fetch cycle per ISR revalidation (all GitHub API + Supabase reads, cached); pages render this cached payload, never fetch independently. ISR revalidate 300s.
- `middleware.ts` — single-env-var basic-auth gate (`OPS_BASIC_AUTH`).

## Brand

`#080E11` bg, teal accents, IBM Plex, wave favicon. Design language from `ops/design-reference/premise-data-sources.html` (copied in), made realtime.
