# 26 — Anthropic Structured Outputs `strict:true` for `extract()` / brain-factory JSON (kill the hand-rolled fence-stripping)

**Model: OPUS.** Vendor-API surface (GA + exact request shape + supported model IDs all DRIFT — RULE 1
WebFetch is mandatory in-session) layered onto the shared `extract()` client every AI-extraction pipeline
calls; the contract is verbatim-sensitive, so Opus. **Priority: P3.** Best-practices hardening — it removes a
whole class of parse failures, not a daily red.

## The gap (verified)
The repo **hand-rolls what the Anthropic API now guarantees.** Every LLM extraction call sends a free-text
prompt that *asks* for `{"rows":[...]}` and then defends against malformed output with a fence-stripper +
a bare `json.loads` that silently swallows parse errors into an empty list. Two live copies of the same
fragility (confirmed 2026-06-22):

- **`ingest/lib/extract_client.py`** — `_parse_rows` (lines 119-132): `if "```" in raw:` split-on-fence,
  `raw[4:]` to drop a `json` tag, then `try: json.loads(raw) except (JSONDecodeError, AttributeError):
  return []`. The instruction (`_build_instruction`, 108-116) literally pleads *"Return ONLY valid JSON …
  No markdown fences."* The Haiku call (`_llm_extract_rows`, 142-156) passes no schema enforcement — just
  `messages.create(model, max_tokens, temperature=0, messages=[…])`.
