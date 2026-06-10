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
- [x] §E — address geocoder: `refinery/lib/geocode.mts` `geocodeAddress(q)` (Mapbox v6 forward primary + Census fallback; URL-restricted token → explicit `Referer` header, works on Vercel; locality fall-through reverse-geocodes `types=postcode`). Wired into `location-resolver.mts` step 6 with `resolveZip().in_scope` (6-county ⊃ METRO_4) scope gate. + `LocationDossier.coverage_caveats` surfaces the Charlotte/Sarasota housing-only asymmetry as a stated boundary (not silent thinning) in `/api/where`+`/api/z` JSON + MCP `_meta.dossier`. 23+52 tests green. LIVE-VERIFIED 2026-06-10: address→33908, Pelican Bay→34108, Charlotte→33950+caveat, Sarasota→34237; `connector_output_live_verify` + `mcp_zip_fanout_live_verify` CLOSED
- [x] Highlighter — session persistence (thread lifted to `HighlighterProvider`, survives close/reopen, shared popup⇄dock) + briefcase capture tray (`localStorage` draft project, `ProjectItem` spine) + "File this answer/figure/report" + cross-cell snapping w/ ambiguous-mix suppression (Projects S1, `…/session-1-highlighter-thread-briefcase__OPUS/`). Per-brain `/r/` tuning tail folds into later sessions.
- [x] Charts Tier A — deterministic at-a-glance chart from key_metrics/detail_tables (`docs/superpowers/specs/2026-06-07-chart-generation-three-tier-design.md`); wire the dead `Dossier.chart` slot + new `/r/` render child
- [x] Charts Tier B + Highlighter "Chart this" — build `buildChartForIntent` (routeChart has NO consumer today) + `HBarChart` responsive fix (shared sub-task)
- [x] `/c/[id]` saved chart → `/project/[id]` (first `auth.uid()` RLS policy) → PDF via `window.print()` — Projects + Briefcase S0–S5 (`docs/superpowers/plans/2026-06-10-projects-briefcase-assembly/`)
- [ ] Assembly engine + hosted deliverable — `POST /api/projects/[id]/build` (forced-tool LLM) + `/p/[id]` public page; deterministic jargon scrub; restyle-without-re-LLM (S6)
- [ ] Delivery + revoke — email draft / share-sheet / mailto; `/p/[id]` 410 on revoke; owner kill switch (S7)
- [ ] Uploads v1 — `project-uploads` Storage bucket + RLS path-prefix; attach+caption (10 MB/file, 10/project); cross-user read DENIED (S8)
- [ ] MCP co-build tools — `swfl_project_list/add/build` write tools; `MCP_BEARER_TOKEN` enforced before ship; service-role write hard-bound to key's project (S9)
