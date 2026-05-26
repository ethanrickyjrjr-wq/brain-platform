# v2 — Corridor Character Generator

**Supersedes v1** (audit of original 2026-05-26 corridor-broker-narrative plan). v1 retained at git blob `HEAD~1` for diff if needed.

> **Scope note.** This plan covers Steps 0–5 only — the work required to replace `corridor_profiles.character` with a two-block (facts + speculative) generator output backed by deterministic local data + Anthropic-grounded web context. Long-term ideas (FL-other-cities comparison context, statewide / national character anchors, forecasts, outlier brain, BYO multi-tenant overlay, Tavily pre-fetch helper) are real but **explicitly out of this plan** — captured in `docs/ontology-and-roadmap.md` so future sessions don't inherit them as "the second half of the work."

---

## Context — why the original plan pivoted

- v1 was: fix Firecrawl broker extraction + build a promote-broker-narratives tool.
- Audit found a load-bearing problem v1 didn't address: `corridor_profiles.character` (rendered verbatim to end users at `refinery/packs/cre-swfl.mts:1087`) contains 24–26 Claude-drafted strings from May 2026 with no per-claim source. Foundation problem.
- Pivot: build a **corridor character generator** with a **two-block output** — a strict facts block (sourced, lint-strict, math-honest) and an unleashed speculative block (AI inference disclosed inline). Broker narrative pipeline becomes a quarterly overlay on top, not the load-bearing layer.

---

## Design model (read first — this is the load-bearing change vs. prior drafts)

The corridor character is **not one piece of prose**. It is a structured output with three regions:

1. **Facts block** — verified, sourced, deterministic. Every numeric value verbatim from the fact pack. Every claim cites an internal data row (with `source_url`) or an Anthropic web-search citation. Lint-strict: no softening words, no inference, no rounding. This is what we guarantee.

2. **Optional chart / table block** — when a comparison is genuinely useful (rent per corridor, vacancy distribution across SWFL, permits over time), emit a structured rows/columns block. Consumer-Claude can render it as markdown table, ASCII chart, whatever fits the surface. Skip when not useful — don't force charts.

3. **Speculative block** — AI unleashed. Reads the fact pack (including its gaps), reads the grounded web context, and produces thought-provoking inference: "given X for 2020-2023 and the 2026 spot reading of Y, the 2024-2025 stretch was most likely hovering near Z; this suggests the recent move is..." This is where AI does what AI does best — connect dots, surface theories, propose what to dig into next. Carries an inline disclaimer at the end (small text): _"Speculative — based partly on inferred data. Double-check."_ The whole point is to give the user something worth questioning, not to certify the inference.

**Below the answer:** a sources link / chart page that surfaces (a) every internal data row with its tagged `source_url`, (b) every web citation from the grounded call, (c) the freshness token (oldest fact-pack vintage), and (d) the privacy-policy + design-philosophy + legal disclaimers (where this stuff actually belongs — not in the answer body). Same pattern as Claude's own one-line footer.

**Why two blocks instead of one:** because the failure modes are opposite. The facts block fails by hallucinating numbers; the speculative block fails by being so hedged it produces nothing thought-provoking. Different lint rules, different prompts, different presentation. Conflating them is what made the May 2026 hand-authored `character` text both un-citable AND un-thought-provoking.

---

## What goes where (so we don't bloat the answer)

| Content                                    | Lives in                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| Verified numbers + math                    | Facts block (in answer)                                                     |
| Comparison tables when useful              | Chart block (in answer)                                                     |
| AI inference, theories, "what to dig into" | Speculative block (in answer, with inline disclaimer)                       |
| Continuity vs. prior quarter               | Facts block when math supports it; speculative block when it's interpretive |
| Source URLs (internal + web)               | Sources chart page (linked at bottom of answer)                             |
| Freshness token (oldest source date)       | Sources chart page + queryable via MCP                                      |
| Privacy policy, AI disclaimer, legal       | Sources chart page footer + privacy policy link                             |
| Design philosophy ("how this is built")    | Privacy policy / about page — NOT in the answer body                        |

Answers stay clean. Disclosure is one click away. Same model Claude uses.

---

## Non-negotiable rules (these are the floor)

