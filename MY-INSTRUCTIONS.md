# MY-INSTRUCTIONS — Phase 1: Refinery v1 + Franchise pack

Phase 0 is done (the Brain URL delivery layer — see `docs/phase-0-test-results.md`).
This file is the Phase 1 handoff.

## What's built (offline, verified)

The **Refinery** — a local CLI at `refinery/` that refines structured data into a
spec-v1.1 Brain URL pack. The full four-stage pipeline, both agents, the renderer,
and the validators are built and pass Tier-1 verification (see
`docs/phase-1-test-results.md`). It runs end-to-end **offline** today:

```bash
REFINERY_SOURCE=fixture node refinery/cli.mts franchise-outcomes --dry-run
```

That uses synthetic fixture data + mock agents — proves the wiring, produces a
shape-valid pack, writes nothing. To get a **real** pack you need credentials.

## Your steps to the seaworthy gate

### 1. Add credentials to `.env.local`

```
SUPABASE_URL=https://tssgulkyczfefucmrtda.supabase.co
SUPABASE_READONLY_KEY=<a SELECT-only key if possible; anon key if RLS allows>
ANTHROPIC_API_KEY=<your key — Haiku + Sonnet access>
```

`.env.local` is gitignored. If you can't get a read-only Supabase key easily, the
`anon` key works if RLS permits reads on the materialized view; `service_role` is
a last resort (it's read-write — the Refinery never writes, but it crosses the
air-gap badly, so avoid it).

### 2. Confirm the view schema (Risk #1 — important)

`refinery/sources/franchise-source.mts` hard-codes a **best-guess** of the
`sba_loans_franchise_outcomes` column names (`franchise_code`, `franchise_name`,
`n_loans`, `n_paid_in_full`, `n_charged_off`, `survival_rate`, `chargeoff_rate`,
`total_gross_approval`, `jobs_supported`). Before the first live run, confirm the
real columns — a one-off `select * from sba_loans_franchise_outcomes limit 1`.
If they differ, **only that one file changes** (the `FranchiseRow` interface and
`normalize()`); the rest of the engine is schema-agnostic. Drop a real sample row
into `refinery/__fixtures__/franchise-outcomes.sample.json` while you're there.

### 3. Live run

```bash
node refinery/cli.mts franchise-outcomes
```

This fetches real rows, runs real Haiku + Sonnet, writes `brains/franchise-outcomes.md`,
and aborts (writing nothing) if the output fails validation. Eyeball the file:
numbers should match the view, facts should read as plain third-person statements.

### 4. Deploy + test in Claude (the seaworthy gate)

```bash
vercel --prod
```

Then `curl https://brain-platform-amber.vercel.app/api/b/franchise-outcomes` to
confirm it serves. Then in Claude (Pattern A then B, per
`docs/invocation-patterns.md`), run a retrieval check and a use check —
PASS = Claude answers from the pack, cites `s01`, treats it as reference data.

### 5. Log results

Fill in Tiers 2-3 in `docs/phase-1-test-results.md`.

## Notes

- **No Vercel env vars needed.** The Refinery runs locally (A1); the B2 route just
  reads `brains/*.md`. Credentials stay on your machine.
- **Don't commit a mock pack.** A pack built with no `ANTHROPIC_API_KEY` is mock
  output — fine for testing the engine, not for serving. Only commit `brains/franchise-outcomes.md`
  after a real run (step 3).
- **CRE pack is next** (plan step 7) — after the Franchise pack passes Tier 3.
  It needs a `get_schema` + count check on Sanity `go8u2esq` first (the corridor
  count is uncertain — see plan Risk #6).
- Full run/mode/env reference: `refinery/README.md`.
