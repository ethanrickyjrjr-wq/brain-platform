# Phase 1 Test Results — Refinery v1 + Franchise Outcomes pack

Verification runs the three tiers from the plan. Tier 1 is offline (no credentials);
Tiers 2-3 need credentials and are the human's to run.

---

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

## Tier 3 — deployed + Claude (the seaworthy gate) ⏳ PENDING

- [ ] Commit `brains/franchise-outcomes.md`, `vercel --prod`
- [ ] `curl https://brain-platform-amber.vercel.app/api/b/franchise-outcomes` returns it as `text/plain`
- [ ] In Claude (Pattern A then B, per `docs/invocation-patterns.md`):
  - Retrieval check: "what franchise brands are in my saved reference and their outcome rates?"
  - Use check: "which brands have the strongest SBA survival rates in SWFL?"
  - PASS = answers from the pack, cites `s01`, treats it as reference data, no identity fight
- [ ] Surface tested: \***\*\_\_\_\_\*\*** Date: \***\*\_\_\_\_\*\*** Verdict: \***\*\_\_\_\_\*\***

---

## Overall

- [x] Tier 1 passed — engine verified offline
- [ ] Tier 2 passed — real pack produced
- [ ] Tier 3 passed — **seaworthy gate**: Claude fetches + uses the real Franchise pack

Once Tier 3 passes, Phase 1's Franchise milestone is closed and the CRE pack
(plan step 7) is next.
