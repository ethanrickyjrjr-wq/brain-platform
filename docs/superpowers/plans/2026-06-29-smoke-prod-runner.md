# Prod Smoke Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Recommended model:** ⚡ Sonnet — keywords: architecture

**Goal:** Build `scripts/smoke-prod.mts` + `.github/workflows/smoke-prod.yml` so that after every push to `main`, Vercel's deployment is polled until READY then 9 HTTP assertions run against prod, passing checks get stamped, failures turn the workflow red.

**Architecture:** A single TypeScript script defines `SmokeTest` objects (one per check key), runs them in parallel via `Promise.allSettled`, stamps each passing check with `node scripts/check.mjs update <key> --detail "smoke passed MM/DD/YYYY"`, and exits non-zero on failure. The GHA workflow fires on `push: main`, polls the Vercel API until the matching deployment reaches `READY`, then runs the script.

**Tech Stack:** Bun (runtime), `fetch` (built-in), `node:child_process` execSync (for check stamping), GitHub Actions, Vercel deployments API.

## Global Constraints

- Bun version `1.3.14` (match `ci.yml` and `daily-rebuild.yml`)
- `uses: actions/checkout@v6` (match existing workflows)
- `uses: oven-sh/setup-bun@v2`
- Script must work with `bun scripts/smoke-prod.mts` from project root
- `check.mjs update` stamp is non-fatal — a missing/closed check must not block the run
- Exit 0 only when ALL registered (non-manual) tests pass
- `VERCEL_TOKEN` is a new GHA secret (operator must add it — see Task 2 prerequisite)
- Vercel project ID: `prj_RpRXhBmez73yyb7ODrUCx3xkwSCy` — team ID: `team_TePIKAawK3I5cX7Sw6TeLcLY`

---

### Task 1: Core smoke script (`scripts/smoke-prod.mts`)

**Files:**
- Create: `scripts/smoke-prod.mts`

**Interfaces:**
- Produces: CLI exit code 0 (all pass) or 1 (any fail); stamps `public.checks` via `node scripts/check.mjs update`
- No imports from other project files — pure `fetch` + `execSync`

- [ ] **Step 1: Create the script with types, arg parsing, and helpers**

Create `scripts/smoke-prod.mts`:

```typescript
#!/usr/bin/env bun
/**
 * scripts/smoke-prod.mts — post-deploy HTTP smoke runner
 *
 * Runs HTTP assertions against prod, stamps passing checks via check.mjs update,
 * exits 1 on any failure so the GHA workflow goes red.
 *
 * Usage:
 *   bun scripts/smoke-prod.mts [--base <url>] [--keys <k1,k2>] [--dry-run]
 */
import { execSync } from "node:child_process";
import { resolve } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────────

type SmokeTest = {
  checkKey: string;
  label: string;
  run: (base: string) => Promise<void>;
};

type SmokeResult =
  | { test: SmokeTest; passed: true }
  | { test: SmokeTest; passed: false; error: string };

// ── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(): { base: string; keys: string[] | null; dryRun: boolean } {
  const args = process.argv.slice(2);
  let base = "https://www.swfldatagulf.com";
  let keys: string[] | null = null;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base" && args[i + 1]) base = args[++i];
    else if (args[i] === "--keys" && args[i + 1]) keys = args[++i].split(",");
    else if (args[i] === "--dry-run") dryRun = true;
  }
  return { base, keys, dryRun };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function assertOk(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res;
}

async function assertBodyContains(res: Response, needle: string): Promise<void> {
  const text = await res.text();
  if (!text.includes(needle))
    throw new Error(`Expected body to contain "${needle}" — got: ${text.slice(0, 300)}`);
}

function today(): string {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

const CHECK_MJS = resolve(import.meta.dirname, "../scripts/check.mjs");

function stampCheck(checkKey: string, dryRun: boolean): void {
  if (dryRun) {
    console.log(`        [dry-run] would stamp: ${checkKey}`);
    return;
  }
  try {
    execSync(
      `node ${CHECK_MJS} update ${checkKey} --detail "smoke passed ${today()}"`,
      { stdio: "pipe" }
    );
  } catch {
    // Non-fatal: check may already be closed or key may not exist
    console.warn(`        [warn] could not stamp ${checkKey} — check may already be closed`);
  }
}
```

