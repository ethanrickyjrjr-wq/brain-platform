# Arsenal Master Stack

<!-- Planning artifact. Updated after each research session. -->

| Field        | Value                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Version      | 3.1                                                                                                                        |
| Last updated | 2026-05-16                                                                                                                 |
| Sources      | Session 3 research + LB / Talisman deep dive + Backprop/Stack Graph integration session + Session 7 dlt vendor-first audit |
| Next action  | Wire `tourism-tdt` into `master.input_brains` after a live-mode gauntlet returns 0 orphans on `fl_dor_tdt_collections`     |

---

## Design Principles (non-negotiable, baked in forever)

The platform rests on **four architectural pillars**. Each pillar names a separate concern (meaning, routing, calibration, tooling) and pairs symbolic GOFAI machinery with deterministic numerical math. Together they compose into a Bayesian stack: prior → evidence → posterior, with the LLM responsible only for narrative synthesis on top of facts the system can prove. Two operating disciplines (Never Skip Pipeline Stages, Outcome First) gate how we sequence work across the pillars. The capstone diagram at the end shows how the pillars compose.

### Pillar 1 — SKOS Disambiguation Ledger (GOFAI Bridge)

SKOS is Good Old-Fashioned AI — symbolic, deterministic, explicit. We give the LLM unambiguous facts via a controlled vocabulary; it synthesizes, it does not guess. An AI-generated vocabulary without definitions is just a list. Lists are not knowledge infrastructure.

