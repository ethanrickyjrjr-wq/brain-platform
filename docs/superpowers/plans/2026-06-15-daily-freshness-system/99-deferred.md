# 99 — Deferred / Parked scope

> Build file for the Daily Freshness System. Things deliberately **out of the build**, with the reason and the trigger to revisit. Parking is a decision, not an omission — each item names why and what unblocks it. **Do not silently drop these; the ops board should show parked items with their reason (no silent caps).**

---

## Parked

| Item | Why deferred | Unblock trigger |
|---|---|---|
| **Live-probe "Update to Today" full wiring** | The button that fabricates-or-fetches a live number on demand is the one place that could violate the MOAT ("the system cannot invent a number"). v1 ships the button as **visual-only / honestly-labeled** (file 07), POSTing to a stub. Real wiring stores `live_probe_estimate` (carries its `source_url`, subject to the same provenance + anomaly gates). | **Operator sign-off** + the cascade engine (file 01) proven accurate by the anomaly + re-anchor loop (file 05). |
| **Redfin weekly-file graduation** | The pulse v1 reads the **monthly** Redfin county tracker (read-through). Redfin also publishes a **weekly** rolling-4wk file (probed live in the 2026-06-14 bridge doc — Cape Coral + Naples metros present) that is fresher. Graduating to it is an ODD-style swap. | After daily_truth + the monthly read-through are stable; check `weekly_pulse_estimate_graduation`. |
| **`parcels_lee_zip_source_layer` (LeePA G2)** | LeePA parcels have **no** site address/lat-lon on the row → can't stamp now. Needs a LeePA MapServer probe → FOLIOID join → site-ZIP via centroid point-in-polygon → backfill, surfaced in properties-lee-value. | Its own ingest PR (memory `leepa-no-sale-price`, check `parcels_lee_zip_source_layer`). |
| **AirDNA STR (ZIP-native)** | Manual ODD portal, **$179/mo** FL-state subscription. Consumer (`investor-zip-swfl`) already empty-tolerant; Tier-1 slot reserved. | Subscription acquired → manual ODD drop (zero-code graduation). |
| **Dead-end CRE sources (Premier Commercial, SVN Florida)** | No market reports exist (brokerage-only / transaction-news-only). Stubs exit 1. | N/A — leave dead unless the source starts publishing vacancy/rent surveys. |
| **Ops operator-editable shared annotations** | File 06's Daily Truth section already reads `daily_truth` **live** (the ops repo has Supabase). A separate `live_search_status` table is only needed for operator-**typed** notes/overrides the board persists — not required for the live status read. | Operator asks for pinned annotations → mirror `app/api/notes/route.ts` + a small table. |
| **Systemic flapper fix** | File 00 root-causes `daily-rebuild` + `freshness-probe-daily`. A *systemic* fix (e.g. FRED-429 backoff, missing-table guard) is its own hardening PR. | After 00 names the root cause; track in `docs/cron-rebuild-failures.md`. |
| **No-anchor sourced metrics** | First metrics are anchored (Redfin/FRED) so validation (file 05) is provable. Ungraded metrics (active inventory today, new-construction starts) wait until the loop's measured accuracy justifies trusting them. | After file 05 reports an in-tolerance track record. |

---

## Resolved by the audit — NO LONGER deferred work

- **"NFIP site-ZIP via parcel join (G1-clean alternative to the mailing ZIP)"** — **moot.** The original plan parked this as the clean alternative to NFIP's supposed mailing ZIP. The OpenFEMA dictionary shows `reportedZipCode` **is** the insured-property (site) ZIP, and `env-swfl` already surfaces per-ZIP NFIP. No parcel-join workaround is needed (see `09-zip-routing.md` §FEMA). The only NFIP follow-up is the optional per-ZIP `detail_table` in env-swfl.
- **"Gemini 3 grounding"** — **adopted as the default, not deferred.** Corrected pricing (operator, verified live 2026-06-15): the engine ships on **`gemini-3.5-flash`** at the Gemini 3 tier (5,000 prompts/mo free, $14/1k search queries, billed per query). There is no cheaper tier to "graduate" to; File 01 STEP 0 just re-confirms the model id + grounding support live before coding.
