# Leveled Self-Healing for Cron Failures — design

**Date:** 2026-06-08
**Status:** approved (lean build; L1 deferred)
**Supersedes:** the draft "Auto-Fix Cron Failure Pipeline" (single auto-fixer that pushed a missing-dep line straight to `main`).

---

## Why this shape (audit-driven)

A code audit of the existing machinery (`docs/cron-rebuild-failures.md`, `.github/scripts/log-cron-incident.mjs`, `.github/workflows/log-cron-incident.yml`, `refinery/lib/master-freeze-watchdog.mts`) changed the draft. Findings, all verified against the code in-session:

1. **The draft's auto-fix target is the rarest failure we have.** In ~32 logged incidents, `ModuleNotFoundError` appears **exactly once** (`bs4`, 2026-05-26). The recurring breakers, by frequency:
   - `SCHEMA_DRIFT` / vocab-orphan (~7) — **almost all on `daily-rebuild`**, which is excluded (owns `master-freeze-watchdog.mts` + the vocab pre-push gate).
   - `TRANSIENT` network/timeout/SSL/429 (~7) — self-resolves on retry.
   - `MISSING_SECRET` (~4 incidents, one hit 6 workflows at once) — needs a human to wire the `env:` block.
   - `DATA_EMPTY` dead-URL/WAF (~6) — needs a human to re-point the source.
2. **Scale argues for L0+L2, against L1.** The classes that grow with data volume are `TRANSIENT` (more API calls → more timeouts) and `DATA_EMPTY` (more scrape sources → more dead URLs). `MISSING_DEP` is a new-pipeline-onboarding event caught by CI/first-fire; it *decreases* as the fleet matures.
3. **The existing logger already gives us the spine.** `SYMPTOM_RX` (`log-cron-incident.mjs:21`) already matches `ModuleNotFoundError`/`KeyError`/`TimeoutError`/`SSLError`/`relation … does not exist`; the slug derivation (`:45-49`), log-tail fetch (`:123-135`), and discrete-issue + Project-#3 + auto-close machinery are **already live**. The classifier is an *extension*, not a rebuild.
4. **Cost is not the constraint; build time is.** L2 Haiku fires only on failure (~3K in / ~300 out ≈ **$0.005/diagnosis, ~$0.15/mo**). The only meaningful cost is engineering time, which concentrates almost entirely in L1.

**Decision:** build the classifier + L0 retry + L2 diagnose now. **Defer L1** (auto-branch dep-fix) entirely — its deterministic value (telling you the exact one-line fix) is captured by L2's deterministic suggestion in the issue body. Build the auto-branch only if `MISSING_DEP` recurs.

This is agent/ops behavioral automation, not a data-pipeline gate — explicitly in-bounds under CLAUDE.md RULE 3 C2 (it extends the logger/ledger/issue seams; it erects no new pre-materialization gate).

---

## The model — levels gated by confidence × blast radius

| Level | Class it handles | Action | Touches `main`? | Kill switch (repo var) |
|---|---|---|---|---|
| **L0 — Retry** | `TRANSIENT` | `gh run rerun --failed` **once** (guarded `run_attempt === 1`); excludes `freshness-probe-daily` | No | `CRON_HEAL_RETRY_ENABLED` |
| **L1 — Branch dep-fix** | `MISSING_DEP` | **DEFERRED — designed, not built.** Trigger to build: a 2nd `MISSING_DEP`. | No (branch + draft PR) | `CRON_HEAL_BRANCHFIX_ENABLED` (reserved) |
| **L2 — Diagnose** | everything else | deterministic fix in the issue (logger) + Haiku narrative for fuzzy classes (heal) | No | `CRON_HEAL_DIAGNOSE_ENABLED` |
| **L3 — Ops cockpit** | all of the above | classified incident + one-click `workflow_dispatch` re-run | No (you click) | ops-side flag (separate repo) |

Global off switch: `CRON_HEAL_ENABLED`. Levels dial up/down by flipping a repo variable — no deploy.

