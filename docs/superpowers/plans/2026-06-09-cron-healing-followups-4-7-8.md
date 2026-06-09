# Cron self-healing — follow-up build plan (items 4, 7, 8)

**Date:** 2026-06-09
**Status:** planned (not built)
**Parent spec:** `docs/superpowers/specs/2026-06-08-leveled-cron-self-healing-design.md`
**Sibling (shipped this session):** ci.yml `node --test` enforcement + trigger-list drift guard + `signal` output + pypi map `pyarrow`/`anthropic`.

These are the three items deferred from the audit as "real features, own pass." Quick wins (1, 2, 5, 6) already shipped; Gap 2 was deleted (no bug — `checkout@v6` is vendor-current and repo-standard).

**Priority order:** 4 → 7 → 8. Item 4 is small + unblocks the L3 cockpit; item 7 prevents the exact class L1 was deferred for; item 8 has the best long-term ROI (DATA_EMPTY is the growing class) but the most build cost.

**Vendor-First (CLAUDE.md RULE 1) — verify these surfaces live IN-SESSION before writing the code that depends on them:**

- Item 4 — the GitHub REST "Get a workflow run" object: confirm it carries `path`, `head_branch`, `run_attempt`, `conclusion`, `name`, `id` (snake_case, same schema as the `workflow_run` webhook). WebFetch the REST docs.
- Item 7 — deptry's current CLI/config surface: flag names (`--requirements-files` vs config key), whether it reads `requirements.txt` without a `pyproject.toml`, and the rule code for "missing dependency" (DEP001). WebFetch the deptry docs.
- Item 8 — Firecrawl's map endpoint: API version (v1 vs v2), path, request body, response shape. WebFetch the Firecrawl docs. (Do NOT remember it — the surface drifts.)

---

## Item 4 — `workflow_dispatch` + manual re-run on `heal-cron-failure`

**Goal.** Let a human (and later the L3 ops cockpit) re-trigger the healer against a specific failed run, instead of only reacting to a live `workflow_run` event.

**Why.** Today the healer fires only on the `workflow_run: completed` event. If you want to re-diagnose an old failure, tweak the classifier and re-test against a real run, or wire a one-click "re-run + diagnose" button in `swfldatagulf-ops`, there is no entry point. This is the hook the L3 cockpit (parent spec, L3) needs.

**The tricky bit (and the correction to the original audit note).** A `workflow_dispatch` event has **no `workflow_run` object** — the script reads `JSON.parse(GITHUB_EVENT_PATH).workflow_run` and would get `undefined` → `process.exit(2)`. We must synthesize the run object from a run ID. The original audit said "map the camelCase `gh run view --json` fields" — **don't**. `gh run view --json` is a curated subset, camelCase, and **has no `path`** (which `deriveWorkflowName` needs to get the kebab slug; without it the slug falls back to the display name and `EXCLUDED`/`resolvePipelineSource`/`isFreshnessProbe` all break).

**Use the REST run object instead — it is the SAME schema the webhook delivers:**

```sh
gh api "/repos/$GITHUB_REPOSITORY/actions/runs/$RUN_ID"
```

returns `{ id, name, path, head_branch, run_attempt, conclusion, ... }` in snake_case — a drop-in for `event.workflow_run`. (Verify `path` presence at build time, per Vendor-First above.)

**Changes:**

1. `.github/workflows/heal-cron-failure.yml`
   - Add to the `on:` block:
     ```yaml
     workflow_dispatch:
       inputs:
         run_id:
           description: "Failed run ID to heal (from the run URL)"
           required: true
     ```
   - Each job `if:` currently gates on `github.event.workflow_run.*`, which is empty on dispatch. Add `|| github.event_name == 'workflow_dispatch'` to the **triage** job `if:` (mirror the pattern already live in `grade-predictions.yml`). `retry`/`diagnose` gate on `needs.triage.outputs.*`, so they need no event check — they follow triage.
   - Pass the input through: `env: { RUN_ID: ${{ github.event.inputs.run_id }} }` on the triage step (and retry/diagnose steps, since each job re-derives `run`).
2. `.github/scripts/heal-cron-failure.mjs`
   - Factor run-sourcing into one function:
     ```js
     function loadRun() {
       if (process.env.GITHUB_EVENT_NAME === "workflow_dispatch") {
         const id = process.env.RUN_ID;
         const repo = process.env.GITHUB_REPOSITORY;
         return JSON.parse(execSync(`gh api /repos/${repo}/actions/runs/${id}`, {...}));
       }
       const ev = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
       return ev.workflow_run;
     }
     ```
   - `if (!run) process.exit(2)` stays. The existing `EXCLUDED = workflowName === "daily-rebuild"` guard means a dispatch against a daily-rebuild run id is still refused (defense in depth — no YAML change needed for that).
   - L0 retry's `run_attempt === 1` guard still applies to dispatched runs (a dispatch on an already-retried run won't loop).

**Acceptance:** From the Actions tab, "Run workflow" with a known failed `run_id` → triage classifies it, retry/diagnose route correctly, and a daily-rebuild run id is refused. The kill switches (`CRON_HEAL_*`) still apply.

**Risk:** low. New entry path is additive; the live `workflow_run` path is untouched. The one real failure mode is the field-mapping — eliminated by using the REST object verbatim.

**Effort:** ~1 hr.

---

## Item 7 — `deptry` in CI (prevent `MISSING_DEP` at PR time)

