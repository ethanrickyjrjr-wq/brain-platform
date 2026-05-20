# Master Synthesizer — V3 Spec (Locked)

| Field            | Value                                                                              |
| ---------------- | ---------------------------------------------------------------------------------- |
| **Version**      | V3 (final, spec-locked)                                                            |
| **Status**       | Ready for Session 1 implementation                                                 |
| **Last updated** | 2026-05-15                                                                         |
| **Source plan**  | `C:\Users\ethan\.claude\plans\using-some-articles-we-squishy-melody.md` (v4-final) |
| **Roadmap**      | `docs/ontology-and-roadmap.md`                                                     |

This document is the implementation contract for the master brain synthesizer. Every formula, threshold, and field is locked. Implementers should not make discretionary calls — open the relevant section and follow the spec.

---

## 1. OUTPUT Contract

All brains emit this shape. Master reads this from upstreams and emits it itself.

```typescript
type BrainOutput = {
  brain_id: string;
  version: number;
  refined_at: ISO8601;

  // Direction & magnitude
  direction: "bullish" | "bearish" | "neutral" | "mixed";
  magnitude: number; // 0.0 to 1.0
  drivers: string[]; // brain ids contributing to direction
  overrides: string[]; // veto/override ids that fired

  // Synthesis
  conclusion: string;
  key_metrics: BrainOutputMetric[];
  caveats: string[];
  contradicts: string[];

  // Confidence & provenance
  confidence: number;
  trust_tier: 1 | 2 | 3 | 4;
  upstream_count: number; // number of upstreams that passed relevance floor

  // Temporal
  relevance: {
    decay_curve: "hours" | "days" | "weeks" | "months" | "permanent";
    half_life_hours: number;
    computed_at: ISO8601;
  };

  // Reserved (empty in v1, populated by Context Signal Brain Week 6-8)
  exogenous_signals?: ExogenousSignal[];
};

type ExogenousSignal = {
  signal_type:
    | "injury"
    | "weather"
    | "policy"
    | "conflict"
    | "market_shock"
    | "other";
  entity: string;
  direction: "bullish" | "bearish" | "neutral";
  severity: "critical" | "major" | "moderate" | "minor";
  confidence: number;
  classification: "confirmed" | "rumored" | "speculative";
  decay_curve: "hours" | "days" | "weeks" | "months";
  source: string;
  observed_at: ISO8601;
};
```

---

## 2. Master Synthesis — Steps 0 through 8

### Step 0 — Relevance computation per upstream

For each upstream brain `b`:

```
relevance_factor(b) = 0.5 ^ ((now - b.relevance.computed_at_hours) / b.relevance.half_life_hours)
```

Capped at 1.0, floored at 0.0. `relevance_factor = 1.0` means brand new; `0.5` means one half-life old; `0.05` means heavily decayed.

### Step 1 — Relevance floor exclusion

Constitution provides `relevance_floor: number` (default `0.10`). Any upstream `b` where `relevance_factor(b) < relevance_floor` is excluded from:

- Direction voting
- Contradiction detection
- Key metrics rollup

Excluded brains generate a caveat: `"{brain_id} excluded from synthesis (relevance {x}, below floor {y})"`. `upstream_count` = number of upstreams that **passed** the floor. `upstream_count == 0` means insufficient data → Step 8.

### Step 2 — Direction voting + magnitude (with Mixed-Direction split)

For each direction `d ∈ {bullish, bearish, neutral}`:

```
weight(d) = Σ (b.magnitude × b.confidence × relevance_factor(b))
            for all b with b.direction == d, b above relevance floor
```

For upstream brains where `b.direction == "mixed"` (legitimate uncertainty), split their weight evenly between bullish and bearish — a mixed upstream injects its uncertainty into both buckets:

```
for each b above floor where b.direction == "mixed":
    w = b.magnitude × b.confidence × relevance_factor(b)
    weight(bullish) += 0.5 × w
    weight(bearish) += 0.5 × w
```

This lowers `agreement_ratio` proportional to mixed-brain weight, naturally making master more likely to also emit `"mixed"` — the honest representation of inherited uncertainty.