This pillar is the **Talisman pipeline stage tracker**. We are explicitly closing the gap from Stage 3 (metadata standards, live today via frontmatter + freshness tokens) to Stage 4 (SKOS Thesaurus, this sprint's goal). No OWL (Stage 5) or Knowledge Graph (Stage 6) until Stage 4 is stable — `vocab_pipeline_stage: 4` is tracked as a registry field so the discipline is machine-checkable, not just a written rule.

**Files this pillar touches (downstream — separate execution sessions):**

- `refinery/vocab/brain-vocabulary.json` (NEW)
- `docs/vocab-audit.md` (NEW)
- `refinery/stages/2.5-normalize.mts` (NEW); hooked between triage and synthesis in `refinery/cli.mts`

**Arsenal items owned:** Tier 1 #1, #2, #3; Tier 2 #14 (notation codes), #15 (stage map); Tier 3 #20 (governance).

### Pillar 2 — Stack Graphs Where SKOS Resolves Meaning

Our DAG resolves _where_ a reference points (which brain produced a given OUTPUT key); SKOS resolves _what_ the reference means at that site (which canonical concept the key denotes). This is the **Stack Graph pattern**, named explicitly. `walkConsumers` in `refinery/lib/dag.mts` is already a Stack Graph traversal; v3.0 makes the naming official with a doc-comment header on the file.

**Tree-sitter via Serena is not just a parser fallback — it is the upgrade path for our validators.** Today `inference-bait-lint.mts` is a regex catching one pattern; `spec-validator.mts` extracts sections via a brittle line scan guarded by `/^--- .* ---$/` (brittle to `---OUTPUT---`, extra spaces, leading whitespace, any drift). A markdown parse tree + Serena's symbol intelligence catches causal verbs linking two brain IDs (roadmap §6.1.3), numeric claims that contradict deterministic `key_metrics`, and synthesis-without-citation patterns. **Validators get smarter, not just safer.**

**Files this pillar touches (downstream):**

- Doc-comment header in `refinery/lib/dag.mts` naming the Stack Graph pattern (Tier 1 #1.5, 15-min edit).
- Doc-comment + backlog ticket in `refinery/validate/spec-validator.mts` for the tree-sitter swap.
- `refinery/validate/inference-bait-lint.mts` — Tier 2 upgrade path (parse tree replaces regex once Serena/tree-sitter is wired).

**Arsenal items owned:** Tier 1 #1.5 (Stack Graph annotation); Tier 2 #17 (parse-tree-backed lints, depends on Tier 1 #8 Serena). Reframes the `github/semantic` SKIP entry — the concept was right, the library was archived.

### Pillar 3 — Feedforward / Backprop Confidence Engine

The brain DAG is a feedforward network. Source connectors = input layer. Refinery stages 1–4 = hidden layers. `--- OUTPUT ---` = output layer. Trust tiers = weights. Topo sort = layer ordering. The confidence formula IS a forward pass — which means **error attribution IS a backward pass**. We already built both; v3.0 just names them.

Math is explicit:

```
forward:  confidence = avg(trust_tier_score) × freshness_ratio
adjoint:  ∂confidence / ∂trust_tier_score_i  =  confidence / trust_tier_score_i
```

Highest ratio = weakest link = source to fix first. `walkUpstream` (graph traversal) lives in `dag.mts`; `attributeError` (pure math, no graph awareness) lives in `confidence.mts`; Stage 4 composes them. **Auto-caveat behavior:** when final confidence < 0.6, Stage 4 calls `attributeError`, takes the top contributor, and appends `"Weakest contributor: source '{id}' (trust {score}, contribution {ratio})."` to `BrainOutput.caveats`. 0.6 is a starting threshold; tune after the first 10 brain refines.

**Files this pillar touches (downstream):**

- `refinery/lib/dag.mts` — add `walkUpstream(brainId, packs): string[]` (sibling to `walkConsumers`; traverses `input_brains` recursively).
- `refinery/lib/confidence.mts` — add `attributeError({sources, confidence})` returning `[{sourceId, errorContribution}]` sorted descending.
- `refinery/stages/4-output.mts` — call `attributeError` when final confidence < 0.6; append caveat.
- `docs/sql/brain_registry.sql` — `alter table source_connectors add column trust_tier_score numeric(3,2)` AND (per SM-2) `alter table outcomes add column attribution jsonb` so the SGD calibration corpus builds itself from refine #1.

**Arsenal items owned:** Tier 1 #4 (`attributeError` + `walkUpstream`), Tier 1 #5 (mutable `trust_tier_score` + outcomes.attribution). Tier 4 #27 (Adaptive Trust Tiers via SGD — gated on outcome count, not calendar time, per SM-2).

### Pillar 4 — Tooling: dlt + Serena Wired Now

**Enablers belong in Tier 1 when they unlock Tier 1 work.** This is the operating rule v3.0 makes explicit. dlt unlocks tourism-tdt (Tier 1 #6) with auto-schema inference + lineage. Serena unlocks the metric audit (Tier 1 #2) with symbol-level cross-pack search, and is the substrate for the tree-sitter validator upgrade in Pillar 2.

**Files this pillar touches (downstream):**

- `refinery/sources/dlt-source.mts` (NEW — implements the existing `Source` interface; tourism-tdt switches to it as its first user).
- Serena MCP server config addition; no in-repo code, used as a tool during the audit (#2) and validator work (Tier 2 #17).

**Arsenal items owned:** Tier 1 #7 (dlt intake — promoted from v2.0 Tier 2 #8); Tier 1 #8 (Serena MCP — promoted from v2.0 Tier 3 #17). Both promotions documented in the changelog.

### Never Skip Pipeline Stages _(Talisman warning, kept verbatim from v2.0)_

Vocabulary → Thesaurus → Ontology → Knowledge Graph. Each stage requires the previous one to be clean. Do NOT attempt OWL reasoning or a Knowledge Graph until the vocab and thesaurus are stable. Skipping stages is how you get a beautiful graph of bad data.

### Outcome First _(from ontology-and-roadmap.md §2, kept verbatim from v2.0)_

Name the customer-facing outcome before decomposing into brain needs. "What should this customer decide?" → "Which brains answer that?" → "What data is missing?"

### Capstone — The Bayesian Stack _(SM-4)_

The four pillars compose into a coherent Math-Honest Bayesian architecture. Constitution (Tier 3 #18) is the prior; SKOS (Pillar 1) provides canonical evidence labels; Yager-DST (Tier 2 #16, per SM-1) produces a belief/disbelief/ignorance posterior. The LLM only narrates over facts the system can prove.

```
                  CONSTITUTION  (Tier 3 #18)
                       │   prior beliefs (flood veto, NAICS distress, macro-overrides-local)
                       ▼
                ┌──────────────────┐
SOURCES ─────►  │   SKOS LEDGER    │ ◄──── canonical evidence labels (Pillar 1)
                │   (Stage 2.5)    │
                └────────┬─────────┘
                         │ deterministic concept equality
                         ▼
                  ┌─────────────┐
                  │  YAGER-DST  │   belief / disbelief / ignorance (Tier 2 #16, per SM-1)
                  └──────┬──────┘
                         │ posterior with honest ignorance mass
                         ▼
                     OUTPUT BLOCK  ◄── LLM narrates over proven facts only
```

This is the answer to "why isn't this just another RAG chatbot." A RAG chatbot retrieves text and asks the model to summarize. We compute the posterior in code, label the evidence in SKOS, anchor the prior in a constitution, and let the LLM produce only the qualitative synthesis. Three of the four moves are deterministic; the fourth is narrative.

---

## TIER 1 — NOW

_Next coding session(s). All items block immediate customer value._

**Lane structure.** Talisman discipline forces the SKOS chain serial (Stage 2 → 3 → 4 — you cannot start Stage 4 before Stage 3 closes). Backprop math and tooling setup share no state with SKOS, so they run in parallel.

```
LANE A — SKOS chain (STRICTLY SERIAL, Talisman discipline)
  #2 vocab-audit  →  #1 brain-vocabulary.json  →  #3 Stage 2.5 normalization

LANE B — Backprop chain (SERIAL within lane, parallel to A)
  #5 mutable trust_tier_score + outcomes.attribution  →  #4 attributeError + walkUpstream

LANE C — Tooling enablers (PARALLEL to both lanes, unblock A and B)
  #8 Serena MCP wired  ←  enables #2 audit
  (#7 dlt-source.mts MOVED to Tier 2 per v3.1 — vendor-first audit found
   dlt is Python-only and tourism-tdt's data already lives in Supabase,
   so the "dlt unlocks Lane D" premise was false.)

LANE D — Brain delivery (DEPENDS ON Lane A finished)
  #6 tourism-tdt brain  (native @supabase/supabase-js reader against
                         fl_dor_tdt_collections — same shape as cre-source)

CROSS-CUTTING (concurrent, ~15-min doc work, anytime)
  #1.5 Stack Graph annotation in dag.mts + tree-sitter fallback note in spec-validator.mts
```

**Parallel-pair groupings for execution sessions:**

- **Pair 1 (parallel):** Lane A `#2 audit` ∥ Lane B `#5 trust_tier_score + outcomes.attribution migration` ∥ Lane C `#8 Serena wired`.
- **Pair 2 (parallel, post-v3.1):** Lane A `#3 Stage 2.5` ∥ Lane B `#4 attributeError + walkUpstream`. Lane C's #7 dlt slot is empty; #8 Serena is the only Lane C item in Tier 1.
- **Lane D `#6 tourism-tdt`** lands after Lane A finishes — no dlt gate. Native Supabase reader against `fl_dor_tdt_collections` (v3.1 correction).

**Total Tier 1: 8 items + 1 micro-item** (was 6 in v2.0).

### 1. SKOS Vocabulary File — 7-Layer Structure

**File:** `refinery/vocab/brain-vocabulary.json`

Build the file using all 7 layers of the ISO 25964 / SKOS toolkit in this order:

| Layer | Element             | Example                                                |
| ----- | ------------------- | ------------------------------------------------------ |
| 1     | URI Identity        | `"id": "RE-001"` — stable machine key                  |
| 2     | Labels              | `prefLabel`, `altLabels`, `hiddenLabel` (search-only)  |
| 3     | Scope Note          | Domain-specific constraint, NOT dictionary definition  |
| 4     | Hierarchy           | `broader` / `narrower` parent-child                    |
| 5     | Mapping             | `exactMatch` / `closeMatch` across brain keys          |
| 6     | Notation Code       | `"notation": "RE-001"` — ISO 25964 classification code |
| 7     | Faceted Collections | Group by domain facet (real-estate, finance, macro)    |

Starter entries: `bullish` / `bearish` (market direction), `vacancy_rate`, `cap_rate`, `cap_rate_spread`, `direction`, `confidence`. These are the cross-brain collisions we already know about.

```json
{
  "scheme": "Brain Platform Vocabulary",
  "concepts": {
    "MD-001": {
      "prefLabel": "bullish",
      "altLabels": ["positive", "upward", "improving"],
      "hiddenLabel": ["up", "green"],
      "broader": "MD-000",
      "scopeNote": {
        "cre-swfl": "local occupancy and cap rate conditions improving",
        "macro-swfl": "macro credit environment loosening",
        "sector-credit-swfl": "sector lending conditions easing"
      },
      "notation": "MD-001",
      "collection": "market-direction"
    },
    "RE-001": {
      "prefLabel": "cap rate",
      "altLabels": ["capitalization rate", "cap_rate", "cap_rate_pct"],
      "broader": "RE-000",
      "scopeNote": {
        "cre-swfl": "net operating income / property value; rising = more risk-priced-in"
      },
      "notation": "RE-001",
      "mappings": {
        "exactMatch": ["cre-swfl:cap_rate_pct"]
      },
      "collection": "real-estate-metrics"
    }
  }
}
```

**Why NOW:** every downstream item (Stage 2.5, error attribution, cross-brain synthesis) depends on this being defined first.

**SM-3 sequencing note (Lane A).** Item #1 must define a **stub-lookup interface FIRST** so the master synthesizer (roadmap §6.1.1) can integrate against it before #3 (Stage 2.5) lands. The stub returns `{prefLabel: <raw key>, scopeNote: null}`; once Stage 2.5 ships, swap the stub for the real lookup — a one-line change in the synthesizer with no behavior break. Synthesizer doesn't wait; Stage 2.5 doesn't get skipped.

---

### 1.5. Stack Graph Annotation (micro-item, ~15 min)

**Files:** `refinery/lib/dag.mts` (doc-comment header) + `refinery/validate/spec-validator.mts` (doc-comment + recorded backlog ticket).

Name what `walkConsumers` already is — a Stack Graph traversal. Record the tree-sitter fallback ticket on `spec-validator.mts` (the line scan guarded by `/^--- .* ---$/` is brittle to `---OUTPUT---`, extra spaces, leading whitespace, or any drift in section markers). 15 minutes of doc work; pays dividends in onboarding and gives Pillar 2 its first concrete artifact.

---

### 2. 10K-to-2.5K Metric Collapse

**Deliverable:** `docs/vocab-audit.md` — a one-time audit table.

Walk every `key_metrics` key across all 5 brain OUTPUT blocks. List every distinct string. Group aliases. Propose the canonical `prefLabel` for each group. Output is the input spec for item #1 — it tells us exactly which concepts to put in `brain-vocabulary.json` first.

Real strings already present in `brains/master.md` OUTPUT: `overall_survival_rate`, `cap_rate_median`, `vacancy_rate_median`, `sofr_rate`, `fl_unemployment`, `best_naics_survival`, `worst_naics_chargeoff`. Likely collapses across the wider corpus: `vacancy_rate_pct` / `vacancy_rate` / `empty_unit_ratio`; `cap_rate` / `cap_rate_pct` / `capitalization_rate`; `direction` (appears in every brain, means subtly different things).

**Lane C enabler.** Serena (#8 below) provides the symbol-level cross-pack search that turns this audit from hours into minutes.

**Why NOW:** without this audit, item #1 is guessing. This is the 20-minute step that makes item #1 10× faster to write.

---

### 3. Master Brain Synthesizer — Stage 2.5 Concept Normalization

**Files:** `refinery/stages/2.5-normalize.mts` (NEW) + hook in `refinery/cli.mts` between triage and synthesis stages.

Add Stage 2.5 between existing stages 2 and 3:

1. For each metric key in each brain's OUTPUT block, look up key in `brain-vocabulary.json`.
2. Normalize `altLabels` → `prefLabel`.
3. Attach `scopeNote` for domain context.
4. Tag any cross-brain `closeMatch` pairs for the synthesizer as **convergent** or **divergent signal**.

This is what lets master say: "cre-swfl's `vacancy_rate_pct` and tourism-tdt's `empty_unit_ratio` are `exactMatch` — they're describing the same thing from different angles."

**Bonus add #4 — consumption-contract extension.** When a metric appears in OUTPUT and has a `scopeNote` for the current brain, Claude quotes that scopeNote verbatim on first interpretation. Same enforcement pattern as freshness tokens — already a proven contract mechanism. Add to `docs/consumption-contract.md` the moment #3 ships.

---

### 4. `attributeError()` + `walkUpstream()`

**Files:** `refinery/lib/confidence.mts` (pure math) + `refinery/lib/dag.mts` (graph walk).

```typescript
// refinery/lib/dag.mts (NEW — sibling to walkConsumers + resolveBuildOrder)
export function walkUpstream(
  brainId: string,
  packs: PackDefinition[],
): string[] {
  // Recursive traversal of input_brains; ordered shallow→deep.
  // Matches walkConsumers's contract for symmetry.
}

// refinery/lib/confidence.mts (NEW — pure math, no graph traversal)
export function attributeError(
  outputConfidence: number,
  sources: Array<{ id: string; trustTierScore: number }>,
): Array<{ id: string; errorContribution: number }> {
  return sources
    .map((s) => ({
      id: s.id,
      errorContribution: outputConfidence / s.trustTierScore,
    }))
    .sort((a, b) => b.errorContribution - a.errorContribution);
}
```

Math: `∂confidence / ∂trust_tier_score_i = confidence / trust_tier_score_i`. Highest ratio = weakest link = source to fix first. The backward pass on the forward-pass confidence formula.

**Bonus add #1 — module split.** `walkUpstream` lives in `dag.mts` (graph traversal stays here alongside `walkConsumers` and `resolveBuildOrder`). `attributeError` lives in `confidence.mts` (pure math, no graph awareness). Stage 4 composes them. Clean separation matches the existing module split — confidence.mts already filters `brain-input:*` sources to avoid double-counting; keeping it graph-free preserves that purity.

**Bonus add #3 — auto-caveat behavior.** Stage 4 (`refinery/stages/4-output.mts`) calls `attributeError` when `final_confidence < 0.6`, takes the top contributor, appends `"Weakest contributor: source '{id}' (trust {score}, contribution {ratio})."` to `BrainOutput.caveats`. Threshold 0.6 is a starting value; tune after the first 10 brain refines.

---

### 5. `trust_tier_score` Mutable in Supabase + `outcomes.attribution`

Today trust tier is a hardcoded TypeScript literal. Move it to a Supabase column so calibration (item #27 below) can update it without code deploys. **Per SM-2**, also add an `attribution` jsonb column to `outcomes` so the SGD calibration corpus (Tier 4 #27) builds itself from refine #1 onward — no calendar wait, just an outcome-count gate.

```sql
alter table source_connectors
  add column trust_tier_score numeric(3,2) not null default 0.8
  check (trust_tier_score between 0 and 1);

-- SM-2: wire attribution into outcomes from refine #1 so the SGD corpus accumulates.
alter table outcomes
  add column attribution jsonb;
```

Stage 4 writes `attribution` alongside the prediction. Tier 4 #27 stops being calendar-gated and starts being outcome-count-gated.

**Why NOW:** item #4 is useless without the trust_tier_score column — we'd compute which source needs calibration but have no way to persist the fix. And without the outcomes column, every refine before #27 lands is a lost data point.

---

### 6. `tourism-tdt` Brain (Lane D)

Already in roadmap §6.2. TDT data is live in the premise-engine Supabase (`fl_dor_tdt_collections`, Lee County, 103 rows FY2013–FY2026). Per v3.1, the source is a thin native `@supabase/supabase-js` reader mirroring `cre-source.mts` — not a dlt-wrapped fetcher. Ship before the "Fort Myers Beach lease" acceptance test (§6.4) can run.

**Lane D gate.** Depends on Stage 2.5 live (Lane A) only — the v3.0 dlt gate was removed in v3.1 once the audit confirmed dlt adds no value for an already-in-Supabase source. Wiring `tourism-tdt` INTO `master.input_brains` is a separate follow-up after a live-mode gauntlet on `fl_dor_tdt_collections` returns 0 orphans (same discipline as Session 6).

**Live-mode pre-req (Session 7 finding).** The brain-platform read-only role needs `SELECT` granted on `fl_dor_tdt_collections` (and the table must be reachable in the `public` schema PostgREST exposes). First live attempt returned `permission denied for table fl_dor_tdt_collections`. The pack ships fixture-passing today; live-mode unblock is a grant + RLS-policy task on the premise-engine Supabase.

---

### 7. ~~dlt Intake — `tourism-tdt` as First User~~ _(MOVED to Tier 2 #10 per v3.1 vendor-first audit)_

Slot intentionally left as a redirect so external doc anchors and prior session notes don't rot. See the v3.1 changelog entry for the full audit finding; the short version is: dlt is Python-only, tourism-tdt's data already lives in our Supabase, and brain-platform's next ~6 source candidates are government APIs / Supabase views — none of which exercise dlt's verified-source catalog. The "enablers belong in Tier 1 when they unlock Tier 1 work" rule (Pillar 4) cut both ways and removed dlt from Tier 1.

---

### 8. Serena MCP — Semantic Code Intelligence Wired _(PROMOTED from v2.0 Tier 3 #17)_

Symbol-level code intelligence, 40+ languages. MCP server config addition — no in-repo code. Wired now because:

1. **Enables Tier 1 #2 audit.** Cross-pack search for every `key_metrics` key happens in minutes, not hours.
2. **Substrate for Pillar 2 validator upgrade.** Once Serena is up, the new Tier 2 #17 item (parse-tree-backed lints) can land.
3. **General refinery navigation.** Tracing a confidence computation across files; auditing which packs reference a given source connector.

**Why promoted:** user directive ("wire now"). The audit (#2), the vocab governance validation matrix (Tier 3 #20), and the validator upgrade (Tier 2 #17) all depend on it.

---

## TIER 2 — SHORT-TERM

_Weeks 2–6. Each item unblocks a brain capability._

### 9. SHACL Intake Validation

Closed-world validation at the moment data enters a source connector. Before a record touches Stage 1, it must conform to the SHACL shape for its domain. Reject on failure — don't silently let bad data degrade confidence.

Tool: Open Ontologies MCP (#11 below) has 43 tools including SHACL validators. Use it rather than writing a validator from scratch.

### 10. dlt Intake Pipeline _(RE-ENTERED at Tier 2 per v3.1 vendor-first audit; previously routed Tier 2 #8 → Tier 1 #7 → here)_

Python-based ETL with schema inference, incremental loading, and a Supabase destination. 5,000+ verified source connectors. Wraps fetch/transform/load loops we currently hand-code per source.

**Why Tier 2 (not Tier 1).** dlt's leverage scales with how painful the equivalent hand-rolled source would be. Brain-platform's current and queued sources are FRED (live, ~240 lines TS, works), SBA (live), Census (REST, FRED-shape), FEMA NFHL (polygons, not in dlt's catalog), Accela RSS (not in catalog), NOAA HURDAT2 (not in catalog), and Supabase views (trivial). None of these need dlt; forcing dlt onto them would add a Python sidecar tax for zero ingest value.

**Gate to promote back to Tier 1.** A source connector enters the queue where (a) the vendor is in dlt's verified-source catalog, AND (b) the hand-rolled shape would be ≥150 LOC of pagination, auth, or schema-evolution code. Stripe / Salesforce / HubSpot / Zendesk / Shopify are the canonical examples. When that first source lands, dlt re-promotes and that source becomes the template for the rest.

**Sidecar shape (when dlt lands).** Python sidecar (subprocess invoked from CLI, or long-running service) loads to a Supabase staging table; the TS source becomes a thin reader over the staging table. Deployment story to confirm before commit: Vercel runtime cannot run Python, so the sidecar lives on a separate host or runs as a local-only CLI job until brain-platform has a separate scheduled-worker tier.

### 11. Open Ontologies MCP

43 MCP tools. Oxigraph triple store (SPARQL endpoint). SHACL validation. OWL reasoning.

Wire as a sidecar MCP server. Use for: validating `brain-vocabulary.json` against SKOS schema, running SPARQL queries against the brain concept graph, SHACL validation of intake data.

### 12. Sirchmunk MCP

EmbeddingDB-free retrieval (Monte Carlo Evidence Sampling). DuckDB backend. MCP server included.

Use for: RAG without a vector DB, evidence sampling across brain OUTPUT blocks, fuzzy concept retrieval from `brain-vocabulary.json` when exact SKOS notation match fails.

### 13. Corridor Factor Brain

First Tier 3 derived metric. Pure deterministic. `refinery/lib/derived/corridor-factor.mts`. Inputs: corridor profile + seasonal index + sector mix + macro context. Output: a single multiplier normalizing business performance by location advantage.

Consumed by `cre-swfl` and `franchise-outcomes` as enrichment. Unblocks the "Pine Ridge" worked example in §9 of the roadmap.

### 14. ISO 25964 Notation Codes — Full Scheme

ISO 25964 is the international standard that SKOS implements. Notation codes (`skos:notation`) are the machine-comparable classification codes — they turn metric identity into a comparison test instead of a string match.

Full scheme: define code ranges per domain.

| Range  | Domain           |
| ------ | ---------------- |
| `MD-*` | Market Direction |
| `RE-*` | Real Estate      |
| `FI-*` | Finance          |
| `MA-*` | Macro            |
| `HO-*` | Hospitality      |
| `EN-*` | Environmental    |
| `DE-*` | Demographics     |
| `LO-*` | Logistics        |

### 15. Formal Pipeline Stage Mapping

Talisman frames the pipeline as 6 stages. Map our existing architecture to it explicitly:

| Talisman Stage           | Our Equivalent                                                    | Status           |
| ------------------------ | ----------------------------------------------------------------- | ---------------- |
| 1: Raw terms             | TypeScript metric key strings across brains                       | Live (scattered) |
| 2: Controlled vocabulary | `brain-vocabulary.json` prefLabel + altLabel                      | Tier 1 #1        |
| 3: Metadata standards    | Frontmatter + freshness tokens                                    | Live             |
| 4: SKOS Thesaurus        | Full `brain-vocabulary.json` with hierarchy + mappings + notation | Tier 1 #1 + #14  |
| 5: OWL reasoning         | —                                                                 | Tier 4 #30       |
| 6: Knowledge Graph       | —                                                                 | Tier 4 #31       |

The gap between Stage 3 (live) and Stage 4 (Tier 1 #1 + #14) is what we're closing in this sprint. Write a one-page `docs/vocab-pipeline-stages.md` mapping once Tier 1 #1 ships, so LB and future Claude start from the map, not a blank sheet.

**Bonus add #2 — `vocab_pipeline_stage: 4` tracked as a registry field** (location to be decided in execution session — likely `refinery/config/`). Prevents accidental Stage 5 (OWL) or Stage 6 (KG) work before Stage 4 is stable. Talisman discipline becomes machine-checkable instead of just a written rule.

### 16. Yager-DST _(PROMOTED from v2.0 Tier 3 #15, per SM-1)_

~30 LOC from textbook Yager 1987 in `refinery/lib/confidence-yager.mts`. Replaces multiplicative confidence with belief / disbelief / ignorance. Conflict mass → ignorance (not amplified disbelief). Ship behind `synthesisStrategy: "yager"` toggle. Do NOT depend on ERTool — empty repo. Math specified in roadmap §4.2.

**Why promoted:** Yager-DST's whole value is honestly reporting disagreement instead of averaging it away. "Disagreement" requires deterministic concept equality — i.e., SKOS. Without Pillar 1 you cannot even detect real contradiction. Once Stage 2.5 (Tier 1 #3) ships, Yager-DST's pre-req is satisfied and its value lights up immediately.

**Sequencing:** AFTER Tier 1 #3 (Stage 2.5) AND AFTER Tier 2 #17 (validator upgrade). Consumes roadmap §6.1.2 `contradicts: string[]` as deterministic SKOS-backed claims, not narrative — exactly the input Yager-DST is built for.

### 17. Validator Upgrade — Parse-Tree-Backed Lints _(NEW per SM-5)_

**Depends on Tier 1 #8 Serena being live.**

Today `inference-bait-lint.mts` is a regex catching one pattern; `spec-validator.mts` uses a brittle line scan. A markdown parse tree + Serena's symbol intelligence catches:

- Causal verbs linking two brain IDs (roadmap §6.1.3 already wants this).
- Numeric claims that contradict deterministic `key_metrics`.
- Synthesis-without-citation patterns.

Validators get smarter, not just safer. This is the Pillar 2 promise made concrete.

---

## TIER 3 — MEDIUM-TERM

_Weeks 6–16._

### 18. Constitution / GoRules Zen

At ≥20 rules across domains, evaluate GoRules Zen JDM (`github.com/gorules/zen`, 1.7k stars) against plain YAML. Pre-flight: Rust N-API on Vercel. Default is YAML at `refinery/constitution/master.yaml`. Encode: flood veto, NAICS distress override, macro-overrides-local. See roadmap §7.2.

### 19. ~~Yager-DST~~ _(MOVED to Tier 2 #16 per SM-1)_

Slot intentionally left as a redirect so external doc anchors and prior session notes don't rot.

### 20. Vocabulary Governance

Vocabulary degrades as brains expand unless there's a governance structure. Implement:

1. **Versioning:** `brain-vocabulary.json` gets a semver field. Minor = add concept. Major = rename/remove. Bumping major triggers a backfill audit.
2. **Ownership:** Each concept has an `owner` field — the brain ID that first defined it. Owner brain's maintainer is responsible for keeping the concept accurate.
3. **Validation matrices:** A test suite (`refinery/validate/vocab-lint.mts`) that runs on every vocab change:
   - Every brain OUTPUT key must map to a vocab notation code.
   - Every vocab concept must have a `prefLabel`, `broader`, and at least one `scopeNote`.
   - No orphan concepts (concepts with no brain using them).
4. **Change log:** Append-only `VOCAB_CHANGELOG.md` — date, what changed, which brain triggered the change.

**Bonus add #6 — implementation note.** Serena (Tier 1 #8) is the natural backend for the validation matrix. Symbol-level cross-file queries answer "every OUTPUT key maps to a notation code" and "no orphan concepts" in one pass each, without writing a custom AST walker.

### 21. ~~Serena MCP~~ _(MOVED to Tier 1 #8 per Pillar 4 promotion)_

Slot intentionally left as a redirect so external doc anchors and prior session notes don't rot.

### 22. Kindly Web Search MCP

Full content retrieval with native APIs. Replaces firecrawl for structured web lookups inside running brains. Use for news-tier (T4) source connectors — anything reading a live web page as input.

### 23. Spatial Oracle

Supabase RPC `corridor_for_point(lat, lon)`. Unlocks `Brand → located_in → Corridor`. Unblocks proximity analysis, gap detection, competitive density. See roadmap §7.6.

### 24. Linked Data URI Namespace

Register a stable URI namespace for brain concepts: `https://brains.platform/vocab#`. Makes `brain-vocabulary.json` concepts dereferenceable and interoperable with external SKOS systems. Tim Berners-Lee's 4th principle: link to other URIs. Low effort, high interoperability payoff.

### 25. Instill AI — T3 Source Connector

Document intelligence for professionals. CRE lease analysis demo (page / paragraph-level citation). Wire as a T3 source connector. Intake: lease PDFs, OM packages, analyst reports. Output: structured facts with source citation → Stage 1 of refinery.

---

## TIER 4 — LONG-TERM

_Month 4+. After the core pipeline is stable._

### 26. InternVL — Visual Brain

Open-source vision-language model. Reads street view + satellite images → structured signals: storefront condition, vacancy signals, renovation state. First-ever visual signal class in the brain platform. Creates `visual-re-swfl` brain consuming corridor GPS coordinates → visual vacancy/condition index.

### 27. Adaptive Trust Tiers (Backprop SGD) _(reframed per SM-2)_

Gradient-descent calibration of `trust_tier_score` from outcome data. Math follows directly from Pillar 3:

```
t_i(new) = t_i(old) − lr × (predicted_outcome − actual_outcome) × (confidence / t_i(old))
```

The `(confidence / t_i(old))` term IS `∂confidence / ∂trust_tier_score_i` from Pillar 3 — same formula, used in reverse to update the input rather than diagnose the output.

**Gated on N outcomes, not calendar time.** Per SM-2, `attribution jsonb` lands in `outcomes` from Tier 1 #5; every refine logs attribution; the SGD corpus builds itself in the background. #27 ships the moment N is large enough (start point: N=50 across all brains), not on Month 10. Trust tiers become empirically calibrated rather than expert-assigned.

### 28. W3C VC Recognized Entities

Cryptographically signed credentials asserting an entity is authorized to perform specific actions in a domain. Use for: verifying that a data provider is authorized to speak to a domain; decentralized trust registry for source connectors. **Blocked:** spec is Editor's Draft as of May 2026, not yet stable. Revisit at Month 8.

### 29. TrustGraph — Context Core Versioning Pattern

TrustGraph validates our brain file architecture (a brain file IS a Context Core). Steal the versioning convention: ontology + graph + embeddings + provenance + retrieval policies bundled as a portable versioned unit. Don't adopt TrustGraph as infrastructure — we already have the right stack.

### 30. Stage 5: OWL Reasoning

After Stage 4 (SKOS Thesaurus) is stable and the vocab has governance, introduce OWL class definitions for key concepts. Enables inference: if `cap_rate > X` AND `vacancy_rate > Y` THEN `distress_signal`. Requires Open Ontologies MCP (item 11) to be wired. Talisman's Stage 5.

### 31. Stage 6: Full Knowledge Graph in Sanity Intelligence Lake

Deploy the fully connected Knowledge Graph. Entities (Corridor, Brand, NAICS_Code, etc.) become nodes; the ontology relationships from §3.2 of the roadmap become edges. Sanity becomes the Intelligence Lake. Enables SPARQL queries across the full entity graph. Talisman's Stage 6. **Prerequisite: Stage 4 vocab stable + Stage 5 OWL defined.**

### 32. SM-6 Candidate (deferred to 2026-08-15 quarterly review) — Vocabulary as a Brain

For the next quarterly review: `vocab-brain` participates in the DAG; OUTPUT reports concept count, orphan count, consumer coverage. Stale vocab → propagates lower confidence into every brain that uses it. Self-policing governance via thin-pipe instead of checklist enforcement. Converts Tier 3 #20 (vocab governance) from lint to first-class brain. **Do NOT implement before the quarterly review** — wild swing, needs sequencing against Stage 4 stability.

### 33–39. Existing Roadmap Items (unchanged)

See `docs/ontology-and-roadmap.md` §8:

- Causal layer (IV analysis, synthetic control, DiD)
- Backtests against 2022–2024 outcomes
- Scheduled runs (3am FRED pulse, etc.)
- Watch-list infrastructure (FRED series, Accela RSS, TDT schedule)
- Real-time subscriptions
- Multi-agent inference (each brain = its own Claude agent)
- Fine-tuned Littlebird (outcomes table → training data)
- New domains: environmental, demographics, logistics, hospitality

---

## BLOCK

_Do not adopt until blocking condition resolves._

| Item                       | Block Reason                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| GraphRAG / Graphiti        | CVE-2026-32247 (Cypher injection, CVSS 8.1). Blocked until patched in a tagged release OR we sanitize `node_labels` at the boundary ourselves. |
| ERTool (Yager)             | Empty repo — LICENSE + README only. Write Yager-DST ourselves (~30 LOC, now Tier 2 #16).                                                       |
| W3C VC Recognized Entities | Editor's Draft, not stable. Revisit Month 8.                                                                                                   |

---

## SKIP

_Evaluated and rejected. Reasoning recorded so we don't re-evaluate._

| Item                  | Reason                                                                                                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github/semantic`     | Archived April 1, 2025. No maintenance. **The pattern is right** — Pillar 2 names `walkConsumers` as our Stack Graph implementation and queues tree-sitter via Serena as the validator upgrade path (Tier 1 #1.5 + Tier 2 #17). The library is skipped; the concept is adopted. |
| Denser Chat           | 152 stars, Python RAG chatbot, unmaintained. Superseded by Sirchmunk on every axis.                                                                                                                                                                                             |
| Apache AGE            | Cannot install on managed Supabase. Violates vendor-first rule.                                                                                                                                                                                                                 |
| ScienceDirect article | CAPTCHA blocked, no content accessible.                                                                                                                                                                                                                                         |

---

## LB's Side Items (placement TBD)

_Items from LB's drop that need more discussion before slotting._

- **GOFAI framing as external communication.** "We are using SKOS as the deterministic bridge to give LLMs explicit, unambiguous facts." Worth putting this language on the product page / marketing copy, not just internal docs.
- **Feedforward Neural Network (Wikipedia).** Confirms our confidence formula = forward pass, error attribution = backprop. No new implementation items — just validates the architecture naming we adopted in Session 3 (now Pillar 3).

---

## Quick Reference

```
NOW (Lane structure — see Tier 1 dependency diagram for the gates):
  LANE A (serial):     #2 vocab-audit → #1 SKOS file (stub-lookup first) → #3 Stage 2.5
  LANE B (serial):     #5 trust_tier_score + outcomes.attribution → #4 attributeError + walkUpstream
  LANE C (alone):      #8 Serena MCP (enables #2)   [#7 dlt MOVED → Tier 2 per v3.1]
  LANE D (gated):      #6 tourism-tdt (after Lane A done; native Supabase reader, no dlt)
  CROSS-CUT:           #1.5 Stack Graph annotation (anytime)

SHORT:  SHACL → Open Ontologies MCP → Sirchmunk → corridor factor
        → ISO notation codes → formal pipeline stage map
        → Yager-DST (SM-1, after Stage 2.5)
        → Validator upgrade (SM-5, depends on Serena)

MEDIUM: Constitution/GoRules → vocab governance (Serena-backed) → Kindly
        → spatial → URI namespace → Instill T3

LONG:   InternVL visual brain → adaptive trust SGD (gated on N outcomes per SM-2)
        → VC entities (Month 8) → OWL (Stage 5) → KG (Stage 6)
        → vocab-as-brain (SM-6, 2026-08-15 review)
        → causal → multi-agent → fine-tuned Littlebird

BLOCK:  GraphRAG (CVE), ERTool (empty), VC entities (not stable)
SKIP:   github/semantic (concept adopted as Pillar 2), denser-chat, Apache AGE
```

---

## Changelog

- **2026-05-16 — v3.1 (dlt sequencing correction, Session 7).** Vendor-first audit of dlt against the actual Tier 1 unblock surface surfaced a sequencing error in v3.0. The "verify arsenal claims" rule from memory caught it before code shipped.

  **Audit findings (verified against vendor docs and the brain-platform codebase):**
  - **dlt is Python-only.** No TypeScript SDK, no JS bindings, no WASM build (dlthub.com/intro, dlthub.com/product/dlt, github.com/dlt-hub/dlt). Install is `pip install dlt`, runs in a Python virtualenv, requires Python 3.9+. Integrating from our Bun refinery requires a Python sidecar that loads to a Supabase staging table, with a TS source then reading the staging table — fundamentally different architecture from the existing 240-line FRED source.
  - **tourism-tdt does not exercise dlt's value.** TDT data already lives in the premise-engine Supabase as `fl_dor_tdt_collections` (103 rows FY2013–FY2026, Lee County, sourced from Lee County Clerk Doc 328). A thin native `@supabase/supabase-js` reader (`refinery/sources/tourism-tdt-source.mts`, shipped 2026-05-16) is the correct shape — same pattern as `cre-source.mts` for `corridor_profiles`. The v3.0 "dlt unlocks Lane D" framing was based on a wrong premise about the data's location.
  - **Brain-platform's next ~6 source candidates are all government APIs or Supabase views** (FRED, SBA, Census, FEMA, Accela, NOAA). dlt's 5,000+ verified-source catalog skews to SaaS apps (Salesforce, Stripe, HubSpot, Shopify); leverage is smallest exactly where our queue lives.

  **Sequencing correction:**
  - **Tier 1 #7 (dlt intake) → Tier 2 #10.** The Pillar 4 rule — "enablers belong in Tier 1 when they unlock Tier 1 work" — cuts both ways. With the unlock premise false, the slot demotes. Old Tier 1 #7 entry kept as a redirect stub; old Tier 2 #10 redirect stub is now the real entry, with explicit gate to re-promote.
  - **First dlt user:** the first source onboarded where (a) the vendor is in dlt's verified-source catalog AND (b) the hand-rolled shape would be ≥150 LOC of pagination/auth/normalization (Stripe-class). Not chosen yet; not blocking anything.
  - **Lane D #6 tourism-tdt:** shipped as a hospitality-domain pack via the native-Supabase-reader path. Pure deterministic, mirrors `macro-swfl.mts` shape (skipSynthesisAgent, corpusSummary + outputProducer). Fixture-mode dry-run passes (48 rows, 0 orphans, 6 facts, Stage 4 validated). Live-mode pre-req: `SELECT` grant + RLS policy for the brain-platform readonly role on `fl_dor_tdt_collections` — first live attempt returned `permission denied for table`.

  **Pillar 4 stands.** The operating rule is unchanged; v3.1 just enforces it against actual unblock surface, not a casual premise. Serena (#8) remains Tier 1; it unlocks the audit, validator upgrade, and vocab governance — all verified Tier 1 work.

  **Inventory diff vs v3.0** (nothing renumbered for Tier 1; only the #7/#10 slot semantics flipped):
  - Tier 1: #7 (dlt) now a "MOVED to Tier 2 #10" redirect stub. Lane C reduces to {#8 Serena}. Lane D #6 no longer gated on Lane C — only on Lane A.
  - Tier 2: #10 promoted from redirect stub to real entry with explicit promotion gate and sidecar-shape sketch.
  - Quick Reference Lane C updated; Lane D gate updated.

- **2026-05-16 — v3.0 (4-Pillar Architectural Integration).**

  **Pillars (Design Principles restructured into four named pillars + Bayesian Stack capstone):**
  - Pillar 1 — SKOS Disambiguation Ledger (GOFAI Bridge). Adds the Talisman pipeline stage tracker narrative; bakes `vocab_pipeline_stage: 4` as a registry-tracked field.
  - Pillar 2 — Stack Graphs Where SKOS Resolves Meaning. NEW. Names `walkConsumers` as our Stack Graph; reframes tree-sitter via Serena as a validator upgrade path (smarter validators), not a fallback.
  - Pillar 3 — Feedforward / Backprop Confidence Engine. Promoted from one-paragraph aside to a full section with explicit math, the `walkUpstream` / `attributeError` module split, and auto-caveat threshold behavior.
  - Pillar 4 — Tooling: dlt + Serena Wired Now. NEW. Operating rule made explicit: "Enablers belong in Tier 1 when they unlock Tier 1 work."
  - Bayesian Stack capstone (SM-4) — ASCII diagram showing Constitution = prior, SKOS = canonical evidence labels, Yager-DST = posterior. Three deterministic moves + one narrative move. Anti-RAG-chatbot positioning for LB and customers.

  **Promotions:**
  - dlt intake pipeline: Tier 2 #8 → **Tier 1 #7** (unlocks tourism-tdt Lane D).
  - Serena MCP: Tier 3 #17 → **Tier 1 #8** (enables the audit; substrate for the validator upgrade).
  - Stack Graph annotation: implicit in `github/semantic` SKIP → **Tier 1 #1.5 (micro-item, ~15 min)**.

  **Tier 1 restructured into Lane A / B / C / D** with explicit dependency diagram and two parallel-pair groupings for execution sessions. 8 items + 1 micro-item (was 6 in v2.0).

  **Sharper Moves folded in:**
  - SM-1 — Yager-DST promoted v2.0 Tier 3 #15 → **Tier 2 #16** (SKOS pre-req is met once Stage 2.5 ships).
  - SM-2 — Attribution wired into `outcomes` table from refine #1 (Tier 1 #5 SQL). Tier 4 #27 reframed: gated on N outcomes, not calendar time.
  - SM-3 — Master synthesizer integrates against a **stub-lookup interface** defined in Tier 1 #1 BEFORE #3 lands; one-line swap when Stage 2.5 ships. Avoids retrofit pain.
  - SM-4 — Bayesian Stack diagram added as the Design Principles capstone.
  - SM-5 — NEW **Tier 2 #17 "Validator upgrade — parse-tree-backed lints"** (depends on Tier 1 #8 Serena). Pillar 2 promise made concrete.
  - SM-6 — Vocabulary-as-a-brain deferred to 2026-08-15 quarterly review (Tier 4 #32 placeholder). Wild swing, do not implement.

  **Bonus adds surfaced by integration:**
  1. `walkUpstream()` in `dag.mts`, `attributeError()` in `confidence.mts` — clean module split (Tier 1 #4 note); preserves confidence.mts's existing purity (already filters `brain-input:*` to avoid double-counting).
  2. `vocab_pipeline_stage: 4` tracked as a registry field (Tier 2 #15 note); makes Talisman discipline machine-checkable.
  3. `attributeError` auto-caveat behavior when final confidence < 0.6 (Tier 1 #4 note); threshold tunes after 10 refines.
  4. Per-brain `scopeNote` extends the consumption contract (Tier 1 #3 note); same enforcement pattern as freshness tokens.
  5. dlt migration of tourism-tdt is the template for FRED / SBA / TDT future connectors (Tier 1 #7 note) — plan the file with extra care.
  6. Serena backs the vocab governance validation matrix (Tier 3 #20 note); cross-file symbol query, no custom AST walker.

  **Inventory diff vs v2.0 (nothing removed; numbering shifted to accommodate promotions, every vacated slot kept as a redirect stub so external doc anchors don't rot):**
  - Tier 1: 1–6 unchanged; added #1.5 (Stack Graph micro), #7 (dlt promoted in), #8 (Serena promoted in).
  - Tier 2: SHACL 7→9, dlt 8→Tier 1 #7 (slot #10 redirect), Open Ontologies 9→11, Sirchmunk 10→12, Corridor Factor 11→13, ISO notation 12→14, Stage map 13→15; added #16 (Yager promoted in), #17 (validator upgrade SM-5).
  - Tier 3: Constitution 14→18, Yager 15→Tier 2 #16 (slot #19 redirect), vocab governance 16→20, Serena 17→Tier 1 #8 (slot #21 redirect), Kindly 18→22, Spatial 19→23, URI namespace 20→24, Instill 21→25.
  - Tier 4: InternVL 22→26, Adaptive Trust 23→27, W3C VC 24→28, TrustGraph 25→29, OWL 26→30, KG 27→31; added #32 (SM-6 vocab-as-brain deferred); existing roadmap items #28–34 → #33–39.

- **2026-05-16 — v2.0 (LB / Talisman deep dive integration, pre-renumber).** Four-pillar architectural narrative was scattered across Design Principles. dlt at Tier 2 #8, Serena at Tier 3 #17, Yager at Tier 3 #15. No Stack Graph annotation. No Bayesian Stack capstone. No attribution column. Superseded by v3.0.
- **2026-05-16 — v1.0.** Created from Session 3 research synthesis (27 items). Added LB / Talisman deep dive: 10K-to-2.5K metric collapse (new NOW item), 7-layer SKOS structure detail, formal pipeline stage mapping (SHORT), vocabulary governance (MEDIUM), Stage 5 OWL + Stage 6 KG (LONG). Feedforward neural network Wikipedia confirmed backprop synthesis — no new implementation items. Deduped against `docs/ontology-and-roadmap.md`.
