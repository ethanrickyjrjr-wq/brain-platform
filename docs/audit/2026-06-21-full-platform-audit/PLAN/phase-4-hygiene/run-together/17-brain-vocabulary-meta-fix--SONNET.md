# 17 — `brain-vocabulary.json` meta fix (stale count + mojibake)

**Model: Sonnet.** One JSON file, metadata only. **Priority: P3.**

## The defect (verified)
`refinery/vocab/brain-vocabulary.json:8` `"concept_count": 214`, but the actual `concepts` object has **277**
entries and `slug_index` has **304**. `meta.description` (line 5) carries Windows-1252 **mojibake** around an
em-dash (bytes render as `â€"`).

## Steps
1. **Probe first.** Open the file; count `concepts` keys and `slug_index` keys (don't trust the audit's
   numbers blindly — recount: the verification found 277 / 304).
2. Edit **meta only** — set `concept_count` to the real `concepts` count; if there's a `slug_index_count`
   (or similar) meta field, fix it too. Re-encode `meta.description` as clean UTF-8 (replace the mojibake
   em-dash with a real `—`). **Do NOT touch `concepts`/`slug_index`/`raw_slug_patterns`** — those are the
   live vocab the resolver reads.
3. The resolver reads `slug_index`, not `meta.concept_count`, so this is cosmetic — but run the vocab
   coverage check anyway to be safe.

## Done when
- `bun refinery/tools/check-vocab-coverage.mts --all` still passes; the JSON parses; `meta.concept_count`
   matches the real count; `meta.description` is clean UTF-8.

## Best-practice fold-in
JSON metadata fields that diverge from structural reality become stale documentation traps. Keeping
`concept_count` derived (or auto-computed at build time) is the standard fix; until then, updating it
in the same commit as any vocab change is the lightweight safeguard.

## Risk
Very low (metadata-only). The `--all` coverage check is the guard against accidentally touching live vocab.

## References (added 2026-06-22 — crawl4ai-live + best-practices fold-in)
**crawl4ai-live (tool-usage reference, docs/audit/2026-06-21-crawl4ai-live/):**
- (n/a — not a crawl4ai build)
**best-practices-research (how to build/operate what we build, docs/audit/2026-06-21-best-practices-research/):**
- (n/a — internal cosmetic; no external best-practice applies)
**Verified:** confirmed 277 concepts / 304 slug_index / mojibake — folded into Steps above where applicable.
