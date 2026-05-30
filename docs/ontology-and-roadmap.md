# Brains — Ontology & Roadmap

| Field            | Value                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Version**      | 1.8                                                                                                                      |
| **Last updated** | 2026-05-29 (Goal 0–8 ladder; canonical status moved to Supabase `goals` table at /ops/goals)                             |
| **Next review**  | 2026-08-26 (quarterly)                                                                                                   |
| **Owner**        | Ricky Cooper. Assistant edits with explicit ask.                                                                         |
| **Scope**        | Brain Factory + everything that feeds or consumes it. If a roadmap item doesn't involve brains, it does not belong here. |

**Elevator.** Brains is a multi-brain intelligence DAG. Each brain owns one slice of reality — macro, sector credit, tourism, corridors, franchise outcomes, parcels, flood, freight, storms — and emits a single distilled OUTPUT block. The master brain synthesizes those blocks under a constitution. Confidence is deterministic. Decisions are weighted by trust tier and freshness. The bet: anyone asking a real question about a real place — a CRE analyst, a homebuyer, a city planner, a journalist, a small operator, a parent picking a school — can hold three variables in their head. We can hold fifty, weighted honestly, with a quoted citation chain. No headline industry; verticals are weightings that follow data, not definitions.

---

## 1. The Core Bet

**One brain has a number. Another brain has a different number. A third brain knows how to combine them. The combination is the product.** Scale that from three brains to fifty and you have something no human analyst can compete with.

**Math is easy. Weighting is everything.** Any calculator does $2.00 × 1.5 gallons = $3.00. The real intelligence is recognizing that a war just started in Iran, crude is going to $7, retail gas is about to double — so the smart move is to fill up _right now_, before the shockwave hits the pump. The math hasn't changed. The decision has. That's the Gas Tank Thesis: data is the number, intelligence is the number weighted against everything else happening in the world.

**What separates Brains from generic Claude:**

1. **Deterministic math, narrative prose.** Numbers come from code (Supabase RPCs, freshness ratios, trust tiers). LLMs supply qualitative synthesis only. Claude doesn't add; code adds. This is the single biggest hallucination prevention mechanism.
2. **Thin-pipe DAG.** A downstream brain never reads an upstream's raw branches — only the upstream's OUTPUT block. The whole system is built so that adding a new brain is local: no other brain knows the new one exists until it's wired in.
3. **Confidence that decays honestly.** Stale data → lower confidence. Conflicting brains → lower confidence (eventually via Yager-DST). Never the same conviction whether the source is FRED or a 3-year-old blog post.
4. **Hard rules at synthesis.** A constitution overrides any individual brain. Flood risk vetoes optimism. NAICS distress vetoes seasonality. No LLM eloquence can override an explicit absolute constraint.

---

## 2. How We Think — The Decision Procedure

This is the loop we run every time we want to add to the system. **Outcome first. Always.**

1. **Name the outcome.** "Should X open at Y?" "Is this ZIP losing momentum or gaining it?" "What's the credit risk on this NAICS code in this season?" "What does flood risk actually cost a $500K homebuyer here?" "Where is school enrollment growing fastest?" "Which corridor is heating up?" Don't start from the data we happen to have. Start from the answer we want to be able to produce, across whatever audience asks it.
2. **Decompose the outcome into questions.** Which dimensions matter? Macro? Sector credit? Seasonality? Demographics? Physical risk? Regulatory? Competition?
3. **Map questions to brains.** For each question: does an existing brain answer it? Does a new brain need to exist? Does the answer come from combining brains in a way master doesn't do yet?
4. **Identify data gaps.** Which sources don't exist yet? What trust tier would they be? Are they free (FRED, Census, FEMA) or paid (LightBox, CoStar)? Are they pull (we fetch) or push (they notify)?
5. **Identify weighting gaps.** When the brains we have disagree, what wins? Is there a constitutional rule? A domain hierarchy override? Do we just propagate the conflict and lower confidence?
6. **Build the smallest viable slice.** Wire one brain. Ship it. Read the output. Find out what's wrong. Repeat.

This procedure goes at the front of this document because it is the only thing here that should never change. Everything else — the entities, the brains, the roadmap phases — gets revised as we learn. The procedure is the constant.

---

## 3. The Ontology

The ontology is what brains reason about. Entities are nouns. Relationships are verbs. Domains are the worlds those nouns live in.

### 3.1 Entities

| Entity           | Status                    | Source of truth (today or planned)                                                                                                                                                    |
| ---------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Corridor         | **Live**                  | Supabase `corridor_profiles` (25 verified)                                                                                                                                            |
| Brand            | **Live**                  | SBA franchise outcomes (275 brands)                                                                                                                                                   |
| NAICS_Code       | **Live**                  | SBA loans aggregated view by 2-digit NAICS                                                                                                                                            |
| Macro_Indicator  | **Live**                  | FRED series (SOFR, FLUR, CPI YoY, FL LFPR)                                                                                                                                            |
| Anchor           | Partial                   | Mentioned in corridor narratives, no table yet                                                                                                                                        |
| Property/Parcel  | **Live (Lee value-axis)** | `data_lake.leepa_parcels` (joined layers 9+10+12, Lee only, no geometry). Consumed by `properties-lee-value`. Supply/corridors/flood + Collier + PostGIS geometry still aspirational. |
| Demographic_Zone | Aspirational              | Census B25038 block groups                                                                                                                                                            |
| Permit           | Aspirational              | Accela Lee County, similar feeds elsewhere                                                                                                                                            |
| FEMA_Zone        | Aspirational              | FEMA NFHL flood polygons                                                                                                                                                              |
| TDT_Period       | Aspirational              | Already ingested in premise-engine, awaits brain                                                                                                                                      |
| Hurricane_Event  | Aspirational              | NOAA HURDAT2, plus our Ian impact tagging                                                                                                                                             |
| Listing/Lease    | Aspirational              | Eventually a CoStar/LoopNet shadow source                                                                                                                                             |
| Prediction       | Aspirational              | Our own outcomes table (predictions vs. actuals)                                                                                                                                      |