1. **Two-block lint discipline.** Facts block passes `spec-validator`, `facts-only-lint`, `inference-bait-lint`, and the `numeric_softening` token ban (same gates brain output passes today). Speculative block passes `spec-validator` only, AND requires the inline disclaimer be present, AND must NOT cite inferred numbers as facts (when inferring a value, use hedging language explicitly — that's the whole point of the block being separate).
2. **Provenance per facts-block claim.** Every claim in the facts block traces to (a) a row in `data_lake.*` / `corridor_profiles.*` with a `*_source_url`, or (b) a web citation URL from Anthropic's `web_search_20260209` `citations[]` array. Untraceable claims do not enter the facts block — they may enter the speculative block, properly disclaimed.
3. **Math is deterministic for what matters.** Stage A computes the indicators we know are decision-relevant: YoY deltas on cap rate / vacancy / asking rent, permit-volume trailing-6mo direction, BLS LAUS county trend direction, ZORI YoY rent change, NFIP claim frequency direction where multi-year data exists. Output is structured numbers in the fact pack; facts block restates them verbatim with units. We do NOT pre-compute every conceivable comparison — consumer-Claude still does the live arithmetic on raw values when the user asks something we didn't anticipate. We DO compute the indicators that are obvious top-of-corridor signals so they're ready for the facts block without round-tripping through the model.
4. **Continuity — new expert reads old expert.** Each generator run reads the prior run's `character_facts` and `character_speculative` for the same corridor as additional context. Enables honest "since last quarter, vacancy moved from 4.2% to 6.1% [internal-3]" framing in the facts block, and "this continues the drift first flagged in Q3 2025 [prior-self]" framing in the speculative block. Old expert's mistakes don't propagate — each run re-derives from the fact pack and grounded web; prior text is context, not source of truth.
5. **Freshness token mandatory.** Every generator run writes `character_fact_pack_vintage` (the date of the OLDEST data source used). Format: `OLDEST-{YYYY-MM}` e.g. `OLDEST-2026-04` if the oldest input is April 2026 BLS LAUS. Surfaced on the sources chart page. Consumer-Claude quotes it per the existing SWFL consumption contract rule 2.
6. **Brain-first ingest gate** (Data Tier Policy rule 2) — if a new ingest is needed to support this generator, it ships with the consumer in the same sprint. No speculative Tier-2 loads.
7. **Vendor-first rule** (CLAUDE.md rule 1) — every grounded-search vendor surface is verified in-session via WebFetch before code lands. Prior plans / READMEs / memory are not verification.

### Authorized override of CLAUDE.md SWFL Protocol rule 8

The blanket ban on `numeric_softening` and `prose_confidence_translation` is preserved for the **facts block only**. The speculative block is explicitly exempt — that's where AI is supposed to interpolate, hedge, and propose. Hedging language in the speculative block is required, not banned. CLAUDE.md SWFL Protocol rule 8 carries this carve-out in-place.

---

## Sequence — do not reorder; gates are not advisory

### Step 0 — Snapshot baseline [SHIPPED]

Done in commits `20692fc` + `ae4061e`. `docs/audits/2026-05-26-corridor-character-snapshot.md` is the frozen pre-generator baseline (26 corridors, 10 Collier / 16 Lee). `refinery/tools/pull-corridor-character-snapshot.mts` is re-runnable.

### Step 1 — Anthropic `web_search_20260209` verification + wire-up [LOCKED, ~30 min]

**Vendor pick is settled**: Anthropic's `web_search_20260209` tool. Decision rationale captured in `docs/vendor-notes/grounded-search-research-2026-05-26.md`. Anthropic is the only Tier-1 vendor that returns **per-claim citations with `cited_text` spans** AND raw publisher URLs (Gemini's `groundingChunks[].web.uri` is a Vertex redirect). The per-claim contract is what Step 3's lint stack needs.

30-minute confirmation, not a comparison:

1. **Vendor-first check** — fetch current Anthropic web_search docs in-session. Verify tool name + version, model availability on Opus 4.7 + Sonnet 4.6, exact citation field path (`citations: [{url, title, cited_text, encrypted_index}]`), `allowed_domains` / `blocked_domains` syntax, rate limits.
2. **Env confirmation** — `ANTHROPIC_API_KEY` already wired in `.env.local`; no new key.
3. **Smoke test** — one Pine Ridge Rd Naples query. Eyeball whether `cited_text` spans are coherent and URLs are primary sources.
4. **Document seed `allowed_domains`** — known SWFL brokers (`cushmanwakefield.com`, `lsicompanies.com`, `creconsultants.com`, `ipcnaples.com`, `cbre.com`, `colliers.com`), county portals (`leegov.com`, `colliercountyfl.gov`, `leepa.org`, `collierappraiser.com`), news sites (`news-press.com`, `naplesnews.com`, `gulfshorebusiness.com`), federal/state data (`fred.stlouisfed.org`, `bls.gov`, `census.gov`, `fema.gov`, `fdot.gov`). Grow from real corridor questions, not imagination.

Deliverable: `docs/vendor-notes/grounded-search-research-2026-05-26.md` (already shipped during propagation) + `docs/vendor-notes/anthropic-web-search-wire-up.md` (verified API contract, seed allowlist, smoke-test response slice).

