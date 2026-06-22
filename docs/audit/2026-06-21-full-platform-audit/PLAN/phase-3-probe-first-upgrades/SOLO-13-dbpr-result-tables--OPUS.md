# 13 — dbpr_sirs `result.tables` (zero-LLM) + `fetch_tables()` helper — **SOLO + PROBE-GATED**

**Model: Opus.** **SOLO — serializes AFTER 10 (same dbpr file) AND 07 (the `fetch_tables` helper lands in
the shared client).** **Priority: P3 (gated).** Full plan: `BRIEF.md` #9 + capability row #1.

## What it buys (verified)
`result.tables` (DefaultTableExtraction, ON by default, `table_score_threshold=7`) returns header-keyed
`{headers, rows, caption}` from any real `<table>` — zero-LLM, kills positional `parse_*_rows` parsers that
silently shift on layout drift (Brain-Factory rule 2). `CrawlResult.tables` exists on 0.9.0; used **nowhere**
in the repo today.

## ⚠️ Premise correction (BRIEF #9)
The helper is for a **class of government summary tables**, not a blanket retrofit. FGCU RERI is **PDF-only**
(already pdfplumber-handled) and LeePA is a **search form** — neither applies. dbpr_sirs (the Qlik grid,
currently hand-walked) is the candidate **only if it renders a real `<table>`**.

## Gate (probe before coding the parser swap)
**Does the dbpr_sirs Qlik grid emit a real HTML `<table>`, or is it `<div>`-rendered?** Fetch a sample and
inspect. If `<div>`-rendered, `result.tables` won't see it → keep the hand-walked parser (this build becomes
just the additive `fetch_tables()` helper + fixture test, no dbpr rewrite). If it IS a `<table>`, proceed.

## Steps
1. **Probe first.** Read `dbpr_sirs/pipeline.py` (the `parse_*_rows` Qlik walk) AFTER build 10 landed; read
   the `condo-sirs-swfl` pack to know the exact output shape that must stay stable.
2. STEP 1 (additive, always safe): add `_scrape_tables()` + sync `fetch_tables()` to `crawl4ai_client.py`
   (DataFrame per table, `df.attrs` provenance, empty-tolerant). Nothing existing modified. Offline
   HTML-fixture test.
3. STEP 2 (only if the gate says `<table>`): swap dbpr_sirs's positional parser for `result.tables`.
   **Brain-first parity:** rebuild `condo-sirs-swfl` and diff its `--- OUTPUT ---` (key_metrics) before vs
   after — must be unchanged or strictly more correct. This is why it's Opus.

## Done when
- The helper + fixture test land (STEP 1); AND, if the gate passed, `condo-sirs-swfl` output verified
   identical/improved after the parser swap. Gate 5 (pack ⇆ catalog) + the pack's own test pass.

## Best-practice fold-in
If the gate finds the Qlik grid is `<div>`-rendered (not a real `<table>`), `result.tables` won't see it and
the LLM extraction path stays — in that case the structured-output reliability fallback is `strict:true` JSON
(build 26), not a positional re-parse.

## Risk
Low for the helper; medium for the parser swap (output-shape drift on a consumed brain) → brain-first parity
diff is mandatory. Serializes after 10 (dbpr file) and 07 (client helper).

## References (added 2026-06-22 — crawl4ai-live + best-practices fold-in)
**crawl4ai-live (tool-usage reference, docs/audit/2026-06-21-crawl4ai-live/):**
- `docs/audit/2026-06-21-crawl4ai-live/round2/18-table-extraction.md` — result.tables {headers, rows, metadata}, table_score_threshold=7
- `docs/audit/2026-06-21-crawl4ai-live/round3/22-table_extraction.md` — deeper table-extraction contract
- `docs/audit/2026-06-21-crawl4ai-live/round3/23-no-llm-strategies.md` — JsonCss/Regex zero-LLM extraction (free after one schema gen)
- `docs/audit/2026-06-21-crawl4ai-live/round3/20-arun-result-contract.md` + `docs/audit/2026-06-21-crawl4ai-live/round3/21-crawl-result.md` — where result.tables lives on the result
**best-practices-research (how to build/operate what we build, docs/audit/2026-06-21-best-practices-research/):**
- `docs/audit/2026-06-21-best-practices-research/round3/q-anthropic-structured-output.md` — the strict:true fallback if no real <table> (-> build 26)
**Verified:** confirmed zero-LLM table path exists; gated on the probe "does the Qlik grid emit a real <table>?"; must verify condo-sirs-swfl parity — folded into Steps above where applicable.
