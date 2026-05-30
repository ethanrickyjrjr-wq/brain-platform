# Plan — Build a clean master v61 + close the fixture-leak hole for good

> **STATUS — SHIPPED 2026-05-30 (all three PRs live on `main`). Do NOT re-execute.**
>
> - **PR1 done + verified live**: rebuilt `env-swfl` v18, `logistics-swfl` v14, `logistics-swfl-nowcast` v12, `traffic-swfl` v9 LIVE, then `master` → **v62** (`SWFL-7421-v62-20260530`). Live MCP/`/api/b/master` payload confirmed fixture-free. The `data_lake.faf_flows` Postgres check in Step 0 was a red herring — logistics reads FAF5 **S3 Parquet** via DuckDB (3,430 flows resolved fine). The role-view re-render step (3.5) was dropped: the Stage-5 role-renderer no longer exists ("we don't do roles" — corridor voices replaced them); the 56 orphaned `brains/*--{role}.md` were **deleted** instead.
> - **Diff-review catch (not in this plan)**: live FDOT `tfctr` is a PERCENT, so `traffic-swfl` shipped a **739.6% truck share**. Fixed in `fdot-source.mts` (÷100) → 7.4%. See [[cre-swfl-llm-rebuild-and-tfctr]].
> - **PR2 done**: build-time fixture-sentinel gate (`refinery/lib/fixture-sentinels.mts` + `4-output.mts`) + logistics live-empty assert. Gate dry-run-verified (no false-trip on clean v62).
> - **PR3 done + live**: speaker caveat hygiene (path-safe pack-id regex, `scrubCaveatTechnical`, cap-8 + tail, fixture backstop) + master caveat reorder + cre-swfl `console.warn`. Live tier-2 confirmed: constants → `[config]`, capped at 8.
> - **Known follow-up (not blocking)**: `cre-swfl`'s artifact-level clean caveat (PR3-D) needs an LLM-capable rebuild — it's the only pack without `skipSynthesisAgent` and hangs at stage 3 in a no-LLM-egress env. Applies on its next cron/manual rebuild; render-time scrub covers it meanwhile.

## Context

The live `GET /api/b/master?view=speak&tier=2` payload (token `SWFL-7421-v60-20260530`)
ships fixture-mode caveats to users — "Fixture mode: only Lee County is populated…
switch to REFINERY_SOURCE=live", plus FAF5/FDOT "synthetic fixture data" strings, file
paths, a commit hash, and SCREAMING_SNAKE constants. The audit first read this as a
"mixed fixture/live build," but that's impossible: `env.source` is one process-wide
getter (`refinery/config/env.mts:107`), so a build is wholly live or wholly fixture.

**Real root cause — verified.** Master reads the committed `brains/{id}.md` artifacts and
lifts their `--- OUTPUT ---` block; it does NOT re-fetch upstreams
(`refinery/sources/brain-input-source.mts:8-26,44-62`; `master-source.mts:102-111`).
Three upstreams were last _rendered_ in fixture mode and never re-rendered live:

| upstream         | last build      | source backing                       |
| ---------------- | --------------- | ------------------------------------ |
| `traffic-swfl`   | v7, 2026-05-18  | `data_lake.fdot_aadt_fl`             |
| `env-swfl`       | v17, 2026-05-20 | live FEMA NFHL API (no table)        |
| `logistics-swfl` | v13, 2026-05-20 | `data_lake.faf_flows` (+ S3 parquet) |

Master, rebuilt live today (v60), faithfully lifted their 10-day-old fixture caveats.

**This is a re-render, not a re-ingest.** The data is already in the lake / behind a live
API. Fixing it = rebuild three brain artifacts in live mode + rebuild master. Minutes, no
ingest — UNLESS a row-count check shows a table is actually empty (then ingest only that
one). Nothing tells the consumer which signals are real today; that is the emergency.

**Two stale assumptions corrected during the audit:**