- **`ingest/pipelines/crexi_listings/extract.py`** — `_extract_with_llm` (lines 86-118): the **exact same**
  fence-strip (`if "```" in raw:` … `raw[4:]`) + `json.loads(raw).get("rows", [])` wrapped in a bare
  `except`. This is the proven-fragile path `extract()`'s docstring says it generalizes (lines 13-19) — it
  ties directly to **build 11 (crexi)**.

A silent parse failure here returns **zero rows that look like "page had no matches"** — indistinguishable
from a real empty page, so the operator never learns the extraction broke. `strict:true` / `output_config.format`
makes the model emit schema-valid JSON via constrained decoding — *"No more `JSON.parse()` errors … No
retries needed for schema violations"* (vendor doc) — which deletes the fence-stripper and the swallow-to-`[]`
branch entirely.

**Scope note (verified, do NOT widen):** the `refinery/**` `JSON.parse` calls (`brain-output-reader.mts`,
`speaker.mts:130`, `spec-validator.mts`, `vocab-coverage.mts`, the `*-source.mts` fixtures) parse the
**deterministic inter-brain `--- OUTPUT ---` / ```reference fence** — that JSON is emitted by *our own code*
between Stage 3/4, not by an LLM, so it is NOT a structured-outputs target. The "brain-factory JSON parse
path" in the REPORT row resolves to the **LLM extraction calls in `ingest/`**, not the TS render layer. Apply
this build to the two Python copies above; leave `refinery/**` untouched.

## Steps
1. **PROBE FIRST (RULE 0.5 — read the actual files, do not trust the line numbers above blindly):**
   - `ingest/lib/extract_client.py` — confirm `_parse_rows` / `_build_instruction` / `_llm_extract_rows`
     still match (the file moves under build 06's `page_timeout` change — re-read post-06).
   - `ingest/pipelines/crexi_listings/extract.py` — confirm `_extract_with_llm`'s fence-strip is still
     the duplicate (coordinate with build 11, which may already be rewriting this function).
   - Inventory the OTHER Anthropic callers found 2026-06-22 so the pattern is applied once, not piecemeal:
     `ingest/pipelines/{city_pulse,city_pulse_corridors}/distill.py`, `corridor_grounded/pipeline.py`,
     `dbpr_press_releases/enricher.py`, `dbpr_public_notices/summarize.py`, `marketbeat_pdf/extractor.py`.
     Decide which of these also parse LLM-JSON (in scope) vs. emit prose (out of scope).
   - `ingest/tests/lib/test_extract_client.py` — the test that pins the current `{rows:[...]}` contract.
2. **VENDOR-FIRST (RULE 1 — MANDATORY, in this session, do NOT hardcode from memory or from the round
   capture):** WebFetch `https://platform.claude.com/docs/en/build-with-claude/structured-outputs` and confirm
   **live**: (a) `strict:true` / structured outputs is **GA** (not beta) on the model IDs we actually call —
   `claude-haiku-4-5-20251001` (extract default) and `claude-opus-4-8`; (b) the **exact request field shape**
   — the round capture shows `output_config={"format":{"type":"json_schema","schema":{…}}}` (GA) superseding
   the beta `output_format` + `structured-outputs-2025-11-13` header, and `additionalProperties:false` +
   `required` on every object — **reconfirm this verbatim; it drifts.** Note the GA caveats that matter here:
   `stop_reason:"refusal"` and `stop_reason:"max_tokens"` can still return off-schema output (so a
   stop-reason check replaces the old `except` branch), and the **24 optional-param / 16 union-type**
   complexity limits (our row schemas are flat — fine, but confirm).
3. **RULE 3.5 brainstorm (short, at execution time):** SDK helper vs. raw request — `client.messages.parse()`
   with a Pydantic row model (auto-validates, returns `parsed_output`) vs. raw `output_config.format` with a
   hand-written JSON schema. Decide whether the `extract()` `schema=` kwarg (already a dict) maps straight to
   the JSON-schema path (likely — no Pydantic needed since callers pass a dict). Decide the failure contract:
   `strict` guarantees schema-validity, so the swallow-to-`[]` goes away — but a `refusal`/`max_tokens`
   stop-reason must now raise (or log loud + provenance-mark), NOT silently return `[]`. Keep the
   `{"status":"completed","data":{"rows":[...]},"_provenance":[...]}` return shape byte-identical so every
   caller (and `test_extract_client.py`) still passes.
4. **Implement** on the confirmed shape: replace `_build_instruction`'s "Return ONLY valid JSON … no fences"
   plea + `_parse_rows` fence-strip with a single `output_config.format` (or `messages.parse`) call carrying
   the row schema; delete the fence-stripper and the bare-`except → []`. Mirror the same change into crexi's
   `_extract_with_llm` (coordinate with build 11 so the two land consistently). Preserve `temperature=0`,
   the chunk-and-merge loop, and `_dedup_rows`.

## Done when
- `ingest/tests/lib/test_extract_client.py` passes with the fence-stripper deleted (the `{rows:[...]}`
  contract test still green): `python -m pytest ingest/tests/lib/test_extract_client.py -q`.
- A live single-URL `extract()` smoke against a real page returns schema-valid rows with **no** `_parse_rows`
  in the call stack, and a deliberately malformed-prompt run no longer silently returns `[]` — it surfaces
  the `stop_reason` (refusal/max_tokens) instead.
- `grep -rn 'if "\`\`\`" in raw' ingest/` returns **zero** matches (both copies removed).

## Risk
Medium. Shared `extract()` client (blast radius = all AI-extraction pipelines) + a vendor contract that
drifts. Contained by: the byte-identical return shape, the pinned `test_extract_client.py`, and the
mandatory in-session WebFetch (step 2) so the request shape is confirmed-live, not remembered. Coordinate the
crexi edit with **build 11** to avoid a two-session conflict on the same function. Sequence **AFTER build 06**
(it moves `extract_client.py`'s call site via `page_timeout`).

## References (added 2026-06-22)
**best-practices-research (docs/audit/2026-06-21-best-practices-research/):**
- `docs/audit/2026-06-21-best-practices-research/round3/q-anthropic-structured-output.md` — `strict:true` guarantees schema-valid JSON; GA on Opus 4.8 / Haiku 4.5 (RECONFIRM live — the round capture is a pointer, not authority; `output_config.format` is the GA shape that supersedes the beta `output_format` + header)
**crawl4ai-live (docs/audit/2026-06-21-crawl4ai-live/):**
- `docs/audit/2026-06-21-crawl4ai-live/round3/23-no-llm-strategies.md` — where zero-LLM extraction (build 13) removes the need for JSON entirely; `strict:true` is for the paths that STILL need an LLM (crexi-style free-text pages where no CSS/XPath schema exists)
**Ties to existing builds:** build 06 (extract_client `page_timeout` — sequence AFTER), build 11 (crexi fence logic — coordinate the duplicate edit), build 13 (the zero-LLM alternative for structurable pages).
**Verified (probe, 2026-06-22):** the fence-strip + bare-`except → []` is duplicated verbatim in `ingest/lib/extract_client.py` (`_parse_rows`, 119-132) and `ingest/pipelines/crexi_listings/extract.py` (`_extract_with_llm`, 101-118); the `refinery/**` `JSON.parse` calls parse the deterministic inter-brain OUTPUT fence (our code, not LLM) and are OUT of scope — folded into the Scope note + Steps above.
