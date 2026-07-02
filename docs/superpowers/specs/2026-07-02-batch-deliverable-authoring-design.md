# Batch Deliverable Authoring — Message Batches API for the scheduled-send fleet

**Status: PARKED — trigger-gated. Do NOT build until the trigger below fires.**
**Written 07/02/2026 while the analysis was fresh; this is a shelf spec, not an active build.**
When the trigger fires: register via `node scripts/new-build.mjs batch-deliverable-authoring "Batch API for scheduled-send authoring"`, re-verify the vendor surface with crawl4ai (it WILL have drifted), then brainstorm the implementation plan per RULE 3.5.

---

## 1. Problem / why this exists

Every scheduled deliverable send regenerates its AI-authored narrative with fresh data
(THE GOAL: "emails/PDFs a user builds+schedules in 5 min, fresh data + AI commentary").
Today each regeneration is a synchronous `messages.create` call at full price:

- `lib/email/build-doc.ts:467` and `:570` — the `email_build` authoring calls
- `lib/email/social-calendar/build-week.ts:241`, `build-canvas-fill.ts:60`,
  `listing-comps.ts:110`, `listing-scrape.ts:384` — supporting authoring calls
- All routed through `getAnthropic(callType)` in `refinery/agents/anthropic.mts`,
  which logs every call to `public.api_usage_log` with cost via `computeCostUsd`.

At today's volume (a handful of scheduled deliverables per send window) this is correct
and cheap. But a send window with hundreds/thousands of subscriber deliverables is the
exact shape the Anthropic **Message Batches API** exists for: many independent prompts,
nobody watching in real time, all needed by a deadline rather than instantly — at **50%
of standard token prices**.

**Explicitly NOT in scope** (these stay on synchronous `messages.create` forever):
- Interactive Email Lab builds — a user is watching the canvas; batch latency (typically
  under 1h) is unusable there.
- Refinery brain synthesis — the 32-brain rebuild is a dependency DAG (downstream reads
  upstream `--- OUTPUT ---`); calls are not independent, so they can't share a batch.
- Assistant chat / chart compose — interactive by definition.

## 2. Trigger — when this build activates

Both thresholds are operator-tunable knobs, not data claims. Check them against
`public.api_usage_log` (surfaced on the ops dashboard):

1. **Volume:** a single scheduled send window contains ≥ 25 independent deliverable
   builds (25 × ~2 calls each is where orchestration cost < savings), OR
2. **Spend:** monthly `email_build`/`deliverable_build` cost attributable to *scheduled*
   (non-interactive) sends exceeds ~$50/mo — i.e., the 50% discount is worth ≥ ~$25/mo.

Below both thresholds, the batch plumbing (submit → poll → collect → fallback) costs
more in complexity than it saves. Do the math from the log, don't guess.

## 3. Vendor surface (verified in-session via crawl4ai, 07/02/2026)

Source: `https://platform.claude.com/docs/en/build-with-claude/batch-processing.md`
(fetched with crawl4ai per RULE 0.4; re-verify before building — these values drift).

- Endpoint: `POST /v1/messages/batches`. TS SDK (what we use):
  - Create: `await anthropic.messages.batches.create({ requests: [{ custom_id, params }] })`
  - Poll: `await anthropic.messages.batches.retrieve(id)` until
    `.processing_status === "ended"`
  - Collect: `for await (const result of await anthropic.messages.batches.results(id))`
- `custom_id`: 1–64 chars, `^[a-zA-Z0-9_-]{1,64}$`. **Results come back in ANY order —
  key by `custom_id`, never by position.**
- Result types per request: `succeeded` / `errored` / `canceled` / `expired`. On
  `errored`, `invalid_request_error` means fix the body before resending; other error
  types are safe to retry directly.
- Limits: 100,000 requests or 256 MB per batch, whichever first. Most batches finish
  < 1 hour; hard expiry at 24 hours (unfinished requests come back `expired`). Results
  downloadable for 29 days.
- Pricing: 50% of standard on ALL usage. Verified batch rates ($/MTok in/out):
  Sonnet 4.6 **$1.50 / $7.50** · Haiku 4.5 **$0.50 / $2.50** · Opus 4.8 **$2.50 / $12.50**.
- Supported inside a batch: everything we use — system prompts, tool use (incl. server
  tools), vision, multi-turn, prompt caching. NOT supported (validation error):
  `stream: true`, `speed` (fast mode), `max_tokens: 0` (cache pre-warm), thread params,
  `cache_hint`/`context_hint`.
