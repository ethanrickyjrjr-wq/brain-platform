# Brains — Ontology & Roadmap

| Field            | Value                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Version**      | 1.0                                                                                                                      |
| **Last updated** | 2026-05-15                                                                                                               |
| **Next review**  | 2026-08-15 (quarterly)                                                                                                   |
| **Owner**        | Ricky Cooper. Assistant edits with explicit ask.                                                                         |
| **Scope**        | Brain Factory + everything that feeds or consumes it. If a roadmap item doesn't involve brains, it does not belong here. |

**Elevator.** Brains is a multi-brain intelligence DAG. Each brain owns one slice of reality — macro, sector credit, tourism, corridors, franchise outcomes — and emits a single distilled OUTPUT block. The master brain synthesizes those blocks under a constitution. Confidence is deterministic. Decisions are weighted by trust tier and freshness. The bet: a CRE analyst can hold three variables in their head; we can hold fifty, weighted honestly, with a quoted citation chain.

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

1. **Name the outcome.** "Should X open at Y?" "Is corridor Z heating up or cooling down?" "What's the credit risk on this NAICS code in this season?" Don't start from the data we happen to have. Start from the answer we want to be able to produce.
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

| Entity           | Status       | Source of truth (today or planned)               |
| ---------------- | ------------ | ------------------------------------------------ |
| Corridor         | **Live**     | Supabase `corridor_profiles` (25 verified)       |
| Brand            | **Live**     | SBA franchise outcomes (275 brands)              |
| NAICS_Code       | **Live**     | SBA loans aggregated view by 2-digit NAICS       |
| Macro_Indicator  | **Live**     | FRED series (SOFR, FLUR, CPI YoY, FL LFPR)       |
| Anchor           | Partial      | Mentioned in corridor narratives, no table yet   |
| Property/Parcel  | Aspirational | PostGIS polygons, county parcel records          |
| Demographic_Zone | Aspirational | Census B25038 block groups                       |
| Permit           | Aspirational | Accela Lee County, similar feeds elsewhere       |
| FEMA_Zone        | Aspirational | FEMA NFHL flood polygons                         |
| TDT_Period       | Aspirational | Already ingested in premise-engine, awaits brain |
| Hurricane_Event  | Aspirational | NOAA HURDAT2, plus our Ian impact tagging        |
| Listing/Lease    | Aspirational | Eventually a CoStar/LoopNet shadow source        |
| Prediction       | Aspirational | Our own outcomes table (predictions vs. actuals) |

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

### 4.3 The Weighting Principle

Three rules, in priority order:

1. **Absolute constraints override everything.** Flood risk > 15% on a parcel kills the deal regardless of every other signal. No LLM eloquence can argue around it.
2. **Macro overrides local in matched signs.** Rising rates kill new debt-funded deals regardless of corridor-level optimism. Local strength can lower the urgency of a macro warning but cannot reverse it.
3. **Brain veto in distress.** When a NAICS sector is in credit distress (charge-off > 4%), it has veto power over seasonal/macro/corridor optimism for businesses in that sector. The distress is the news, not the season.

These are the seed constitutional rules. Section 7 plans the move from inline TypeScript checks to a YAML constitution.

---

## 5. Current State — Honest Snapshot (2026-05-15)

### 5.1 Live Brains

| Brain                | Domain      | Sources                                     | Input brains                       |
| -------------------- | ----------- | ------------------------------------------- | ---------------------------------- |
| `franchise-outcomes` | real-estate | SBA franchise outcomes (275 brands)         | —                                  |
| `cre-swfl`           | real-estate | `corridor_profiles` (25 corridors, 8 types) | —                                  |
| `master`             | real-estate | Index of franchise-outcomes + cre-swfl      | `franchise-outcomes`, `cre-swfl`   |
| `macro-swfl`         | finance     | Live FRED: SOFR, FLUR, CPI YoY, FL LFPR     | `master`                           |
| `sector-credit-swfl` | finance     | SBA loans by NAICS × county (893 rows)      | `franchise-outcomes`, `macro-swfl` |

### 5.2 DAG

```
franchise-outcomes ─┐
                    ├─→ master ─→ macro-swfl ─→ sector-credit-swfl
cre-swfl ──────────┘                              ↑
        (also feeds sector-credit-swfl directly ──┘)
```

