# Row Tier + Source Declaration — Plan

**Filed:** 2026-06-03 · **Updated:** 2026-06-03 (rule-sort locked + verified; flywheel two-engine reframe) · **Status:** Phase 0 audit GREEN; lock-now items verified real; build-priority fork = Track A (sweep) vs Track B (flywheel backward-engine), they share a spine
**Origin:** 2026-06-03 architecture session ("Source Contract as spine?" → No; row tier + extend the artifact you have).
**Opus handoff directions:** `HANDOFF.md` in this folder.

> **This is a brief, not a status board.** Open obligations live in the `checks` ledger (`scripts/check.mjs`), never as ⬜/✅ markers here (RULE 2). Verify done-ness against `git` + code, not against this file.

---

## Vision — the precomputed fact artifact (the missing query-direct layer)

| Databricks layer                       | SWFL Data Gulf                                                                          | State (verified 2026-06-03)                                |
| -------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Lakehouse storage                      | Tier 1/2 lake                                                                           | ✅ have (548k parcels, 433k NFIP claims, 255k CBP rows, …) |
| **Governed tables you query directly** | **Row tier — pure precomputed facts**                                                   | ❌ **the missing layer — this build**                      |
| Unity Catalog (governance + lineage)   | Source declaration (`cadence_registry` + 3 fields) + row/brain classifier + DAG lineage | 🟡 ~60% (`cadence_registry.yaml` + `dag.mts`)              |
| Notebooks / models                     | Brains (synthesis)                                                                      | ✅ have (27 packs)                                         |
| Serving                                | MCP `swfl_fetch` + `/api/b` + consumption contract                                      | ✅ have (served from disk)                                 |
| **MLflow / model registry**            | predictions → outcomes → grading flywheel                                               | 🟡 **live but thin — the moat**                            |
| Anti-bloat governance                  | "Extend the artifact, never a new mandatory gate"                                       | 🆕 standing refusal                                        |

The row tier is the one missing layer that turns "a lake with brains" into "a lakehouse you can trust." The flywheel is what makes it un-copyable.

