# Phase 1 Test Results — Refinery v1 + Franchise Outcomes & CRE packs

Verification runs the three tiers from the plan. Tier 1 is offline (no credentials);
Tiers 2-3 need credentials and are the human's to run.

---

# Franchise Outcomes pack — `franchise-outcomes`

## Tier 1 — engine, offline, no credentials ✅ PASSED (2026-05-14)

> Re-confirmed 2026-05-14 after `franchise-source.mts` was reworked: live-mode
> `INGEST_QUERY` drafted, `fetch()` returns proper `RawFragment[]`, and a
> null-survival bug in `normalize()` was fixed (`null` survival_rate stayed
> `null` instead of collapsing to `0`). Pipeline output unchanged — 15 → 11
> kept / 4 dropped — and all checks below still pass.

| Check                                                                                                                | Result                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `tsc -p refinery/tsconfig.json --noEmit`                                                                             | ✅ clean                                                                                               |
| Root `tsc --noEmit` (Next app unaffected)                                                                            | ✅ clean                                                                                               |
| Full pipeline on `__fixtures__/franchise-outcomes.sample.json` (`REFINERY_SOURCE=fixture`, mock agents, `--dry-run`) | ✅ ran clean                                                                                           |
| Stage 1 ingest                                                                                                       | ✅ 15 fragments from fixture                                                                           |
| Stage 2 pack-fit filter                                                                                              | ✅ 4 dropped (3 below 5-loan floor, 1 null survival_rate), 11 kept                                     |
| Stage 2 composite cutoff                                                                                             | ✅ 0 dropped (all survivors well above cutoff)                                                         |
| Stage 3 synthesis                                                                                                    | ✅ 11 facts, composite-ordered (Subway n=47 → f001)                                                    |
| Stage 4 render → spec-v1.1 Master Index                                                                              | ✅ frontmatter complete, no `authority`/`identity`, one fenced `reference` block, all sections present |
| `spec-validator` on good output                                                                                      | ✅ passes                                                                                              |
| `facts-only-lint` on good output                                                                                     | ✅ zero violations                                                                                     |
| `spec-validator` negative test                                                                                       | ✅ caught 7 errors (missing keys, forbidden `authority`+`identity`, missing reference block)           |
| `facts-only-lint` negative test                                                                                      | ✅ caught second-person directive + "from now on"                                                      |

**Verdict:** the engine, renderer, validators, and pack-fit scoring all work. The
wiring is proven. Output in mock mode is shape-valid and spec-valid but not real
intelligence — that's expected; real intelligence comes from Tier 2.

---

## Tier 2 — live pipeline ✅ PASSED (2026-05-14, v3)

Run: `node refinery/cli.mts franchise-outcomes` — `brains/franchise-outcomes.md` at v3.