```
total_weight = weight(bullish) + weight(bearish) + weight(neutral)
agreement_ratio = max(weight(d)) / total_weight
winning_direction = argmax(weight(d))

if agreement_ratio >= 0.60:
    direction = winning_direction
    magnitude = agreement_ratio × (avg b.magnitude for b on winning side)
else:
    direction = "mixed"
    magnitude = agreement_ratio
```

A stale or low-confidence brain contributes proportionally less. High magnitude requires both strong agreement AND strong individual reads.

### Step 3 — Override cascade (priority-ordered)

Constitution's `overrideCascade` is an ordered array of rules:

```typescript
type OverrideRule = {
  priority: number;
  condition: (upstreams, signals) => boolean;
  effect:
    | "force_signal_direction"
    | "force_bearish"
    | "force_bullish"
    | "add_caveat";
  override_id: string;
};
```

Rules evaluate in priority order (high to low). First match in each direction-forcing category wins. Multiple `add_caveat` rules can stack.

Initial cascade in `real-estate.ts`:

```
{ priority: 100, condition: any signal with severity="critical" + classification="confirmed" + confidence > 0.85,
  effect: "force_signal_direction", override_id: "exogenous-critical-confirmed" }
{ priority: 90,  condition: any upstream emits matching pair swfl_zip_<ZIP>_barrier_island_score === 1.0 AND swfl_zip_<ZIP>_flood_aal_usd_per_insured_property >= 800,
  effect: "add_caveat", override_id: "flood-barrier-mode-1" }
{ priority: 80,  condition: NAICS distress above baseline AND rising,
  effect: "force_bearish", override_id: "naics-distress-veto" }
```

When an override fires:

- `direction` is forced to the override's effect (direction-forcing effects only: `force_bearish`, `force_bullish`, `force_signal_direction`).
- `magnitude` is set to `max(current_magnitude, 0.85)` (direction-forcing effects only).
- `override_id` is appended to `overrides[]`.
- A caveat is generated naming the override.

`add_caveat` effects (e.g. `flood-barrier-mode-1`) skip the direction and magnitude steps — they append `override_id` + caveat only. Master's direction synthesis continues to drive the read; the override is a modifier, not a kill-switch.

### Step 4 — Contradiction detection

Only between brains above the relevance floor. For each pair `(a, b)` where `a.direction != b.direction` AND both are non-neutral AND both have `confidence > 0.5`:

```
contradicts.push(`{a.brain_id} ({a.direction}) vs {b.brain_id} ({b.direction})`)
```

### Step 5 — Conclusion templating (deterministic)

V1 produces conclusion via template composition, not LLM. Template:

```
"{direction_clause} ({magnitude_descriptor} magnitude). " +
"Driven by: {comma-separated drivers}. " +
(overrides ? "Overrides: {comma-separated overrides}. " : "") +
(contradicts ? "Note conflicts: {first contradict}. " : "") +
"Combined confidence {confidence}, trust tier T{trust_tier}, " +
"based on {upstream_count} upstream brain{s}."
```

Where:

- `direction_clause` ∈ `{"Read is bullish", "Read is bearish", "Read is neutral", "Read is mixed"}`
- `magnitude_descriptor` ∈ `{"high" (≥0.75), "moderate" (0.40–0.75), "low" (<0.40)}`

### Step 6 — Key metrics rollup

For each upstream above floor: take its top 1–2 metrics (by `b.key_metrics[0..1]`). Master's `key_metrics` is the concatenation, capped at 8 total. If franchise-outcomes contributes zero metrics, the mandatory backfill fixes that bug at the source.

**Tiebreak rule (reserve-then-fill, shipped Session 8):** the rollup is ordering-independent. Pass 1 reserves one seat per passing upstream so every brain that produced any metric is represented (a T1 brain at the end of `input_brains` cannot lose its slot to T2 brains that ran earlier). Pass 2 fills remaining slots from each upstream's second metric, ranked by `upstream.trust_tier` ascending, then `upstream.confidence × upstream.relevance_factor` descending, with DAG order as the final tiebreak. If reservation alone overflows (passing.length > 8), the reservation is trimmed by the same ranking rule rather than DAG order.

### Step 7 — Trust tier + decay propagation

