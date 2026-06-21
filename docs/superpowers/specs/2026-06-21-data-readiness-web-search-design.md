# Data-readiness ladder — swap dead crawl4ai `/search` for Anthropic `web_search` grounding

**Date:** 2026-06-21
**Check:** `crawl4ai_search_ladder_dead`
**Scope:** `lib/email/data-readiness.ts` + `lib/email/verification-sources.ts` (+ new `lib/email/data-readiness.test.ts`)
**Operator decision:** Option A — Anthropic `web_search` tool grounding (selected via AskUserQuestion 2026-06-20). NOT a crawl4ai server (Option B), NOT single-source (Option C).
**Push gate:** RULE 1 diff-review — live `/api/cron/data-readiness` path. Build + test locally, then HOLD for operator review. Do not push.

---

## 1. The bug (root cause, proven)

`lib/email/data-readiness.ts:88-118` (`crawl4aiSearch`) POSTs `${CRAWL4AI_API_URL}/search` with `{ extraction_config: { type: "cosine" } }`. Three independent failures, all confirmed:

1. **No server is wired.** `CRAWL4AI_API_URL` is referenced only in this file (grep) and is **not** set in `data-readiness-cron.yml`'s `env:` block — so it defaults to `http://localhost:11235`, which does not exist in the Vercel runtime.
2. **The endpoint + extraction don't exist** in current crawl4ai. The `/search` route and `cosine` extraction were removed ~v0.4 (verified against the GitHub `deploy/docker/server.py` — no `/search` route, no cosine). crawl4ai is a **crawler keyed on a URL**, not a search engine keyed on a query.
3. **Failure is silent.** `if (!res.ok) return null` + `catch { return null }` → every metric silently skips Tier 1 + Tier 2 and degrades to ungrounded `sonnet_only` (or `last_known`/`omitted`).

**Prod evidence:** `data_readiness_alerts` has **0 rows ever**. Degradation is latent until the first schedule fires (schedule id=5, **2026-06-22 14:00 UTC**). Fixing now beats fixing under a live blast.

This is **not** a crawl4ai problem to solve with a crawl4ai server — crawl4ai cannot do query→answer web search at all. The right primitive is a **search engine with grounding**, which we get from Anthropic's own `web_search` server tool (verification, not ingest — does **not** violate "crawl4ai is the only crawl tool"; that rule governs *ingest crawling*).

## 2. Vendor-First contract (verified in-session, 2026-06-21)

Source: `platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool` + `/tool-reference`.

- **Tool (non-beta, no `anthropic-beta` header):**
  ```json
  { "type": "web_search_20250305", "name": "web_search",
    "max_uses": 4, "allowed_domains": ["bls.gov"] }
  ```
  Works on the plain `anthropic.messages.create` surface (the SDK already pinned at `@anthropic-ai/sdk@^0.69.0` exposes `web_search_20250305` on the non-beta `messages` type; `_20260209`/`_20260318` are beta-namespace only — we deliberately use the basic GA tool).
- **Model:** `claude-sonnet-4-6` — on the support list for even the dynamic-filtering versions, so it supports the basic GA tool. (Existing code already calls sonnet-4-6 here.)
- **Response blocks (in `msg.content`):**
  - `text` — narration / final answer; final-answer text carries `citations[]` of `web_search_result_location` (`url`, `title`, `cited_text`).
  - `server_tool_use` — the query (`input.query`).
  - `web_search_tool_result` — `content` is either an array of `web_search_result` (`url`, `title`, `page_age`, `encrypted_content`) **or** `{ type: "web_search_tool_result_error", error_code }`.
- **Errors return HTTP 200** with a `web_search_tool_result_error` block (`too_many_requests`, `max_uses_exceeded`, `query_too_long`, `unavailable`, `invalid_input`). MUST be detected → logged LOUD.
- **`stop_reason: "pause_turn"`** → re-send accumulated content to continue (bounded loop).
- **Cost:** $10 / 1000 searches + tokens. Volume is a few metrics × ≤3 calls, hourly only when a send is ≤75 min out → trivial.

