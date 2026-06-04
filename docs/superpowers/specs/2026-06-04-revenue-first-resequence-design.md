# Revenue-First Re-Sequence — design (decision record)

**Filed:** 2026-06-04 · **Status:** blessed by operator 2026-06-04, corrections incorporated.
**Supersedes the build-PRIORITY of** `docs/superpowers/plans/2026-06-03-row-tier/` (the Track-A "row-tier next" ordering). **Architecture is unchanged**; the build ORDER flips to revenue-first.
**Origin:** first-principles + full-GTM review (2026-06-04) — 6 web-research strands + 5 adversarial audits + live-DB verification + repo surface-map. Operator independently verified every code premise against the live repo.

> Brief, not a status board. Open obligations live in the `checks` ledger (RULE 2), never as `⬜/✅` markers here. Verify done-ness against `git` + code.

---

## Verdict

Architecture is sound and **survives adversarial refutation**; the build ORDER was wrong for the stated goal ("a must-have for SWFL business people"). All five audits returned `re-sequence`.

**Caveat on that signal (do not over-weight it):** five LLM auditors share training priors — correlated reasoning, not five independent witnesses. The weight is in the **code-verified findings**, not the unanimity:

- `app/api/mcp/auth.ts` is a documented no-op stub; zero `stripe/checkout/billing/paywall` code anywhere → **no way to take a dollar.**
- No `app/sitemap.ts` / `app/robots.ts`; `/r/[slug]` is `export const dynamic = "force-dynamic"` with no `generateStaticParams` → **report pages are undiscoverable by crawlers.**
- `refinery/lib/derived/corridor-factor.mts` does not exist (spec'd only in `docs/ontology-and-roadmap.md`) → the cheapest RED-goal mover is unbuilt.
- **Zero row-tier consumer in code;** the tier answers no query `detail_tables` + `swfl_fetch zip=` don't already serve.
- Live DB: the 6 "gradeable" predictions are **all one slug** (`laus_lee_unemployment_rate`), **one direction** (bearish), the dirtiest-for-backtest series; `metric_observations` holds **4 days** of snapshots → the clean corpus lives in raw source tables the grader never reads.
- ~~`last_sale_amount` is NULL across `leepa_parcels`~~ **CORRECTED 2026-06-04 (live source + DB verify):** `last_sale_amount` is **populated on 528,130 / 548,798 parcels** — source ArcGIS Layer 10 returns currency strings (`$245,000.00`) and `coerce_float` parses them; the earlier "NULL" reads were a false alarm (sampling the 20,668 genuinely-saleless parcels, or the PostgREST 1000-row cap). Property-VALUE retrodiction is out of scope by **feasibility** (one row per parcel = latest sale only → no repeat-sales index without ATTOM / FL-DOR-SDF), **not** absence of data. Sale-velocity/volume signal is rich.

Competitive urgency (disruption radar): ATTOM national MCP (Jan 2026) and Cotality MCP (Mar 2026) cover Lee/Collier parcels; Shovels.ai covers SWFL permits with its own AI agent. **Raw parcel/permit data is no longer a moat** — the defensible layer is the cross-domain synthesis + local-exclusive data (flood AAL, TDT, corridor absorption) + a scored history that is calendar-gated, not code-gated.

---

## The re-sequence

| #   | Move                                                                                                                                                                                                                 | Owner              | Gate                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| 0   | Renew GSC domain verification — **confirm the date in Search Console first**, then execute                                                                                                                           | operator, today    | irreversible; expires 2026-06-05                                                         |
| 1   | `app/sitemap.ts` + `app/robots.ts` (+ force-dynamic recommendation) — justified as **crawlability, NOT JSON-LD theory**                                                                                              | agent (running)    | diff review before push                                                                  |
| 2   | **Willingness-to-pay test = the keystone:** one-function bearer gate in `auth.ts` + a $39–79 page on the _existing_ housing-swfl ZIP-drill + env-swfl flood AAL → one LCAR/NABOR demo                                | next               | operator go (money/auth surface)                                                         |
| 3   | **Sweep stays IN scope:** 1a polarity-gate tighten (live-correctness) + column 3 (Track-B input). Only the row-tier _schema/P4_ defers behind a NAMED consumer                                                       | ready              | 1a: diff before merge; per-metric polarity audit                                         |
| 4   | `corridor-factor` 0–100 derived composite — cheapest RED-goal mover                                                                                                                                                  | agent (running)    | diff review (output-math)                                                                |
| 5   | Ian study — pre-registered, honestly-captioned **content/demo** (not proof)                                                                                                                                          | gated              | operator blessing + price-scope + live-lake column check; follows the sales conversation |
| 6   | Row-tier README: **label swap** (Databricks/governed-gold → "precomputed fact artifact") + size-cap (ZIP/county grain, no full row dumps through the disk choke point) + ledger reconcile only — **no prose polish** | small              | —                                                                                        |
| —   | Generalized two-engine flywheel harness                                                                                                                                                                              | **HELD** (correct) | settle decision function + skill baseline first                                          |

---

## Hard boundaries on the Ian study (gated; not fired)

- **Ian EXERCISES the deterministic decision function end-to-end on ONE event.** It does **not** settle the skill baseline — a single event cannot; the baseline stays **UNSETTLED until N grows.** The HOLD stays **HELD**; **Ian does not lift it.** Honestly captioned: _illustrative demonstration, N≈1–2 families, not a skill score._ Never "moat proof."
- **TRIPWIRE 1 — reusable machinery:** if the build reaches for a reusable replay harness, a content-hashed event manifest, or look-ahead scaffolding that generalizes to N events → **STOP**, that is the held scope.
- **TRIPWIRE 2 — vintage (per source):** as-of-then replay needs point-in-time vintage per source. **Hard-code the Ian-spanning sources + their vintages for this one event.** If the agent reaches for a generalized vintage resolver or an event manifest → that IS the held scaffolding → **STOP.**
- **PRICE-SCOPE LOCK:** outcomes = **TDT collections + LeePA sale-velocity/volume ONLY, never property value.** Pre-registration must verify those columns exist with Ian-spanning depth against the **live lake** before locking outcomes. (The `leepa-no-sale-price` memory is now **reconciled** — price IS present, 528k rows; sale-velocity/volume stays the chosen outcome on **repeat-sales-feasibility** grounds, not data absence.)
- **Pre-registration** (event / outcome slugs / counterfactual via FHFA synthetic-control method, which absorbs the concurrent COVID run-up confounder / persistence null / per-outcome scoring rule — Brier binary, CRPS continuous) is written and **frozen before any outcome is looked at.**

---

## Sweep — stays in scope (do NOT defer it with the materialization)

- **1a polarity-gate tighten** = a live-CORRECTNESS fix (closes the out-of-enum `"neutral"` hole that can reach `gradeable:true` with a garbage polarity), independent of the re-sequence. **Diff to operator before merge; audit EACH affected metric's polarity individually — do not assume the existing pattern transfers** (cre-swfl inversion lesson).
- **Column 3** (backtestable inventory) = the only input Track B needs; keep it.
- **Defer only** the row-tier SCHEMA / P4 materialization, behind a NAMED consumer.

---

## C1 — stays `DEBT`

The row-tier web-refutation survived (4 primary sources: Matterbeam medallion critique, Tobiko/dbt-contract critique, GoCardless implementation, Zircote enforcement audit — row tier is small-team-optimal; R2 purity-by-construction is _ahead of_ dbt model contracts). **But surviving an LLM refutation is not a discharge, and the tier is deferred regardless.** Ledger stays `DEBT`; the in-session primary-source fetch that formally discharges C1 happens **when P4 un-defers** — cheap then, premature now.

---

## Indexing — crawlability, not AEO theory

Build sitemap/robots because **force-dynamic pages absent from a sitemap can't be discovered at all.** The JSON-LD "no citation uplift" study is a **relayed, in-session-UNVERIFIED imported best-practice** (RULE 3/C1) → **not load-bearing** for any decision here. If JSON-LD efficacy ever becomes load-bearing, fetch the primary source in-session first.

---

## Backlog (NOT in this spec — RULE 2 anti-sprawl)

The 7 future-proofing moves are an idea bank, ledgered as backlog, **not** committed to this spec: `.well-known/mcp.json` passive discovery · x402 / Stripe MPP per-call billing · BeachesMLS / Stellar MLS embed · Perplexity publisher program + Bing Webmaster · pre-registration protocol as a standing practice · B2B data-licensing lane · fast-cycling monthly TDT-corridor predictions. **Spec only what gates the first dollar.** (x402 network metrics and the BeachesMLS embed are partially verified — non-load-bearing until confirmed.)

---

## GSC — P0, operator-only

GSC domain verification expires **2026-06-05**. Operator confirms the date in Search Console and executes. Highest-leverage hour on the board; outside every agent's scope.
