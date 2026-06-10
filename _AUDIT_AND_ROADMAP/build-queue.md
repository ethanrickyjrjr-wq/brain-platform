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
- [ ] Highlighter — real-time follow-up prompts (next-question chips generated after each answer) + selection-type awareness; then session persistence (lift thread to provider) + briefcase; snapping fixes; per-brain tuning of the other `/r/` pages (same doc)
- [ ] Charts Tier A — deterministic at-a-glance chart from key_metrics/detail_tables (`docs/superpowers/specs/2026-06-07-chart-generation-three-tier-design.md`); wire the dead `Dossier.chart` slot + new `/r/` render child
- [ ] Charts Tier B + Highlighter "Chart this" — build `buildChartForIntent` (routeChart has NO consumer today) + `HBarChart` responsive fix (shared sub-task)
- [ ] `/c/[id]` saved chart → `/board/[id]` (first `auth.uid()` RLS policy) → PDF via `window.print()` (`docs/superpowers/specs/2026-06-07-boards-pdf-composed-export-design.md`)
