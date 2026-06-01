# Post-FMB-restore backlog — do AFTER the restore plan lands

> The restore plan (`~/.claude/plans/look-into-all-of-scalable-engelbart.md`, §0–§7) makes **Fort Myers Beach** answerable. This file is everything deliberately staged for **after** the fire's out — so it doesn't get orphaned. The restore makes FMB answerable; this list is what makes **every place** answerable and keeps the system honest.

## The big one — §9: place→data router + un-crush connectors (the real "everywhere in SWFL")

The thing the operator actually asked for. Today `/api/b/[slug]` takes a brain slug, not a place; and connectors crush grain to county before any brain sees it (verified: `dbpr-sirs-source.mts:70-88` issues count-only queries by `county_normalized`, discarding the association `name`/`address`/`zip` that exist in the rows — same shape for licenses + Lee-permits).

- Generalize `place-resolver.mts` beyond the ~24 hardcoded corridors.
- Wire it onto the fetch / MCP consumption path (place in → routed dossier out).
- Rewrite SIRS/licenses/permits connectors to SELECT + emit place-level fragments (name/address/zip/lat,lon), not county counts.
- Make "answer what we hold → route to ask-next → assemble" behavior structural.

## Hardening the restore deferred (real, not blockers)

- **§4 ranker** (root-cause first): suppress zero-signal thin-data metrics (permits z=0.00) and/or add a magnitude term + surface beyond `key_metrics[0]`. Blast-radius gate: snapshot all ~26 brains' tier-2 before/after.
- **§3 condo-SIRS + modifier-rollup surfacing**: ship together so the neutral SIRS edge becomes a real drill-pointer (env-swfl per-ZIP too); assert it appears in master drivers.
- **rsw-airport**: wire the missing `makeBrainInputSource` (real demand signal) — it currently contributes 0 fragments. Delete only if genuinely empty.
- **§5 TDT direction label**: stop the Collier-backfill recomposition reading as "falling."
- **§6 output presentation**: strip all system/noun language; answer → sources → freshness token (see memory `feedback_output-no-system-noun`).

## Regression-prevention (class-level, §8)

- Re-wire `news-swfl` only once it renders clean live (it does now — §0 done); keep the **fixture-sentinel / deploy-staleness pre-check** so a fixture-built leaf can never silently freeze master again. (This was the deploy-gap root cause.)
- Fixtures derive field names from a **shared schema constant** (the FEMA `reportedZipCode` typo survived because the fixture mirrored it; `dbpr-sirs.sample.json` self-masks the same way).
- Post-ingest **NULL-rate alarm** on pinned columns; **orphan/dead-edge lint**.

## Ops dashboard shows FALSE-GREEN (operator-flagged 2026-06-01)

The ops health banner showed **brain** and **fema** green while master was frozen (Stage-4 fixture abort) and FEMA's zip column was 100% null. Root cause: the checks test **liveness/existence, not correctness**:

- **brain**: likely reads the last _successful_ (or manual-dispatch) Daily Brain Rebuild run, not the latest _scheduled_ one (which was red); and/or treats `/api/b/master` → 200 as healthy while it serves a stale `.md`.
- **fema**: reads row-count > 0 (448k rows) without checking the zip column is populated — the "row count fine, column null" class.

Fix (in `swfldatagulf-ops`): assert CORRECTNESS, not just response — (a) latest _scheduled_ rebuild green, (b) master freshness token advancing (not frozen), (c) no fixture sentinel in served brains, (d) per-pipeline column-quality (e.g. FEMA `reported_zipcode` non-null rate). Surface the same signals the ingest NULL-rate guard + fixture-sentinel pre-check now enforce. **A green light must mean "fresh + correct," not "it answered."**

## Dormant / empty data (needs source work, not config)

- **safety-swfl**: FIBRS undercounts ~2.3× — switch to FBI Crime Data Explorer (issue #59). Don't activate on FIBRS alone.
- **news-swfl**: SourceA announcements table returns 0 rows — populate the `swfl_inc_announcements` / press-release feed so the modifier carries real momentum.

## The two un-run audits (the spine flagged these; do them before claiming "every question")

- **Per-brain signal-quality sweep** across all ~26 packs — find the next buried/mis-ranked signal before a user does.
- **Source-connector normalization audit** — which connectors crush grain (like SIRS), which fixtures self-mask.

## Scope ceiling — say it plainly in any pitch

After the restore, nearly every analytical answer improves and the false denials stop. It does NOT yet give arbitrary place-grain on every dataset (that's §9), and it can't answer about data we never collected. "Every place answerable" = §9 + the connector rewrite, not the restore alone.