**Size-cap (2026-06-04):** the row tier serves **ZIP/county-grain precomputed facts**, never full per-parcel row dumps through the `lib/fetch-brain.ts` disk choke point. It is **deferred behind a named consumer** (re-sequence move #3 / P4 — `docs/superpowers/specs/2026-06-04-revenue-first-resequence-design.md`); raw parcel/permit data is commoditized (ATTOM / Cotality / Shovels), so the moat is the flywheel + local-exclusive data, not this layer.

---

## Phase 0 audit — GREEN gate

Seven read-only streams (6 confirm/refute sweeps + 1 live-DB probe). **Every load-bearing claim confirmed in code AND the running Postgres. All drift is doc-lags-code (code is ahead) — zero phantom features.** Key ground truth the build relies on:

- **The R1 classifier already exists.** "Row iff ungradeable" ≡ `resolveGradeConfig(slug).gradeable === false` — `refinery/vocab/loader.mts:220`. Four gates: registered + `direction_polarity ≠ none` (never inherited) + `window_days` + `epsilon`/`grade_basis`. Reuse it; don't build one.
- **Consumers are served from DISK.** `lib/fetch-brain.ts` reads `brains/{slug}.md` — zero DB calls. → **the row tier must materialize as a precomputed artifact served through that same choke point**, not a live-DB read path.
- **Grading loop is live & wired.** `predictions` insert at `refinery/stages/4-output.mts:677`; deterministic grader `refinery/grade/grade-predictions.mts`; write-once `grade_prediction()` RPC; cron `grade-predictions.yml`.
- **R2 confirmed net-new:** no row-purity lint anywhere; the 4 Stage-4 lints police BRAIN markdown only.
- **R3 confirmed net-new:** change detection is timestamp-only — zero etag/hash/checksum in the ingest path.
- **`cadence_registry` matches the live lake** — every registered table exists; no claimed-but-missing.
- **Freshness/freeze safety is live:** `deriveExitCode` at `refinery/lib/resilient-build.mts:169` (exit 1 deterministic/held/silently-unpublished, 2 degraded, 0 ok).

### The strategic context — two engines, not one

Live DB, 2026-06-03: **36 predictions, 6 gradeable (one slug `laus_lee_unemployment_rate`), 0 graded outcomes** (windows mature Aug–Sep 2026), `metric_observations` 976. Read forward-only, the moat looks empty and 12 months from its first turn. **That read is incomplete** (operator reframe, 2026-06-03). The flywheel has two engines:

- **Forward engine (built, slow).** Log a falsifiable call today → wait for the window → grade. Wired (`logPrediction` → `grade-predictions.mts`). First turn ~12 months out. This is the thin one.
- **Backward engine (the reframe — fastest path to a non-empty moat).** The moat's mechanism is _starting conditions + event → measured outcome over time_. For every **past** event (a store opening from permits, an interchange from FDOT, a rate hike from the Fed, Hurricane Ian Sept-2022) all three legs already sit in the lake — we hold the before AND the after. These are **completed natural experiments we already paid to ingest and have never mined.** "0 outcomes" was an artifact of looking only forward; the backward corpus is already complete.

**The backward engine is real on exactly one condition — point-in-time honesty (no look-ahead bias).** Three hard gates:

1. **Data revisions — but "overwrite" ≠ "dirty."** The trap: BLS (LAUS/OEWS/QCEW) and Census revise heavily; a retrodiction must use the value _as it read on the prediction date_ (the vintage), not today's revised number, or the future leaks into the past. **R4's `vintage_policy {overwrite|append_asof}` field is now load-bearing for the moat.** But the real axis is _immutable record vs revised aggregate_, not the pipeline's write mode: a recorded **sale**, a paid **NFIP claim**, an **issued permit** is its own point-in-time truth — it never revises, so even an `overwrite` table of immutable records is **clean** for backtest. Only revised **aggregates** (unemployment rate, OEWS wages, ACS estimates) need retained vintages. Uncomfortable corollary: `laus_lee_unemployment_rate` — the one slug currently feeding the forward flywheel — is among the **dirtiest** for backtest, while the clean corpus is the transaction-grain event data we don't yet grade. _(Irony: the bitemporal facet we cut from the Source-Contract spine is what the backtest needs — as one job's input, not a mandatory gate. "No to the spine" still holds.)_
2. **LLM hindsight.** The flywheel grades master's _conditional_ calls. The honest-but-cheap start grades only the **deterministic** directional/magnitude signal `resolveGradeConfig` already grades — no LLM, no prose, just (as-of-then baseline + window + polarity) vs. the known outcome → seeds `grade_accuracy_by_slug` with real N today. The rich version (re-run the master pack against a point-in-time lake snapshot) is the moat proper — defer until the cheap version proves the machinery.
3. **Survivorship — a mechanical gate, not a discipline note.** "Pre-register the event catalog" rots as prose. The guard: a **two-phase harness** — phase 1 enumerates the full event list from source data and writes it to a **committed, content-hashed manifest**; phase 2 (outcome lookup + grading) refuses to run unless pointed at a frozen manifest and **stamps that manifest's hash into every graded outcome**, so "the event was registered before its outcome was looked up" is provable after the fact, not promised. Enumeration must never read outcomes.

**Sequencing + the size-the-prize gate (operator, 2026-06-04).** `vintage_policy` does **not** exist in `cadence_registry` yet — it's one of R4's three additive fields — so it must be **populated before the sweep**, or payoff (c) below is empty and you don't know which slugs are clean. Populating it is not a field-add; it's a **per-source revision audit** (classify each pipeline immutable-record vs revised-aggregate, verified against each vendor's actual revision calendar — Vendor-First). That audit's by-product is the **count** that gates the whole track: clean corpus ≈ 8 slugs → the backward engine is a modest boost; ≈ 80 → a moat-builder. **Get the count before committing to Track B.** This makes the R4 +3 fields (or at least `vintage_policy`) a **pre-sweep dependency, not a parallel track.**

**Why this unifies with the row tier (not competes):** the Option-1 `resolveGradeConfig` sweep that partitions row/brain can, in the same pass, record per slug — (a) row vs brain, (b) the moat-fuel backlog (ungradeable _only_ for missing `direction_polarity`), and (c) **which slugs are backtestable (immutable-record / vintaged).** One sweep, three payoffs — but payoff (c) only lights up if `vintage_policy` was **populated before** the sweep (the pre-sweep dependency above); (a) and (b) come from `resolveGradeConfig` alone and don't wait on it.

---

## Acceptance criteria — the row-tier rules (R1–R4)

These graduate to enforced code (lint / default-branch / test) **in the same commit as the machinery they govern** — not pre-written into CLAUDE.md (our own "don't pre-write rotting markers" doctrine). R1 becomes Brain-Factory non-negotiable #9 the day the row-purity lint ships.

- **R1 — Row/brain boundary, at SLUG grain.** A materialized _metric_ is row-tier iff master never makes a falsifiable call keyed to its slug — executably, `resolveGradeConfig(slug).gradeable === false`. Rowness is **revocable**: the first time master makes a call on a row-slug it has become a brain — the drift event is "row-tier slug appears in `predictions` with non-null `gradeable_slug`" → retract the call or promote (add the PackDefinition).
- **R2 — Purity by construction, lint as backstop.** The row schema has **no narrative/claim field**, so a hedge is unexpressible. A net-new row-purity lint (sibling to `smoothing-lint`) is the backstop: a row carrying a directional/conditional/hedge claim fails and re-enters the brain gate. (Existing lints police brains only — confirmed.)
- **R3 — Content-hash is a cost lever, never safety.** Skip is the **success-only branch**: `skip IF (hash_known && fetch_ok && hash_equal) ELSE rebuild`. Never `rebuild IF hash_differs ELSE skip` (fails-closed-to-skip on error). A fetch exception → rebuild. Footgun: a hash match ≠ proof the source served current data (CDN/maintenance pages return byte-identical stale bodies) — pair with the existing etag/timestamp; hash alone never skips. Unit test pins "detector throws → rebuild."
- **R4 — `cadence_registry` new fields = declaration, not gate.** Three additive fields — `change_signal {timestamp|etag|content_hash}`, `vintage_policy {overwrite|append_asof}`, `repro_pointer {recipe_version, archival_url}` — **warn-only**, pinned by a regression test asserting the probe exits 0 when they are null. Promotion to gating is a per-dataset opt-in flag. If any probe/CI/GHA starts FAILING on a missing field, the rejected five-facet spine has been silently rebuilt → revert.

---

## Rule disposition (operator review + verification, 2026-06-03)

Eight candidate rules sorted by whether they govern code that exists **today**. The discipline: **a rule that isn't a test / hook / schema constraint is ceremony, and ceremony rots** — so lock-now items are mechanized, never written as prose. Lock-now items verified in-session against the live code.

| Rule                                                | Verdict                                        | Form / finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R4 — per-slug polarity, never inherited**         | 🔒 **Lock now**                                | Already the runtime behavior (`resolveGradeConfig` requires explicit `direction_polarity`; ungradeable if none → fails safe, never grades on a guessed sign). Lock = assertion in `check-vocab-coverage.mts` ("no gradeable slug inherits polarity") + extend to any future multi-metric vote. cre-swfl polarity-flip is the why.                                                                                                                                                                                                           |
| **R8 — no cross-project contamination**             | 🔒 **Lock now, as a hook**                     | ✅ Slot verified real: `.claude/settings.json` wires `PreToolUse:Bash` (`check-prepush-gate.mjs`) and `Edit\|Write` (PostToolUse `refinery-tsc.mjs`). New `.claude/hooks/check-project-path.mjs` on `PreToolUse:Edit\|Write` denies writes outside the brain-platform tree. **Not** a CLAUDE.md sentence.                                                                                                                                                                                                                                   |
| **R5 — scoring constants need a source**            | 🔧 **Improve, then lock**                      | Current code has dozens of uncited constants → can't lock "all" without lying day one. Scope to **net-new** + open a backfill sweep. Split _empirical_ (citation URL) from _design-choice_ (documented rationale) so nobody fakes a citation for an arbitrary pick.                                                                                                                                                                                                                                                                         |
| **R6 — citation honesty (no phantom provenance)**   | ✅ **FIXED 2026-06-03 (was a live-bug class)** | Shipped this session: `buildSourceCitationUrl` (`refinery/lib/citation-url.mts`) now branches on `env.source` — a fixture build returns a `synthetic fixture` sentinel string, never a live `/r/source/[table]` URL. Closes the phantom-provenance hole _through the existing Stage-4 fixture-sentinel gate_ (the sentinel hard-fails any live build that lifts it). Live mode byte-identical; 9 citation + 111 source tests green. The 2026-05-30 fixture-leak incident (`docs/superpowers/plans/2026-05-30-fixture-leak-fix`) is the why. |
| **R1 — row iff ungradeable**                        | ⏳ **Stays in the plan**                       | Governs the unbuilt row tier. Wording fixes (see Acceptance criteria): test _current_ state, not "never"; slug grain; revocable. Graduates to a guard the day the tier ships.                                                                                                                                                                                                                                                                                                                                                               |
| **R2 — purity by construction**                     | ⏳ **Stays in the plan**                       | Operator's cut is sharper than the original: rows may emit signed/computed _directional data_ (a MoM delta is a fact); only brain _claim_text_ is policed. Collapses the net-new lint to a **schema-shape assertion** (no free-text column; numeric/enum/identifier only). Cost win. Ships with the schema.                                                                                                                                                                                                                                 |
| **R3 — content-hash is a cost lever, never a gate** | ⏳ **Stays in the plan**                       | Latent — change detection is timestamp-only today, nothing to govern until P5. Locks as a unit test (`detector throws → rebuild`) when content-hashing ships.                                                                                                                                                                                                                                                                                                                                                                               |
| **R7 — `[INFERENCE]` machine-readable**             | ✅ **Already have prose ver.**                 | `inference-bait-lint` (Stage 4) + v3-rule-7 + the rules-of-engagement marker. Only net-new is a _structured_ `is_inference` field (a build item, not a rule). Skip or queue the field.                                                                                                                                                                                                                                                                                                                                                      |

**Lock-now batch** (the genuine mechanizable items, `HANDOFF.md` Step 0): R8 hook + R4 assertion + CLAUDE.md C1/C2. **R6 already shipped this session** (one fewer). Do **not** lock R1/R2/R3 into CLAUDE.md — that recreates the rotting-marker drift Phase 0 just cleaned out.

---

## Build phases (Opus 🔴 / Sonnet 🔵 / Explore ⚪)

**Heuristic:** ⚪ read-only sweeps · 🔵 implementation to a written spec (lints, migrations, tests, parsers) · 🔴 architecture, schema/classifier semantics, spec authoring, adversarial refutation, gates, safety-class review.

- **P1 — Policy + ledger** 🔴 — land the two durable-now CLAUDE.md lines (working agreement + standing refusal); open `checks` T1/T2/row-tier. _(trivial)_
- **P2 — Classifier sweep + spec + refutation** 🔴 — run `resolveGradeConfig` across the lake → row/brain partition + moat-fuel backlog; author this spec's detail; a second Opus agent tries to kill it before it's blessed. _(medium)_
- **P3 — Catalog: extend `cadence_registry`** 🔵 (Opus diff-review) — 3 additive fields + R4 guard test + recipe-version stamp into `_tier1_inventory`/`_dlt_loads`. _(low–med)_
- **P4 — Row tier** 🔴 schema (no narrative field) + classifier wiring; 🔵 row-purity lint + materialization (precomputed artifact, disk choke point) + migration. _(med–high — the real project)_
- **P5 — Change-detection cost lever (R3)** 🔵 (Opus safety review) — content-hash skip, success-only branch, test. _(low)_
- **P6 — Rollout: parity window** 🔵 diff harness; 🔴 adjudication — shadow-materialize, diff row-value vs brain-value, parity miss → `checks` row → adjudicate → retire on N periods of observed prod parity (closed on prod evidence, never "code looks right"). _(low–med, weeks of wall-clock)_

Opus is ~20–25% of spend (P1, P2, reviews); P3–P6 are Sonnet-heavy by construction — which is _why_ P2's spec must be tight.

---

## Deferred tripwires (do NOT build; reopen only if triggered)

These live in the `checks` ledger, not here:

- **T1 — transitive invalidation** (`dag.mts:64` `walkConsumers` exists, only the auto-invalidation caller is unwired). Reopen ONLY if nightly full-DAG-walk rebuild is abandoned for incremental.
- **T2 — tenancy seam at the payload-assembly edge, NOT Postgres RLS.** Reopen ONLY when the asset-management multi-client brain un-parks. Bigger than one file: the MCP/brain choke point is clean, but UI/embed side-channels (`/r/source`, `/r/cre-swfl`, `/embed/*`) read Postgres directly and the MCP `auth.ts` gate is a live no-op stub — all need scoping too.

---

## Standing refusal (the non-rule that IS the lesson)

> Don't erect a mandatory pre-materialization gate; extend the enforced artifact you already have.

**Scope (operator clarification 2026-06-03):** this refusal covers **data-pipeline gates and mandatory pre-materialization schema constraints** — the machinery that turns sources into the lake. It does **not** cover the agent's own behavioral guardrails (the R8 path-guard hook, hook enforcement); those gate Claude's behavior, not the materialization path, and are explicitly in-bounds. Without this carve-out the refusal reads as prohibiting the one mechanical enforcement we agreed must land now — so C2 and the R8 hook ship in the **same commit**.

The five-facet "Source Contract as spine" was rejected on evidence (dbt warns against early bundled governance; ODCS is descriptive, not a gate; GoCardless ran the contract _alongside_ a precomputed layer with observability/lineage deferred). The interface seam we already have (consumption contract, BrainOutput + spec-validator, the 4 lints, the brain-first ingest gate); the source side is `cadence_registry`, 60% there. Extend it. R4 is this refusal's operational tripwire.

---

## Open decision — build-priority fork (operator choosing 2026-06-03)

The fork is now **Track A — full classifier sweep / audit** vs **Track B — flywheel backward-engine** — and the Phase-0 reframe shows they share a spine: the Option-1 `resolveGradeConfig` sweep that partitions row/brain _also_ yields the moat-fuel backlog and the backtestable-slug inventory (§ two engines). So Track A's sweep is the on-ramp to Track B; it isn't either/or at the foundation.

**Recommended sequence:** Step 0 lock-now batch (R8 hook + R4 assertion + R6 guard + CLAUDE.md C1/C2) → Track A's sweep → decide how far to push Track B. Runnable directions for an Opus on either track: `HANDOFF.md`.