- [ ] **Step 2: Add the assertion catalog (SMOKE_TESTS + MANUAL_ONLY)**

Append to `scripts/smoke-prod.mts`:

```typescript
// ── Assertion catalog ────────────────────────────────────────────────────────

const SMOKE_TESTS: SmokeTest[] = [
  {
    checkKey: "one_assistant_unify_live_verify",
    label: "POST /api/assistant → 200 + streaming body starts",
    async run(base) {
      const res = await assertOk(`${base}/api/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: "outside",
          messages: [{ role: "user", content: "What is the SWFL home price trend?" }],
        }),
      });
      // Read first chunk only — streaming; don't wait for full LLM response
      const reader = res.body?.getReader();
      if (!reader) throw new Error("Response has no body stream");
      const { value, done } = await reader.read();
      reader.cancel();
      if (done || !value || value.length === 0)
        throw new Error("Streaming body is empty on first read");
    },
  },
  {
    checkKey: "welcome_converse_mcp_zip_live_verify",
    label: "GET /api/b/master?zip=33931 → contains 'Fort Myers Beach' not 'Lehigh Acres'",
    async run(base) {
      const res = await assertOk(`${base}/api/b/master?zip=33931&view=speak&tier=1`);
      const text = await res.text();
      if (!text.includes("Fort Myers Beach"))
        throw new Error(
          `Place name missing 'Fort Myers Beach' for ZIP 33931 — got: ${text.slice(0, 300)}`
        );
      if (text.includes("Lehigh Acres"))
        throw new Error("Response incorrectly names 'Lehigh Acres' for ZIP 33931");
    },
  },
  {
    checkKey: "zip_quick_summary_live_verify",
    label: "GET /r/zip-report/33908 → 200 + page contains census.gov",
    async run(base) {
      const res = await assertOk(`${base}/r/zip-report/33908`);
      await assertBodyContains(res, "census.gov");
    },
  },
  {
    checkKey: "briefcase_examples_live_verify",
    label: "GET /p/example-email + /p/example-market-overview → 200 each",
    async run(base) {
      await Promise.all([
        assertOk(`${base}/p/example-email`),
        assertOk(`${base}/p/example-market-overview`),
      ]);
    },
  },
  {
    checkKey: "homepage_listing_showcase_live_verify",
    label: "GET / → 200 + HTML contains <body",
    async run(base) {
      const res = await assertOk(base);
      await assertBodyContains(res, "<body");
    },
  },
  {
    checkKey: "siteflow_b1_shell_verify",
    label: "GET / → 200 (SiteShell render)",
    async run(base) {
      // Shares the homepage GET; just confirms 200
      await assertOk(base);
    },
  },
  {
    checkKey: "charts_tier_panel_live_verify",
    label: "GET /charts → 200",
    async run(base) {
      await assertOk(`${base}/charts`);
    },
  },
  {
    checkKey: "storm_ian_live_verify",
    label: "GET /api/b/storm-history-swfl?view=speak&tier=1 → 200 + freshness_token",
    async run(base) {
      const res = await assertOk(`${base}/api/b/storm-history-swfl?view=speak&tier=1`);
      await assertBodyContains(res, "freshness_token");
    },
  },
  {
    checkKey: "rsw_v3_live_verify",
    label: "GET /api/b/rsw-airport?view=speak&tier=1 → 200 + freshness_token",
    async run(base) {
      const res = await assertOk(`${base}/api/b/rsw-airport?view=speak&tier=1`);
      await assertBodyContains(res, "freshness_token");
    },
  },
];

