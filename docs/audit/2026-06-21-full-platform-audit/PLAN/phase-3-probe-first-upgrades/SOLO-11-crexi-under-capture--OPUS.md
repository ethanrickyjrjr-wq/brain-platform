# 11 — Crexi under-capture overhaul — **SOLO + PROBE-FIRST** (highest yield, highest uncertainty)

**Model: Opus.** **SOLO.** **Depends on: 06 (chunker) + 07 (additive step params).**
**Priority: P1/P2 (biggest LLM-source yield lever).** Full plan: `BRIEF.md` #7 + capability rows #2/#3/#4.

## The defect (verified)
`ingest/pipelines/crexi_listings/extract.py` (NOTE: dir is `crexi_listings/`, the audit's `crexi/` is wrong):
ONE manual `_SCROLL_JS` (def line 42, applied once line 76) + `soup.get_text(...)[:28000]` hard truncation
(line 83). The highest-volume LLM source **silently amputates rows**. `delay_after=5.0` (line 70) + `4.0`
(line 77) are blind waits too.

## ⚠️ Two gates that MUST run before any code (from BRIEF #7 — verified-correct)
- **P0a — DOM shape (home-IP):** is the Crexi grid **virtualized** (recycles DOM nodes → Branch A
  `VirtualScrollConfig`, replaced-DOM capture + dedup) or **accumulating** (appends → Branch B
  `scan_full_page`)? **The wrong branch silently captures nothing extra.** Determine this on a real browser first.
- **P0b — GHA-IP reachability:** Crexi actively blocks datacenter ASNs. Run `ingest-crexi-listings`
  `workflow_dispatch --dry-run` and compare the raw count vs a home-IP run. **Accela's GHA-IP clearance does
  NOT generalize** (BLS LAUS + Census both 403'd a datacenter fetch this audit). If the runner returns
  zero, the code fix is moot until residential egress / a self-hosted runner exists — this build (and 12/13)
  reduce to "needs egress." **This is the single highest-leverage probe in the whole plan — run it first.**

## ⚠️ Premise correction (BRIEF #7)
"Route Crexi through the shipped `extract()`" is **half-wrong** — `extract()` uses `fetch_many` (separate
contexts, **no shared session, no scroll**); adopting it verbatim **deletes** the scroll and makes
under-capture worse. The scroll must stay in a stateful `Crawl4aiSession`; the chunker (from build 06)
applies to the **full** captured text.

## Steps (only after P0a + P0b resolve)
1. **Probe first** (code): read `crexi_listings/extract.py` end-to-end; confirm the scroll + the `[:28000]`
   cut + the two `delay_after` waits.
2. **RULE 3.5 brainstorm:** Branch A vs B per P0a; whether a `capture_network_requests` JSON-XHR read
   (BRIEF #6) beats scrolling entirely (highest ceiling if the XHR is reachable).
3. Swap in the chosen branch (additive `step()` params from 07 keep other callers byte-identical), **drop
   `[:28000]`**, apply build 06's chunker to the full text, and replace the blind `delay_after` with a `js:`
   "cards stopped growing" settle.

## Best-practice fold-in
This LLM path inherits the `[:28000]` cut → fence-strip ("Do not include markdown fences", `extract.py` L57)
→ `json.loads` fragility that **build 26's Anthropic Structured Outputs `strict:true` fixes** (REPORT BRAINS
JSON-reliability row) — wire this extract through that path so a malformed/fenced response can't drop rows.
Highest-ceiling alternative to scrolling: a `capture_network_requests` JSON-XHR read (Branch in Step 2) —
reading the grid's backing XHR beats scrolling entirely **if the XHR is reachable**.

## Done when
- A home-IP run captures materially MORE rows than the `[:28000]` baseline with no field loss; AND the P0b
   verdict on GHA reachability is recorded (so downstream knows whether prod can run it). `RULE 1`: ingest
   write + shared-lib consumption → show the diff.

## Risk
Code low; **outcome med-high and unresolvable from the desk** — hence probe-first + SOLO.

## References (added 2026-06-22 — crawl4ai-live + best-practices fold-in)
**crawl4ai-live (tool-usage reference, docs/audit/2026-06-21-crawl4ai-live/):**
- `docs/audit/2026-06-21-crawl4ai-live/round2/17-virtual-scroll.md` — VirtualScrollConfig for a recycled-DOM (virtualized) grid = Branch A
- `docs/audit/2026-06-21-crawl4ai-live/round2/15-content-selection.md` — scan_full_page for an accumulating grid = Branch B
- `docs/audit/2026-06-21-crawl4ai-live/round2/19-markdown-generation.md` — chunk the FULL captured text (replaces the [:28000] cut)
- `docs/audit/2026-06-21-crawl4ai-live/round3/24-network-console-capture.md` — capture_network_requests -> read the JSON XHR directly (highest ceiling; beats scrolling if reachable)
- `docs/audit/2026-06-21-crawl4ai-live/round1/08-page-interaction.md` — the js: "cards stopped growing" settle that replaces delay_after
**best-practices-research (how to build/operate what we build, docs/audit/2026-06-21-best-practices-research/):**
- `docs/audit/2026-06-21-best-practices-research/round3/q-anthropic-structured-output.md` (REPORT P3#10) — strict:true kills the fence-stripping this build inherits (-> build 26)
**Verified:** V-1 — dir is crexi_listings/ (audit's crexi/ was wrong); the [:28000] cut + single scroll + blind waits all confirmed — folded into Steps above where applicable.