### Step 2 — One-corridor generator end-to-end [GATED on Step 1]

Build for **Pine Ridge Rd Naples only** (clean, medical-office, low confounders). Three stages plus migration.

**Stage A — Fact pack builder** (`refinery/tools/build-corridor-fact-pack.mts`, TS, no network, pure function):

- Pulls per-corridor rows from `corridor_profiles`, `data_lake.marketbeat_swfl`, `data_lake.bls_laus`, `data_lake.fdot_aadt_*`, `data_lake.zori_swfl`, `data_lake.fema_nfip_*`, `data_lake.lee_building_permits` (when geo-joinable).
- Output: structured JSON. Two regions per metric: `current` (the latest value + units + `source_url`) and `important_math` (YoY delta / trailing direction / SWFL-corridor-distribution comparison, computed in code, only for the indicators we know are decision-relevant — see non-negotiable rule 3).
- Missing data surfaces as `{value: null, gap_reason: "<reason>"}` rather than absent keys. E.g. Collier corridors get `{permits: null, gap_reason: "Collier County not in lee_building_permits ingest"}`. `marketbeat_swfl` returns `null + gap_reason` until that pipeline lands its first row. **This is not "data unavailable" hedging** — these gaps feed the speculative block, which interpolates around them. Facts block stays silent on null fields; speculative block treats the gap as a prompt for inference.
- Also reads prior-run `character_facts` and `character_speculative` for the same corridor (if present) and packages them as `prior_quarter_context` for Stage C continuity.
- Computes `fact_pack_vintage` — the date of the OLDEST data source used. Surfaced on the sources page.
- Unit-testable.

**Stage B — Grounded web call + Tier-1 capture** (`ingest/pipelines/corridor_grounded/pipeline.py`, Python, matches `news_swfl` pattern):

- One Anthropic `web_search_20260209` call per corridor with the seed `allowed_domains` list.
- Capture the full response + all `citations[]` entries to `lake-tier1` bucket as NDJSON via existing `storage_uploader.py` + `tier1_inventory.py`.
- Re-runnable without re-spending credits.

**Stage C — Synthesis with two-block output** (`refinery/tools/synthesize-corridor-character.mts`, TS):

- Reads fact pack + Tier-1 grounded blob + prior-quarter context.
- Issues a SINGLE model call with a structured prompt that emits a JSON object with three keys: `facts_block` (3–5 sentences), `chart_block` (optional structured rows/columns or null), `speculative_block` (2–4 sentences ending with the required disclaimer).
- **Facts block prompt fragment:** "Use values from FACT_PACK verbatim with their units. Every claim cites inline as [internal-N] or [web-N]. No softening, no rounding, no inference. If a value is null with a gap_reason, omit it from this block."
- **Chart block prompt fragment:** "If a comparison or distribution is genuinely useful for this corridor (e.g. asking rent vs. SWFL median, vacancy vs. submarket peers), emit a structured `{title, columns, rows}` object using only fact-pack values. Otherwise return null. Do not invent comparisons."
- **Speculative block prompt fragment:** "Read FACT*PACK gaps and GROUNDED_WEB context. Produce thought-provoking inference: where might the next-quarter signal be heading; what does the gap_reason imply; what's a question the operator should dig into next. Hedge explicitly when inferring numeric values ('most likely hovering near', 'tracking toward'). Use [web-N] for grounded claims; mark inference with [inference]. End with: \_Speculative — based partly on inferred data. Double-check.*"
- **`--preview` flag** writes the three-block output to stdout only, no DB write. Used for Step 2 iteration and Step 4 spot-checks.
- **`--corridor=<name>` flag** for targeted single-corridor runs; default is all 26.

**SQL migration** (same PR):

```sql
ALTER TABLE corridor_profiles
  ADD COLUMN IF NOT EXISTS character_facts          TEXT,
  ADD COLUMN IF NOT EXISTS character_chart          JSONB,
  ADD COLUMN IF NOT EXISTS character_speculative    TEXT,
  ADD COLUMN IF NOT EXISTS character_citations      JSONB,   -- {internal: [{ref, source_url}], web: [{ref, url, title, cited_text}]}
  ADD COLUMN IF NOT EXISTS character_generated_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS character_fact_pack_vintage TEXT;  -- e.g. "OLDEST-2026-04"
```

Do NOT overwrite `character` — old text stays as cold fallback for one full quarterly cycle.

### Step 3 — Lint stack (split by block) [SAME PR AS STEP 2]