**Bounded by design (kills "flailing for an hour"):**
- The LLM never writes code. Its only role is the L2 narrative for `DATA_EMPTY`/`SCHEMA_DRIFT`/`UNKNOWN`.
- L0 retries **at most once** — `run_attempt === 1` gate. A retried failure (`run_attempt === 2`) does not retry again; it escalates to L2.
- `timeout-minutes` on every job; `concurrency: heal-${{ run.id }}`, `cancel-in-progress: false`.
- `Daily Brain Rebuild` is excluded at the workflow trigger **and** defensively in the script.

---

## Components

### A. Shared classifier — `.github/scripts/classify-cron-failure.mjs`

Pure `classify(logTail) → { klass, signal, suggestedAction }`. Deterministic regex only; no LLM, no fs. Classes (checked in priority order): `LOCKFILE`, `ACTION_VERSION`, `MISSING_DEP`, `MISSING_SECRET`, `SCHEMA_DRIFT`, `DATA_EMPTY`, `TRANSIENT`, `UNKNOWN`. Also exports `isLocalModule(mod)` (fs-backed guard), `isFreshnessProbe(name)`, `shouldRetry(klass)`, `needsLlm(klass)`. Imported by **both** the logger and the heal script — the DRY spine.

- `MISSING_DEP` resolves the import name to a PyPI package via `pypi-import-map.json` (data, not code). `bs4`→`beautifulsoup4`, `yaml`→`PyYAML`, etc. Stdlib names get a "wrong Python version, not a missing package" suggestion.
- `MISSING_SECRET` only matches `UPPER_SNAKE` env-looking names (a lowercase `KeyError` falls to `SCHEMA_DRIFT`/`UNKNOWN`).
- **Local-module guard:** the logger calls `isLocalModule(signal)` for `MISSING_DEP`; if the name matches a repo dir/file, the suggestion flips to "import-path bug, not a missing package" (dependency-confusion-safe). De-risked further by L1 being deferred — nothing is auto-applied.

### B. Logger — `.github/scripts/log-cron-incident.mjs` (modified)

On failure, in addition to the existing row + issue + Project-add:
- Fills the ledger **Root Cause** column with `CLASS — signal` instead of `_auto-captured; pending triage_` (UNKNOWN keeps the old text). The ledger becomes a self-triaging, queryable failure-class history — the "keep track as we scale" win.
- Embeds the class in the issue **title** (`[cron-failure:slug] CLASS · Display — date`; the `[cron-failure:slug]` tag stays intact for the auto-close search) and a **Suggested action** block in the body.
- Race-free: the logger *owns* the issue, so all deterministic diagnosis lives here. No new dependency, no LLM.

### C. Heal workflow — `.github/workflows/heal-cron-failure.yml` (new)

Triggers on `workflow_run: completed` over the same watched set **minus `Daily Brain Rebuild`**. Three jobs:
- `triage` — checkout + node, runs `--mode=triage`, emits `class` / `should_retry` / `needs_llm` as job outputs.
- `retry` — `if should_retry` → `--mode=retry` (`gh run rerun --failed`). No deps, no checkout weight beyond node.
- `diagnose` — `if needs_llm` → checkout + `bun install --frozen-lockfile` + `--mode=diagnose`. The only path that pulls the SDK; runs rarely.

`actions: write` (for `gh run rerun`), `issues: write`, `contents: read`.

### D. Heal script — `.github/scripts/heal-cron-failure.mjs` (new)

Modes mirror the logger's `--mode` pattern. `triage` → classify, write `$GITHUB_OUTPUT`. `retry` → re-run failed jobs once (re-checks `run_attempt`). `diagnose` → resolve the failing pipeline's source by parsing the workflow's `run:` command (self-maintaining; fixes the `ingest-fred-g17`→`fred_g17`, `zori-tier1`+`zori-tier2`→`zori_swfl` brittleness), call Haiku (`claude-haiku-4-5`, `@anthropic-ai/sdk`), post a `DIAGNOSIS / LIKELY CAUSE / HUMAN ACTION` comment on the incident issue. Degrades gracefully: no `ANTHROPIC_API_KEY` → deterministic-only comment.

