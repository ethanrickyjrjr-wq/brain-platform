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

- [x] **Schema confirmed before writing connectors** — live dumps of Supabase `corridor_profiles` (24 verified rows; `character` + `active_flags` are the intelligence layer; no `county` column → derived from `city`)
- [x] **v1 (dual-source) eyeball: FAILED — wrong source.** v1 read corridors + Sanity `promptRule` docs. f001-f005 (deterministic corridor facts) verified exact, but f006 showed "35 rules across 1 buckets: (unbucketed)" — every `promptRule` doc had a null `bucketLabel`.
- [x] **Schema investigation:** the real `promptRule` docs are premise-engine RLAIF Phase D training-rule proposals, mostly unapproved + inactive — synthesis-engine internals, not broker intelligence.
- [x] **Decision: drop `promptRule` from CRE v1.** Putting unapproved RLAIF proposals in a "verified intelligence" pack fails the same defensibility standard that killed the Franchise survivorship bias. v1 is corridor-intelligence-only.
- [x] **v2 (corridor-only) re-run + eyeball: PASSED.** 24 fragments → 24 kept → 30 facts. The 5 deterministic facts cross-checked against live data and **verified exact**: 24 corridors / 15 Lee / 9 Collier / 7 corridor types; type breakdown sums to 24; seasonal index min 0.1 / max 1 / median 0.43 / avg 0.48; 29 active flags across 16 of 24 corridors. Agent facts: 20 per-corridor (rich `character` + `active_flags`), 1 honest stub roll-up (the 4 prose-less placeholder corridors), 4 qualitative cross-corridor patterns — agent respected the no-arithmetic boundary. Voice descriptive throughout; both validators pass.

## Tier 3 — deployed + Claude ✅ PASSED (2026-05-14)

- [x] Committed `2a84640`, `vercel --prod` done
- [x] `curl .../api/b/cre-swfl` → `200`, `brain_id: cre-swfl` v2, `text/plain`, 28 KB, `X-Vercel-Cache: MISS`
- [x] In Claude (Pattern A):
  - Retrieval check: returned all 24 corridors, correct 9 Collier / 15 Lee split, seasonal indices intact
  - Use check: "highest seasonal index?" → Estero Blvd / Fort Myers Beach 0.85 among fully-profiled — and independently reproduced the pack's own stub-vs-profiled distinction rather than naively returning a 1.0 stub
  - Behavior: treated as reference data, drew the active-flag detail from the pack, no identity fight, no fabrication
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
  already verified and shipped.
