# /ops — SWFL Data Gulf live operations ledger

A private dashboard, **its own Vercel project** (separate from swfldatagulf.com).
Status is **derived from real signals, never hand-typed** — so it can't drift the
way prose docs do. The one exception is `_AUDIT_AND_ROADMAP/build-queue.md` (the
operator-editable priority/in-progress input).

## What it shows

- **Brains** — freshness token + refined_at per brain (from `brains/*.md`).
- **Pipelines & Cron** — `cadence_registry.yaml` × Supabase `_dlt_loads` freshness.
- **GitHub Actions** — last run + result per workflow.
- **Services & Health** — MCP endpoint, main site, Supabase, GitHub signal.
- **Build queue** — `/queue`, rendered from `build-queue.md`.

Every section shows the read: **last 2 GREENS · next 3–6 REDS · any YELLOWS.**

## Architecture

- One data builder `lib/ledger.ts` → `buildLedger()`. Pages call it directly;
  the underlying GitHub/Supabase `fetch`es use Next's cache (`revalidate: 300`),
  so it's effectively one fetch cycle per 5-minute revalidation.
- `/api/ledger` exposes the same payload as JSON.
- `middleware.ts` gates everything behind `OPS_BASIC_AUTH` (`user:pass`).

## Local dev

```bash
cd ops
npm install
cp .env.example .env.local   # fill in GITHUB_PAT, SUPABASE_*, OPS_BASIC_AUTH
npm run dev                  # http://localhost:3000
```

Without secrets it still builds and runs — rows show "signal unavailable" and a
degraded banner appears.

## Deploy (operator step — needs interactive Vercel login)

1. `vercel` → new project, **Root Directory = `ops`**.
2. Set env vars (see `.env.example`): `GITHUB_PAT`, `GITHUB_REPO`, `GITHUB_BRANCH`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `OPS_BASIC_AUTH`, `MCP_URL`, `MAIN_SITE_URL`.
3. Deploy. ISR refreshes every 5 minutes.

Isolation: the root `tsconfig.json` and `eslint.config.mjs` exclude `ops/`, so this
project never affects the main app's build or CI.
