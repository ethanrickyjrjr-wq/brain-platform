# 18 — stale-docs sweep (converse "deleted", in-process-only landmine, 4→5 stages)

**Model: Sonnet.** Doc/comment edits across several files. **Priority: P3.** Append-only where the file is a
ledger; correct comments where they're wrong.

## The stale facts (verified)
1. **`/api/converse` + `/api/welcome/chat` are FULLY DELETED** from disk (not "thin deprecated forwarders").
   Fix the wording in: `_AUDIT_AND_ROADMAP/build-queue.md` (the One-Assistant line says "deprecated
   forwarders"), the **header comment in `app/api/assistant/route.ts:3-4`** ("thin deprecated forwarders"),
   and any `SESSION_LOG.md` forward-reference (append a correcting entry — never rewrite history).
2. **`lib/grounded-answer.ts`** has 4 dangling comment refs to the now-deleted `/api/converse` route
   (lines ~3, 9, 30, 80). Update them to say the assembly was lifted into `lib/assistant/*-path.ts`.
3. **In-process-only landmine (BRIEF #10):** add a ≤12-line canonical paragraph to the
   `ingest/lib/crawl4ai_client.py` module docstring — crawl4ai is **in-process SDK ONLY**, no live
   `CRAWL4AI_API_URL` consumer, and **stealth can never move to the 0.9.0 server** (it 400-rejects
   `js_code`/`proxy`/`cookies`; `Crawl4aiSession.step` depends on `js_code_before_wait`). Re-grep
   `CRAWL4AI_API_URL` first (must be zero live consumers).
4. **"4-stage" → "5-stage"** naming: the pipeline is 1-ingest → 2-triage → **2.5-normalize** → 3-synthesis →
   4-output. Fix any doc that says "4-stage" (grep `docs/` + CLAUDE-adjacent refs).
5. **`../NOTES.md` factual fixes** (the audit's own small errors, from VERIFICATION.md): master
   `sources[]`/`input_brains[]` count **30** not 31; Crexi path is `crexi_listings/`; `check_freshness.py`
   lives in `ingest/scripts/` not `ingest/pipelines/`; news cap is per-source ≈40 total; the client-flip
   hooks are `lib/chat/use-chat-stream.ts` + `app/welcome/_components/useWelcomeStream.ts` (no `hooks/` dir).

## Steps
1. **Probe first.** Open each target; confirm the current wording before editing. For `SESSION_LOG.md`,
   APPEND a correcting entry (RULE 0 append-only) — do not edit past entries.
2. Make the surgical edits. Keep `build-queue.md` ops-board-accurate (RULE 1 ops-board sync).

## Done when
- No doc/comment claims converse is a "forwarder"; the in-process-only paragraph is in the client docstring;
   no "4-stage" references remain; NOTES.md facts corrected. `next build` unaffected (comments only on TS side).

## Best-practice fold-in
SRE postmortem culture (`rootcause-sre-postmortem-culture.md`): stale "deleted vs forwarder" docs are the exact drift postmortem discipline guards against — accurate records are load-bearing because the next incident diagnosis starts from them. This sweep IS that discipline applied to code comments and build-queue prose.

## Risk
Very low (docs/comments). Watch for concurrent edits to `build-queue.md`/`SESSION_LOG.md` — re-read before edit.

## References (added 2026-06-22 — crawl4ai-live + best-practices fold-in)
**crawl4ai-live (tool-usage reference, docs/audit/2026-06-21-crawl4ai-live/):**
- `docs/audit/2026-06-21-crawl4ai-live/VERIFICATION.md` (V-8/V-9/V-12 + V-2) — the corrected doc-claims this sweep makes durable
**best-practices-research (how to build/operate what we build, docs/audit/2026-06-21-best-practices-research/):**
- `docs/audit/2026-06-21-best-practices-research/round1/rootcause-sre-postmortem-culture.md` — accurate records are load-bearing; stale "deleted vs forwarder" docs are exactly the drift to fix
**Verified:** V-8 (real client-flip sites: lib/chat/use-chat-stream.ts:55, app/welcome/_components/useWelcomeStream.ts:25 — there is NO hooks/ dir), V-9 (/api/converse + /api/welcome/chat are FULLY DELETED, not "thin forwarders"), V-12 (the 4 grounded-answer.ts refs are dangling COMMENTS). ALSO fold the master-count fix into this sweep: NOTES.md §3 says sources/input_brains = 31; truth is 30 (V-2) — this NOTES.md edit belongs to this build. — folded into Steps above where applicable.
