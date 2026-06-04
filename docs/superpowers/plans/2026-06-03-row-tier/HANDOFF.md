# Opus Handoff — Row Tier + Flywheel (filed 2026-06-03)

**Read first:** this folder's `README.md` (the plan + Phase-0 audit + rule disposition + the two-engine flywheel reframe), `docs/THE-GOAL.md` (the three tiers), `CLAUDE.md` RULE 0–2 (the session loop). **Verify every "shipped" claim against `git` + code before trusting it** — Phase 0 found all drift is doc-lags-code, but verify anyway; that discipline is the whole point.

> **⚠️ BUILD ORDER SUPERSEDED 2026-06-04 — read `docs/superpowers/specs/2026-06-04-revenue-first-resequence-design.md` FIRST.** The Track-A "row-tier next" ordering below is the build RECORD, not the current priority. Revenue-first re-sequence (operator-blessed): GSC (P0, operator — expires 2026-06-05) → indexing (`app/sitemap.ts` + `app/robots.ts` — SHIPPED) → **the next Claude's FIRST task = move #2: smallest paid path / willingness-to-pay** — a one-function bearer gate in `app/api/mcp/auth.ts` + a $39–79 page on the _existing_ housing-swfl ZIP-drill + env-swfl flood AAL → one LCAR/NABOR demo (gate: operator go on the money/auth surface). The sweep's 1a polarity-tighten + column-3 inventory **stay in scope**; only the row-tier **schema / P4** defers behind a NAMED consumer. Track B flywheel **stays HELD** (`checks: flywheel_backtest_decision_function`). **Ian = standalone illustrative demo (N≈1–2, NOT moat proof), NOT folded into the held harness, does NOT lift the HOLD** (`checks: ian_retrodiction_demo`). LeePA price premise in the old plan is CORRECTED: `last_sale_amount` IS populated (528,130 rows, live-verified 2026-06-04).

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

This is plan phase **P2**. **Pre-sweep dependency — ✅ DONE 2026-06-04.** `vintage_policy` audit complete: `docs/littlebird-notes/2026-06-04.md` (11 clean gradeable slugs; LAUS + ZORI dirty; licenses gradeable-in-theory but pipeline not running).

**Sweep design — ✅ SPEC WRITTEN 2026-06-04: `sweep-spec.md` (this folder).** The locked contract, hardened across two LB review rounds and grounded against `loader.mts` / `predictions-log.mts`:

- **Two code-writes in `loader.mts` (one commit, Opus diff-review):** (1a) tighten the polarity gate from `=== "none"` to **enum-membership** so an out-of-enum polarity (`"neutral"`, `"higher_is_bearish"`) is `ungradeable` at the runtime source, not just flagged in the sweep — blast radius is live-inert today (licenses pipeline not running); (1b) add a pure no-short-circuit `gateVector(slug)` returning the independent gates `{registered, polarity_state, window_ok, numeric_ok}`.
- **Bucketing is a total, disjoint 24-combo truth table** (precedence: unregistered ▸ invalid-polarity ▸ non-numeric→row ▸ gradeable ▸ moat-fuel ▸ needs-window). No slug in two buckets — kills the first-failing-gate double-count by construction.
- **Drift pin** `gateVector all-green ⇔ resolveGradeConfig.gradeable`, green from the 1a commit.
- **Invalid-polarity = fix-or-remove via per-slug Opus directional audit, NEVER string-normalize** (the cre-swfl inversion lesson).
- **Output is a regenerable JSON artifact + `checks` rows, never a markdown checkbox board.** Row-vs-brain (R1) stays an Opus semantic call; the sweep emits candidates only.

One pass → the three-column ledger: (1) row vs brain, (2) moat-fuel backlog, (3) backtestable inventory (gradeable ∩ vintage-clean). Then author the row-tier schema (**no free-text column**; precomputed artifact through the `lib/fetch-brain.ts` disk choke point) → **a second Opus agent adversarially refutes it before it's blessed (C1)** → P3–P6 per `README.md`.