### 3.2 Relationships

| Relationship                                     | Status       | Unblocked by                               |
| ------------------------------------------------ | ------------ | ------------------------------------------ |
| Brand → categorized_as → NAICS_Code              | **Live**     | Implicit in SBA data                       |
| NAICS_Code → has_credit_profile → SBA_Charge_Off | **Live**     | `sector-credit-swfl` brain                 |
| Brand → located_in → Corridor                    | Aspirational | `corridor_for_point(lat,lon)` Supabase RPC |
| Corridor → has_seasonality → TDT_Period          | Aspirational | `tourism-tdt` brain                        |
| Corridor → has_flood_risk → FEMA_Zone            | Aspirational | FEMA connector + spatial join              |
| Corridor → serves → Demographic_Zone             | Aspirational | Census connector + PostGIS join            |
| Brand → competes_with → Brand                    | Aspirational | Same NAICS within Corridor                 |
| Corridor → impacted_by → Hurricane_Event         | Aspirational | NOAA connector + our Ian tagging           |
| Prediction → about → (any entity)                | Aspirational | Outcomes table                             |

### 3.3 Brain Domains

The `BrainDomain` union (locked in v1.1):
`real-estate | finance | environmental | demographics | logistics | hospitality | macro`.

Today only `real-estate` and `finance` have brains. The other domains are slots waiting to be filled. Each becomes its own column of intelligence the master brain can call on.

### 3.4 Source Trust Tiers

| Tier | Meaning                | Examples today (Live)            | Examples wanted                                  |
| ---- | ---------------------- | -------------------------------- | ------------------------------------------------ |
| T1   | Authoritative          | FRED, SBA franchise outcomes     | Census, FEMA, official permits                   |
| T2   | Curated                | `corridor_profiles`, brain-input | Verified analyst tables, our own derived metrics |
| T3   | Professional secondary | —                                | LightBox, CoStar shadow, vendor reports          |
| T4   | Open web / sentiment   | —                                | News, blogs, social, scraped listings            |

Trust tier feeds directly into the deterministic confidence formula. T1 source = 1.0, T2 = 0.8, T3 = 0.6, T4 = 0.4. Multiplied by freshness ratio. Multiplied by upstream confidence.

---

## 4. Confidence & Weighting

### 4.1 Today — Multiplicative Propagation

```
self_confidence = avg(trust_tier_score) × freshness_ratio
brain_confidence = self_confidence × Π(upstream_confidences)
```

Lives in `refinery/lib/confidence.mts`. Live as of Phase D1. Brain-input sources are excluded from the tier average to avoid double-counting (their confidence is already in the upstream product).

**What it gets right:** stale data lowers confidence, low-tier sources lower confidence, a brain that consumes shaky upstream brains can't claim more confidence than its inputs.

**What it gets wrong:** treats "low confidence because we lack data" identically to "low confidence because brains actively disagree." Both come out as the same number. We can't distinguish ignorance from conflict.

### 4.2 Tomorrow — Yager-DST

Each upstream contributes a Basic Belief Assignment over **{belief, disbelief, ignorance}**:

- Stale upstream → mass into **ignorance**, not disbelief.
- Conflicting upstream → mass into **ignorance** (Yager's rule), not amplified agreement (Dempster's rule, which causes Zadeh's Paradox where two violently disagreeing brains converge on a fringe agreement at 100%).
- Reliability discounting per DAG hop converts confidence into ignorance, not disbelief.

**Why this matters for the gas tank.** When macro says "rates rising, bearish" and tourism says "peak season, bullish," the multiplicative system averages toward neutral and presents it as moderate confidence. The Yager-DST system reports: "belief 0.45 / disbelief 0.40 / ignorance 0.15 — the brains disagree." That conflict signal is what triggers the constitutional layer to pick the override (or, if none applies, kick to human review).

**Implementation note (locked 2026-05-15).** We write `refinery/lib/confidence-yager.mts` ourselves from textbook Yager 1987 (~30 LOC). The OSS option (ERTool) was evaluated and rejected — the repo is empty (LICENSE + README only). The math is short enough that owning it is cheaper than depending on a non-existent dependency. See arsenal triage in `C:\Users\ethan\.claude\plans\piped-seeking-backus.md`.

### 4.3 The Weighting Principle

Three rules, in priority order:

1. **Absolute constraints override everything.** Flood risk > 15% on a parcel kills the deal regardless of every other signal. No LLM eloquence can argue around it.
2. **Macro overrides local in matched signs.** Rising rates kill new debt-funded deals regardless of corridor-level optimism. Local strength can lower the urgency of a macro warning but cannot reverse it.
3. **Brain veto in distress.** When a NAICS sector is in credit distress (charge-off > 4%), it has veto power over seasonal/macro/corridor optimism for businesses in that sector. The distress is the news, not the season.

These are the seed constitutional rules. Section 7 plans the move from inline TypeScript checks to a YAML constitution.

---

## 5. Current State — Honest Snapshot

> **§5.1 (live brains) and §5.2 (DAG) moved to an auto-generated sidecar.** See `docs/roadmap-status.md`, regenerated via `npm run roadmap:sync` after any commit that touches `refinery/packs/`, `refinery/sources/`, `refinery/types/`, `refinery/constitution/`, `refinery/lib/confidence`, `refinery/lib/dag`, `refinery/render/`, or `refinery/validate/`. That file also lists trigger-shaped commits since the last touch of this doc — read it first to see what's currently un-reflected here. The qualitative §5.3–§5.6 sub-sections below remain hand-edited.

### 5.3 What Works

- **Deterministic confidence** with multiplicative upstream propagation (Phase D1).
- **Live FRED ingestion** with fixture-mode fallback.
- **Freshness tokens** quoted in the consumption contract for every brain.
- **Inference-bait lint** (narrow but real) blocks the historical `(% — N total)` pattern that trapped models into recomputing rates.
- **Thin-pipe DAG reads** via `brain-input-source.mts`. Downstream brains cannot accidentally read upstream branches.
- **Atomic scaffold** — one command creates a new pack file and appends it to the registry.

### 5.4 Gaps Between What Exists and What We Want

- **Master is an index, not a synthesizer.** It points to its children; it doesn't combine them. Multi-brain combination is happening in the human reader's head, not in the brain itself.
- **OUTPUT contract is incomplete vs. spec.** Missing top-level `trust_tier`, top-level `direction`, and `contradicts` array. `direction` exists only nested inside each `key_metric`.
- **Inference-bait lint is too narrow.** Catches one regex pattern. Doesn't catch "because / due to / leading to / which is why" linkages between two different brain OUTPUT references — exactly the pattern that produces hallucinated causation.
- **No Tier 3 derived metrics.** No Corridor Factor, no Seasonal Credit Risk Score, no Corridor Gap Score. We have raw and aggregated, not derived.
- **No spatial RPCs.** `corridor_for_point`, `find_corridor_gaps`, `bg_bivariate_choropleth` are referenced in the vision but don't exist in code.
- **No outcomes table.** Every brain output disappears into the customer's decision. We have no way to look back and see whether we were right.
- **No scheduled runs, watch-list, or subscriptions.** Every refinery run is manual.
- **Memory directory is empty.** No cross-session learning yet.
- **Trigger logic lives only as prose.** "Fetch a brain" is decided from paragraphs in user-side CLAUDE.md / project knowledge, biased toward CRE/franchise keyword matching. No machine-readable capability inventory. Estimate from working sessions: current rules cover ~15% of the legitimate user surface. (See §6.6.)
- **No MCP server.** The plug-and-play surface promised in the elevator is a copy-pasted text block users install by hand. (See §6.7.)
- **No report-page side channel.** Heavy structure (tables, charts, maps) has nowhere to go except into the chat reply, which crowds the conversational voice out. (See §7.7.)

### 5.5 What Claude Can Honestly Do Today

- **Synthesize 5 brain OUTPUT blocks** into a narrative answer.
- **Flag obvious contradictions** between brains when asked.
- **Structure unstructured input** (LightBox PDFs, news articles, permit records) into entities + relationships ready for the ontology.
- **Cite freshness tokens** verbatim when the consumption contract is followed.

### 5.6 What Claude Cannot Do Today (No Pretending)

- **Reliably do math in chain-of-thought.** Long arithmetic chains fail. Hence the "code does math" rule.
- **Remember between sessions** without explicit memory writes. Memory directory is empty as of this writing.
- **Watch data streams.** All ingest is pull. If FRED publishes at 3am, the brains don't know until someone runs the CLI.
- **Learn from past mistakes** without an outcomes table. Same hallucination today, same hallucination next month.

---

## 6. The Goal 0–9 Ladder

**The canonical ladder + live status is the Supabase `goals` table, rendered at `https://swfldatagulf-ops.vercel.app/goals`.** The operator edits it in Studio; status is hand-set there, never in this file (prose drifts; the table doesn't). This section keeps the _why/how_ behind each goal — the table is the source of truth.

**The carry contract is Goal 2 and it is live — it is the spine.** A downstream Claude reasons over master's dossier + the lean rules block (riding in every MCP `_meta` / `/api/b?format=json` payload) and answers follow-ups without re-fetching. Goals 3→8 all stand on it.

| Goal | Title                                    | Arc                                                                                                     |
| ---- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 0    | Stamp the goal & contract                | THE-GOAL.md + lean rules block                                                                          |
| 1    | Live /ops ledger                         | derived-status dashboard                                                                                |
| 2    | The carry contract                       | dossier + lean rules in every payload (the spine)                                                       |
| 3    | Master is a synthesizer, not an index    | weighted conclusion, contradictions surfaced, dynamic key-metric cap                                    |
| 4    | Prove it & self-own the data             | predictions/outcomes, TDT + sales-tax self-ingest, acceptance tests, green CI                           |
| 5    | Audience voices + first derived metric   | Corridor Factor, constitution YAML, critique-revision loop                                              |
| 6    | Honest confidence + rich side channel    | Yager-DST, report-page side channel, spatial oracle                                                     |
| 7    | Outcomes loop (correlation → causation)  | grade predictions, causal layer, backtests                                                              |
| 8    | Autonomy & expansion                     | scheduled runs, watch-list, regional, multi-tenant, fine-tune                                           |
| 9    | **The compounding flywheel** (end state) | scored "conditions + event → outcome" history → cohort-matched prediction; the moat is time + territory |

The deep detail below is grouped under those goals: **Goals 3–4** (was "NOW", §6.x), **Goals 5–6** (was "NEAR-TERM", §7), **Goals 7–8** (was "LONG-TERM", §8). **Goal 9 is the end-state the whole ladder serves** — its mechanics live in `docs/THE-GOAL.md` (§ "The end state — the compounding flywheel"); Goals 7+8 are its build steps. The killed Industry-Characters plan is gone — the corridor character generator superseded it.

> **Read done-ness from `/ops/goals` and `/ops`, not from the paragraphs below.** The per-goal prose is design rationale captured at authoring time; some of it describes work that has since shipped (master is now a synthesizer; the speaker layer and MCP are live; the carry contract rides in every payload). For what is actually done, trust the live ledger.

### 6.x — Goal 3/4 detail (was NOW)

### 6.1 (Goal 3 — SHIPPED) `master` is a Synthesizer, not an Index

**Status: done — see `/ops/goals` Goal 3.** master now runs a real `outputProducer` that combines its upstream OUTPUT blocks into one weighted conclusion with `contradicts[]`, a dynamic key-metric cap (`t1Count+1`), and the dossier-engine conditional thesis + grain boundary (master.md v59). The rationale below is why this was the first wire-up; it is no longer pending.

**Why this came first.** Every customer-facing answer flows through master. Before this, master was a pointer that said "go look at the children" — multi-brain combination happened in the reader's head, not the system. Every later upgrade (Yager-DST, constitution, causal layer, scheduled runs) operates on this foundation.

It's also the highest-leverage move available: no new data, no new connector, no new domain. Just a real `outputProducer` on the master pack and a thin starter constitution.

**Concrete work:**

1. Add `outputProducer` to the `master` pack that reads downstream OUTPUT blocks (`franchise-outcomes`, `cre-swfl`, and eventually `macro-swfl`, `sector-credit-swfl`, `tourism-tdt` once they exist as inputs). Emit a single `conclusion + key_metrics + caveats + contradicts`.
2. Close the OUTPUT contract gaps. Add top-level `trust_tier`, top-level `direction`, and `contradicts: string[]` to `BrainOutput` in `refinery/types/brain-output.mts`. Backfill in all 5 packs. Update `spec-validator` so the gates fail closed.
3. Expand `inference-bait-lint`. Add a rule that flags `because | due to | leading to | which is why | as a result` when the flanking phrases reference two different brain IDs in master's OUTPUT block. Master is allowed to attribute conclusions to specific upstream brains, but it must do it with explicit citation syntax (e.g. `"per macro-swfl"`) rather than causal English.
4. **Seed the outcomes table.** Two Supabase tables: `predictions(id, brain_id, refined_at, conclusion, confidence, prediction_window, metadata)` and `outcomes(prediction_id, actual_value, observed_at, delta, correction_notes)`. No UI yet. Just start logging every master refine. This is the seed corpus for everything downstream — backtests, fine-tuning, drift detection.

### 6.2 Ship `tourism-tdt` Brain

TDT (Tourist Development Tax) data is already ingested in premise-engine. It is the single biggest missing piece for SWFL: the seasonal pulse that every retail / food / accommodation / hospitality decision needs to be weighted against. Without it, "should I open in Q3" gets the wrong answer half the year.

**Concrete work:**

1. Add a source connector for the TDT data (Supabase view from premise-engine).
2. Use `refinery/scaffold.mts` to create the pack with `domain=hospitality, input_brains=["master"]`.
3. `outputProducer` emits seasonal index, Y/Y delta, Ian-impact tagging, and a `direction` (peak / shoulder / trough).
4. Add `tourism-tdt` to `master`'s `input_brains` once master is a real synthesizer.

### 6.3 Per-Domain `LAKE_ID` Refactor

Known pending refactor. Today the `macro-swfl` brain (domain `finance`) carries a generic `SWFL-7421-v4-…` freshness token. Per-domain tokens like `FINANCE-v2-20260515` and `REAL-ESTATE-v3-20260515` give the consumption contract a way to flag stale-by-domain rather than stale-by-everything.

### 6.4 NOW Acceptance Tests

The NOW phase ships when **both** of these come back right.

**Test A — Operator question (T3 audit shape):** "Is now a good time to sign a 5-year accommodation lease on Fort Myers Beach?" The answer should cite macro, tourism (TDT), sector credit, CRE, and franchise outcomes. One synthesized conclusion with one combined confidence. Any contradiction explicitly flagged (e.g. "macro is bearish but tourism is bullish — see `contradicts`"). Freshness token quoted. Logged to the predictions table so we can revisit in 18 months.

**Test B — Homebuyer question (T2 conversational shape, via the speaker layer in §6.5):** "Under $500K in Lee County, which ZIPs give me the best shot at low flood-insurance costs without sitting in a stagnant neighborhood?" The answer should fit on a phone screen: a 2–3 sentence conversational opener, one small ZIP table, one paragraph naming in plain English what the brain can't answer yet, no `§` symbols, no internal pack IDs (`env-swfl`, `properties-lee-value`), no "siblings haven't shipped" admissions, no "bifurcate." Report-page link returned for the operator who wants to dig deeper.

If A comes back as "go look at each brain individually," the synthesizer (§6.1) isn't done. If B comes back as an 800-word CRE-analyst dissertation, the speaker layer (§6.5) isn't done.

### 6.5 Speaker Layer + Output Tier Table

**Why this matters.** Today the API route (`app/api/b/[slug]/route.ts`) serves the raw audit `.md` straight into the chat surface. That collapses three jobs into one — guardrails, sources, and voice — and the voice gets crushed. Concrete failure mode: a homebuyer asks a $500K Lee County flood-budget question and gets back an 800-word CRE-analyst dissertation with `§` symbols, internal pack IDs (`env-swfl`, `properties-lee-value`), and a tour of every ZIP we touch. The brain output is correct. The render is the bug.

**Concrete work:**

1. Introduce a speaker layer between brain output and the user's chat reply. Pick the format tier from the question shape; strip internal pack IDs; drop the `§` symbol; suppress "siblings haven't shipped" roadmap-status admissions.
2. Land the four-tier output scheme:

   | Tier | When                                               | Looks like                                                        | Audit detail lives where        |
   | ---- | -------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------- |
   | 0    | Out of scope ("what's the weather")                | One sentence. No fetch happens.                                   | Nowhere — brain didn't trigger. |
   | 1    | Simple in-scope question                           | 2–4 sentences, conversational, no headers, maybe one table.       | Report-page link if useful.     |
   | 2    | Analytical / comparison / ranking                  | Conversational opener + table + 1–2 paragraphs of read + caveats. | Report-page link, always.       |
   | 3    | "Show me the audit" / power user / API integration | Current full six-section format.                                  | Inline.                         |

3. Hygiene rules baked in: no `§`, no internal pack IDs in user copy, no "bifurcate," no six-section format on T1/T2 questions, no ZIP-tour answers when the question is a budget filter.

### 6.6 Trigger Logic + Capability Inventory

**Why this matters.** Today the "fetch a brain" decision lives only as prose in user-side CLAUDE.md / project knowledge ("before answering any franchise or CRE question…"). That biases Claude toward fetching for CRE/franchise and away from fetching for residential, healthcare, logistics, government, or community questions — even when the data supports those. Estimate from working sessions: current rules cover ~15% of the legitimate user surface.

**Concrete work:**

1. Publish a machine-readable capability inventory — what Brains can confidently answer right now, by data availability rather than topic keyword. Capability-matching, not keyword-matching.
2. Bar examples that lock the discipline:
   - "What's the weather in SWFL?" → **do not fetch.** Even if we pipe weather in, we are not a weather provider.
   - "What's the economy like in Orlando?" → **do not fetch.** Out of footprint.
   - "What's the economy like in Venice, FL?" → **do not fetch (yet).** In footprint geographically; data is thin. Pretending otherwise is the failure mode.
   - "Should I open a [vertical] near [SWFL ZIP]?" → **fetch.** In scope and data-supported.
3. The inventory is the thing the MCP server (§6.7) exposes to the user's Claude as the trigger description.

### 6.7 MCP Wrapper

**Why this matters.** The elevator promises a plug-and-play surface a user drops into their Claude. Today there is no MCP server. The "protocol" is a copy-pasted block in user-side CLAUDE.md / project knowledge that every operator has to install by hand and that drifts the moment we change anything.

**Concrete work:**

1. Stand up a Brains MCP server. Expose tools whose descriptions encode the trigger logic from §6.6 (so Claude decides when to call them the same way he decides when to use any other tool).
2. The MCP server is the surface that delivers the capability inventory, fetches brain content through the speaker layer (§6.5), and eventually hands back report-page URLs (§7.7).
3. Retire the copy-pasted CLAUDE.md protocol block once the MCP equivalent ships — keep the block as a legacy fallback for non-MCP clients.

---

## 7. NEAR-TERM Roadmap — 8–16 Weeks (Goals 5–6)

_Maps to Goals 5–6 on `/ops/goals`. Each item builds directly on the shipped carry-contract + synthesizer foundation._

1. **First Tier 3 derived metric — Corridor Factor.** The "Park Factor" analog. Lives in `refinery/lib/derived/corridor-factor.mts`. Pure deterministic. Inputs: corridor profile + seasonal index + sector mix + macro context. Output: a single multiplier that normalizes business performance by location advantage. A coffee shop doing $1.5M in downtown Naples might be _underperforming_ relative to the corridor; one doing $900K in Lehigh Acres might be _overperforming_. Consumed by `cre-swfl` and `franchise-outcomes` as enrichment.
2. **Constitutional master brain — decision gate (YAML vs GoRules Zen JDM).** Lift the inline rules from NOW step 6.1 into a constitution. **Decision moment: Week 8–10** (per master plan). Default path is plain YAML at `refinery/constitution/master.yaml`. Alternate path is **GoRules Zen** ([github.com/gorules/zen](https://github.com/gorules/zen), 1.7k stars), whose `first`-hit Decision Table policy is a near-exact semantic match for the `overrideCascade` design. **Tipping point: rule count ≥ 20 across all domains** (today we have ~5). Pre-flight check: verify Zen's Rust N-API binary deploys cleanly on Vercel runtime. Encode either way: absolute constraints (flood veto, NAICS distress override), logical consistency rules (rising rates + flat employment = headwind), domain hierarchy for contradiction resolution.
3. **2-round critique-revision loop** at master synthesis time. Draft → constitution check → revise → final check → if still violating, emit `LOW_CONFIDENCE_HUMAN_REVIEW`. Research shows diminishing returns after 2 rounds; we hard-cap there.
4. **Yager-DST confidence upgrade.** Replace multiplicative propagation in `confidence.mts` with belief/disbelief/ignorance modeling. Conflict mass routed to ignorance. Reliability discounting per DAG hop. This is the math that lets us honestly report disagreement. **Implementation: write `refinery/lib/confidence-yager.mts` ourselves from textbook Yager 1987 (~30 LOC). ERTool — the brief's suggested port source — is an empty repo, do NOT depend on it.** Ship behind the `synthesisStrategy: "llm-assisted"` toggle for an A/B period vs multiplicative.
5. **GraphRAG indexing for LightBox + news — Graphiti as Python sidecar.** Deploy **Graphiti** ([github.com/getzep/graphiti](https://github.com/getzep/graphiti), 26.1k stars) as a Python sidecar service that the Bun refinery calls via REST/MCP. **Backend: Kuzu** (embedded — simplest of the four supported, no separate DB to operate). The Episode → fact → bi-temporal validity model maps directly onto our thin-pipe + citation table contract. **Walled off from `refinery/`** — Graphiti never touches deterministic outputs, never writes to any brain's `confidence` field. The "facts-only" + "thin-pipe" contracts stay sacred. **Adoption blocked until CVE-2026-32247 (Cypher injection via unsanitized `node_labels`, CVSS 8.1) is patched in a tagged release**, or until we sanitize labels ourselves at the boundary. Apache AGE was evaluated and rejected — it cannot install on managed Supabase. Estimated 4–6 weeks of acceleration vs building Episode/temporal-walk primitives ourselves.
6. **Spatial oracle.** Supabase RPC `corridor_for_point(lat, lon)`. Unlocks `Brand → located_in → Corridor` relationship and every downstream spatial query (proximity, gap detection, competitive density).
7. **Report-page side channel.** While the speaker layer (§6.5) renders T1/T2 conversational answers, Brains publishes a rich page at a stable URL and returns the link with the chat reply. The page holds proper sortable tables, real charts (Recharts / Chart.js / D3 — one library install on the existing Next.js + Vercel deployment), maps (via the Mapbox MCP already wired), expanded source citations, and the full T3 audit detail. Shareable, dated, cacheable. Two follow-on adds once the base page ships: PDF / formatted email render (Postmark or Resend, ~1–2 days plumbing each — clean paid-feature wedge), and the "highlight prompt-on-hover" interactive (hovercards on numbers and keywords kick off a follow-up Claude conversation about that specific value). The interactive feature is web-only — does not exist inside the chat reply.

---

## 8. LONG-TERM Roadmap — 16+ Weeks (Goals 7–8)

_Maps to Goals 7–8 on `/ops/goals`. These are the moves that turn correlation into causation and turn manual runs into an autonomous system._

1. **Causal layer.**
   - **Instrumental variable analysis** using Hurricane Ian as the exogenous shock to corridor supply. Pre/post Ian on damaged vs. undamaged corridors, controlling for everything else.
   - **Synthetic control corridors.** Algorithmically blend untreated corridors to create a counterfactual twin. Measure divergence after a treatment (new anchor, zoning change).
   - **Difference-in-differences** for policy effects. Treated corridor minus control corridor, before minus after.
   - Lives in `refinery/causal/`. Consumed by domain brains, never directly by master.
2. **Backtests.** Run every derived metric (Corridor Factor, Seasonal Credit Risk, future metrics) against 2022–2024 outcomes. Drop anything that doesn't predict above baseline.
3. **Scheduled runs.** Cron-driven refinery at 3am: FRED pulse, permit deltas, TDT release window, SBA quarterly release. A brief waits in inbox by 7am.
4. **Watch-list infrastructure.** Persistent feed configs: FRED series IDs, Accela RSS, TDT publication schedule, SBA quarterly release dates, NOAA hurricane track. The detection layer for "Iran just happened" — we don't predict the war, we just react in minutes instead of months when something happens.
5. **Real-time subscriptions.** Where push exists (webhook, websocket, SSE), use it. Where it doesn't, poll on a tight schedule. When source data changes, downstream brains rebuild automatically.
6. **Multi-agent inference.** Each brain runs as its own Claude agent in parallel; the master agent consumes their OUTPUT blocks. Same DAG, but at inference time instead of batch. Faster, fresher, more responsive to ad-hoc questions.
7. **Fine-tuned synthesis model.** The outcomes table (seeded in NOW step 6.1.4) becomes training data. The Constitution stops being a prompt and starts being weights. The anti-inference-bait rules stop being a regex and start being learned behavior.
8. **Additional brain domains** activated as data comes online:
   - `environmental` — flood, storm, climate, sea-level. _(live: env-swfl)_
   - `demographics` — Census, migration, income trends. _(planned: gap-swfl, IRS SOI)_
   - `logistics` — corridors as flow networks (traffic, freight, accessibility). _(live: logistics-swfl on FAF5; planned v2: FDOT traffic counts)_
   - `hospitality` — hotel ADR, STR pricing, occupancy beyond TDT. _(live: tourism-tdt)_
9. **Regional brain proliferation reusing the macro chain.** The three-tier macro denominator chain (macro-us → macro-florida → macro-swfl, shipped 2026-05-17) is built for reuse. Future `macro-tampa` and `macro-jax` brains consume both `macro-us` and `macro-florida` as upstreams — zero duplication of national or state series, just the regional-specific layer. A future `macro-georgia` brain would consume `macro-us` only. The same pattern extends to gap brains: any `gap-*` brain declares `macro-florida` as its denominator upstream and computes deltas in code (never LLM). This is the architectural payoff of the restructure — every new regional or gap brain is one file + one DAG edge, not a fresh re-ingest of national context.

---

## 9. Worked Example — The Gas Tank Applied

**Question.** "Should I open a coffee shop on Pine Ridge in Q3 2026?"

The brains contribute:

| Brain                | Read                                                         | Direction | Confidence |
| -------------------- | ------------------------------------------------------------ | --------- | ---------- |
| `macro-swfl`         | SOFR 5.25%, rising → bearish on new debt-funded buildout     | bearish   | 0.82       |
| `sector-credit-swfl` | NAICS 722515 (snack/coffee) charge-off rate 4.2% → elevated  | bearish   | 0.88       |
| `tourism-tdt`        | Q3 is the seasonal trough in Lee County → demand soft        | bearish   | 0.79       |
| `cre-swfl`           | Pine Ridge corridor: rising vacancy, anchor turnover flagged | bearish   | 0.74       |
| `franchise-outcomes` | Independent coffee 100% survival on Pine Ridge, n=4 (small)  | bullish   | 0.51       |

**Today (multiplicative).** Combined confidence collapses to ~0.20. Too pessimistic — the brains don't all disagree, the franchise reading is just small-sample.

**Tomorrow (Yager-DST).** Four bearish brains commit mass to **belief** (bearish). The franchise reading at n=4 commits its mass mostly to **ignorance**, not disbelief. Combined: belief ~0.72 bearish, ignorance ~0.20, disbelief ~0.08.

**Master synthesis under the constitution.** "Four independent brains report bearish signals across macro, credit, seasonal, and corridor dimensions. The franchise reading is too thin to override. Per domain hierarchy: macro + credit signals dominate when aligned. **Recommend delay 6–9 months and revisit when Q1 2027 macro outlook clarifies.** Quoted freshness tokens for all five brains attached. Logged to predictions table for outcome tracking."

That is the difference between data and intelligence. Math hasn't changed — the brains gave us five numbers. The decision changed because the weighting did.

### 9.1 Sibling Worked Example — Homebuyer (T2 conversational)

**Question.** "Under $500K in Lee County, which ZIPs give me the best shot at low flood-insurance costs without sitting in a stagnant neighborhood?"

The brains contribute (illustrative, post-speaker-layer):

| Brain                  | Read                                                                        | Direction      | Confidence |
| ---------------------- | --------------------------------------------------------------------------- | -------------- | ---------- |
| flood economics        | Inland Lee ZIPs sit below the $800/yr AAL barrier — coastal ZIPs well above | bullish inland | 0.91       |
| Lee parcel velocity    | Lee aggregate sales velocity z = 1.5 (bullish) — no per-ZIP breakdown yet   | bullish        | 0.91       |
| macro / price level    | FHFA HPI for Cape Coral–Fort Myers MSA at −8.86% YoY                        | bearish prices | 0.96       |
| per-ZIP days-on-market | _Not yet built — flagged as a gap_                                          | n/a            | n/a        |

**Today (multiplicative + no speaker layer).** Render dumps the raw audit format — six sections, `§` symbols, internal pack IDs in parentheticals, every ZIP we have data on listed. Looks like noise on a phone.

**Tomorrow (Yager-DST + speaker layer, T2 render).** Two sentences of context, one small table of candidate inland ZIPs, one honest line about the per-ZIP DOM gap, one report-page link for the operator who wants the audit. The tradeoff the buyer set up (low flood vs. not stagnant) gets resolved in plain English: at this budget you're inland by default, and the inland ZIPs that are cheapest on flood are also the highest-velocity — the tradeoff mostly dissolves.

Same brains, same numbers. The speaker layer puts them in a voice the asker can use.

---

## 10. Update Cadence & Sign-Off

**Quarterly review** (next: **2026-08-15**). Re-read this doc top to bottom. Update entity status (Aspirational → Live as things wire up). Move roadmap items between phases as they ship or get reprioritized. Add new entities or relationships discovered along the way.

**Trigger-based updates** — revise immediately when:

- A new MCP server gets wired (changes what tools brains can call).
- A new Claude capability ships (memory, scheduled runs, real-time subscriptions, fine-tuning).
- A new domain is activated (`environmental`, `demographics`, etc.).
- A new hard constraint is discovered (compliance, legal, physical).
- A roadmap item ships — move it to "Live" and capture lessons in the changelog.

**Append-only changelog** at the bottom of this doc. Date, what changed, why. No deletes.

---

## 11. Source Map (for the next person who edits this doc)

So the next reader (Ricky or future Claude) can verify everything against code:

| Concept               | File                                                      |
| --------------------- | --------------------------------------------------------- |
| Pack registry         | `refinery/packs/index.mts`                                |
| New-style packs       | `refinery/packs/macro-swfl.mts`, `sector-credit-swfl.mts` |
| Legacy packs          | `refinery/config/packs.mts`                               |
| Confidence formula    | `refinery/lib/confidence.mts`                             |
| DAG resolver          | `refinery/lib/dag.mts`                                    |
| OUTPUT type           | `refinery/types/brain-output.mts`                         |
| Pack type             | `refinery/types/pack.mts`                                 |
| OUTPUT rendering      | `refinery/render/master-index.mts`                        |
| Inference-bait lint   | `refinery/validate/inference-bait-lint.mts`               |
| Spec validator        | `refinery/validate/spec-validator.mts`                    |
| Brain-input source    | `refinery/sources/brain-input-source.mts`                 |
| Scaffold              | `refinery/scaffold.mts`                                   |
| CLI                   | `refinery/cli.mts`                                        |
| Consumption contract  | `docs/consumption-contract.md`                            |
| Engine state snapshot | `docs/engine_state_may15.md` + `_brain_factory.md`        |
| Notion blueprint      | Notion page `36135f3b-7faf-813d-b9b8-dfc16ee7da0b` (v1.1) |
| Project spec          | `CLAUDE.md`                                               |

---

## Future-vision items (post-character-generator)

Captured 2026-05-26 alongside the corridor character generator v2 plan (`docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`). **None of these start before the character generator ships and proves out for at least one full quarterly cycle.** They live here so the operator's long-term thinking is recorded without inheriting into the active plan as "the second half of the work."

Each item is one sentence and a gate. Add detail when you start it, not before.

- **FL-other-cities comparison context as a data layer for SWFL outputs.** Ingest comparable Tampa / Orlando / Jacksonville fact-pack inputs so SWFL corridor characters can carry sentences like "Fort Myers Daniels Pkwy cap rate is N bps vs. Tampa Westshore at M bps." Comparison flows TO SWFL users; not market expansion. **Gate:** character generator shipped, FL-cities ingest inventory audit committed.
- **Florida statewide character anchor.** Same generator shape, FL-statewide fact pack, consumed as comparison anchor by SWFL corridor regeneration. **Gate:** FL-other-cities step shipped + statewide ingest landed.
- **National character anchor.** Same shape, national fact pack as comparison anchor of last resort (FRED / BLS national / Census ACS national). **Gate:** statewide step shipped.
- **Deterministic forecasts where multi-period history exists.** Per-metric trend math (slope + R² + period count) emitted as `[INFERENCE]` lines with falsification conditions per consumption contract rule 7. No ML, no LLM-driven forecasts. Math in TS. **Gate:** ≥ 4 periods of history in `data_lake.*` for the metric.
- **Outlier-detection brain as side effect of stored fact packs.** Once national + state + regional fact packs are stored in the same shape, divergences become SQL-computable; render outlier list as a standalone brain (`outliers-swfl.mts`). **Gate:** statewide + national fact packs in production for at least one quarter.
- **BYO multi-tenant clean-data overlay.** Companies overlay their own asset data on top of SWFL fact packs. **Gate:** same multi-tenant prereqs (auth, namespacing, billing, schema isolation) that block `/vault` from MCP v1 — see `[[brains-mcp-server-v1-plan]]`. Not a 2026 conversation.
- **Tavily as optional pre-fetch helper.** If Anthropic's `web_search_20260209` index proves thin on primary SWFL sources during the character generator's first quarterly cycle, revisit Tavily's 300-domain allowlist as a pre-fetch augmentation before the Claude synthesis call. **Gate:** at least one quarterly cycle of operator feedback on Anthropic citation quality.

---

## Changelog

- **2026-05-15 — v1.0.** Initial roadmap. Five brains live. Multiplicative confidence in production. Master is an index, not yet a synthesizer. Tourism-TDT, derived metrics, constitution, Yager-DST, causal layer, scheduled runs all on the roadmap. First wire-up: promote master from index to synthesizer.
- **2026-05-19 — v1.2.** Split prescriptive from descriptive. §5.1 brain table and §5.2 DAG removed from this doc; replaced by the auto-generated sidecar `docs/roadmap-status.md` (regenerated via `npm run roadmap:sync` — generator at `refinery/tools/roadmap-sync.mts`, mirrors the `npm run ledger` pattern). The §10 trigger list now has a code-level enforcement path: any commit touching packs/sources/types/constitution/confidence/dag/render/validate surfaces in `roadmap-status.md` until the prescriptive sections here are updated to reflect it. Quarterly review cadence still applies to §6–§9 (forward strategy); §5 descriptive layer is now machine-current on every regenerate.
- **2026-05-19 — v1.3.** `storm-history-swfl` v1 shipped via the new Tier 1 DuckDB ingest lane (`ingest/duckdb_pipelines/storm_history_swfl/` writes Parquet to `s3://lake-tier1/environmental/storm_events_swfl.parquet`; `refinery/sources/storm-history-source.mts` reads it back via `@duckdb/node-api` + httpfs). NOAA Storm Events 1996-2025 modern-schema vintage, 1,178 SWFL events (LEE+COLLIER+CHARLOTTE), `environmental` domain, leaf brain (not wired to master). First proof that the dlt-and-DuckDB coexistence pattern (typed Tier 2 loader vs. cold Tier 1 Parquet + analytical reader) works end-to-end. See `docs/API_BLUEPRINTS.md` Data Tier Policy → Tool Placement for the locked rules.
- **2026-05-19 — v1.4.** Tool Placement policy locked under Data Tier Policy in `docs/API_BLUEPRINTS.md` (matrix mapping workload → tool → destination, dlt-math-clarification, anti-patterns list). dlt is recorded explicitly as a "typed Postgres loader" in this repo — not an ETL engine — so future contributors don't assume rich semantics it isn't using. **Cross-Tier SQL (DuckDBSource with pgAttachments):** architecture proven via the runtime Q0 gate at `scripts/duckdb_postgres_smoke_test.mts` (DuckDB `postgres` extension autoloads through `@duckdb/node-api`). The generic `refinery/sources/duckdb-source.mts` connector is **deferred** until a shipping brain requires a cross-tier Parquet + Postgres join. First candidate brains: `demographics-swfl` (ACS Tier 1 Parquet joined against `data_lake.macro-*` denominators) and `hurricane-tracks-fl` (HURDAT2 Tier 1 Parquet joined against `data_lake._tier1_inventory` or `data_lake.leepa_parcels`). When that brain ships, build the connector in the same PR — never before. This marker is the trigger.
- **2026-05-15 — v1.1.** Arsenal audit against 13 OSS tools (full findings in `C:\Users\ethan\.claude\plans\piped-seeking-backus.md`). Posture: **Math-Honest, Security-First, Vendor-First.** Three roadmap concretizations:
  - **§7.2 — Constitution → decision gate.** Week 8–10 evaluates GoRules Zen JDM alongside plain YAML; tipping point at ≥ 20 rules across domains. Pre-flight: verify Rust N-API binary on Vercel.
  - **§7.4 / §4.2 — Yager-DST → write ourselves.** ~30 LOC from textbook Yager 1987 in `refinery/lib/confidence-yager.mts`. ERTool rejected (empty repo).
  - **§7.5 — GraphRAG → Graphiti sidecar with Kuzu backend.** Python sidecar walled off from `refinery/`. Adoption blocked until CVE-2026-32247 patched. Apache AGE rejected (incompatible with managed Supabase, violates vendor-first rule).
  - **Skips (with reasoning).** DagEngine (Bun support unverified, 13 stars), D2TS (alpha, wrong shape for LLM synthesis), Puffgres (archived, Turbopuffer-only), bayesjs (4½ years dead), CHUK MCP Solver (wrong problem), TrustGraph (platform replacement, not library), Data-Genie (premature at our scale).
  - **Deferred spikes.** Mastra (2-week spike at Month 4+ multi-agent milestone), UQLM (Python sidecar IF/WHEN `synthesisStrategy: "llm-assisted"` ships).
- **2026-05-29 — v1.8.** Reframed §6/§7/§8 around the **Goal 0–8 ladder**. Canonical ladder + live status now lives in a Supabase `goals` table rendered at `/ops/goals` (hand-owned by operator, insert-only seed). §6 leads with the ladder + a blanket note that done-ness reads from `/ops`, not the prose; §6.1 corrected (master is a synthesizer — Goal 3 shipped — not "an index"); §7/§8 mapped to Goals 5–6 / 7–8. The **carry contract is Goal 2 and the spine**. CLAUDE.md Status section points at `/ops/goals`. Per-section design rationale retained as history.
- **2026-05-29 — v1.7.** Industry Characters Plan killed (7 audience voices, 5-tier routing cascade — never started). Role Renderer deleted (4 CLI-only roles, never wired to API). `render-roles.mts` CLI + `"roles"` npm script removed. Speaker-layer gap (§5.4) closed — `speaker.mts` ships with `?view=speak&tier=` query params via MCP.
- **2026-05-26 — v1.6.** Corridor character generator v2 plan locked. New "Future-vision items (post-character-generator)" section added between §§ and Changelog capturing seven deferred ideas (FL-other-cities comparison context, FL statewide / national character anchors, deterministic forecasts, outlier brain, BYO multi-tenant overlay, Tavily pre-fetch helper). Each item carries an explicit gate; none start before the character generator ships and proves out for one quarterly cycle. CLAUDE.md SWFL Protocol rule 8 carries an in-place carve-out exempting the `character_speculative` block from the smoothing-tokens ban (with the speculative block's own inline disclaimer enforced separately by the v2 lint stack). Canonical plan: `docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md`. Memory: [[corridor-character-generator]].
- **2026-05-20 — v1.5.** Post-LittleBird reset alignment. Vision-board cleanup notes at `C:\Users\ethan\.claude\plans\right-now-we-need-noble-quasar.md`. Three new NOW items: §6.5 Speaker Layer + Output Tier Table, §6.6 Trigger Logic + Capability Inventory, §6.7 MCP Wrapper. One new NEAR-TERM item: §7.7 Report-Page Side Channel. Reshape pass: elevator broadened beyond "CRE analyst"; §2 decision-procedure examples expanded to non-CRE shapes; §5.4 picks up the speaker / trigger / MCP / report-page gaps; §5.5 LittleBird name removed; §6.4 now has two acceptance tests (operator audit + homebuyer conversational); §8.7 "Fine-tuned Littlebird" renamed to "Fine-tuned synthesis model"; §9.1 added sibling homebuyer worked example. Memory cleanup executed in parallel — see [[vision-board-may20]], [[littlebird-is-notetaker]], [[three-jobs-not-one]], [[speaker-layer-hygiene]], [[no-headline-industry]].