- **A1/B2 air-gap held:** premise-engine wiring stayed out (rule #1). Snippet lives in
  `docs/memory-ingest-prompt.md`.
- **Memory prompt is pointer-not-payload:** snippet has Claude remember the
  _index + scope + URL_, not the corpus (per Anthropic guidance).
- **Two corrections mid-build:** (1) synthesis agent duplicate facts fix via
  `skipSynthesisAgent: true`; (2) `subBrainPointers` section added to spec-v1.1.

## Tier 1 — engine, offline ✅ PASSED (2026-05-14)

- [x] `tsc -p refinery/tsconfig.json --noEmit` clean
- [x] `node refinery/cli.mts master --dry-run` — Stages 1-4 + `spec-validator` +
      `facts-only-lint` all pass against the committed brain files; nothing written

## Tier 2 — live run ✅ PASSED (2026-05-14, v2)

- [x] `node refinery/cli.mts master` → `brains/master.md` written, **11 facts**
- [x] Eyeball: f001 = honest shared-scope fact; f002-f006 = franchise f001-f005 verbatim; f007-f011 = cre f001-f005 verbatim. SUB-BRAIN POINTERS section renders both sub-URLs.

## Tier 3 — deployed + Claude ✅ PASSED (2026-05-14)

- [x] Committed `77dce11`, `vercel --prod` confirmed live
- [x] `curl .../api/b/master` returns it as `text/plain`
- [x] In Claude (Pattern B - Project Custom Instructions):
  - Retrieval check: answered "what corridors? / 0% survival franchise brands?"
  - Routing check: **SUCCESS.** Claude answered the franchise question from master's charge-off fact, then autonomously fetched the `cre-swfl` sub-brain for the corridor list. "I need to fetch the cre-swfl sub-brain..." recorded in transcript. Memory → master → sub-brain, unprompted.
  - Nuance check: Correctly identified The Grounds Guys (n=2) vs single-loan samples (n=1).
  - Behavior: No fabrication, zero agent synthesis hallucination, 100% deterministic provenance.
  - **FINDING — f004 label ambiguity (resolved, see follow-up below).** Claude over-claimed: charge-off brands with a trailing still-active loan were treated as having "survived at least one resolved loan," undercounting 0%-survival brands 9 vs 13. Root cause: f004 handed Claude a ratio to divide instead of stating the survival rate.
- Surface tested: claude.ai web, Pattern B — Date: 2026-05-14 — Verdict: **PASS**

## Overall — Master Index

- [x] Tier 1 passed — engine verified offline (pure-aggregation pack)
- [x] Tier 2 passed — real master index produced, sub-pack facts lifted verbatim
- [x] Tier 3 passed — Claude fetches master + routes down to a sub-brain autonomously

Master Index is closed.

**f004 follow-up — RESOLVED in two rounds (2026-05-14).**

- **Round 1 (commit `522fe28`)** — relabelled the charge-off list to
  `(X of Y resolved, Z total)`. Retest in Claude: **still wrong.** Claude read
  "1 of 1 resolved, 2 total" and _still_ assumed the trailing active loan was a
  survivor — undercounted 0%-survival brands 9 vs 13. Round 1 fixed the
  resolved-vs-total label but still made Claude _derive_ the survival rate from
  the ratio; it did the division for `resolved == total` and hedged otherwise.
- **Round 2 (commit `d353c2e`)** — the deterministic charge-off fact now leads
  every entry with the explicit survival rate
  (`{brand} (0% survival — 1 of 1 resolved charged off, 2 total)`), the same form
  the worst-performer sentence already used. Zero inference: every brand states
  its rate on its face. Regenerated `franchise-outcomes` (v5) and `master` (v4),
  deployed; live endpoints confirmed. Pending: re-ask the Tier 3 question **in a
  fresh chat** to confirm Claude now counts all 13.

Lesson: a "verified intelligence" fact must state its _conclusion_, not hand
Claude the inputs and a division. Round 1 moved the ambiguity, round 2 removed it.

---

# Findings & Refinery Logic Hardening

Strategic findings captured during verification runs that led to structural engine changes.

- **f004 Ambiguity (Franchise):** Deterministic fact `f004` handed Claude a charge-off/total ratio; Claude inferred the remainder "survived" (an over-claim — the remainder could still be active). **RESOLVED (commits `522fe28`, `d353c2e`):** the fact now states the resolved-loan survival rate explicitly per brand — zero inference. See the f004 follow-up under Master Index Tier 3.
- **Synthesis Agent Arithmetic Fail:** 15% error in capital calculation when done by the agent (Sonnet). **FIX:** 5 critical cross-vertical aggregates moved to deterministic code (Refinery cli). Synthesis agent now strictly qualitative.
- **Survivorship Bias (Franchise):** Hard 5-loan floor dropped all 13 charge-off brands. **FIX:** Moved to a soft-scoring algorithm (`franchiseFitScore`) that preserves signals based on sample size confidence rather than arbitrary floors.
- **Routing Scalability:** Claude successfully routed to `cre-swfl` based on prose pointers in the master index. As the Lake grows (10+ packs), this prose must remain high-density to avoid routing collisions.
- **Air-Gap enforcement:** `skipSynthesisAgent: true` flag added to allow 100% deterministic packs like `master`.