- [x] `SUPABASE_URL` + key set; live RPC `get_franchise_outcomes_aggregated` returns 275 franchises
- [x] **Schema confirmed (Risk #1):** RPC columns map to `normalize()` with **zero changes** — the fixture-vs-live name handling (`n_chargeoffs`/`total_approved`) absorbed the real shape; `jobs_supported` absent → 0 (safe). `survival_rate` confirmed resolved-loan denominator.
- [x] `ANTHROPIC_API_KEY` set; real Haiku triage + Sonnet synthesis ran
- [x] `brains/franchise-outcomes.md` written, passed both validators (spec + facts-only)
- [x] **v1 eyeball: FAILED — survivorship bias.** `MIN_FRANCHISE_LOANS = 5` hard-drop kept only 6 of 275; all 13 charge-off brands have 1-3 loans → filter dropped 100% of the failure signal. Plus the synthesis agent conflated `n_loans` (total) with "resolved loans".
- [x] **v2 rework (soft-score + corpus header + prompt fix):** `franchiseFitScore` now soft-scores — keeps all 137 brands with resolved-loan data, scales score by sample-size confidence, hard-drops only null-survival. Deterministic `corpusSummary` prepends an exact corpus header fact. Synthesis prompt tightened (n_loans vs resolved, name every charge-off brand, roll up the tail). Re-ran → v2 written, 137 kept, 31 facts.
- [x] **v2 eyeball: structural fixes all confirmed** — no survivorship bias, n_loans/resolved distinction correct throughout, all 13 charge-off brands named individually (incl. The Grounds Guys 2/2 charged off — the exact failure signal v1 hid), deterministic f001 header verified correct (275/137/138/13).
- [x] **v2 eyeball: FINDING — agent-computed aggregates unreliable.** f004 claimed "$194,010,400 total approved capital"; the real sum is **$169,095,700** — a ~15% hallucinated figure. LLM arithmetic across 137 rows is not trustworthy for a verified-intelligence product.
- [x] **v3 rework (deterministic aggregates):** `corpusSummary` now returns `SynthesisFact[]` — **5 deterministic facts** computed in code: corpus overview, total approved capital, charge-off summary (named + worst performer + total loans charged off), strong-performer shortlist (≥3 resolved, 0 charge-offs), median survival rate. Synthesis prompt + `SYSTEM_INSTRUCTIONS` forbid the agent from computing any numeric aggregate — it owns per-brand framing + qualitative roll-ups only. Re-ran → v3, 40 facts (5 deterministic + 35 agent).
- [x] **v3 eyeball: PASSED.** All 5 deterministic facts cross-checked against the RPC and **verified exact**: 275/137/138/13 brands; $169,095,700 / $310,519,600 capital; 13 charge-off brands / 14 loans charged off / worst = The Grounds Guys 0%; 7 strong performers (exact list match); median 100% (13 below / 124 at 100%). Agent facts: n_loans/resolved distinction correct throughout; f009/f010 are qualitative roll-ups — the agent respected the no-arithmetic boundary.

**Verdict:** the pipeline is proven and the pack is quality-shippable — no survivorship bias, every charge-off brand named, every numeric aggregate deterministic and verified exact. Proceed to Tier 3.

---

## Tier 3 — deployed + Claude (the seaworthy gate) ✅ PASSED (2026-05-14)

- [x] Committed `brains/franchise-outcomes.md` (`52be6f6`); `vercel --prod` done (the `cre-swfl` deploy ships the whole repo, so this pack is live too)
- [x] Endpoint live — confirmed indirectly: Claude successfully fetched `/api/b/franchise-outcomes` in the test below
- [x] In Claude (Pattern A):
  - Use check: "which brands have the strongest SBA survival rates in my saved reference?" → returned the f004 strong-performers shortlist (7 brands — matches the Tier 2 exact-list verification), with resolved/total loan counts + gross approval per the user's stated preference; cited the f005 median (100%, 124 of 137 assessable)
  - Behavior: answered from the pack, treated it as reference data, respected `n_loans` vs resolved throughout, no identity fight, no fabrication
  - Minor **Claude-side** slip (not a pack defect): claimed only SkyZone + Jet's Pizza were fully resolved (3/3); Tropical Smoothie 4/4 is also fully resolved. Pack data was correct; the testing model's downstream arithmetic missed one.
- Surface tested: claude.ai web, Pattern A — Date: 2026-05-14 — Verdict: **PASS**

---

## Overall

- [x] Tier 1 passed — engine verified offline
- [x] Tier 2 passed — real pack produced
- [x] Tier 3 passed — **seaworthy gate**: Claude fetches + uses the real Franchise pack

Phase 1's Franchise milestone is closed.

---

# CRE pack — `cre-swfl`

Second vertical. Same engine, new source connector — proves the Refinery is
pack-agnostic. Built corridor-intelligence-only (see Tier 2).

## Tier 1 — engine, offline, no credentials ✅ PASSED (2026-05-14)

- [x] Synthetic fixtures captured to match the live schemas (`corridor-profiles.sample.json`)
- [x] `tsc -p refinery/tsconfig.json --noEmit` clean
- [x] Fixture-mode pipeline ran clean end-to-end; `spec-validator` + `facts-only-lint` pass on output

## Tier 2 — live pipeline ✅ PASSED (2026-05-14, v2)

Run: `node refinery/cli.mts cre-swfl` — `brains/cre-swfl.md` at v2.

- [x] **Schema confirmed before writing connectors** — live dumps of Supabase `corridor_profiles` (24 verified rows; `character` + `active_flags` are the intelligence layer; no `county` column → derived from `city`) and Sanity `lpyl3q9w`.
- [x] **v1 (dual-source) eyeball: FAILED — wrong source.** v1 read corridors + Sanity `promptRule` docs. f001-f005 (deterministic corridor facts) verified exact, but f006 showed "35 rules across 1 buckets: (unbucketed)" — every `promptRule` doc had a null `bucketLabel`.
- [x] **Schema investigation:** the real `promptRule` docs are nothing like the build assumption — no `bucketLabel`, `ruleText` not `promptText`, `appliesTo` is an RLAIF agent role ("Student"/"Grader") not a corridor type, plus `runId` / `approvedByRicky` / `active` / `confidence` / `evidenceCount`. They are **premise-engine RLAIF Phase D training-rule proposals**, mostly unapproved + inactive — synthesis-engine internals, not broker intelligence.
- [x] **Decision: drop `promptRule` from CRE v1.** Putting unapproved RLAIF proposals in a "verified intelligence" pack fails the same defensibility standard that killed the Franchise survivorship bias. v1 is corridor-intelligence-only; the Sanity client (`sanity.mts`) is kept for a future real Sanity source.
- [x] **v2 (corridor-only) re-run + eyeball: PASSED.** 24 fragments → 24 kept → 30 facts. The 5 deterministic facts cross-checked against live data and **verified exact**: 24 corridors / 15 Lee / 9 Collier / 7 corridor types; type breakdown sums to 24; seasonal index min 0.1 / max 1 / median 0.43 / avg 0.48; 29 active flags across 16 of 24 corridors. Agent facts: 20 per-corridor (rich `character` + `active_flags`), 1 honest stub roll-up (the 4 prose-less placeholder corridors), 4 qualitative cross-corridor patterns — agent respected the no-arithmetic boundary. Voice descriptive throughout; both validators pass.

## Tier 3 — deployed + Claude ✅ PASSED (2026-05-14)

- [x] Committed `2a84640`, `vercel --prod`
- [x] `curl .../api/b/cre-swfl` → `200`, `brain_id: cre-swfl` v2, `text/plain`, 28 KB, `X-Vercel-Cache: MISS`
- [x] In Claude (Pattern A — note: the Phase 0 Pattern B project was still wired to `test-alpha`; testing surfaced this. Pattern B retest = repoint that project's custom instructions):
  - Retrieval check: returned all 24 corridors, correct 9 Collier / 15 Lee split, seasonal indices intact
  - Use check: "highest seasonal index?" → Estero Blvd / Fort Myers Beach 0.85 among fully-profiled — and independently reproduced the pack's own stub-vs-profiled distinction rather than naively returning a 1.0 stub
  - Behavior: treated as reference data, drew the active-flag detail from the pack, no identity fight, no fabrication, no `BRAIN-OK` marker (correct — production pack)
- Surface tested: claude.ai web, Pattern A — Date: 2026-05-14 — Verdict: **PASS**

## Overall — CRE

- [x] Tier 1 passed — engine verified offline (pack-agnostic confirmed)
- [x] Tier 2 passed — real corridor-only pack produced, deterministic facts verified exact
- [x] Tier 3 passed — Claude fetches + uses the real CRE pack

---

# Phase 1 status

- **Franchise Outcomes:** Tier 1 ✅ · Tier 2 ✅ · Tier 3 ✅ — **closed**
- **CRE (cre-swfl):** Tier 1 ✅ · Tier 2 ✅ · Tier 3 ✅ — **closed**
- **Master Index (master):** Tier 1 ✅ · Tier 2 ✅ · Tier 3 ✅ — **closed** (see Master Index section below)

Both vertical packs and the master index are seaworthy. Phase 1 is complete — the
Refinery engine is proven pack-agnostic, both vertical packs are deployed and
verified in Claude, and the master index routes down the tree autonomously.

---

# Master Index — `master`

The "brain of brains" — a Refinery-produced pack that aggregates the two
verified vertical packs into one fetchable index. Proves the engine handles a
pure-aggregation pack: zero live sources, zero LLM synthesis.

## Build notes

- **master-source.mts** parses the committed `brains/franchise-outcomes.md` +
  `brains/cre-swfl.md` and lifts each pack's deterministic f001-f005 corpus
  facts verbatim. No external APIs, no credentials — it indexes only what is
  already verified and shipped. The committed brain files _are_ the fixture.
- **A1/B2 air-gap held:** the updated `/build` task's STEP 2 (wire the PowerPad
  component inside `premise-engine`) was refused — premise-engine is a separate
  repo (CLAUDE.md rule #1). The canonical ingest snippet lives in
  `docs/memory-ingest-prompt.md` as the producer/consumer bridge instead.
- **Memory prompt is pointer-not-payload:** per Anthropic's published memory
  guidance (detailed data belongs in reference docs, not memory), the snippet
  has Claude remember the _index + scope + URL_, not the corpus.
- **Two corrections mid-build:** (1) the synthesis agent ignored a "return
  empty facts" prompt and produced 9 duplicate facts — fixed deterministically
  with a new `skipSynthesisAgent` pack flag (the master pack runs no synthesis
  agent at all); (2) `subBrainPointers` added as an optional `PackDefinition`
  field + renderer section, implementing the spec-v1.1 SUB-BRAIN POINTERS
  section (omitted for single-vertical packs).

## Tier 1 — engine, offline ✅ PASSED (2026-05-14)

- [x] `tsc -p refinery/tsconfig.json --noEmit` clean
- [x] `node refinery/cli.mts master --dry-run` — Stages 1-4 + `spec-validator` +
      `facts-only-lint` all pass against the committed brain files; nothing written

## Tier 2 — live run ✅ PASSED (2026-05-14, v2)

- [x] `node refinery/cli.mts master` → `brains/master.md` written, **11 facts**
- [x] Eyeball: f001 = honest shared-scope fact, explicitly states there is **no
      record-level join** (no fabricated cross-vertical links); f002-f006 =
      franchise f001-f005 verbatim → cite s01; f007-f011 = cre f001-f005 verbatim →
      cite s02. Citation table points at both sub-pack Brain URLs; SUB-BRAIN
      POINTERS section renders both. Zero agent facts.

## Tier 3 — deployed + Claude ✅ PASSED (2026-05-14)

- [x] Committed + pushed; deploy ships `brains/master.md`
- [x] Endpoint live — confirmed indirectly: Claude fetched `/api/b/master` and `/api/b/cre-swfl` in the test below
- [x] In Claude (Pattern A): asked one cross-vertical question — "what corridors do we have tracked in the CRE pack, and which franchise brands have a 0% survival rate?"
  - **Tree routing works autonomously.** Claude had master loaded, answered the franchise half from the master's deterministic charge-off fact (f004), and recognized on its own that corridor _names_ aren't in the master — "the master only shows aggregate stats — I need to fetch the cre-swfl sub-brain." Memory → master → sub-brain, unprompted.
  - Returned all 24 corridors with type + seasonal index, correctly flagged the 4 stub registry entries; derived 9 brands at 0% survival from the f004 ratios and preserved the sample-size nuance (only The Grounds Guys has n>1).
  - Behavior: provenance on every line, no arithmetic hallucination (read ratios, didn't recompute), no identity fight.
  - **FINDING (not a Claude defect) — f004 label ambiguity.** Claude said the other 12 charge-off brands "survived at least one resolved loan." Over-claim: f004 labels the ratio "loans charged off / **total** loans", but total ≠ resolved (the core Phase 1 distinction). A 1/2 brand could have one charged off + one still **active** — not a survivor. Fix is in the Refinery's deterministic charge-off fact: label it "/ resolved loans" or carry both counts explicitly. The data must be unambiguous before it reaches Claude, because Claude reasons off the label.
- Surface tested: claude.ai web, Pattern A — Date: 2026-05-14 — Verdict: **PASS**

## Overall — Master Index

- [x] Tier 1 passed — engine verified offline (pure-aggregation pack)
- [x] Tier 2 passed — real master index produced, sub-pack facts lifted verbatim
- [x] Tier 3 passed — Claude fetches master + routes down to a sub-brain autonomously

Master Index is closed.

**f004 follow-up — RESOLVED (2026-05-14, commit `522fe28`).** The deterministic
charge-off fact now lists every brand as `(X of Y resolved, Z total)` — the same
self-describing format f005 uses — so the resolved-vs-total distinction is on the
face of the fact, not inferred. Regenerated `franchise-outcomes` (v4) and `master`
(v3), deployed; live endpoint confirmed serving the new format. Pending: re-ask
the Tier 3 question in Claude to confirm the over-claim is gone.