### E. Allowlist — `.github/scripts/pypi-import-map.json` (new)

Import-name → PyPI-package map. Widen breadth later by editing this file, no code change.

---

## Two refinements (baked in)

1. **`freshness-probe-daily` → never L0 retry.** A freshness probe going red is a *real stale-data signal*; retrying it masks the signal. It routes to L2 only.
2. **Pipeline source resolved from the workflow YAML's `run:` command,** not a hand-maintained slug→dir map (self-maintaining), with a small fallback.

---

## Data flow

```
cron workflow fails (workflow_run: completed, conclusion=failure, head_branch=main)
        │
        ├──► log-cron-incident.yml (existing)
        │       classify() → Root Cause = "CLASS — signal"
        │       create issue "[cron-failure:slug] CLASS · …" + Suggested action + add to Project #3
        │
        └──► heal-cron-failure.yml (new)
                triage: classify() → should_retry, needs_llm
                  ├─ retry (TRANSIENT, attempt 1, not probe) → gh run rerun --failed   [exit]
                  └─ diagnose (DATA_EMPTY/SCHEMA_DRIFT/UNKNOWN, or TRANSIENT attempt≥2)
                        resolve pipeline source from workflow YAML → Haiku → comment on the issue
```

A success on the next scheduled run auto-resolves the ledger row and closes the issue (existing logger behaviour, unchanged).

---

## Out of scope

- **No LLM writing code.** No auto-push to `main`, ever.
- **`Daily Brain Rebuild` is not auto-touched** — it keeps `master-freeze-watchdog.mts`; its failures are vocab/lockfile/render drift, not dep-shaped.
- **GitHub Projects stays tracking-only.** Cards get smarter (class in title); the board never executes.
- **L1 auto-branch dep-fix is deferred** — full design retained below for when `MISSING_DEP` recurs.

---

## Rollout

1. **P1 — classifier + logger fill** (zero autonomy): board #3 + ledger become a triage history.
2. **P2 — heal workflow** with L0 retry + L2 diagnose behind kill switches. Soak in dry-run/observe, then default-on. Needs `gh secret set ANTHROPIC_API_KEY` for the LLM path (deterministic path works without it).
3. **P3 — L3 ops cockpit** in `swfldatagulf-ops` (separate deliverable).
4. **P4 — L1 auto-branch dep-fix** — build only on a 2nd `MISSING_DEP`.

---

## L1 — deferred design (build only when MISSING_DEP recurs)

Branch `autofix/cron-<slug>-<date>` (date from the run, not `Date.now`) → one-line `requirements.txt` edit (allowlist-resolved, non-local, non-stdlib, not already present) → validate on the branch side-effect-free (`pip install -r` + `python -c "import X"`) → green: push + **draft** PR + issue comment; red: delete branch, fall to L2. Confidence gate (ALL required): error is exactly `ModuleNotFoundError: No module named 'X'`; `X` resolves via allowlist; `X` is not local and not stdlib; `X` not already in `requirements.txt`. Lockdown: only `autofix/cron-*`, auto-deleted on close, branch-protection restricts pushers to the bot, PR opens as draft (never auto-merged — the merge stays the operator's), Vercel ignores `autofix/*`. One attempt, ~15-min cap, no fix-retry loop.

---

## Verification

- Classifier unit test (`classify-cron-failure.test.mjs`): real log tails from the ledger (`bs4`, FRED 429, socket close, SSL EOF, `KeyError` secret, missing-env-var, `… not set`, 0-rows, Orphan Concept, `relation … does not exist`, `checkout@v6`, lockfile-frozen, Stage-4 validation) → assert class + signal + routing.
- `isLocalModule`: a real pipeline dir (`fred_g17`) → local; a PyPI name (`beautifulsoup4`) → not.
- `shouldRetry`/`needsLlm`/`isFreshnessProbe` mapping.
- Kill switches: each `CRON_HEAL_*` var `false` → that level skipped, others run.
