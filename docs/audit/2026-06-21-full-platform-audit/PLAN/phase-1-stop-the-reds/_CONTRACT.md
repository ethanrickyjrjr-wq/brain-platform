# Phase 1 — shared contracts (so 01–04 run in parallel without colliding)

Builds 01–04 touch disjoint files, but two pairs share a **string contract**. Pin these so concurrent
agents don't drift:

## Contract A — the daily-rebuild reason string (build 02 ⇄ build 04)
- **02** echoes, to stdout before `process.exit`, the master outcome's `failureClass` + `reason` straight
  from `_build-report.json` (the fields already exist; 02 just surfaces them). Echo them on **one line**,
  prefixed literally: `CRON-DIAG failureClass=<x> reason=<y>`.
- **04** adds a classifier rule that matches that line: a `DETERMINISTIC_HOLD` class keyed on
  `failureClass=deterministic` **and/or** `reason=.*\.md not found`. Match the prefix `CRON-DIAG` OR the
  raw `_build-report.json` text — both, for resilience.

## Contract B — the Postgres DatatypeMismatch signature (build 01 ⇄ build 04)
- **01** fixes the live `news_swfl` `published_date` mismatch so it stops recurring.
- **04** still adds a `SCHEMA_DRIFT`-adjacent rule for `DatatypeMismatch` (Postgres: `column ".*" is of
  type .* but expression is of type .*`) so the NEXT schema drift on any pipeline is classified, not
  bucketed `UNKNOWN`. The existing `SCHEMA_DRIFT` class already matches `relation/column does not exist`;
  add `DatatypeMismatch` to that same class.

## Why these four are parallel-safe
| Build | File(s) | Touches anything 02/03/04 touch? |
|---|---|---|
| 01 | `data_lake.news_swfl*` migration (+ maybe `pipelines/news_swfl/pipeline.py`) | no |
| 02 | `refinery/cli.mts` | no |
| 03 | `ingest/scripts/check_freshness.py` | no |
| 04 | `.github/scripts/classify-cron-failure.mjs`, `.github/scripts/lib/cron-run.mjs` | no |

Run all four concurrently. 05 is SOLO (module-load gate) — do NOT run it in this group.
