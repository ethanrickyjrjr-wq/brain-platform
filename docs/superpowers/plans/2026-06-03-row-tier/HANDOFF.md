# Opus Handoff — Row Tier + Flywheel (filed 2026-06-03)

**Read first:** this folder's `README.md` (the plan + Phase-0 audit + rule disposition + the two-engine flywheel reframe), `docs/THE-GOAL.md` (the three tiers), `CLAUDE.md` RULE 0–2 (the session loop). **Verify every "shipped" claim against `git` + code before trusting it** — Phase 0 found all drift is doc-lags-code, but verify anyway; that discipline is the whole point.

Three things were verified in-session 2026-06-03 (don't re-verify, but know the result):

- **R8 hook slot is real** — `.claude/settings.json` already wires `PreToolUse` gates; a `PreToolUse:Edit|Write` hook is a genuine registered slot.
- **R6 is a real GAP** — `buildSourceCitationUrl` does not branch on build-mode; a fixture build emits a live-looking citation. This is a build, not a verify.
- **A8 (`master-gate.mts`) shipped + wired + tested** — Phase-4 circuit breaker is live; its plan-doc header was stale (flipped this session).

---

## Step 0 — Lock the gate (SHARED — do this first on either track)

**✅ SHIPPED 2026-06-04** — R8 hook + R4 pin + C1/C2 landed as one commit; R6 shipped 2026-06-03. Step 0 is complete; specs retained below as the build record.

1. **R8 path-guard hook — ✅ SHIPPED 2026-06-04.**
   - `.claude/hooks/check-project-path.mjs` (registered in `.claude/settings.json` `PreToolUse` / `matcher: "Edit|Write"`). **Design correction vs the original spec:** a naive "deny outside the repo root" would block legitimate out-of-repo writes — most importantly the agent **memory dir** (`~/.claude/...`). So it denies (exit 2) only paths in a **sibling project** (under the dev workspace root, not this repo) or any path with a `premise-engine` segment; it **allows** the repo, memory, temp, and anything outside the dev workspace. Fail-OPEN on internal error. Smoke-tested 8 cases (premise-sibling/elsewhere → deny; repo/memory/temp/relative/empty → allow).

2. **R4 polarity assertion — ✅ SHIPPED 2026-06-04** (placed in a dedicated test, not `check-vocab-coverage`).
   - `refinery/vocab/grade-config-polarity.test.mts`: iterates every concept, calls `resolveGradeConfig`, asserts every **gradeable** slug has `source.polarity === "slug"` (never inherited). **Placement note:** `check-vocab-coverage.mts` is a rendered-brain orphan-slug gate (wrong layer for grade config); the pin lives next to `resolveGradeConfig` in `refinery/vocab/`. Already the runtime behavior (loader.mts:234 resolves polarity slug-only) — this pins it so a future `CATEGORY_POLARITY` default can't regress it. cre-swfl polarity-flip is the why.

3. **R6 citation-provenance guard — ✅ SHIPPED 2026-06-03 (not a remaining task).**
   - `buildSourceCitationUrl` now branches on `env.source`: a fixture build returns a `synthetic fixture` sentinel string instead of a live `/r/source/[table]` URL, so the existing Stage-4 fixture-sentinel gate hard-fails any live build that lifts it. Test pinned in `refinery/lib/citation-url.test.mts` (9 citation + 111 source tests green; live mode byte-identical). Left here only as the record of what the lock-now batch contained.

4. **CLAUDE.md policy C1 + C2 — ✅ SHIPPED 2026-06-04** (project `CLAUDE.md` → "RULE 3 — ARCHITECTURE DISCIPLINE"), in the same commit as the R8 hook.
   - **C1 (working agreement):** architecture-level claims get a code audit **always**; an adversarial web-refutation pass **only** when the claim imports an outside best-practice (new storage tier / new mandatory gate / any "X is the spine / the one primitive"). Eloquence is not evidence.
   - **C2 (standing refusal, SCOPED):** "Extend the enforced artifact you already have; never erect a new mandatory pre-materialization gate — this applies to **data-pipeline gates and mandatory pre-materialization schema constraints**, NOT the agent's own behavioral guardrails (the R8 path-guard hook is explicitly in-bounds)."

**Do NOT lock R1/R2/R3/R7 into CLAUDE.md.** R1/R2/R3 graduate to code with the row-tier machinery; R7 already exists (`inference-bait-lint`). Locking them now recreates the rotting-marker drift Phase 0 cleaned out.

---

## Track A — Full classifier sweep / audit (the row-tier on-ramp) 🔴

This is plan phase **P2**. **Pre-sweep dependency — ✅ DONE 2026-06-04.** `vintage_policy` audit complete: `docs/littlebird-notes/2026-06-04.md`. Key findings: **11 clean gradeable slugs** (3 SBA loan outcomes + 7 TDT hospitality + 1 LeePA sales velocity z-score — all immutable individual-record sources). 5 dirty (3 BLS LAUS revised-aggregate + 2 Zillow ZORI revised-aggregate). 5 licenses slugs gradeable-in-theory but pipeline not yet running. Gate verdict: **somewhere between** (~11 = modest boost, not moat-fuel). The `laus_lee_unemployment_rate` forward-flywheel slug is in the dirty bucket — needs `append_asof` before Track B can use it. Full table + LAUS note in the doc above.

Then run `resolveGradeConfig` across the whole lake → per slug, a three-column ledger:

1. **row vs brain** — `gradeable === false` → row-tier candidate; `true` → brain. _(from `resolveGradeConfig` alone — no vintage dependency.)_
2. **moat-fuel backlog** — slugs ungradeable **only** for a missing `direction_polarity`. The cheapest predictions to make gradeable. _(also vintage-independent.)_
3. **backtestable inventory** — from the `vintage_policy` audit above: immutable-record / vintaged → backtestable; revised-aggregate without retained vintages → contaminated. **The count here is the go/no-go on Track B** (≈8 clean = modest boost; ≈80 = moat-builder).

Then author the row-tier spec (schema with **no free-text column** — numeric/enum/identifier only; materialize as a precomputed artifact served through the `lib/fetch-brain.ts` disk choke point, not a live-DB read). **A second Opus agent adversarially refutes the spec before it's blessed** (C1). Then P3–P6 per `README.md`.

Model split: the sweep itself is mechanical (⚪/🔵); the row/brain semantics, schema design, and adversarial refutation are 🔴.

---

## Track B — Flywheel backward-engine (fastest path to a non-empty moat) 🔴

The backtest. **Gated entirely on point-in-time honesty** (README § two engines). Steps:

1. **Inventory backtestable slugs = Track A's `vintage_policy` audit** (don't duplicate it). A slug is backtestable iff its as-of-then value is recoverable: immutable records (sales/claims/permits) are clean by nature; revised aggregates are clean only with retained vintages. **The clean-corpus count is the make-or-break, size-the-prize gate — get it before building anything else, or the whole track is fool's gold.**
2. **Deterministic retrodiction harness** _(Sonnet to spec; Opus designs the look-ahead guard)_ — no LLM. For each backtestable slug × each past period: reconstruct (as-of-then baseline + window + the slug's polarity rule) → the direction the system _would_ have predicted → grade against the known later outcome via the existing `grade_prediction()` machinery. Seeds `grade_accuracy_by_slug` with real N today.
3. **Pre-register the event catalog — a mechanical two-phase gate, not a discipline note** _(Opus designs)_. Phase 1: enumerate the full event list from source data (store openings from permits, interchanges from FDOT, rate hikes from the Fed, Hurricane Ian Sept-2022) → write a **committed, content-hashed manifest**, never reading outcomes. Phase 2: outcome lookup + grading refuses to run unless pointed at a frozen manifest, and **stamps the manifest hash into every graded outcome** so "registered before looked-up" is provable. Grade ALL of it, duds included.
4. **Report** real N + direction-hit rate, with the contamination caveats stated (which slugs are clean-vintaged vs revised-only).
5. **Defer** the rich version (re-run the master pack against a point-in-time lake snapshot to backtest its _conditional_ calls, not just the deterministic signal) until the deterministic version proves the machinery.

---

## Recommended sequence

**Step 0 (R8 hook + R4 assertion + C1/C2; R6 already shipped) → ~~populate `vintage_policy` (pre-sweep dependency)~~ ✅ DONE → Track A's sweep → read the clean-corpus count → decide how far to push Track B.** Not either/or at the foundation; the sweep is the shared spine. Vintage policy audit landed 2026-06-04: 11 clean slugs, LAUS dirty. Next: Step 0 code (R8 hook + R4 assertion + C1/C2) and then the full Track A `resolveGradeConfig` sweep.

**Token discipline:** Step 0 items 1–2 + the Track B harness are Sonnet to a written spec. Opus reserved for: C1 wording, the row/brain schema semantics, the look-ahead-bias + event-catalog design, and the adversarial refutation pass. That keeps Opus at ~20–25% of spend.
