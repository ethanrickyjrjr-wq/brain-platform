# 21 — supercrawl4ai disposition: delete vs keep (its capabilities are now adopted natively) — **SOLO**

**Model: Opus.** Decision + possible deletion. **SOLO — AFTER builds 11 + 13** (they natively adopt
supercrawl's main capabilities, which is what makes the disposition decidable). **Priority: P3.**

## The situation (verified)
`ingest/lib/supercrawl4ai.py` is **fully built + tested but imported by ZERO pipelines/GHA jobs** (only its
own `supercrawl4ai_bench.py` + `test_supercrawl4ai.py` import it; everything else is docs). It bundles
proxy, tables, fit_markdown, virtual_scroll, jitter, monitor, after_goto — all dormant dead weight.

## Why this comes last
By the time builds 07 (jitter/monitor/stream/after_goto/fit_markdown), 11 (virtual_scroll/scan_full_page),
12 (proxy), and 13 (`result.tables` / `fetch_tables`) land, **supercrawl4ai's capabilities live natively in
the shared client + pipelines.** At that point supercrawl4ai is redundant staging code. The decision can't
be made responsibly until you can see which of its caps were adopted and which weren't.

## The decision
1. **Probe first.** After 07/11/12/13, grep again for any new `supercrawl4ai` importer; list which caps were
   adopted natively vs. which remain only in supercrawl4ai.
2. **RULE 3 / RULE 3.5 (architecture-shape decision):** does anything of value remain ONLY in supercrawl4ai?
   - If **no** (everything adopted): **delete** `supercrawl4ai.py` + `supercrawl4ai_bench.py` +
     `test_supercrawl4ai.py`, and update the BRIEF/SESSION_LOG to record the adopt-then-retire path.
   - If **yes** (a cap is uniquely there and wanted): either port that one cap into the shared client (and
     then delete), or keep supercrawl4ai as an explicitly-documented staging lib with a tracked adoption plan
     (no orphan-by-default).
3. Whatever you choose, leave NO dormant-imported-by-zero module without a written reason.

## Best-practice fold-in
An untested-in-prod, imported-by-zero library is toil weight, not an asset — it must *earn* its keep. The
VERIFICATION pass confirms every supercrawl4ai cap (proxy/tables/fit_markdown/virtual_scroll/jitter/monitor)
is dormant and is exactly what 07/11/12/13 adopt natively. So the default after those land is **lean delete**;
keep only if a cap is uniquely there and wanted (probe step 1 decides).

## Done when
- A decision is recorded (delete or keep-with-reason); if delete, the 3 files are gone and `ingest` tests +
   the ingest smoke still pass with no broken import.

## Risk
Low (it's imported by nothing live). The risk is *deciding too early* — hence the after-11/13 gate.

## References (added 2026-06-22 — crawl4ai-live + best-practices fold-in)
**crawl4ai-live (tool-usage reference, docs/audit/2026-06-21-crawl4ai-live/):**
- `docs/audit/2026-06-21-crawl4ai-live/STEP7-FINAL-REPORT.md` (fix #6) — supercrawl4ai built but wired into ZERO pipelines
- `docs/audit/2026-06-21-crawl4ai-live/round2/17-virtual-scroll.md`, `docs/audit/2026-06-21-crawl4ai-live/round2/16-fit-markdown.md`, `docs/audit/2026-06-21-crawl4ai-live/round2/18-table-extraction.md`, `docs/audit/2026-06-21-crawl4ai-live/round2/12-proxy-security.md` — the four caps it bundles (now adopted natively by 07/11/12/13)
**best-practices-research (how to build/operate what we build, docs/audit/2026-06-21-best-practices-research/):**
- `docs/audit/2026-06-21-best-practices-research/round2/rootcause-sre-eliminating-toil.md` — dead/untested-in-prod weight is toil; remove or earn it
**Verified:** confirmed: every supercrawl4ai capability (proxy/tables/fit_markdown/virtual_scroll/jitter/monitor) is dormant; its caps are exactly what builds 07/11/12/13 adopt NATIVELY -> after they land, supercrawl4ai is likely redundant -> lean delete — folded into Steps above where applicable.