Longest chain: `franchise-outcomes → master → macro-swfl → sector-credit-swfl` (4 hops).

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

### 5.5 What Claude (Littlebird) Can Honestly Do Today

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

## 6. NOW Roadmap — Next 4–8 Weeks

Everything here names a brain or directly serves brain output. Nothing else.

### 6.1 First Wire-Up — Promote `master` from Index to Synthesizer

**Why this first.** Every customer-facing answer flows through master. Today master is a pointer that says "go look at the children." That means multi-brain combination is happening in the reader's head, not in the system. Until master actually combines, every later upgrade (Yager-DST, constitution, causal layer, scheduled runs) operates on a fiction.

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

### 6.4 NOW Acceptance Test

Ask the system: **"Is now a good time to sign a 5-year accommodation lease on Fort Myers Beach?"**

The answer should cite macro, tourism (TDT), sector credit, CRE, and franchise outcomes. It should produce one synthesized conclusion with one combined confidence. It should explicitly call out any contradiction (e.g. "macro is bearish but tourism is bullish — see `contradicts`"). It should quote the freshness token. It should be logged to the predictions table so we can revisit it in 18 months.

If the answer is still "go look at each brain individually," the NOW phase isn't done.

---

## 7. NEAR-TERM Roadmap — 8–16 Weeks

Each item builds directly on a NOW deliverable.

1. **First Tier 3 derived metric — Corridor Factor.** The "Park Factor" analog. Lives in `refinery/lib/derived/corridor-factor.mts`. Pure deterministic. Inputs: corridor profile + seasonal index + sector mix + macro context. Output: a single multiplier that normalizes business performance by location advantage. A coffee shop doing $1.5M in downtown Naples might be _underperforming_ relative to the corridor; one doing $900K in Lehigh Acres might be _overperforming_. Consumed by `cre-swfl` and `franchise-outcomes` as enrichment.
2. **Constitutional master brain (YAML).** Lift the inline rules from NOW step 6.1 into `refinery/constitution/master.yaml`. Encode: absolute constraints (flood veto, NAICS distress override), logical consistency rules (rising rates + flat employment = headwind), domain hierarchy for contradiction resolution.
3. **2-round critique-revision loop** at master synthesis time. Draft → constitution check → revise → final check → if still violating, emit `LOW_CONFIDENCE_HUMAN_REVIEW`. Research shows diminishing returns after 2 rounds; we hard-cap there.
4. **Yager-DST confidence upgrade.** Replace multiplicative propagation in `confidence.mts` with belief/disbelief/ignorance modeling. Conflict mass routed to ignorance. Reliability discounting per DAG hop. This is the math that lets us honestly report disagreement.
5. **GraphRAG indexing** for LightBox articles, news feeds, and any qualitative source. Extract entity-relationship triples. Cluster into community summaries. Master queries via global/local search for narrative context. Sits beside the deterministic math layer, doesn't replace it.
6. **Spatial oracle.** Supabase RPC `corridor_for_point(lat, lon)`. Unlocks `Brand → located_in → Corridor` relationship and every downstream spatial query (proximity, gap detection, competitive density).

---

## 8. LONG-TERM Roadmap — 16+ Weeks

These are the moves that turn correlation into causation and turn manual runs into an autonomous system.

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
7. **Fine-tuned Littlebird.** The outcomes table (seeded in NOW step 6.1.4) becomes training data. The Constitution stops being a prompt and starts being weights. The anti-inference-bait rules stop being a regex and start being learned behavior.
8. **Additional brain domains** activated as data comes online:
   - `environmental` — flood, storm, climate, sea-level.
   - `demographics` — Census, migration, income trends.
   - `logistics` — corridors as flow networks (traffic, freight, accessibility).
   - `hospitality` — hotel ADR, STR pricing, occupancy beyond TDT.

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

## Changelog

- **2026-05-15 — v1.0.** Initial roadmap. Five brains live. Multiplicative confidence in production. Master is an index, not yet a synthesizer. Tourism-TDT, derived metrics, constitution, Yager-DST, causal layer, scheduled runs all on the roadmap. First wire-up: promote master from index to synthesizer.
