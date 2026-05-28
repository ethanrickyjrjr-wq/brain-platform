# SWFL Data Gulf — Project Audit (2026-05-27)

> Paste-ready for Notion. Same content as `_AUDIT_AND_ROADMAP/audit-2026-05-27.md`.

**Branch:** `main` at `53d00c1`, fully in sync with `origin/main`
**Working tree:** clean except `fixtures/corridor-permits.json` (untracked)
**Tests:** `bun test` → 762 pass / 0 fail / 0 skipped (897 ms)

## Headline state

- **15 upstream brains feeding `master`.** `tourism-tdt` is LIVE (reads from premise-engine's Supabase — flagged for self-ingest).
- **MCP v1 live in prod** at `https://www.swfldatagulf.com/api/mcp`. `swfl_fetch` tool returns SSE-framed JSON-RPC; tier-2 master payload carries `SWFL-7421-v53-20260525` freshness token.
- **Waitlist + WAF rate-limit + Anthropic Connectors directory submitted.**
- **133 commits in the audit window** (2026-05-22 → 2026-05-27). Busiest day was 2026-05-27 (47 commits, 7 PRs).

## What shipped (chronological)

| Day       | Big things                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **05-22** | Fiverr briefs added.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **05-23** | Redfin SWFL ZIP pipeline; rentals-swfl ZORI brain (PR #9); viz scaffold.                                                                                                                                                                                                                                                                                                                                                                 |
| **05-24** | MCP v1 step 1 + step 2 foundation; corridor-data pipeline + bundle (steps 1–7); URL migration to www.swfldatagulf.com; Resend waitlist email.                                                                                                                                                                                                                                                                                            |
| **05-25** | MCP step 3 /connect; speaker CRLF fix; banned internal pack IDs in MCP responses; provenance page (PR #13); BLS LAUS county ingest + macro-swfl real metrics (PR #14); firecrawl pipeline skeleton (PR #15); MarketBeat Flow 3 (PR #18).                                                                                                                                                                                                 |
| **05-26** | Freshness-first chain (PRs #19–#26): secrets normalize, dry-run, GHA Node 24, pipeline-freshness standard + scaffold + drift-guard, 9 cron wrappers backfill, FRED G.17 + BLS PPI + Census VIP Tier 1 pipelines, daily freshness probe; MCP basePath fix (PR #28) — POST live; MCP v1 LIVE IN PROD; permits-swfl v2 (PR #29); SESSION_LOG.md mechanism; corridor-character generator Steps 0–2; broker-scrape pipelines killed (PR #41). |
| **05-27** | corridor-character Step 4 — all 26 corridors (PR #42); Step 4.5 type-conditional voice (PR #43); housing-swfl Redfin buy-side brain LIVE; permits-swfl Collier join; auto-capture incident ledger; data-intel page; FDOT pagination fix (PR #45); CI catalog drift fix (PR #46); spider extraction-schema fix (PR #47); Firecrawl→Spider plain-scrape wrapper + rule lock (PR #48); 5 stale GH issues closed; ccpm skill removed.        |

## Issue board

- **Open:** 1 — `#44 Cron incident feed (do not close)` — sticky, auto-capture target.
- **Closed in window:** #33 (epic), #34, #35, #36, #37, #38 — all corridor-character generator sub-issues. Hand-closed in `53d00c1` board sweep (no `Fixes #` syntax in PRs — they don't auto-close).
- **Open PRs:** 0.
- **Stale local branch:** `fix/firecrawl-agent-client` — upstream `[gone]`, commits in PR #47.

## Pipeline status

**Active (20):** zori_swfl_duckdb · redfin_swfl · hurdat2_fl · storm_history_swfl · usgs · faf5 · fred_g17 · bls_ppi · census_vip · bls_laus · bls_qcew · census_cbp · usgs_tier2 · fema · leepa · fhfa · fdot · lee_permits · collier_permits · zori_swfl_tier2.

**Not yet running (1):** news_swfl — Tier 1 cold storage, no consumer brain yet.

**Open incident (1):** `faf5-annual` — `relation "data_lake.faf_sctg_lookup" does not exist`. Needs versioned DDL + DLT state clear.

**First-fires 2026-05-27:** redfin_swfl (66,672 rows / 125 ZIPs), fred_g17, bls_ppi, census_vip.

## Roadmap state vs. ontology doc

### NOW (§6) — quarterly

| Item                                      | Status                                                  |
| ----------------------------------------- | ------------------------------------------------------- |
| §6.1 Master synthesizer                   | **NOT STARTED** (highest-leverage NOW item)             |
| §6.2 tourism-tdt brain                    | **LIVE** (ontology says "not started" — WRONG)          |
| §6.3 Per-domain LAKE_ID                   | **NOT STARTED** (mechanical)                            |
| §6.4 NOW acceptance tests                 | **NOT STARTED** (gated on §6.1 + §6.5)                  |
| §6.5 Speaker Layer + Tier Table           | **PARTIAL** (speaker exists, tier table not formalized) |
| §6.6 Trigger Logic + Capability Inventory | **PARTIAL** (in MCP tool description)                   |
| §6.7 MCP Wrapper                          | **SHIPPED**                                             |

### Plans in `docs/superpowers/plans/`

| Plan                                                | Status                                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------- |
| `2026-05-19-cre-corridor-absorption-rent-expansion` | SHIPPED                                                                           |
| `2026-05-22-brains-mcp-server-v1`                   | SHIPPED — LIVE IN PROD                                                            |
| `2026-05-23-rentals-swfl`                           | SHIPPED                                                                           |
| `2026-05-24-corridor-data-pipeline-and-mcp-bundle`  | SHIPPED                                                                           |
| `2026-05-25-firecrawl-pipeline-skeleton`            | PARTIAL — brain-side shipped, MarketBeat/corridor/county pipelines deleted PR #41 |
| `2026-05-26-corridor-character-generator`           | SHIPPED Steps 0–4.5. Step 5 CLOSED — superseded by PR #43                         |
| `2026-05-26-corridor-broker-narrative-promotion`    | DEAD — Step 5 closed                                                              |
| `2026-05-26-industry-characters`                    | NOT STARTED (gate met by Step 4)                                                  |

## Protocols in effect

1. **Global `~/.claude/CLAUDE.md`:** Vendor First, Plan Mode First, Data Provenance, Discrepancy Reporting.
2. **Project `CLAUDE.md` (refactored to 16 KB / 135 lines):**
   - RULE 0 SESSION_LOG (locked, marker-protected, hook-enforced).
   - RULE 1 commit/push autonomy.
   - Brain Factory 8 non-negotiable rules.
   - SWFL Intelligence Lake data protocol v3 (8 rules).
3. **Hooks:** SessionStart (prints SESSION_LOG, marker + build-context check), PreToolUse Bash (blocks `git push` if no SESSION_LOG entry).
4. **Subagents:** `constitution-builder`, `v3-spec-guard`.

**No instruction tells Claude to default to feature branches or PRs** — RULE 1 explicitly authorizes direct-to-main for low-blast-radius work.

## Phantom / dead / drift

1. `docs/superpowers/plans/2026-05-26-corridor-broker-narrative-promotion/` — DEAD. Dir gitignored.
2. `docs/superpowers/plans/2026-05-25-firecrawl-pipeline-skeleton/README.md` — PARTIAL, needs status banner.
3. `ingest/pipelines/{marketbeat_swfl,corridor_narratives,county_planning_swfl}/` — dirs exist, workflows deleted PR #41. Triggers `test_pipeline_drift.py` failures (pytest not in CI).
4. MEMORY.md drift: stale SHA, "Step 5 gated" should say CLOSED, "Part C MCP v1 pending" — it's LIVE.
5. tourism-tdt listed in ontology §6.2 as NOT STARTED — actually LIVE.
6. Stale local branch `fix/firecrawl-agent-client`.

## What's actually missing

1. **Master synthesizer (§6.1)** — oldest unstarted NOW item.
2. **Self-ingest tourism-tdt source data** — see `premise-data-replacement.md`.
3. **Per-domain LAKE_ID refactor (§6.3).**
4. **NOW acceptance tests (§6.4).**
5. **`faf5-annual` DDL gap.**
6. **`news_swfl` first-fire.**
7. **Industry-characters Phase 0** — 8 files in one PR.
8. **Vercel-side env-var rename** (code handles both names; Vercel still on legacy).
9. **`test_pipeline_drift.py` cleanup.**

## Recommended next

**Master synthesizer (§6.1).** Single highest-leverage unblock. After master synthesizes, every other roadmap item compounds against a real combined-conclusion endpoint. Right window: 15 upstreams shipped; never more to synthesize.
