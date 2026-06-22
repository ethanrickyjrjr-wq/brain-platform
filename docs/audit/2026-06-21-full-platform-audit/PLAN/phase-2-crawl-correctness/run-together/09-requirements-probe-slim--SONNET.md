# 09 — slim install for probe/gate crons (`requirements-probe.txt`)

**Model: Sonnet.** New file + two YAML edits. **Priority: P2.** Removes the biggest daily-failure surface.

## The defect (verified)
`freshness-probe-daily.yml:28` and `daily-rebuild.yml:50` (the rebuild *gate* step) both run
`pip install -r ingest/requirements.txt` — the **entire ~100-package tree** (crawl4ai, playwright,
patchright, dlt, pandas, pyarrow, duckdb, anthropic, pdfplumber, pymupdf …). But the probe only runs
`ingest.scripts.check_freshness` and the gate only runs `ingest/scripts/rebuild_due.py` — both need just
`psycopg[binary]` + `pyyaml`. So a yanked wheel or PyPI blip on ANY of ~100 packages reddens a cron that
never uses it. (Note: this is the Python *package* tree; the browser binary is a separate step only on the
11 crawl jobs — not these two.)

## Steps
1. **Probe first.** Read `freshness-probe-daily.yml` (~28-37), `daily-rebuild.yml` (the gate Python step
   ~44-61), and confirm exactly what `check_freshness.py` + `rebuild_due.py` import (psycopg + pyyaml; check
   for any stray import).
2. Create `ingest/requirements-probe.txt` with the minimal pins (`psycopg[binary]>=3.2`, `pyyaml>=6.0`, plus
   anything those two scripts actually import — verify, don't guess).
3. Point `freshness-probe-daily.yml` + the `daily-rebuild.yml` gate step at `-r ingest/requirements-probe.txt`.
   Leave the daily-rebuild's *build* step (the one that runs the refinery) on the full tree — only the
   lightweight gate/probe steps switch.
4. **RULE 1 lockfile/gate awareness:** this is a Python requirements file, not `package.json` — no bun.lock
   impact. But double-check no other workflow assumes the probe step installed the full tree.

## Done when
- A `freshness-probe-daily` `workflow_dispatch` installs only the slim file and the probe still runs + exits 0
  (pairs with build 03's guards). Same for the daily-rebuild gate step.

## Best-practice fold-in
Slim ONLY probe/gate-class jobs (those that run `check_freshness.py` / `rebuild_due.py`). Crawl jobs
**must** keep the full tree — they need `crawl4ai`, `playwright`, `patchright`, and the rest. Never target
a crawl workflow with `requirements-probe.txt`; the guard in Step 4 should confirm this explicitly.

## Risk
Low. If a needed import is missing it fails fast at probe start (not destructively). Verify imports first.

## References (added 2026-06-22 — crawl4ai-live + best-practices fold-in)
**crawl4ai-live (tool-usage reference, docs/audit/2026-06-21-crawl4ai-live/):**
- `docs/audit/2026-06-21-crawl4ai-live/round1/02-installation.md` — what crawl4ai actually needs (torch/transformers are optional extras; the bare 0.9.0 pin is correct)

**best-practices-research (how to build/operate what we build, docs/audit/2026-06-21-best-practices-research/):**
- `docs/audit/2026-06-21-best-practices-research/round3/q-uv-pip-compile.md` (REPORT P2#9) — pin minimal reproducible deps per job; this removes the biggest daily-failure surface
- `docs/audit/2026-06-21-best-practices-research/round2/ci-gha-reusing-workflows.md` — DRY workflow composition for the slim install step

**Verified:** confirmed: every daily cron installs the full ~100-pkg tree (crawl4ai+playwright+patchright+litellm+scipy/...) even probe/gate jobs that need only psycopg+pyyaml — folded into Steps above where applicable.