const MANUAL_ONLY: Array<{ checkKey: string; reason: string }> = [
  { checkKey: "global_nav_signed_in_live_verify",         reason: "requires real session cookie" },
  { checkKey: "branding_save_live_verify",                reason: "requires authenticated PATCH + read-back" },
  { checkKey: "piece2_live_verify",                       reason: "requires project context + auth" },
  { checkKey: "root1_unify_live_verify",                  reason: "requires auth + pill interaction" },
  { checkKey: "piece1_branding_all_paths_verify",         reason: "auth-gated" },
  { checkKey: "piece1_email_scope_build_verify",          reason: "auth-gated" },
  { checkKey: "piece1_workspace_shell_verify",            reason: "auth-gated" },
  { checkKey: "carry_back_bridge_live_verify",            reason: "requires anon→claim flow" },
  { checkKey: "mcp_project_tools_live_verify",            reason: "requires X-Project-Key header" },
  { checkKey: "email_scheduler_f_live_verify",            reason: "requires real email send" },
  { checkKey: "email_lab_tracking_live_verify",           reason: "requires real email send" },
  { checkKey: "ingest_database_url_repoint_live_verify",  reason: "ingest-layer, not HTTP-probeable" },
  { checkKey: "solo25_dq_probe_live_verify",              reason: "ingest-layer, not HTTP-probeable" },
  { checkKey: "incremental_ingest_live_verify",           reason: "ingest-layer, not HTTP-probeable" },
  { checkKey: "prochart_rendering_live_verify",           reason: "browser/visual" },
  { checkKey: "email_lab_block_editing_live_verify",      reason: "browser/visual" },
];
```

- [ ] **Step 3: Add the runner (main function)**

Append to `scripts/smoke-prod.mts`:

```typescript
// ── Runner ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { base, keys, dryRun } = parseArgs();

  const tests = keys
    ? SMOKE_TESTS.filter((t) => keys.includes(t.checkKey))
    : SMOKE_TESTS;

  console.log(`\nsmoke-prod — target: ${base}${dryRun ? " [dry-run]" : ""}`);
  console.log(`Running ${tests.length} automated assertions...\n`);

  const settled = await Promise.allSettled(
    tests.map((t) =>
      t
        .run(base)
        .then((): SmokeResult => ({ test: t, passed: true }))
        .catch((e: Error): SmokeResult => ({ test: t, passed: false, error: e.message }))
    )
  );

  let failures = 0;

  for (const r of settled) {
    // allSettled never rejects — the inner .catch() guarantees fulfillment
    if (r.status !== "fulfilled") continue;
    const result = r.value;
    if (result.passed) {
      console.log(`  PASS  ${result.test.checkKey}`);
      console.log(`        ${result.test.label}`);
      stampCheck(result.test.checkKey, dryRun);
    } else {
      failures++;
      console.log(`  FAIL  ${result.test.checkKey}`);
      console.log(`        ${result.test.label}`);
      console.log(`        Error: ${result.error}`);
      console.log(
        `        To close manually: node scripts/check.mjs close ${result.test.checkKey} "verified manually"`
      );
    }
  }

  if (!keys) {
    console.log(`\nManual-only (${MANUAL_ONLY.length}) — skipped:`);
    for (const m of MANUAL_ONLY) {
      console.log(`  SKIP  ${m.checkKey} — ${m.reason}`);
    }
  }

  const total = tests.length;
  const passed = total - failures;
  console.log(`\n${passed}/${total} passed${failures > 0 ? `, ${failures} FAILED` : " ✓"}`);

  if (failures > 0) process.exit(1);
}

main();
```

- [ ] **Step 4: Dry-run locally against prod**

```
bun scripts/smoke-prod.mts --base https://www.swfldatagulf.com --dry-run
```

Expected output:
- Each test line shows `PASS` or `FAIL`
- Passing tests show `[dry-run] would stamp: <key>`
- No Supabase writes happen
- Script exits 0 if all pass

Fix any assertions that produce unexpected `FAIL` (wrong URL, wrong content needle, etc.) before proceeding.

- [ ] **Step 5: Run for real against prod (stamps checks)**

```
bun scripts/smoke-prod.mts --base https://www.swfldatagulf.com
```

Expected: same PASS/FAIL output, plus each passing check gets stamped. Confirm in Supabase or via:

```
node scripts/check.mjs list
```

Each passing check should show `detail: smoke passed MM/DD/YYYY`.

- [ ] **Step 6: Test targeted rerun with --keys**

```
bun scripts/smoke-prod.mts --base https://www.swfldatagulf.com --keys rsw_v3_live_verify,charts_tier_panel_live_verify --dry-run
```

Expected: only those 2 tests run, manual-only list is suppressed.

- [ ] **Step 7: Commit**

```
git add scripts/smoke-prod.mts
git commit -m "feat(smoke): prod smoke runner — 9 HTTP assertions + check stamping"
```

---

### Task 2: GHA workflow (`.github/workflows/smoke-prod.yml`)

**Files:**
- Create: `.github/workflows/smoke-prod.yml`

**Prerequisite (operator action before committing):**
Add `VERCEL_TOKEN` as a GitHub Actions secret:
1. Go to vercel.com/account/tokens → create a token (name: "GHA smoke runner")
2. Go to github.com/ethanrickyjrjr-wq/SWFL-Data-Gulf/settings/secrets/actions → add `VERCEL_TOKEN`

**Interfaces:**
- Consumes: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (existing secrets), `VERCEL_TOKEN` (new secret)
- Produces: green/red commit status on every push to `main`

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/smoke-prod.yml`:

