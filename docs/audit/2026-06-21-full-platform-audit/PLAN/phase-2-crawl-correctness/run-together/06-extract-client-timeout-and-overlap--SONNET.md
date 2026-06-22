# 06 — extract_client: fix the 8-minute page_timeout + add chunk overlap

**Model: Sonnet.** Single file, two well-specified fixes. **Priority: P2.**

## The defects (verified)
1. **8-min per-page timeout (unit bug).** `ingest/lib/extract_client.py`: `extract()` defaults
   `timeout: int = 480` (seconds, line 168); line 195 calls `fetch_many(url_list, timeout=timeout * 1000 …)`
   → `480 * 1000 = 480000`, and `fetch_many` passes that straight to `CrawlerRunConfig(page_timeout=…)`
   which crawl4ai treats as **milliseconds** → 480000 ms = **8 minutes per page**. A firecrawl-era *job*
   budget got reused as a *per-page browser* timeout. A stuck page hangs ~8 min.
2. **Zero chunk overlap (BRIEF #26).** `_chunk_text` (~64-79) splits at ~24k with **no overlap** → a record
   straddling a boundary loses fields.

## Steps
1. **Probe first.** Read `extract_client.py` ~60-80 (`_chunk_text`), ~160-200 (`extract()` + the
   `fetch_many` call), and `crawl4ai_client.py:185-200` (how `fetch_many`'s `timeout` becomes `page_timeout`).
2. **Timeout:** separate the *job* budget from the *per-page* timeout. Set the per-page `page_timeout` to
   **60–90s** (ms). Either stop multiplying by 1000 and pass a sane ms value, or add an explicit
   `page_timeout_ms` param to `fetch_many` and leave the job-level budget elsewhere. Pick the option that
   doesn't change `fetch_many`'s public default for other callers (coordinate with 07's byte-identical rule).
3. **Overlap:** add a ~10% tail carry to `_chunk_text` (BRIEF #26 — "port the idea, keep our engine; no
   litellm dep"); dedup rows on their id so the overlap doesn't double-count.
4. (Optional, same file) the P3 "de-dup the crexi JSON-fence onto extract_client" can ride here if trivial.

## Done when
- Offline test: a deliberately slow URL times out per-page in ~60-90s (not 8 min); a record spanning a
  chunk boundary survives (fixture with a row straddling 24k). Existing `extract()` callers unaffected.

## Best-practice fold-in
Build 26 (Structured Outputs `strict:true`) removes the hand-rolled `json.loads` + fence-stripping that
currently runs downstream of this chunker (REPORT P3 #10). When build 26 ships, Step 3's `_dedup_rows`
merge becomes simpler — the fences are gone and the schema is guaranteed. No action required here; note it
as a sequencing dependency if both builds land in the same PR.

## Risk
Low–medium. The timeout change touches a default other callers share — keep `fetch_many`'s default for
non-`extract` callers unchanged (see Phase-2 `_CONTRACT.md`).

## References (added 2026-06-22 — crawl4ai-live + best-practices fold-in)
**crawl4ai-live (tool-usage reference, docs/audit/2026-06-21-crawl4ai-live/):**
- `docs/audit/2026-06-21-crawl4ai-live/round1/05-parameters.md` — page_timeout is MILLISECONDS; delay_before_return_html is the safety margin, wait_for is the settle
- `docs/audit/2026-06-21-crawl4ai-live/round2/19-markdown-generation.md` — chunking/overlap mechanics
- `docs/audit/2026-06-21-crawl4ai-live/round2/16-fit-markdown.md` — denoised markdown the chunker consumes

**best-practices-research (how to build/operate what we build, docs/audit/2026-06-21-best-practices-research/):**
- (n/a — crawl4ai tool-usage build; JSON-reliability fold-in points to build 26)

**Verified:** confirmed end-to-end (480x1000=480000ms) in VERIFICATION "confirmed-as-written" — folded into Steps above where applicable.