- **Facts block:** `spec-validator` + `facts-only-lint` + `inference-bait-lint` + `numeric_softening` ban (all current brain-output gates).
- **Speculative block:** `spec-validator` only, plus two new lint rules: (a) the trailing inline disclaimer must be present verbatim, (b) any numeric value not appearing in the fact pack MUST be wrapped in hedging language (regex-checkable against the softening-tokens list — but in the speculative block, presence is required, not banned).
- **Chart block:** structural validation only — must be `{title: string, columns: string[], rows: cell[][]}` or null. No semantic gating.
- Test: a deliberately-malformed run (made-up tenant name in facts block, unhedged inferred number in speculative block, missing disclaimer) must be rejected and the DB must remain untouched. The same fact pack + grounded blob run cleanly should pass.

### Step 4 — All 26 corridors [GATED on Step 2/3 shipped + operator sign-off on Pine Ridge output]

Run generator for the remaining 25 corridors via `--preview` first (no DB writes). Operator reads 5 spot-checks against the snapshot baseline using this 5-point rubric:

1. **Facts block** cites at least one internal AND one external source.
2. **Facts block** states every numeric value verbatim from the fact pack — no rounding, no softening.
3. **Speculative block** is genuinely thought-provoking (proposes a question, surfaces a connection, frames a hypothesis) AND carries the inline disclaimer AND hedges any inferred values.
4. **Chart block** (when present) uses only fact-pack values; (when absent) the omission is defensible.
5. A SWFL broker would recognize this corridor from the facts block. The speculative block makes them want to ask a follow-up.

If 5/5 pass: write to DB. Then flip `composeCharacterRender` in `cre-source.mts:240-253` to read the new structured columns (see Step 5 rendering stack). Old `character` column data remains untouched for one full quarterly cycle as restore safety.

### Step 5 — Quarterly broker overlay [PARALLEL-ELIGIBLE with Step 4]

Original audit plan's Streams 2/3/4: `promote-broker-narratives.mts` tool + consumption-contract paragraph + DDL confirmation. Quarterly dated layer over the fused base. **Stream 1 (fixing Firecrawl broker extraction) drops in priority** — `character_facts`/`character_speculative` are no longer suspect, so broker data shifts from "load-bearing" to "nice-to-have overlay." Fix the broker URLs eventually; don't block the generator on it.

**Final rendering stack** (make this explicit so executing session doesn't have to infer):

`composeCharacterRender` post-generator composes:

1. **Facts block:** `character_facts` (preferred when non-null).
2. **Chart block:** `character_chart` (when non-null; consumer rendering layer formats it).
3. **Quarterly overlay (within facts block tail):** `character_broker_narrative` stacked via the existing "Broker positioning (Qn YYYY): …" prefix.
4. **Speculative block:** `character_speculative` (rendered as a clearly-labeled second section with the inline disclaimer).
5. **Sources chart link** at the bottom — surfaces `character_citations` JSONB, `character_fact_pack_vintage`, the privacy-policy link, and the legal/AI-disclaimer footer.
6. **Cold fallback:** legacy `character` — used only when `character_facts IS NULL`. Kept in DB one full cycle as restore safety, then revisit deletion.

**Plan ends here.** Anything beyond Step 5 is roadmap, not plan.

---

## Anti-LittleBird fences (must read before any step)

These exist because prior sessions have drifted scope under cover of "we agreed to X" framing. See `[[littlebird-is-notetaker]]`, `[[inherited-plan-skepticism]]`, `[[pre-build-state-check]]`.

- **This plan is the canonical Step 0–5 sequence.** Steps ship in order. No skipping ahead.
- **Gates are hard.** The bracketed gate after each step title is a precondition, not a hint.
- **"We agreed to X" is not authority.** Verify against this plan file. Run `git pull` and `git log --oneline -20` before proposing any code change.
- **Vulnerabilities discovered mid-build get fixed in the current PR.** Do not defer to a "cleanup sprint."
- **Future-vision items live in `docs/ontology-and-roadmap.md`, not here.**
- **Do not re-tighten the speculative block.** If a future session reads this plan and is tempted to "add more rigor" to the speculative block (require citations, ban hedging, narrow the scope), that's the handcuff the operator explicitly removed. The speculative block is supposed to be loose — that's its job.

---

## What this plan does NOT cover

- Specific Stage C prompt text (iterated in Step 2 against Pine Ridge output).
- FL-other-cities, statewide, national, forecasts, outlier brain, BYO overlay, Tavily pre-fetch. All deferred to roadmap, not plan. See `docs/ontology-and-roadmap.md`.
- Privacy-policy / about-page copy update reflecting the design model. Out of scope for this plan; flagged for a future copy pass.
- Marketing positioning, pricing, demo copy.
- n8n or non-GHA orchestration changes. (Firecrawl debugging — async-polling check, URL drift fixes — gets its own separate plan and a separate session, not bundled here.)
