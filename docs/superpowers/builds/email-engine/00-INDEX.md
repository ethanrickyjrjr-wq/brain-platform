# Email Lab Engine — Build Index

- **Branch:** `email-lab-engine`
- **Plan:** `~/.claude/plans/abundant-dazzling-tome.md`
- **Free-tier map:** `docs/email-lab/BUILDER-GUIDE.md`
- **Research:** `docs/superpowers/specs/2026-06-28-email-lab-ai-design-research.md`

**Governing rule:** PAID = strict SUPERSET of free. Inherit everything, downgrade nothing, add on top. Verify every build with `bunx next build` (not bare tsc). Nothing pushed without operator confirmation.

## DAG — order · model · parallel group

**Group 0 — start now (parallel):**
- `01 doc-contract` — **Sonnet** — deps: none
- `04 save-photo` — **Sonnet** — deps: none

**Group 1 — after 01 (parallel):**
- `02 compile-grid` — **Opus** — deps: 01
- `03 author-engine` — **Opus** — deps: 01
- `05 listing+multicol blocks` — **Sonnet** — deps: 01
- `G1 GridCanvas` — **Sonnet (OPERATOR)** — deps: 01

**Group 2 — after deps (parallel):**
- `06 templates` — **Sonnet** — deps: 01, 05
- `G2 block-toolbar` — **Sonnet (OPERATOR)** — deps: G1
- `G3 photopea-modal` — **Sonnet (OPERATOR)** — deps: 04
- `G4 wire-shell` — **Sonnet (OPERATOR)** — deps: G1, 03

**Independent track:**
- `07 asset-factory` — **Sonnet (ingest)** — deps: none — GHA only, not Vercel

## File-contention chokepoints (do NOT run in parallel on the same tree)
- `doc/types.ts` + `doc/schema.ts` — touched by 01, 03 (author schema), 05 (block schema). **01 lands first; 03 and 05 serialize on `schema.ts`** (or the main thread owns the shared schema hunk).
- `components/email-lab/EmailLabShell.tsx` — G4 only.
- `components/email-lab/CanvasBlock.tsx` — G1 + G2 serialize.

## Ownership
- **Engine** (01, 02, 03, 04, 05, 06, 07): this agent.
- **Grid** (G1, G2, G3, G4): **OPERATOR**.

## Status
- [x] 01 doc-contract — **DONE**, `bunx next build` green (branch `email-lab-engine`)
- [x] 02 compile-grid — **DONE**, `bunx next build` green (branch `email-lab-engine`)
- [x] 03 author-engine — **DONE**, `bunx next build` green (worktree `bp-author-engine` on `email-lab-engine`)
  - Files: `doc/schema.ts` (+`AuthorDocSchema`), NEW `lib/email/author-doc.ts` (pure engine), `build-doc.ts` (+`authorDoc`), `api/email-lab/ai/route.ts` (`build:true`/`mode:"author"` → author path; content-patch + per-block + legacy untouched).
  - **Reframe vs plan §Grid-contract 5:** model emits SEMANTIC structure (`span` + `new_row`), engine derives bounds-correct `{x,y,w,h}` — so NO `react-grid-layout` dependency server-side (verified: `react-grid-layout@2.2.3` `/core` is real but exports `compact`/`compactItemVertical`, NOT `verticalCompactor`; deterministic row-derivation is tighter for email and avoids hauling a client lib into the server bundle). Canvas (G1) still uses RGL v2; feeding it already-tight rows is a no-op, so both halves agree.
  - **Moat:** id-selection for numeric fields (mirrors compose-chart) + no-invention prose lint (mirrors gateNarrative, reuses `narrative-lint` primitives). Chart/photo fill RESERVED slots (never bottom-dumped). Footer code-guaranteed (CAN-SPAM). Ids minted server-side. Repair bounded to one regeneration → strip.
  - **Proof gate:** `lib/email/author-doc.test.ts` — 11 pure unit tests (the moat + guarantees, demonstrated in code; `next build` never runs `authorDoc`). Adversarial-review fix: a literal `stats[].value` carrying an UNanchored number is blanked at assembly (`anchoredStatValue`) — the prose lint never walks `stats`, so that number-field is closed structurally, not by prompt. Author tool-call budget = 8192 tokens (a content patch's 4096 truncates a full multi-block doc).
  - **Blocked-by-05:** the acceptance line's *listing card* needs build 05's `listing` block; the author drives its vocabulary from `DEFAULT_BLOCK_PROPS` (ONE root), so it picks up `listing`/`multi-column` automatically once 05 lands — no author-code change.
  - **Follow-ups (NOT regressions — free content-patch path keeps all):** author v1 omits the stale-figure web refresh + model-driven external/upload/user gap-fill lanes; they join the menu + anchor set in a later increment.
- [x] 04 save-photo — **DONE**, compile+TS green (branch `email-lab-engine`)
- [ ] 05 listing+multicol blocks
- [ ] 06 templates
- [ ] 07 asset-factory
- [x] G1 GridCanvas (operator) — code-complete; `react-grid-layout@2.2.3`; `bunx next build` green (compile+TS), eslint clean; live drag/resize test deferred to G4 (nothing mounts it yet)
- [ ] G2 block-toolbar (operator)
- [ ] G3 photopea-modal (operator)
- [ ] G4 wire-shell (operator)
