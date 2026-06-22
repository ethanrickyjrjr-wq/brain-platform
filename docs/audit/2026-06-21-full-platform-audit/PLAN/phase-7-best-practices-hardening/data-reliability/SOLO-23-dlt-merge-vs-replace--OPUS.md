# 23 — dlt `merge` + `primary_key` (or `refresh="drop_data"`) instead of blind `replace`+guard where a stable key exists

**Model: OPUS.** Irreversible-risk territory (BIBLE §0.2 rule 5 — a destructive write with no guard on a
bad/empty pull is the one irreversible ingest failure) and the change is **per-pipeline judgment** (a stable
key vs a per-refresh-regenerated id), so it carries the audit-first / no-blind-swap weight Opus is for.
**Priority: P3.** Best-practices hardening — replaces a working band-aid (Gate 4) with the native idempotent
answer where a key exists; not a daily red.

## The gap (verified)
The REPORT names this exactly ("three things that break" row 2 + P1 #6): *"Destructive `replace` wipes good
data on a bad/empty pull"* → root *"blind `write_disposition=\"replace\"`"* → authoritative answer *"dlt
`merge` on a `primary_key` is the idempotent upsert; `replace` is the dangerous one. For a clean reset use
`refresh=\"drop_data\"` (TRUNCATE + reset cursor) — not hand-run SQL."* Verdict on what we shipped:
*"⚠️ we band-aid with a guard; `merge` is the native idempotent answer."*

Probed live (`ingest/pipelines/**`, 2026-06-22) — **5 resources still write `replace`**:
- `ingest/pipelines/fema/resources.py:161` (`fema_nfip_claims`) — **NO stable key.** The code comment at
  `:186-189` is explicit: *"OpenFEMA regenerates `id` every refresh — no stable key — so this is a full
  replace."* **Per BIBLE §0.2 rule 5, `replace` is CORRECT here, not lazy.** Keep it; do NOT convert. It
  already carries a real guard (`assert_min_rows` + flood_zone non-null floor at `:153-157`).
- `ingest/pipelines/fhfa/resources.py:67,82` (`fhfa_hpi`) — declares `id` as a `primary_key` non-nullable
  text column (`:11`). **If that `id` is deterministically derived** from source fields (place_id + yr +
  period + flavor) and stable across refreshes → **merge candidate.** Audit the id-construction first.
- `ingest/pipelines/fl_dbpr_licenses/resources.py:296` (`fl_dbpr_applicants`) — `license_number` is the
  declared primary_key (`:71,167`). A license number is a natural stable key → **merge candidate** (pending
  confirmation it never returns empty on a live refresh).
- `ingest/pipelines/fdot/resources.py:87` (`fdot_aadt_fl`) — the Tier-2 resource declares **no** `primary_key`.
  Audit whether the FDOT segment/station id is stable; if yes, add the key + merge; if it's per-refresh →
  keep replace.
- `ingest/pipelines/census_cbp/resources.py:22` (`census_cbp_fl`) — small annual full pull; audit whether a
  composite (fipstate+naics+year) is a stable key or whether replace is the honest disposition.

Contrast — pipelines that **already do this right** (the pattern to copy): `noaa_ghcn_rainfall`
(`primary_key="id"` + the comment *"Uses merge+primary_key"* at `resources.py:82,91`), `bls_oews_swfl`,
`bls_qcew`, `bls_laus`, `collier_parcels`, `leepa`, `lee_permits`, `collier_permits`, `redfin_lee`,
`redfin_collier`, `zhvi_swfl`, `zori_swfl`, `tier_divergence_swfl`, `news_swfl` — all carry a real
`primary_key` and merge/upsert. So this build is **bringing 2–4 stragglers up to the house standard**, not
inventing a pattern.

The Gate-4 guard this can supersede: `.claude/hooks/check-prepush-gate.mjs` (Gate 4, `:437-534`) blocks any
touched `ingest/pipelines/**.py` that has a `write_disposition="replace"` / `truncate` **without** an
`ingest.lib.guards` non-null guard. **Where we convert replace→merge, the destructive write is gone, so the
guard is no longer the only thing standing between a bad pull and wiped data** — but keep the `assert_min_rows`
volume floor regardless (it's the bad-pull detector from build 19, orthogonal to the disposition).

## Steps
1. **PROBE FIRST (RULE 0.5).** Open and read — do **not** trust the line numbers above blindly, confirm each:
   - `ingest/pipelines/fema/resources.py` (`:159-198`) — confirm the "no stable key, replace is correct"
     comment; this one is the **counter-example**, leave it.
   - `ingest/pipelines/fhfa/resources.py`, `fl_dbpr_licenses/resources.py`, `fdot/resources.py`,
     `census_cbp/resources.py` — for each, find where the declared `primary_key` (if any) comes from and
     whether that key is **stable across refreshes** (the BIBLE §0.2 rule 5 test: a stored id that returns
     EMPTY on a live refresh = NO stable key → replace stays).
   - `ingest/lib/guards.py` — the Gate-4 non-null guard surface; understand what merge removes vs keeps.
   - `.claude/hooks/check-prepush-gate.mjs` (Gate 4, `BLOCK_REPLACE_WITHOUT_GUARD`, `:437-534`) — confirm the
     per-touched-file scan so you know what stops flagging once a resource is merge.
   - The canonical good pattern: `ingest/pipelines/noaa_ghcn_rainfall/resources.py` (merge+primary_key).
2. **VENDOR-FIRST (RULE 1) — verify the dlt API surface live, in-session.** merge/refresh are dlt API
   surfaces; do not ship from memory. WebFetch dlt's incremental-loading docs and confirm verbatim:
   `write_disposition="merge"` + `primary_key=...` (idempotent upsert) and `refresh="drop_data"`
   (*"truncates all tables belonging to the selected resources and resets their state (including
   incremental); the schema is not changed"*). The 2026-06-22 spec-pass confirmed both strings against
   `dlthub.com/docs/general-usage/incremental-loading` — re-confirm at execution time (the surface can drift).
3. **RULE 3.5 brainstorm (short, at execution time).** Per converting pipeline decide: (a) is the key truly
   stable, or per-refresh-regenerated (→ keep replace)? (b) merge (upsert, keeps history of unchanged rows)
   vs `refresh="drop_data"` (intentional clean reset, replaces hand-run TRUNCATE) — which matches the
   source's semantics? An append-only/snapshot source that fully re-publishes each period is a `drop_data`
   case; an incrementally-corrected source is a `merge` case. (c) keep the `assert_min_rows` volume floor.
4. **Convert per-pipeline, one resource at a time** (not a sweep): change `write_disposition="replace"` →
   `"merge"` on the `@dlt.resource`, ensure the `primary_key=` is set on that resource (some declare it in
   the columns dict only), keep the volume guard, run the pipeline's own test. **FEMA is explicitly excluded**
   — leave its `replace` + comment intact.

## Done when
- For each converted pipeline: a live `--dry-run` (or `workflow_dispatch`) completes the dlt LOAD with **exit
  0**, and a **second consecutive run is idempotent** — row count does not double and unchanged rows are not
  re-written (the merge proof). Verify row count before/after (RULE: never assume).
- `git grep -n 'write_disposition="replace"' ingest/pipelines` returns **only** the resources audited as
  having no stable key (FEMA + any others that fail the stability test) — every stable-key resource is now
  `merge`.
- Each converted pipeline's `bun:test`/`pytest` still passes; Gate 4 no longer flags the converted files
  (the destructive write is gone) while still flagging FEMA correctly (replace + guard present → passes).

## Architecture guardrail (bake this in)
This is a **DATA-PIPELINE build.** Per **RULE 3 C2 — EXTEND, never erect a new mandatory gate.** Do NOT add a
new global "must-use-merge" gate. We **extend the existing Gate-4 concern per-pipeline**: where a stable key
exists, merge makes the destructive write disappear (so Gate 4 has nothing to flag); where it doesn't (FEMA),
Gate 4's existing replace+guard requirement stays exactly as-is. No new pre-materialization gate, no global
sweep — per-pipeline judgment only. This is irreversible-risk territory (BIBLE §0.2 rule 5), which is why
this is **audit-first + Opus**: a wrong convert (merging on a non-stable key) silently accumulates duplicate
rows instead of replacing — a quieter, worse failure than the replace it set out to fix.

## Dependencies / file-conflicts
- **Per-pipeline; independent of the crawl builds (07/12/13).** Touches `ingest/pipelines/<name>/resources.py`
  `write_disposition` (+ `primary_key`) only, one pipeline per commit.
- **Coordinates with Gate 4** (`.claude/hooks/check-prepush-gate.mjs`, the destructive-replace non-null guard)
  — does not modify the hook; the hook simply stops flagging a file once it's `merge`.
- **Ties to build 19** (volume floors that detect a bad pull — keep the `assert_min_rows` floor on every
  converted resource; merge changes the disposition, not the bad-pull detector) and **build 22** (dlt
  `schema_contract` — orthogonal: contract governs column *shape* drift, this governs *row* disposition; a
  pipeline can carry both).

## Risk
Medium-high if done wrong, low if done right — hence audit-first/Opus. The failure mode of a **wrong** convert
is silent duplicate accumulation (merging on an unstable key), which is harder to notice than a wiped table.
Contained by: (1) FEMA explicitly excluded, (2) the stable-key audit gate in STEP 1/3, (3) the
second-consecutive-run idempotency proof in Done-when, (4) one pipeline per commit (trivially revertable),
(5) keeping the volume floor as the bad-pull backstop regardless of disposition.

## References (added 2026-06-22)
**best-practices-research (docs/audit/2026-06-21-best-practices-research/):**
- `docs/audit/2026-06-21-best-practices-research/round2/data-dlt-merge-incremental.md` — merge on primary_key = idempotent upsert
- `docs/audit/2026-06-21-best-practices-research/round2/data-dlt-write-dispositions.md` — replace is the dangerous one; merge/append are safe
- `docs/audit/2026-06-21-best-practices-research/round1/data-dlt-incremental-loading.md` — incremental cursors
- `docs/audit/2026-06-21-best-practices-research/round3/q-dlt-pipeline-refresh.md` — refresh="drop_data" vs hand-run TRUNCATE
**crawl4ai-live (docs/audit/2026-06-21-crawl4ai-live/):**
- (n/a — data-reliability build)
**Ties to existing builds:** Gate 4 (the guard this can supersede where a key exists), build 19 (volume floors that detect a bad pull), build 22
**Verified (2026-06-22, RULE 1 vendor-first, live dlt docs):** `write_disposition="merge"` + `primary_key=...` (idempotent upsert) and `refresh="drop_data"` (truncates selected resources' tables + resets state/incremental, schema unchanged) confirmed verbatim against `dlthub.com/docs/general-usage/incremental-loading` — re-confirm in-session at execution time. **Audit-confirmed in repo:** FEMA `id` is per-refresh-regenerated → replace is CORRECT (leave it); fhfa/fl_dbpr/fdot/census_cbp are the per-pipeline merge-candidate audits.