**C1 debt — run before P4:** the "governed gold / row tier" is an imported best-practice (the Databricks medallion) → C1 owes an adversarial **web-refutation** pass (Phase-0 was a code audit only). Name the row tier's consumer first (per R1, rows = slugs master never calls on → consumer = product querying facts directly), and tie it to the 2026-06-03 rejection of the mandatory Source-Contract spine (too-early-governance grounds) so we don't rebuild it.

Model split: the sweep tool is mechanical (⚪/🔵); 1a/1b + row/brain semantics + schema + refutation are 🔴.

---

## Track B — Flywheel backward-engine 🔴 — ⛔ HELD (settle the decision function first)

**HOLD (2026-06-04):** do NOT scope the retrodiction harness or the manifest/look-ahead scaffolding until the decision function + skill baseline are settled — `checks` key `flywheel_backtest_decision_function`. Building immaculate point-in-time hygiene around an undefined predictor is scaffolding around a void.

The unresolved crux: the forward engine grades master's authored `claim.then_direction` (`predictions-log.mts:99-101`); **polarity is the grading orientation, not a predictor.** The backward harness has no master, so "the direction the system would have predicted" must be defined explicitly:

1. **Decision function (deterministic, no LLM):** replay = recomputed z-score / MoM sign **as-of-then**, never a model call. This needs as-of-then INPUTS — a bounded partial de-defer of step 5 (date-filtered queries over immutable records, not a full master re-run).
2. **Skill baseline:** report **lift over a persistence null**, never raw accuracy (a directional rule on a trending series — e.g. `hosp_tdt_post_ian_recovery_ratio` — scores ~100% by autocorrelation).
3. **Independence caption (reporting contract):** effective **N ≈ 5 families, not 11** (7 TDT slugs are one `fl_dor_tdt_collections` series; 3 SBA = one outcome family). Caption family-N wherever N is reported.

**Backtestable corpus (post-ALFRED):** clean/recoverable = SBA-outcomes · TDT-collections · LeePA-deeds (immutable, date-filter) **+ Lee/Collier LAUS** — the latter **verified recoverable from ALFRED 2026-06-04**: `FLLEEC7URN` / `FLCOLL0URN`, 231 vintages, ~19yr point-in-time deep, `realtime_start` returns as-of-then values; connector + key already exist (`refinery/sources/macro-florida-source.mts`). Re-ingest tracked as `checks` key `laus_alfred_pit_reingest`. **ZORI stays dirty** — Zillow republishes its back-series and ships no vintage archive → `append_asof`-forward only, past gone. The rule: re-ingesting the _same_ source re-imports the contamination; the only moves are a **vintage-preserving source** (LAUS→ALFRED) or **append_asof-forward** (ZORI).

[INFERENCE] "directional grades rarely flip on revision" (base: benchmark revisions are typically sub-100bps) — **falsifier:** once ALFRED LAUS vintages are ingested, measure as-of-then vs revised direction; if >~10% of periods flip sign, false. Not enshrined as a constant.

**Deferred (the rich version):** re-run the master pack against a point-in-time lake snapshot to backtest its _conditional_ calls, not just the deterministic signal — only after the deterministic version proves the machinery.

---

## Recommended sequence

**Step 0 ✅ → vintage audit ✅ → Track A sweep (spec ✅ `sweep-spec.md`; build next: `loader.mts` 1a/1b → sweep tool → 3-col ledger) → C1 web-refutation before P4 → row-tier schema (P4).** Track B is **HELD** behind `flywheel_backtest_decision_function`; the sweep's column 3 (backtestable inventory) is the only Track-B input it produces. ALFRED LAUS re-ingest (`laus_alfred_pit_reingest`) is verified moat fuel that runs once the decision function is settled.

**Token discipline:** the sweep tool + `gateVector` (1b) are Sonnet to this spec; 1a (behavior change), the row/brain semantics, the decision-function + look-ahead design, and the C1 refutation are Opus. Keeps Opus at ~20–25% of spend.