```yaml
name: Smoke — Prod

on:
  push:
    branches: [main]
  workflow_dispatch:

# One smoke run at a time per branch — cancel in-progress if a new push lands
# before the previous deployment has finished going READY.
concurrency:
  group: smoke-prod-${{ github.ref }}
  cancel-in-progress: true

jobs:
  smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.14"

      - name: Wait for Vercel deployment
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          TARGET_SHA: ${{ github.sha }}
        run: |
          PROJECT_ID="prj_RpRXhBmez73yyb7ODrUCx3xkwSCy"
          TEAM_ID="team_TePIKAawK3I5cX7Sw6TeLcLY"
          MAX_ATTEMPTS=40
          ATTEMPT=0

          echo "Waiting for Vercel deployment of ${TARGET_SHA}..."

          while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
            RESPONSE=$(curl -sf \
              -H "Authorization: Bearer ${VERCEL_TOKEN}" \
              "https://api.vercel.com/v6/deployments?projectId=${PROJECT_ID}&teamId=${TEAM_ID}&limit=20&target=production" \
              || echo '{"deployments":[]}')

            STATE=$(echo "$RESPONSE" | python3 -c "
          import json, sys, os
          data = json.load(sys.stdin)
          sha = os.environ.get('TARGET_SHA', '')
          deps = data.get('deployments', [])
          match = next(
            (d for d in deps
             if d.get('meta', {}).get('githubCommitSha') == sha
             and d.get('state') == 'READY'),
            None
          )
          print('READY' if match else 'WAITING')
          ")

            if [ "$STATE" = "READY" ]; then
              echo "Deployment READY — proceeding to smoke tests"
              exit 0
            fi

            ATTEMPT=$((ATTEMPT + 1))
            echo "Attempt ${ATTEMPT}/${MAX_ATTEMPTS} — not ready yet, waiting 15s..."
            sleep 15
          done

          echo "Timeout: Vercel deployment not ready after 10 minutes"
          exit 1

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Run smoke tests
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
        run: bun scripts/smoke-prod.mts --base https://www.swfldatagulf.com
```

- [ ] **Step 2: Verify the workflow parses cleanly**

```
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/smoke-prod.yml'))" && echo "YAML OK"
```

Expected: `YAML OK`

- [ ] **Step 3: Commit and push to trigger the workflow**

```
git add .github/workflows/smoke-prod.yml
git commit -m "ci(smoke): GHA workflow — post-deploy Vercel poll + HTTP smoke battery"
node scripts/safe-push.mjs
```

Then open the GitHub Actions tab. Expected:
- `Smoke — Prod` workflow appears on the commit
- "Wait for Vercel deployment" step polls and eventually prints `Deployment READY`
- "Run smoke tests" step shows PASS lines for all 9 checks
- Workflow status: green ✓

- [ ] **Step 4: Update SESSION_LOG and close the design check**

Append to `SESSION_LOG.md` (top of file):

```
## 2026-06-29 (main) — Prod smoke runner shipped

scripts/smoke-prod.mts (9 HTTP assertions) + smoke-prod.yml GHA workflow.
Post-deploy: polls Vercel until READY, runs smoke battery, stamps passing checks.
VERCEL_TOKEN secret required (operator adds via vercel.com/account/tokens).
Next: close smoke_prod_runner_live_verify after first green GHA run.
```

---

## Convention Going Forward

When opening a new `*_live_verify` check, add one of these to `scripts/smoke-prod.mts`:

**If HTTP-assertable:** add a `SmokeTest` entry to `SMOKE_TESTS`
**If auth/browser required:** add `{ checkKey, reason }` to `MANUAL_ONLY`

The `MANUAL_ONLY` list is the authoritative record of intentionally-deferred checks. If a check key appears in neither array, it is invisible to the runner — do not leave checks unregistered.