- Prompt caching inside batches: vendor tip is to use the **1-hour cache TTL**
  (`cache_control: {type: "ephemeral", ttl: "1h"}`) on shared context, since batches
  routinely outlive the 5-minute default TTL. Cache hits inside a batch are best-effort.
- Not ZDR-eligible (we are not a ZDR org; noting for completeness).
- Batches are Workspace-scoped; rate limits are separate from synchronous Messages
  limits (HTTP requests + queued request count).

## 4. Design sketch

The authoring seam splits into three phases; only the middle one changes. Four-lane
sourcing, `gateNarrative`, and every validator stay exactly where they are (RULE C2:
extend the existing seam, no new mandatory gate).

**Phase A — prepare (deterministic, unchanged logic).** At batch kickoff (T-2h before
the send window), the scheduler collects all due deliverables and, for each, runs
today's prompt-assembly path (fresh lake data, project context, brand voice — identical
to what `build-doc.ts` feeds `messages.create` now) but *returns the request params
instead of calling the API*. This is a refactor of the authoring functions into
`prepareParams()` / `consumeResponse()` halves so the synchronous path and the batch
path share one prompt builder — zero drift between interactive and scheduled output.

**Phase B — batch round-trip (new, small).**
- Submit ONE batch: `custom_id = <deliverable_id>-<build_id>` (fits the regex; maps
  results back without ordering assumptions).
- Shared system/context blocks marked `cache_control: {type: "ephemeral", ttl: "1h"}`.
- Poll `retrieve()` with backoff (runs fine as a GHA job step or a Vercel cron tick;
  no long-lived process needed — poll, if not ended, exit and re-tick).
- **Deadline math:** kickoff T-2h; fallback cutoff T-30min. If the batch isn't `ended`
  by the cutoff, cancel it and run the stragglers through today's synchronous
  `messages.create` path at full price. A late send is a product failure; a full-price
  build is just Tuesday. `expired`/server-`errored` results take the same fallback.
  `invalid_request_error` results fail loudly (the prompt builder produced a bad body —
  that's a bug, not a retry).

**Phase C — consume (unchanged logic).** Each `succeeded` result's message flows into
the same validation + assembly path a synchronous response takes today: no-invention
lint, citation roots, as-of stamping, then render + send at the scheduled time.

**Usage logging.** Batch results carry per-message `usage`. Route each through
`logApiUsage` with a new `CallType` (e.g. `"deliverable_batch_build"`) and teach
`computeCostUsd` a batch flag — the verified batch rates above are exactly 0.5× the
`RATES` table in `refinery/agents/anthropic.mts`, so a `× 0.5` multiplier keyed off the
call type is sufficient (keep the cache read/write fractions; they discount too).
Without this, the ops spend dashboard would double-report batch costs.

## 5. Failure modes to design against

- **Batch never ends before cutoff** → cancel + synchronous fallback (above). Sends
  must never slip because we chased a discount.
- **Result/`custom_id` mismatch or missing result** → treat as `expired`: synchronous
  fallback for that deliverable. Never send a deliverable whose narrative came back
  keyed to a different build.
- **Partial batch success** → per-result handling; one bad deliverable never blocks the
  window's other sends.
- **Double-send** — the batch consumer and the fallback path must be idempotent on
  `build_id` (a result arriving after its fallback already built must be discarded).
- **Prompt staleness** — params are frozen at kickoff (T-2h). If a data source refreshes
  between kickoff and send, the deliverable carries the kickoff-time as-of date, which
  it states once (MM/DD/YYYY) as always. Acceptable: same freshness class as today's
  cron-built sends.

## 6. Non-goals / guardrails

- No per-ZIP or per-parcel pre-generated narrative fleet. That was the illustrative
  hypothetical that surfaced this spec; ZIP report pages stay deterministic
  (data-selected by code, narrative synthesized once per brain at the coarse grain).
- No change to interactive builds, refinery synthesis, or assistant paths.
- No new mandatory pre-materialization gate (RULE C2) — batch is a transport swap
  behind the existing authoring seam, not a pipeline stage.
- Never surface "batch" to users. A scheduled send is a scheduled send.

## 7. Evidence trail

- Codebase probe 07/02/2026: zero `messages.batches` call sites; only `.messages.create`
  / `.messages.stream` are invoked anywhere (confirmed independently by the wrapper
  comment in `refinery/agents/anthropic.mts`, which grep-verified the same).
- Vendor facts: crawl4ai fetch of the batch-processing doc, 07/02/2026 (§3).
- Origin: operator conversation 07/02/2026 — "the AI authors a story in email lab"
  → the batch-shaped workload is the scheduled-send fleet at scale, not ZIP pages.