```
trust_tier = max(b.trust_tier for b above floor)   // worst (highest number) wins

master.relevance.half_life_hours = weighted_avg(
    b.relevance.half_life_hours,
    weighted by b.magnitude × b.confidence × relevance_factor(b)
) for all b above floor

master.relevance.decay_curve = quantize(master.relevance.half_life_hours)
    // → "hours" if <72, "days" if <500, "weeks" if <2000, "months" if <8760, "permanent"

master.relevance.computed_at = now
```

A single fast-decaying input pulls master's freshness down proportionally to its importance, but doesn't override stable inputs.

### Step 8 — Empty synthesis case

If `upstream_count == 0` (all upstreams below floor):

```json
{
  "direction": "neutral",
  "magnitude": 0,
  "drivers": [],
  "overrides": [],
  "conclusion": "Insufficient current data for synthesis. {N} upstream brains below relevance floor {f}.",
  "key_metrics": [],
  "caveats": ["All upstream brains below relevance threshold"],
  "contradicts": [],
  "confidence": 0,
  "trust_tier": 4,
  "upstream_count": 0,
  "relevance": {
    "decay_curve": "hours",
    "half_life_hours": 24,
    "computed_at": "{now}"
  },
  "exogenous_signals": []
}
```

Master NEVER hallucinates a conclusion from nothing. Downstream Claude can detect `upstream_count == 0` and refuse to answer.

---

## 3. Constitution Shape

```typescript
type Constitution = {
  domains: BrainDomain[];
  relevance_floor: number; // default 0.10
  absoluteConstraints: ConstraintRule[];
  overrideCascade: OverrideRule[]; // priority-ordered
  domainHierarchy: DomainOrderRule[];
  caveatGenerators: CaveatGenerator[];
};
```

Files in `refinery/constitution/`:

- `index.ts` — `loadConstitution(domains: BrainDomain[])` returns a merged `Constitution`.
- `types.ts` — type definitions.
- `real-estate.ts` — flood-barrier-mode-1 caveat, NAICS distress veto, override cascade, relevance_floor = 0.10.
- `finance.ts` — rising-rates-dominance, relevance_floor = 0.10.

YAML migration scheduled Week 8–10 once rule count crosses ~5 per domain.

---

## 4. Locked Decisions

| Issue                             | Decision                                                                   |
| --------------------------------- | -------------------------------------------------------------------------- |
| Master count                      | ONE                                                                        |
| Synthesis strategy v1             | `deterministic` (pure code)                                                |
| LLM injection point               | `synthesisStrategy` field on pack                                          |
| Constitution format v1            | TypeScript                                                                 |
| Constitution format Week 8–10     | YAML migration                                                             |
| Franchise-outcomes metrics        | MANDATORY backfill Week 1                                                  |
| Tourism-tdt timing                | Week 4–5 (split from Context Signal)                                       |
| Context Signal Brain timing       | Week 6–8 (NOAA storm alerts first source)                                  |
| Decay propagation                 | Weighted average of half-lives (NOT minimum)                               |
| Direction granularity             | 4-value enum + numeric `magnitude`                                         |
| Override cascade ordering         | Priority numbers per rule                                                  |
| Override cascade bullish signals  | Force the SIGNAL'S direction, not always bearish                           |
| Mixed upstream direction          | Split weight 50/50 across bullish/bearish — honest uncertainty propagation |
| Empty synthesis handling          | Explicit "insufficient data" mode, never hallucinate                       |
| Relevance floor                   | 0.10 default, constitution-overridable                                     |
| Janitor between master and brains | NOT needed — outputProducer + thin-pipe rule                               |
| Black Belt brains                 | Implicit DAG capability, no design needed yet                              |
| Source-layer tagging discipline   | Wrap full table; brains select columns; ontology IS the registry           |

---

## 5. Verification — 15 Acceptance Tests

**Core synthesis (5):**

1. All 5 brains refine clean (`npm run refinery <id> --force`).
2. Every OUTPUT block contains v3 shape (all fields present, `exogenous_signals` empty or absent).
3. `brains/master.md`: conclusion cites 3+ upstream brains via citation syntax; `key_metrics` includes a franchise-outcomes metric; `direction` valid; `magnitude` ∈ [0,1]; `drivers` non-empty; `overrides` empty in v1; `upstream_count` matches active inputs; `relevance.half_life_hours` is a weighted average.
4. `inference-bait-lint` passes clean on master.
5. Supabase `predictions` row written (if `SUPABASE_URL` set); silent no-op otherwise.