- The `fdot_aadt_fl.year_` blocker is **dead** — the `year_→yearx` rename shipped in
  `1c3c21b` (2026-05-20). `fdot-source.mts:235-244` queries `yearx`. traffic-swfl is
  data-dependent, not code-blocked.
- **No fixture-sentinel gate exists anywhere** (confirmed across `spec-validator.mts` and
  `4-output.mts`). That silence is why this recurred unseen. PR 2 adds the gate.

Decisions taken (operator said "build it right"): **hard-block fixture leaks at build
time** + speaker backstop; **full fidelity** — if a table is empty, ingest that one, never
ship a degraded brain as "live."

---

## PR 1 — Rebuild a clean master v61 (the emergency; do first, no code changes)

### Step 0 — confirm the data is there (one read, gates everything)

From a machine that can reach the DB (or via the Supabase pooler host — the direct
`db.<ref>.supabase.co:5432` host is unreachable from the sandbox):

```sql
SELECT 'fdot' t, count(*) FROM data_lake.fdot_aadt_fl
UNION ALL SELECT 'faf', count(*) FROM data_lake.faf_flows;
```

- Both non-zero → proceed straight to Step 1. **No data work.**
- `fdot` = 0 → run `python -m ingest.pipelines.fdot.pipeline` + apply
  `docs/sql/fdot_aadt_fl_grant.sql` (the source's own error message names both:
  `fdot-source.mts:208-214`), THEN Step 1.
- `faf` = 0 → run the FAF5 dlt pipeline + confirm GRANT on `faf_flows`/`faf_zone_lookup`/
  `faf_sctg_lookup`, THEN Step 1. (logistics degrades gracefully on empty, but "build it
  right" = populate it.)

### Step 1 — guarantee live mode

`env.source` defaults to `live` when `REFINERY_SOURCE` is unset (`env.mts:68-70`). **But
Bun's `.env` loader overrides shell env** (see `[[bun-env-precedence]]`) — so grep `.env`,
`.env.local` for `REFINERY_SOURCE=fixture` and remove/override it. Do not trust
`$env:REFINERY_SOURCE='live'` alone.
**Verification anchor:** every CLI run prints `[refinery] pack=… source=live` at start
(`cli.mts:65`). If it says `source=fixture`, STOP — the rebuild is worthless.

### Step 2 — re-render the three stale upstreams live

Each is a leaf (no upstreams of its own), so each command builds only itself:

```
bun refinery/cli.mts env-swfl
bun refinery/cli.mts logistics-swfl
bun refinery/cli.mts traffic-swfl
```

Confirm each banner reads `source=live` and each new `brains/{id}.md` no longer contains
`Fixture mode:` / `synthetic fixture`.

### Step 3 — rebuild master from the now-live upstreams

```
bun refinery/cli.mts master --target-only
```

`--target-only` rebuilds ONLY master, reading the 15 committed upstream `.md` files (now
all live) without re-touching them (`cli.mts:183`). Cleaner than `--force`, which would
re-run all 15 upstreams' live fetches unnecessarily.

### Step 3.5 — re-render the role views (a v60-class leak in different files)

The role-renderer outputs (`brains/{id}--operator.md`, `--investor.md`, etc., per
`refinery/render/role-renderer.mts`) are STILL stale-fixture for the three upstreams —
same leak, different files. After the live rebuilds, re-render:

```
npm run roles -- env-swfl
npm run roles -- logistics-swfl
npm run roles -- traffic-swfl
npm run roles -- master
```

Confirm none of the regenerated role files contain `Fixture mode:` / `synthetic fixture`.

### Step 4 — verify + ship

- `grep -ri "fixture mode\|synthetic fixture\|REFINERY_SOURCE" brains/` → **zero** (the
  whole dir, so the role views are covered too).
- New token `SWFL-7421-v61-20260530`.
- `git add` the four brain `.md` files **and their regenerated role views**
  (`brains/{env-swfl,logistics-swfl,traffic-swfl,master}*.md`) — stage only these,
  SESSION_LOG entry, commit, push. API serves the committed file.

---

## PR 2 — Durable fixture-sentinel gate (so this can never recur silently)

**The root-cause fix.** Add a build-time gate that refuses to write a LIVE artifact whose
rendered markdown contains a fixture sentinel — the exact master-lifting-stale-upstream
case. Plus a speaker runtime backstop.

**A. Build-time hard-block — `refinery/stages/4-output.mts:464`** (just before the
validator `if`). New shared module `refinery/lib/fixture-sentinels.mts` exporting
`FIXTURE_SENTINELS = [/fixture mode:/i, /synthetic fixture/i]` and
`hasFixtureSentinel(md)`. Then:

```ts
// A live build must never ship a fixture-mode caveat lifted from a stale upstream.
const fixtureLeak = env.source === "live" && hasFixtureSentinel(markdown);
if (!spec.ok || !lint.ok || !bait.ok || !smoothing.ok || !grainGuard.ok || fixtureLeak) {
  const errs = [
    ...(fixtureLeak ? [`  fixture-leak: live build of ${pack.brain_id} contains a fixture sentinel — an upstream is stale. Rebuild it live first (npm run refinery <upstream>).`] : []),
    ...spec.errors.map(...), ...   // existing
  ].join("\n");
  throw new Error(`Stage 4: rendered pack failed validation — NOT writing brains/${pack.brain_id}.md\n${errs}`);
}
```

Fires on master's build when any upstream is stale; never fires in fixture mode (expected
there) and never on a clean live build. Self-correcting: you can't produce master until
upstreams are live. Import the shared sentinel list into the packs that _emit_ those
caveats so the strings stay single-sourced.

