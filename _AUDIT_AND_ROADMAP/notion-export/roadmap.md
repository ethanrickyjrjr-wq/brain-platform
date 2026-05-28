# SWFL Data Gulf — Roadmap (2026-05-27)

> Paste-ready for Notion. Same content as `_AUDIT_AND_ROADMAP/roadmap-2026-05-27.md`.

## Where we are

15 upstream brains feeding master. MCP v1 live in prod at `www.swfldatagulf.com/api/mcp`. Pipeline-freshness standard locked with daily probe + auto-capture incident ledger. SESSION_LOG mechanism enforces cross-session continuity. Speaker layer renders tier-1/2/3 voice. Brain output is deterministic math + cited narrative; every numeric claim traces to a `source_url`.

**Last 7 days shipped:** housing-swfl (Redfin buy-side, 125 ZIPs); permits-swfl second-county join (Collier); corridor character generator Steps 0–4.5; MCP v1 + waitlist + Anthropic Connectors submitted; freshness-first chain (PRs #19–#26); Firecrawl→Spider fallback rule locked.

**Not done yet:** master is still an index, not a synthesizer. No outcomes table. No constitution YAML. Confidence is still multiplicative, not Yager-DST. tourism-tdt brain LIVE but still reads premise-engine's Supabase (must self-ingest). No watchlist. No regional expansion.

---

## NEXT — 1–3 weeks (sequenced)

### 1. Master synthesizer (§6.1)

Every roadmap item below depends on it. Master combines its 15 upstreams into one weighted conclusion. Right window — housing-swfl + permits-swfl Collier + Step 4.5 voice all just landed.

- `outputProducer` on master pack.
- Close `BrainOutput` contract: top-level `trust_tier`, `direction`, `contradicts: string[]`. Atomic backfill across all 15 packs.
- Expand `inference-bait-lint` (cross-brain causal-language ban).
- Seed `predictions` + `outcomes` DDL. Log every master refine.

### 2. Self-ingest tourism-tdt source data

Replaces the earlier "ship tourism-tdt brain" item — that's done. Brain runs against premise-engine's Supabase today. See `premise-data-replacement.md`. New `ingest/pipelines/tdt_swfl/` reads Lee County Clerk Doc 328 directly; cuts over `tourism-tdt-source.mts:TABLE` to brain-platform Supabase.

### 3. Per-domain LAKE_ID refactor (§6.3)

Replace generic `SWFL-7421-v…` with `FINANCE-v…` / `ENVIRONMENTAL-v…` / etc. Mechanical.

### 4. NOW acceptance tests (§6.4)

- **Test A** (operator audit, T3): "Is now a good time to sign a 5-year accommodation lease on Fort Myers Beach?" → one synthesized conclusion citing macro + tourism + sector credit + CRE + franchise outcomes; contradictions flagged.
- **Test B** (homebuyer, T2 conversational): "Under $500K in Lee County, which ZIPs give me the best shot at low flood-insurance costs without sitting in a stagnant neighborhood?" → phone-screen length, no `§`, no internal pack IDs.

### 5. Industry-characters Phase 0

Clones the corridor-character generator pattern across 7 voices. One PR, 8 files: shared slug (TS + Python parity) → DB migration `corridor_industry_characters` → 5-tier voice router → shared `IndustryFactPack` interface → parameterized clones of `corridor_grounded` pipeline + synthesizer + lint → 7 cadence_registry entries.

---

## NEAR-TERM — 1–3 months

1. **Industry-characters Phase 1** — Voices 1–3 (main-street, storm-ready, move-ready). All data live; no new pipes. Three PRs.
2. **Corridor Factor (§7.1)** — first Tier 3 derived metric. Single multiplier normalizing business performance by location advantage.
3. **Constitution as YAML (§7.2)** — `refinery/constitution/master.yaml`. Plain YAML default; revisit GoRules Zen JDM at rule count ≥ 20. Flood veto, NAICS distress, logical consistency rules, domain hierarchy.
4. **2-round critique-revision loop** at master synthesis. Hard-cap at 2.
5. **Yager-DST confidence upgrade (§7.4)** — `refinery/lib/confidence-yager.mts` (~30 LOC). Stale → ignorance, not disbelief. Conflict → ignorance, not amplified agreement. Ship behind `synthesisStrategy: "llm-assisted"` toggle for A/B.
6. **Industry-characters Phases 2–4** — Voices 4–7. Voice 6 needs `str_firecrawl` (optional, ~4 hrs); Voice 7 needs `fldoe_grades` + `fdle_ucr` (~2 days).
7. **Spatial oracle (§7.6)** — Supabase RPC `corridor_for_point(lat, lon)`.
8. **Report-page side channel (§7.7)** — `/r/[slug]` upgrade: real charts (Recharts), maps (Mapbox MCP), citation tables, sortable T3 detail. Follow-ons: PDF/email render, hovercard-on-numbers.
9. **`faf5-annual` DDL gap** — write `docs/sql/YYYYMMDD_faf_sctg_lookup.sql`; clear DLT state; re-run.

---

## LONG-TERM — 3–12 months

1. **Outcomes loop wired up.** Cron grades predictions against observed values; surface drift; flag brains systematically wrong. Seed corpus for backtests, fine-tuning, drift detection.
2. **Causal layer (§8.1).** Instrumental variable analysis using Hurricane Ian as exogenous shock. Synthetic control corridors. Difference-in-differences.
3. **Backtests (§8.2).** Every derived metric tested against 2022–2024 outcomes. Drop anything that doesn't predict above baseline.
4. **Scheduled runs + watch-list + real-time subscriptions (§8.3–§8.5).** 3am refinery: FRED pulse, permit deltas, TDT release window, SBA quarterly, NOAA hurricane track. Brief waits in inbox by 7am.
5. **Regional expansion.** FL-other-cities (Tampa, Orlando, Jacksonville) → FL statewide → national anchor → outlier brain. Each step gated on the prior cycle's proof-out.
6. **Multi-tenant /vault (BYO overlay).** Companies overlay their own asset data on SWFL fact packs. Blocked on `user_id` + RLS + billing + schema isolation.
7. **Multi-agent inference (§8.6).** Each brain as its own parallel Claude agent at inference time.
8. **Fine-tuned synthesis model (§8.7).** Outcomes table becomes training data. Constitution stops being prompt, starts being weights.

---

## North Star

A homebuyer, a CRE analyst, a city planner, a journalist, a small operator, a parent picking a school — they can hold three variables in their head when they make a real decision about a real place. We can hold fifty, weighted honestly, with a quoted citation chain. **Math is easy. Weighting is everything.**

Today we have 15 brains and master is an index. By the end of NEXT we'll have 15 brains, master is a synthesizer, and tourism-tdt is fully self-owned. By the end of NEAR-TERM we'll have a constitution, Yager-DST, 4–7 audience voices, and a report-page side channel. By the end of LONG-TERM we'll have an outcomes loop telling us when we're wrong, a causal layer telling us why, scheduled runs that don't need a human to fire them, and a regional expansion pattern that turns one SWFL into Tampa + Orlando + statewide.

That's the road.