**Sourcing is strictly better than the old `sonnetVerify`:** old code trusted a *model-emitted* `source_url` (hallucinable). web_search citations are **real fetched URLs**.

## 3. New ladder (replaces Tiers 1–3; Tiers 4–5 unchanged)

| Tier | Name | Mechanism |
|------|------|-----------|
| 1 | `web_consensus` | Two grounded `web_search` calls over **disjoint domain subsets** of `preferred_domains`; both return numeric values **within tolerance** → consensus. value = call-A answer (units preserved), sources = union of both calls' cited URLs. |
| 2 | `web_single` | One grounded cited value (reuses a Tier-1 call's result when exactly one side produced a value; or the sole call for single-domain metrics). |
| 3 | `model_only` | Plain model call, **no `web_search` tool** — honest *ungrounded* last resort. Prompt instructs `UNKNOWN` rather than guessing. `source_urls = []`. |
| 4 | `last_known` | freshness_token age ≤ `max_stale_days` → reuse snapshot value. (unchanged) |
| 5 | `omitted` | all tiers exhausted. (unchanged) |

**Tier order is preserved from the old code** (grounded → ungrounded model → last_known → omitted), matching the operator-approved preview. (Follow-up worth considering but **out of scope**: move `model_only` *below* `last_known`, since a recent real value may beat an ungrounded guess; and add a true `brain_fresh` short-circuit — currently in the type but never returned, so every metric runs the full ladder hourly.)

**Two-source consensus mapping.** `splitDomains(preferred_domains)` alternates by index → `[groupA, groupB]`. `groupB` empty (single-domain metric, e.g. unemployment→`bls.gov`) ⇒ no real second source ⇒ skip consensus, go straight to `web_single`. This keeps consensus *honest* (genuine cross-source agreement, never the same source twice).

## 4. LOUD failure (no silent degradation)

- `groundedLookup`: `catch` → `console.error("[data-readiness] web_search threw for <slug>: …")` and returns `{ value:null, sourceUrls:[], error }` (never swallows).
- `web_search_tool_result_error` block → `console.warn("[data-readiness] web_search error <code> for <slug>")`, value treated as absent.
- `verifyMetricItem` emits a `console.warn` whenever it falls past `web_consensus` (records which tier it landed on). The durable signal stays `data_readiness_alerts.tier_used`; console adds Vercel-log visibility. The old silent `catch { return null }` is gone.

## 5. Testable seams (TDD)

No test file exists today — this fills the gap.

- **`splitDomains(domains)`** (pure, in `verification-sources.ts`).
- **`parseGroundedResponse(msg)`** (pure, in `data-readiness.ts`) → `{ answer, sourceUrls, searchError }`: pulls last `ANSWER:` line from text blocks, unions citation URLs + `web_search_result` URLs (deduped), detects the error block. `UNKNOWN` → `answer: null`.
- **`LookupFn` injection:** `verifyMetricItem(item, asOf?, deps?: { lookup?: LookupFn })`. Default `deps.lookup = groundedLookup`. Tests inject a fake keyed on `{ allowedDomains, grounded }` to drive every tier deterministically, no network. `model_only` = `lookup({ grounded: false })` (one seam, not two).
- Real call stays in `groundedLookup` (network + pause_turn loop); covered indirectly via `parseGroundedResponse` unit tests + a fake-client path.

**Test matrix:** consensus-agree → `web_consensus`; consensus-disagree → `web_single`; single-domain → `web_single`; both-absent → `model_only`; model UNKNOWN → `last_known`; stale token → `omitted`; snapshot-num-null path; error from a lookup still proceeds + logs; `parseGroundedResponse` extracts/dedupes/detects-error; `splitDomains` even/odd + single.

## 6. Surfaces NOT changed

- `data_readiness_alerts.tier_used` is `text` (no enum) → **no migration**.
- `app/api/cron/data-readiness/route.ts` checks only `"brain_fresh"` / `"omitted"` (both names kept) → **no route change**.
- `extractNumericValue`, `withinTolerance`, `toleranceFor`, `verificationQuery` reused as-is.
- Removed: `crawl4aiSearch`, `haikuConfirm`, `buildCrawl4aiSearchUrl`, the `CRAWL4AI_API_URL`/`_API_TOKEN` reads. `VerificationTier` swaps `crawl_consensus|crawl_haiku|sonnet_only` → `web_consensus|web_single|model_only` (`brain_fresh` kept — route-referenced).

## 7. Done = local-green, then HOLD

`bun test lib/email/data-readiness.test.ts` green · real `tsc` 0 on touched files · `eslint` clean. Then **stop** — operator runs the RULE 1 diff review and pushes. Reconcile the check only on **prod evidence** (`data_readiness_alerts` rows with `web_*` tiers after the 06-22 send), never on "code looks right".

## 8. Post-adversarial-review hardening (2026-06-21)

A 23-agent workflow (5 dimensions → verify-each-finding) confirmed **18 findings, 0 dropped**. Triaged + applied:

**Fixed (correctness / honesty / robustness):**
- **Cross-source disagreement honesty** (major). When both grounded sides return numeric-but-disagreeing values, the ladder no longer reports a clean `web_single` off side A: it flags `within_tolerance: false` and keeps **both** source URLs, so a contradicted reading is never dressed up as clean. `web_single` now means "exactly one side produced a usable value" (spec-aligned) OR a flagged conflict.
- **Per-item cron isolation** (major). `route.ts` now wraps each metric's verify+log in `try/catch` — one bad item (or a `loadTolerances` throw) can't abort the rest of the loop and leave a silent gap.
- **Tolerances bundling** — `next.config.ts` `outputFileTracingIncludes` now ships `ingest/data-verification-tolerances.yaml` into the cron's serverless function; `loadTolerances` additionally guards the read and degrades to a built-in `_default` rather than 500-ing.
- **Grounding error → durable signal** — `VerificationResult.grounding_error` carries a web_search infra error (`unavailable`/`too_many_requests`/throw) onto the fallback row, so "grounding broke" is distinguishable from "grounding found nothing". Logged LOUD; header comment corrected (no longer over-promises full DB persistence).
- **Insert-error log** now carries slug + tier.
- **Doc drift** — stale `crawl_consensus|crawl_haiku|sonnet_only` tier lists + dead `CRAWL4AI_API_URL` references updated in `cadence_registry.yaml`, both `data_readiness_alerts` SQL comment files, and `route.ts` header.
- **Test coverage** — 20 tests now: consensus-disagree-conflict, one-side-non-numeric, value-AND-error, grounding_error propagation, model_only-drops-sources, call-count (2 grounded / 1 grounded), staleness boundary (==/+1), no-trailing-date token, non-numeric snapshot, last-ANSWER-wins, citation-only parse.

**Deferred (out of scope / not prod-safe mid-review), noted for follow-up:**
- **Persist `grounding_error` to the table.** The `gate_reason` column (Phase-F migration `20260619b`) is **not live** in prod (verified via `information_schema`). Persisting needs that migration applied first — a one-line `ALTER TABLE … ADD COLUMN IF NOT EXISTS … ; NOTIFY pgrst` then add it to the insert. Left for the operator's call.
- **`max_tokens` truncation visibility** (minor) — a `stop_reason: "max_tokens"` before the `ANSWER:` line is currently indistinguishable from a clean UNKNOWN. `max_tokens` is 1024 (ample for a one-line answer); if truncation shows up in prod, raise to ~2048 and inspect the final `stop_reason`.
- **`brain_fresh` short-circuit** — still in the type, never returned; adding an early "value still fresh → skip the ladder" check would cut web_search cost but is a behavior change beyond this fix.
