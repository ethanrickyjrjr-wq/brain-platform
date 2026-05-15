# SWFL Intelligence Lake — State of the Engine (2026-05-15)

## What this session fixed

- **Cache-bust shipped** (commit `876b591`, pushed to `main`). Added `?v=2` to the
  master URL in both spots of `docs/consumption-contract.md` (line 18 paste block,
  line 48 mandatory-fetch section) plus a short note explaining Vercel ignores
  query params but Claude's consumption-side cache keys on the URL string. Bump
  `v3`/`v4` next time the cache traps a Project again.

## Current versions

| Pack                 | Version | Freshness token            |
| -------------------- | ------- | -------------------------- |
| `master`             | v4      | `SWFL-7421-v4-20260514`    |
| `franchise-outcomes` | v5      | (per plan — v5 socialised) |
| `cre-swfl`           | v2      | (per plan — v2 socialised) |

## What's proven in the wild (end-to-end)

Re-paste verified on both Claude desktop and web. Both runs:

1. **Quoted `SWFL-7421-v4-20260514` verbatim** — first live read since the
   freshness guard went in. The cache-bust flipped.
2. **Returned 13 brands at 0% survival** — stable across surfaces.
3. **Routed to sub-brains** instead of inferring from master aggregates.
4. **Read rates as written** — no 50%-from-"1 of 2 total" bait anywhere.
5. **Surfaced the small-n caveat unprompted** — only The Grounds Guys is
   multi-resolved (n=2); the other 12 are single-resolved-loan, directionally
   negative but thin.
6. CRE breakdown: 24 corridors (15 Lee, 9 Collier), 4 stubs correctly flagged.

## Guard chain (the full stack)

1. `?v=2` cache-bust → forces a live fetch.
2. `freshness_token` YAML field → survives WebFetch HTML→markdown stripping.
3. Quote-the-token rule → makes staleness self-evident to the user.
4. Master `f004` carries headline + worst-performer + pointer; full per-brand
   list lives only in `franchise-outcomes` `f003`.
5. `inference-bait-lint.mts` wired into Stage 4 → prevents the `%`-plus-`N total`
   parenthetical bait class from re-entering.

## Pending file modifications

None. Working tree was clean at session end. No uncommitted changes pending.

## Ready when new data lands

- **Refinery ingest is unblocked.** Drop new data in, run the relevant pack(s),
  version bumps automatically, fresh `freshness_token` lands.
- **No protocol re-paste needed for content updates** — only re-paste if you
  bump the URL again (e.g. `?v=3`) to bust the cache.
- **Lint + master-routes-not-retrieves pattern** will keep the bait gone as new
  charge-off brands get added.

## Outstanding stubs (CRE pack)

Placeholder profiles still in `cre-swfl`:

- Waterside Shops
- Gulf Coast Town Center
- Coconut Point Mall
- Naples Airport-Pulling

Fill these when there's data; the corridor list otherwise verified.