**B. Speaker runtime backstop — `refinery/render/speaker.mts`.** Strip any sentinel-bearing
caveat from tier-1/2 replies and, if any were stripped, prepend ONE honest line:
`"One or more underlying datasets were running on cached sample data at build time."`
This guarantees the site never _renders_ a raw fixture string even if a bad artifact
somehow ships.

**C. Live-emptiness assert for logistics-swfl — the only hole the sentinel gate misses.**
A live build against an EMPTY `faf_flows` produces no fixture sentinel (it degrades to
"could not resolve any FAF5 flow rows" — `logistics-swfl.mts:224-239`), so gate A sails
right past it and ships a hollow brain as "live." env-swfl and traffic-swfl already throw
loud on empty (`fetchCountyStats` / `assertSegmentsNonEmpty`, `fdot-source.mts:208-214`);
logistics is the lone graceful-degrader. Add a matching live-mode assert in
`faf5-source.mts` (or at the top of `logisticsCorpusSummary`): when `env.source === "live"`
and zero flow rows resolve, THROW with the same actionable shape FDOT uses (name the dlt
pipeline + the GRANT). Keep the graceful path for fixture mode only. This makes "build it
right" = empty data fails loud, never silently hollow.

---

## PR 3 — Speaker caveat hygiene (the v60 leak cleanup)

The speaker renders `out.caveats` verbatim through `sanitizeProse` only — which scrubs
pack-ids/corridor/§ but NOT file paths, hashes, or constants, and is **uncapped**
(`speaker.mts:243-248`). The linters guard only the ` ```reference ` fence
(`facts-only-lint.mts:44`, `smoothing-lint.mts:73`), so caveats are an ungated leak channel.

**Fix A — pack-id regex no longer corrupts paths** (`speaker.mts:197-201`). Current
`\b${escaped}\b(?!\s+brain)` rewrote `env-swfl-spike-findings.md`. Use:

```ts
const re = new RegExp(`\\b${escaped}\\b(?![-\\w]|\\s+brain)`, "g");
```

Blocks a following hyphen/word-char (paths, compound filenames spared) while a
sentence-final `env-swfl.` still scrubs. Add a test asserting
`sanitizeProse("see docs/env-swfl-spike-findings.md")` is left intact.

**Fix B — technical scrub on caveats only** (new `scrubCaveatTechnical`, applied after
`sanitizeProse` in the caveats block). Conservative — must NOT eat domain acronyms
(SOFR, NFIP, FEMA, FDOT, AAL):

```ts
c.replace(/\brefinery\/\S+/g, "[internal]") // file paths
  .replace(/\b(?=[0-9a-f]{7,40}\b)[0-9a-f]*[a-f][0-9a-f]*\b/g, "[ref]") // commit hashes (>=1 a-f, spares 20260530)
  .replace(/\b\w*[a-z0-9]_[a-z0-9]\w*\b/gi, "[config]"); // underscore identifiers only
