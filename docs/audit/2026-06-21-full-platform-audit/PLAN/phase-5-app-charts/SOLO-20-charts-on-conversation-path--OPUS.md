# 20 — charts on the conversation path (Phase 3A) — **SOLO, independent track**

**Model: Opus.** **SOLO — but independent of EVERY other build** (different subsystem: TS app vs Python
ingest/cron). Can run in parallel with any phase. Opus because it touches the **no-invention moat** (two
grounded-prompt assemblies) and the chart-emit contract. **Priority: P1.**

## The gap (verified)
There is one AI endpoint (`POST /api/assistant` → `lib/assistant/engine.ts` → `runReportPath` /
`runConversationPath`). **Charts work on the report path but NOT the conversation path:**
- `lib/assistant/report-path.ts:118-119` builds the chart (`routeChart` + `buildChartForIntent`) and
  `:156-157` emits the `data: {chart}` SSE frame.
- `lib/assistant/conversation-path.ts:96-100` has an **INTERIM note that it CANNOT chart**; `routeChart` is
  imported (`:28`) but used only at `:187` to pick grounding, **never to emit a chart**.
- Proof the report-path chart fix works: `scripts/.prove-chart-deflection-result.json`
  `fixed_with_chart_bad_rate:0`. **Nuance (verified):** that file's top-level `"worked": false` because the
  *no-chart fallback* still deflected 12/12 — i.e. the fix works *when a chart is shown*; the chartless path
  is exactly the gap this build closes.

## The no-invention catch (verified)
There are **two parallel grounded-prompt assemblies**: `conversation-path.ts` assembles inline
(`:204-215`, also `:245/:446/:527`) and does NOT import `buildGroundedSystemPrompt`, while
`lib/grounded-answer.ts:85` has its own `buildGroundedSystemPrompt`. **A no-invention-safe chart fix must
touch the path that actually runs (conversation-path inline)** and not silently diverge the two.

## Steps
1. **Probe first.** Read `report-path.ts` (the chart build + emit), `conversation-path.ts` (the INTERIM
   note + the `routeChart` grounding use + the inline prompt assembly), and `grounded-answer.ts`.
2. **RULE 3.5 brainstorm** (this is a feature change). Decide: extract the report-path chart build/emit into
   a shared helper both paths call, vs. inline it in conversation-path. Preserve the no-invention contract
   (charts only from grounded `key_metrics`, never invented).
3. Port `buildChartForIntent` + the `data: {chart}` SSE frame into `runConversationPath`; remove the INTERIM
   "cannot chart" note so the analyst stops claiming it can't chart.

## Done when
- A conversation-path question that warrants a chart (e.g. a cre-swfl vacancy/asking-rent intent) emits a
   chart frame; the no-invention behavior holds (no chart without grounding); the prove-chart harness shows
   the conversation path no longer deflects. Live-verify after deploy (sibling to `one_assistant_unify_live_verify`).

## Best-practice fold-in
A no-invention chart must **cite the source rows it plots** (build 27 / REPORT P3#11): wire the chart's
`key_metrics` provenance through the native Citations API and retract-if-no-quote on the conversation path —
a chart with no citable grounding row is dropped, not emitted (same floor as the text answer).

## Risk
Medium (no-invention surface + two prompt assemblies). Isolated subsystem → safe to run anytime; Opus for the
moat-sensitivity.

## References (added 2026-06-22 — crawl4ai-live + best-practices fold-in)
**crawl4ai-live (tool-usage reference, docs/audit/2026-06-21-crawl4ai-live/):**
- (n/a — not a crawl4ai build)
**best-practices-research (how to build/operate what we build, docs/audit/2026-06-21-best-practices-research/):**
- `docs/audit/2026-06-21-best-practices-research/round1/brains-anthropic-reduce-hallucinations.md` — cite a source per claim; allow "I don't know" (the chart must not invent)
- `docs/audit/2026-06-21-best-practices-research/round3/q-anthropic-citations.md` — native Citations API returns cited_text per claim (-> build 27)
- `docs/audit/2026-06-21-best-practices-research/round1/web-aisdk-agents.md` + `docs/audit/2026-06-21-best-practices-research/round1/web-nextjs-production-checklist.md` — the app-layer patterns for streaming chart frames
**Verified:** V-10 — the chart fix works WHEN a chart is shown (fixed_with_chart_bad_rate:0); the chartless fallback still deflected 12/12 — that chartless path is the open gap to keep in mind — folded into Steps above where applicable.
