# Build Queue — the one human input

> **This is the only hand-maintained status file.** /ops reads it to (1) order the
> REDs ("next up" = top-to-bottom here) and (2) flag YELLOWs (currently building).
> Everything else on /ops is derived from real signals.
>
> Format: priority = line order. `- [x]` done · `- [~]` building now · `- [ ]` up next.
> Edit this file on GitHub; /ops picks it up within 5 minutes.

- [x] Section 1 — stamp THE-GOAL.md + lean rules-of-engagement block
- [x] Section 2 — /ops live operations ledger (this dashboard)
- [X ] Apply predictions/outcomes SQL to live Supabase + verify a prediction row lands
- [X ] fl_dor_sales_tax — run schema migration + first backfill, move registry to active
- [X ] Section 3 — plan master synthesizer flesh, starting from /ops state
- [x] Fix US-41 / Tamiami Trail corridor naming collision
- [x] safety-swfl — FBI Crime Data Explorer replaces unfit FIBRS (#59); brain LIVE (bullish, -9.7% YoY), `public.fdle_crime_swfl` backfilled 2022–2024, quarterly cron re-enabled, master v71
- [x] Highlighter Phase 1 — in-page ask layer (`docs/superpowers/specs/2026-06-07-highlighter-in-page-ask-chart-design.md`): fact detection + mobile chips, popup (3 states), `/api/converse` (haiku, metered, enforcement OFF), precomputed suggestions, discovery coachmark
- [x] Highlighter Phase 1.5 — /r/ AI answer-quality pass (`docs/superpowers/plans/2026-06-09-highlighter-iteration.md`): header-badge grounding, 3-lane be-Claude/grounded/offer prompt, slug→label CLEAN fix, FOCUS/NATURAL/no-echo/concise voice, type-aware chips (killed "what's driving <date/token>"), chart/section real-text fix, off-screen shield, SWFL-wide platform framing — all `/r/` pages
- [x] Highlighter Phase 2 — real-time follow-up prompts + selection-type awareness (`docs/superpowers/plans/2026-06-09-highlighter-iteration.md`): `⟦FOLLOWUPS⟧` same-call tail split client-side (`splitFollowupTail`), `deriveSelectionType` (section/token/date/place/metric) passed to converse — directive GATED on selection_type (dock spends no tokens); + mobile number tap-targets (`MetricValueCell` string|number, `DataRow` FactChip) + chip analytics (`recordAsk` → `data_requests.selection_type/is_realtime/from_chip`, columns live). Tests 64✓, tsc/eslint clean. Live runtime verify (model emits tail, chips render, mobile tap) pending → check `highlighter_realtime_prompts` stays open.
- [x] §D2 — Universal Location Search endpoints: `GET /api/where?q=` (any input → dossier, plain text or JSON) + `GET /api/z/[zip]` canonical ZIP permalink
- [x] §D1 — MCP `swfl_fetch` zip fan-out: `resolveLocation` + `assembleLocationDossier` for zip/location params (no explicit `report_id`); pinned non-master `report_id` keeps the single-brain `fetchDetailRow` drill (back-compat). Tier-2 default, capped (true-ZIP + 8 headline); `_meta.dossier` = full `LocationDossier` matching `/api/z?format=json`. 5 integration tests green
- [x] §D3 — search box (any input → redirect) + identity header card + grain chips + did-you-mean; generalized `/r/zip-report/[zip]/page.tsx` off `assembleLocationDossier`. New `/r` index + `/r/search` resolver + shared `lib/location-surface.ts` (19 tests). Also fixed `place-resolver.mts` `import.meta.dirname` impurity that threw on `resolveLocation` in the Next/Vercel bundle (was latent on D2's corridor path too — `/api/where?q=North Naples` now 200). §D COMPLETE
- [ ] Highlighter — session persistence (lift thread to `HighlighterProvider`) + briefcase; cross-element/cross-row snapping fixes; per-brain tuning of the other `/r/` pages (remaining from same doc, after Phase 2)
- [x] Charts Tier A — deterministic at-a-glance chart from key_metrics/detail_tables (`docs/superpowers/specs/2026-06-07-chart-generation-three-tier-design.md`); wire the dead `Dossier.chart` slot + new `/r/` render child
- [ ] Charts Tier B + Highlighter "Chart this" — build `buildChartForIntent` (routeChart has NO consumer today) + `HBarChart` responsive fix (shared sub-task)
- [ ] `/c/[id]` saved chart → `/board/[id]` (first `auth.uid()` RLS policy) → PDF via `window.print()` (`docs/superpowers/specs/2026-06-07-boards-pdf-composed-export-design.md`)
