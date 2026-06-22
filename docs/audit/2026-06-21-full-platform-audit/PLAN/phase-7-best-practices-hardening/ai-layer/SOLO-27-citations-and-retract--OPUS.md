# 27 — Citations API + "retract if no supporting quote" self-check on the conversation path

**Model: Opus.** It touches the **no-invention moat** — the two grounded-prompt assemblies a no-invention
fix must touch (per NOTES §1) — plus a vendor surface (Anthropic Citations API) whose request/response
shape and model-id support drift. **Priority: P3.** This is AI-layer best-practices hardening (a
belt-and-suspenders layer + a citation surface for build-20 charts), not a daily red.

## The gap (verified)
We ground the conversational answer **structurally** — the payload controls the model's context, so "no
source in payload → no claim" (CLAUDE.md THE-GOAL). That moat is arguably **stronger** than a prompt-level
citation instruction (the model literally cannot reach an un-payloaded fact). But on the **conversational
follow-up path**, two things the authoritative source recommends are absent:
- **No per-claim citation surface.** The grounded prompt is assembled inline in
  `lib/assistant/conversation-path.ts` (the path that actually runs — `:204-215`, `:245/:446/:527` per build
  20's verification) and again in `lib/grounded-answer.ts` (`buildGroundedSystemPrompt`, ~`:85`). Neither emits
  a machine-checkable `cited_text` per claim — the answer is grounded but not **auditable** claim-by-claim.
  Anthropic's native **Citations API** returns `cited_text` per claim, and `cited_text` does **not** count
  toward output tokens (`round3/q-anthropic-citations.md`).
- **No "retract if no supporting quote" self-check.** The authoritative reduce-hallucinations guidance is:
  cite a quote+source per claim, and **have the model find a supporting quote after generating; if it can't,
  it must retract the claim** (`round1/brains-anthropic-reduce-hallucinations.md`). We rely on the structural
  floor alone; there is no post-generation retract pass.

This complements — does **not** replace — the structural moat. REPORT verdict for this row: *"✅ aligned
(arguably stronger: structural vs prompt) — ⚠️ could add the native Citations API + the 'retract if no quote'
self-check on the conversation path"* (REPORT "BRAINS / AI LAYER" no-invention row + P3 #11).

Repo anchors confirmed present (probe still required — do NOT trust these blindly): `lib/assistant/
conversation-path.ts`, `lib/grounded-answer.ts`, the Anthropic client `refinery/agents/anthropic.mts`
(`getAnthropic`/`TRIAGE_MODEL`, imported by grounded-answer), and the existing citation-render surface
`lib/citations/clean-url.ts` + `components/CitationList.tsx` (the single citation root per MEMORY — route any
new UI citation through it, don't rebuild).

## Dependencies / file-conflicts
- **AFTER build 20 (charts on the conversation path).** Both builds touch `conversation-path.ts` +
  `grounded-answer.ts` — the two grounded-prompt assemblies. Do **not** run concurrently with 20.
- **A build-20 chart must cite its source rows via this build.** Build 20's fold-in already pins it: a chart
  with no citable grounding row is **dropped, not emitted** — the same floor as the text answer. The chart's
  `key_metrics` provenance flows through the surface this build adds.

## Steps
1. **Probe first (RULE 0.5 — read the actual files, do not trust the line numbers above):**
   - `lib/assistant/conversation-path.ts` — the inline grounded-prompt assembly + how the dossier/`key_metrics`
     reach the model (the path that actually runs); confirm where `cited_text` would attach.
   - `lib/grounded-answer.ts` — the second `buildGroundedSystemPrompt` assembly; whether it shares the dossier
     builder (`buildDossier`/`fetchBrain`) with conversation-path so a fix lands in **both** without diverging.
   - `refinery/agents/anthropic.mts` — the `getAnthropic` client + model id; the request must be built here, not
     hand-rolled.
   - `lib/citations/clean-url.ts` + `components/CitationList.tsx` — the existing single citation root; any
     surfaced citation reuses it.
2. **Vendor-first (RULE 1, MANDATORY — `WebFetch` the LIVE docs in-session before coding):**
   - Citations API: `https://platform.claude.com/docs/en/build-with-claude/citations` — confirm the request
     shape (`document` block with `source` + `citations:{enabled:true}`), the **response** shape (multiple text
     blocks, each `citations[].cited_text` + `document_index` + char/page/block location), streaming
     (`citations_delta`), and current model support. **Load-bearing caveat from the live doc:** *Citations and
     Structured Outputs are incompatible* — enabling `citations` on a document **and** `output_config.format`
     returns **400**. Build 26 adds `strict:true` Structured Outputs to the JSON path; the conversation answer
     is **prose, not strict-JSON**, so they don't collide here — but the brainstorm must confirm this path does
     not also carry an `output_config.format`. Do not hardcode any of this from memory or from the round
     capture; the captured `round3/q-anthropic-citations.md` is a starting pointer, not authority.
3. **RULE 3.5 brainstorm (this is a behavior change — invoke `superpowers:brainstorming` at execution time):**
   decide the layering. The two designs to weigh:
   - **(a) Native Citations API** — pass the grounded dossier rows as `document`/custom-content blocks with
     `citations:{enabled:true}` so the model returns `cited_text` per claim natively. Pro: structurally
     reliable pointers, `cited_text` free on output tokens. Con: changes the request shape on the live
     conversational surface; verify it composes with the existing streaming + chart-frame emit (build 20).
   - **(b) Retract-if-no-quote self-check** — a lighter prompt-level pass: after the grounded answer, the model
     must find a supporting quote in the payload for each claim and retract any it can't support; allow
     "I don't know." Pro: minimal surface change, additive to the structural floor. Con: prompt-level, not
     machine-guaranteed.
   - These are **complementary, not exclusive** — (a) for the citation surface (esp. for build-20 chart
     rows), (b) as the cheap self-check. Decide whether to ship one, both, or stage (b) first then (a). Keep
     the structural moat intact either way — this is belt-and-suspenders, never a replacement.
4. Implement on the path that **actually runs** (conversation-path inline) and the shared `grounded-answer.ts`
   assembly **together** so the two do not silently diverge (the exact divergence build 20 calls out). Wire any
   surfaced citation through `lib/citations/clean-url.ts` + `components/CitationList.tsx` — do not rebuild the
   citation root.

## Done when
- A live conversation-path follow-up that makes a factual claim either (a) carries a `cited_text` pointer per
  claim back to a real grounding row, OR (b) is retracted when no supporting quote exists in the payload —
  verified against a deployed request, not a unit mock. Add a proof line to `verification/answer-proofs.jsonl`
  (the answer-fix-proof gate, per MEMORY) showing a live, non-deflecting, leak-free cited answer.
- A build-20 chart with no citable grounding row is **dropped, not emitted** (same floor as the text answer) —
  demonstrable on the conversation path.
- The structural moat is unchanged (no payload fact is reachable that wasn't before); the
  `buildGroundedSystemPrompt` golden snapshot test still passes (or is updated deliberately, with the diff
  reviewed). Live-verify after deploy (sibling to build 20's `one_assistant_unify_live_verify`).

## Risk
Medium (no-invention surface + two prompt assemblies + a live vendor request-shape change on a paid public
endpoint). Contained by: serializing **after** build 20, keeping the structural floor intact (additive only),
the Citations↔Structured-Outputs 400 incompatibility check in the vendor-first step, and the
`verification/answer-proofs.jsonl` live-proof gate. Opus for the moat-sensitivity.

## References (added 2026-06-22)
**best-practices-research (docs/audit/2026-06-21-best-practices-research/):**
- `docs/audit/2026-06-21-best-practices-research/round3/q-anthropic-citations.md` — native Citations API returns cited_text per claim
- `docs/audit/2026-06-21-best-practices-research/round1/brains-anthropic-reduce-hallucinations.md` — quote-first grounding; cite a source per claim, retract if no supporting quote; allow "I don't know"
**crawl4ai-live (docs/audit/2026-06-21-crawl4ai-live/):**
- (n/a — AI-layer build)
**Ties to existing builds:** build 20 (charts must cite their source rows), the structural payload moat (CLAUDE.md THE-GOAL)
**Verified (live docs, 2026-06-22 — re-fetch at build time):** Citations API request = `document` block + `citations:{enabled:true}`; response = text blocks each carrying `citations[].cited_text` + `document_index` + location (char/page/block); `cited_text` is free on output tokens; **Citations + Structured Outputs are incompatible (400)** — folded into Steps 2/3 above.
