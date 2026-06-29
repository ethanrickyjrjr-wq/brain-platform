# Prod Smoke Runner — Design Spec

**Date:** 2026-06-29  
**Status:** approved  
**Check opened:** `smoke_prod_runner_live_verify` (opened via `new-build.mjs` after spec approval)

---

## Problem

23 open `live_verify` checks exist because every feature build opens one and closes it manually — only after someone remembers to hit prod. The backlog compounds: features ship, checks pile up, prod state drifts from the check ledger.

## Goal

A `scripts/smoke-prod.mts` runner that:
1. Hits key prod endpoints after every push to `main`
2. Stamps passing checks with `--detail "smoke passed YYYY-MM-DD"` (no auto-close — operator closes after review)
3. Exits non-zero on any failure → red commit status in GitHub
4. Makes adding a new assertion as simple as adding one object to an array

---

## Script Shape (`scripts/smoke-prod.mts`)

### SmokeTest type

```ts
type SmokeTest = {
  checkKey: string;        // matches the checks ledger key
  label: string;           // human-readable, printed in output
  run: (base: string) => Promise<void>;  // throws on failure, silent on pass
};
```

### Runner behavior

- Parses `--base <url>` (default `https://www.swfldatagulf.com`) and `--keys <k1,k2>` (run subset)
- Runs all `SMOKE_TESTS` in parallel via `Promise.allSettled`
- For each **pass**: calls `node scripts/check.mjs update <key> --detail "smoke passed YYYY-MM-DD"`
- For each **fail**: prints `FAIL [key] — <error message>` + the manual close command
- Prints `MANUAL_ONLY` entries as `SKIP (manual) [key]`
- Exits 0 only if every registered (non-manual) test passes

### Flags

- `--base <url>` — target base URL (default prod)
- `--keys <k1,k2,...>` — run only these check keys (for targeted reruns)
- `--dry-run` — run assertions but skip the `check.mjs update` stamps

---

## Assertion Catalog

### Automated (9 checks at launch)

| Check key | Assertion |
|---|---|
| `one_assistant_unify_live_verify` | POST `/api/assistant` `{"messages":[{"role":"user","content":"What is the SWFL home price trend?"}]}` → 200, response body starts streaming (non-empty) |
| `welcome_converse_mcp_zip_live_verify` | GET `/api/b/housing-swfl?zip=33931&view=speak&tier=1` → 200, JSON contains `"Fort Myers Beach"` (not `"Lehigh Acres"`) |
| `zip_quick_summary_live_verify` | GET `/r/zip-report/33908` → 200, HTML body contains `"census.gov"` |
| `briefcase_examples_live_verify` | GET `/p/example-email`, `/p/example-market-overview` → 200 each |
| `homepage_listing_showcase_live_verify` | GET `/` → 200, HTML contains `<body` |
| `charts_tier_panel_live_verify` | GET `/charts` → 200 |
| `storm_ian_live_verify` | GET `/api/b/storm-history-swfl?view=speak&tier=1` → 200, JSON contains `"freshness_token"` |
| `rsw_v3_live_verify` | GET `/api/b/rsw-airport?view=speak&tier=1` → 200, JSON contains `"freshness_token"` |
| `siteflow_b1_shell_verify` | GET `/` → 200 (covered by homepage check; assertion is page-level shell render) |

`siteflow_b1_shell_verify` shares the homepage assertion — both stamp on the same GET `/` pass.

### Manual-only (logged as SKIP)

These cannot be HTTP-asserted without auth state or browser rendering:

- `global_nav_signed_in_live_verify` — requires real session cookie
- `branding_save_live_verify` — requires authenticated PATCH + read-back
- `piece2_live_verify` — requires project context + auth
- `root1_unify_live_verify` — requires auth + pill interaction
- `piece1_branding_all_paths_verify`, `piece1_email_scope_build_verify`, `piece1_workspace_shell_verify` — auth-gated
- `carry_back_bridge_live_verify` — requires anon→claim flow
- `mcp_project_tools_live_verify` — requires `X-Project-Key` header (per-project MCP key)
- `email_scheduler_f_live_verify`, `email_lab_tracking_live_verify` — require real email send
- `ingest_database_url_repoint_live_verify`, `solo25_dq_probe_live_verify`, `incremental_ingest_live_verify` — ingest-layer, not HTTP-probeable
- `prochart_rendering_live_verify`, `email_lab_block_editing_live_verify` — browser/visual

---

## GHA Workflow (`.github/workflows/smoke-prod.yml`)

```
Triggers: push to main, workflow_dispatch

Jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      1. checkout
      2. bun setup
      3. wait-for-vercel (inline script, max 10 min)
      4. bun install --frozen-lockfile
      5. bun scripts/smoke-prod.mts --base https://www.swfldatagulf.com
```

### Wait-for-Vercel step

Inline bash script polls `https://api.vercel.com/v6/deployments?projectId=prj_RpRXhBmez73yyb7ODrUCx3xkwSCy&limit=10&target=production` every 15 seconds. Exits when it finds a deployment where `meta.githubCommitSha` matches `$GITHUB_SHA` and `state === "READY"`. Times out (exit 1) after 10 minutes.

### Required secrets (one new)

- `SUPABASE_URL` — already in GHA ✓
- `SUPABASE_SERVICE_KEY` — already in GHA ✓
- `VERCEL_TOKEN` — **new**: create at vercel.com/account/tokens, add as GHA secret

No `ANTHROPIC_API_KEY` needed — all assertions are pure HTTP, no LLM calls.

---

## Convention: Adding New Assertions

When opening a new `*_live_verify` check:

1. If HTTP-assertable: add a `SmokeTest` entry to `SMOKE_TESTS` array in the script
2. If auth/browser required: add the key to `MANUAL_ONLY` array in the script

The script's `MANUAL_ONLY` list is the authoritative record of which checks are intentionally deferred from automation. It prints in the run output so nothing disappears silently.

---

## Out of Scope

- Auto-closing checks (operator closes after reviewing the stamp)
- Browser automation / Playwright (future phase if needed)
- LLM-scored assertions (existing `prove-*.mts` scripts handle those)
- Notification (Slack, PR comment) — red commit status is the signal