**Goal.** Fail CI when a Python file imports a third-party package that isn't declared in `ingest/requirements.txt` — i.e., catch `MISSING_DEP` at the PR, before it ever reaches a cron.

**Why.** `MISSING_DEP` is the class L1 (auto-branch dep-fix) was designed to *heal at runtime* — and the parent spec deferred L1 precisely because the class is rare and onboarding-shaped. `deptry` kills it at the source instead: the failure that L1 would patch on a branch never lands. This makes the L1 deferral permanent rather than provisional. The classifier + pypi map remain the runtime safety net for the rare miss.

**The tricky bit.** brain-platform's `ci.yml` is a Bun/TS job with no Python. deptry needs Python + the requirements context, and the repo declares deps in `ingest/requirements.txt` (no `pyproject.toml` for the ingest package). So this is a **separate workflow** (or a separate job), not a step in the existing build job.

**Changes:**

1. New `.github/workflows/deptry.yml` (push/PR to main, paths-filtered to `ingest/**`):
   ```yaml
   - uses: actions/checkout@v6
   - uses: actions/setup-python@v5
     with: { python-version: "3.13" }
   - run: pip install deptry
   - run: deptry ingest --requirements-files ingest/requirements.txt
   ```
   (Confirm the exact flag name + that deptry accepts a requirements.txt-only project at build time — Vendor-First.)
2. Suppress legitimate noise to reach a **clean zero-false-positive baseline** before making it blocking:
   - `known_first_party` / local-module roots so `ingest.lib.*`, `ingest.pipelines.*` aren't flagged as missing.
   - `per_rule_ignores` for any optional/conditional imports (e.g. a `try: import X` fallback).
   - Config lives in a small `[tool.deptry]` table (in a root or `ingest/` `pyproject.toml`) or via CLI flags.

**Acceptance:** A PR that adds `import some_new_pkg` to an ingest file *without* adding it to `requirements.txt` fails the deptry job with DEP001; the current tree passes clean (zero false positives).

**Risk:** false positives are the only real cost — they're a one-time tuning pass (run deptry once locally, suppress the known-good local-import/optional-dep noise, then turn it blocking). No runtime/blast-radius risk; it's a CI gate, not a pipeline gate (RULE 3 C2 — it gates code review, not materialization).

**Effort:** 30–60 min (mostly tuning to zero false positives).

---

## Item 8 — Firecrawl/Spider auto-rediscovery for `DATA_EMPTY` (heal++)

**Goal.** When a pipeline fails `DATA_EMPTY` (0 rows — usually a dead/moved source URL or a new WAF block), have the L2 diagnose step **automatically surface candidate replacement URLs** in the incident issue, instead of only posting "needs a human to re-point the source."

**Why.** Per the parent spec, `DATA_EMPTY` (~6 incidents) and `TRANSIENT` are the classes that *grow with data volume* (more scrape sources → more dead URLs). It's the highest long-term ROI heal target. The repo already owns the rediscovery muscle — `extract_client.scrape_with_fallback()` (Firecrawl primary, Spider fallback) — but that's Python ingest-side; the healer is node in Actions, so it calls Firecrawl's HTTP API directly.

**Stays inside the guardrails.** The LLM/healer **never re-points the source or writes code** (parent spec: "no LLM writing code, no auto-push"). It only *surfaces candidate URLs* for a human to wire. This is an enrichment of the existing advisory comment, not a new autonomy level.

**Changes:**

1. `.github/scripts/heal-cron-failure.mjs` — in `diagnose()`, when `c.klass === "DATA_EMPTY"`:
   - Derive the source domain from the pipeline source already read by `resolvePipelineSource()` (grep the `.py` for the first `https?://` literal / base URL).
   - Call Firecrawl `/map` (verify v1/v2 path + body + response at build time) on that domain with a search term derived from the pipeline slug; collect the top N candidate URLs.
   - Append a **"Candidate replacement URLs"** block to the issue comment (alongside the Haiku narrative). Bounded: one map call, `timeout`, top ~5 URLs.
   - Degrade gracefully: no `FIRECRAWL_API_KEY` → skip the rediscovery block, post the deterministic + Haiku comment as today (same pattern as the missing-`ANTHROPIC_API_KEY` path).
2. `.github/workflows/heal-cron-failure.yml` — add `FIRECRAWL_API_KEY: ${{ secrets.FIRECRAWL_API_KEY }}` to the **diagnose** job's `env:` block. **RULE 1 breaker #3:** the secret isn't live until it's in the `env:` block, not just `gh secret set`.

**Acceptance:** A simulated `DATA_EMPTY` (dispatch item 4 against a known 0-row run, or a unit-level test of the rediscovery function) produces an issue comment containing live candidate URLs from the source domain; with no key set, the comment degrades cleanly.

**Risk:** scope creep + candidate quality. Keep it strictly advisory and bounded (one map call, capped URLs, hard timeout). Firecrawl map cost per incident is negligible.

**Effort:** ~half day. Build after 4 + 7, or when `DATA_EMPTY` recurrence justifies it.

---

## Out of scope (unchanged from parent spec)

- No LLM writing code; no auto-push to `main`.
- `Daily Brain Rebuild` is never auto-healed (excluded at the trigger AND in the script; now also enforced by the trigger-list drift guard test).
- L1 auto-branch dep-fix stays deferred — item 7 (deptry) makes that deferral permanent by preventing the class upstream.
