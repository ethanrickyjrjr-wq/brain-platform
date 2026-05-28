# Build Queue — the one human input

> **This is the only hand-maintained status file.** /ops reads it to (1) order the
> REDs ("next up" = top-to-bottom here) and (2) flag YELLOWs (currently building).
> Everything else on /ops is derived from real signals.
>
> Format: priority = line order. `- [x]` done · `- [~]` building now · `- [ ]` up next.
> Edit this file on GitHub; /ops picks it up within 5 minutes.

- [x] Section 1 — stamp THE-GOAL.md + lean rules-of-engagement block
- [~] Section 2 — /ops live operations ledger (this dashboard)
- [ ] Apply predictions/outcomes SQL to live Supabase + verify a prediction row lands
- [ ] fl_dor_sales_tax — run schema migration + first backfill, move registry to active
- [ ] Section 3 — plan master synthesizer flesh, starting from /ops state
- [ ] Fix US-41 / Tamiami Trail corridor naming collision
- [ ] news_swfl — first successful live Firecrawl run + consuming brain