```

The underscore discriminator kills `DFIRM_ID`/`REFINERY_SOURCE`/`chargeoff_pct` and
spares every acronym.

**Fix C — cap caveats in the SPEAKER, not master.** Do NOT slice in `master.mts` —
`out.caveats` is the tier-3 audit receipt and every downstream's input
(`master.mts:199-206` keeps full + deduped). Cap at display time in `speaker.mts` with an
explicit, non-silent tail per CLAUDE.md ("no silent caps — log what was dropped"):

```ts
const MAX_DISPLAY_CAVEATS = 8;
const shown = out.caveats.slice(0, MAX_DISPLAY_CAVEATS);
const extra = out.caveats.length - shown.length;
// …render shown… then if (extra > 0) append `- …and ${extra} more in the full audit.`
```

Reorder in `master.mts` so the most user-relevant lead: `cascade.caveats` (explain the
forced direction call) → `floorCaveats` (excluded upstreams) → upstream caveats. Ordering
only — no truncation in the artifact.

**Fix D — cre-swfl build diagnostic, not a user caveat** (`cre-swfl.mts:919-926`). The
"N corridors did not join … MARKETBEAT_SUBMARKET_MAP …" push leaks a constant name and a
25-item list. Replace `vote.caveats.push(...)` with `console.warn(...)`; if coverage is
materially low, surface one humanized line ("MarketBeat coverage incomplete for this
build") with no count/constant.

---

## Verification

1. `bun test` — currently 801 pass / 0 fail; must stay green. New tests: fixture-gate
   throws on a live build containing a sentinel (PR 2); `sanitizeProse` path-preservation
   - `scrubCaveatTechnical` spares `SOFR`/`NFIP` but kills `DFIRM_ID` (PR 3); speaker
     caveat cap shows the `…and N more` tail.
2. `refinery/typecheck` clean (ignore the pre-existing `usgs-water-source.mts:395` noise).
3. **v61 artifact:** `grep -i "fixture mode\|synthetic fixture\|REFINERY_SOURCE" brains/master.md`
   → zero matches; token = `SWFL-7421-v61-20260530`.
4. **Live tier-2 reply** (`/api/b/master?view=speak&tier=2`): ≤ 8 caveat bullets, no
   `refinery/` paths, no 7-char hex, no underscore constants, no `.mts`/`.md` in prose;
   any path like `docs/env-swfl-spike-findings.md` referenced in prose is un-mangled.
5. **Negative gate test:** temporarily point master at a fixture-built upstream and confirm
   `bun refinery/cli.mts master --target-only` aborts with the `fixture-leak` error and
   leaves the old `brains/master.md` intact.

## Sequencing

PR 1 first (emergency — clean v61 today). PR 2 second, PR 3 third (one speaker/validator
review). PR 1 is no-code and ships independently.

> **GUARDRAIL — do NOT merge PR 2 until v61 is confirmed clean on `main`.** The gate
> hard-blocks ANY live master build that still carries a fixture sentinel. If it lands
> while an upstream is stale, the next scheduled master refresh aborts — freezing your
> live macro/cre/franchise data behind a stale artifact along with the fixture ones. Order
> is load-bearing: clean v61 → then arm the gate. (Gate C, the logistics emptiness assert,
> has the same property — it can't merge before `faf_flows` is confirmed populated.)