**Edge cases (10):**

6. **All upstreams agree.** All 4 bearish at 0.8+. Expect: direction=bearish, magnitude > 0.75, contradicts=[].
7. **Contradiction.** macro-swfl bullish 0.7, sector-credit bearish 0.7. Expect: contradicts populates, direction may be "mixed".
8. **Override — exogenous bullish.** Inject `exogenous_signals: [{direction:"bullish", severity:"critical", confidence:0.9, classification:"confirmed"}]`. Expect: direction=bullish, overrides contains `"exogenous-critical-confirmed"`.
9. **Override — flood-barrier-mode-1.** Inject `swfl_zip_33931_barrier_island_score: 1.0` and `swfl_zip_33931_flood_aal_usd_per_insured_property: 1000`. Expect: overrides contains `"flood-barrier-mode-1"`, caveat present, direction NOT forced (`add_caveat` is a modifier — master's direction synthesis still drives the read).
10. **Override stacking.** Both flood-barrier-mode-1 (90, `add_caveat`) AND critical bullish signal (100, `force_signal_direction`). Expect: direction=bullish (priority 100 forces direction); `overrides` contains both; flood-barrier-mode-1 caveat documents the barrier exposure under the bullish read.
11. **Decay floor exclusion.** Upstream 30 days old, half_life_hours=168 → relevance ≈ 0.04 < 0.10. Expect: brain excluded, caveat lists exclusion, upstream_count drops.
12. **Empty synthesis.** All 4 below floor. Expect: direction="neutral", magnitude=0, conclusion contains "Insufficient current data", upstream_count=0, trust_tier=4.
13. **Single upstream.** Only 1 above floor. Expect: no crash, trust_tier inherits, upstream_count=1.
14. **Malformed upstream OUTPUT.** Invalid JSON in one upstream. Expect: graceful skip with caveat, no crash.
15. **Mixed-direction upstream.** 2 bearish at 0.7, 1 mixed at 0.6. Expect: split weight reduces bearish agreement_ratio below 0.60, master emits direction="mixed", caveat references mixed upstream.

Tests 6–15 should run as fixtures independent of live refinery.

---

## 6. Implementation Pointers

**Reuse:**

- `refinery/sources/brain-input-source.mts` — `makeBrainInputSource()` handles OUTPUT parsing.
- `refinery/packs/macro-swfl.mts:144-209` — `macroSwflOutputProducer` is the proven pure-code template.
- `refinery/lib/confidence.mts` — multiplicative formula stays through v3 (Yager-DST is Month 4+).
- `refinery/lib/dag.mts` — topo sort + cycle detect.
- `refinery/scaffold.mts` — atomic per-pack creation.

**Functions to write in `masterSynthesizerOutputProducer`:**

- `computeRelevanceFactor(b, now)`
- `applyRelevanceFloor(upstreams, constitution)`
- `voteDirection(upstreams)` — includes the mixed-direction split
- `applyOverrideCascade(upstreams, signals, constitution)`
- `detectContradictions(upstreams)`
- `composeConclusion(direction, magnitude, drivers, overrides, contradicts, confidence, trust_tier, upstream_count)`
- `rollupKeyMetrics(upstreams)`
- `propagateDecay(upstreams)`
- `emptySynthesisResult(originalCount, floor, now)`

Each is independently testable. Tests 6–15 map to these functions plus integration.

---

## 7. What's Explicitly NOT in V3

- Yager-DST math (Month 4+)
- Runtime master / query-time synthesis (Month 4+)
- Causal layer / IV / synthetic controls / DID (Month 4+)
- GraphRAG (Month 4+)
- Scheduled runs / watch-list / real-time subscriptions (Month 4+)
- Multi-agent inference (Month 4+)
- Fine-tuned Littlebird (Month 4+)
- LLM-assisted conclusion synthesis (slot designed, Month 4+ fills it)
- Sports / Aaron Judge brains (architecture supports them with zero master changes)
- Black Belt / domain-synthesis brains (implicit DAG capability)
- Global tag registry separate from ontology (ontology IS the registry)
