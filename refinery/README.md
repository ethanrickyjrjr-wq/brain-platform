# Refinery v1

The **Refinery** is the vertical-intelligence packing engine. It reads structured
data, refines it through a four-stage pipeline, and emits a spec-v1.1 Brain URL
Master Index (`brains/{brain_id}.md`) that the B2 delivery route serves.

It is an **A1 (lab) tool** — a local CLI. It is a sibling of `app/`, never
bundled into the Next build. Credentials never leave A1.

## Run

```bash
# offline — fixture data + mock agents, no credentials, validates without writing
REFINERY_SOURCE=fixture node refinery/cli.mts franchise-outcomes --dry-run

# live — real Supabase data + real Anthropic agents, writes brains/franchise-outcomes.md
node refinery/cli.mts franchise-outcomes

# npm scripts
npm run refinery:franchise            # node refinery/cli.mts franchise-outcomes
npm run refinery:typecheck            # tsc -p refinery/tsconfig.json --noEmit
```

`--dry-run` runs all four stages + validation but does not write to `brains/`.

## Modes (two independent axes)

| Axis            | `live` (default)                       | alternate                                                               |
| --------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| **Data source** | reads premise-engine Supabase / Sanity | `REFINERY_SOURCE=fixture` — reads `refinery/__fixtures__/*.sample.json` |
| **Agents**      | real Haiku/Sonnet calls                | mock (deterministic) when `ANTHROPIC_API_KEY` is unset                  |

The two axes are independent. With neither credential set, the full pipeline still
runs (fixture data + mock agents) — output is shape-valid and spec-valid but not
real intelligence. That is the offline Tier-1 verification path.

## Environment (`.env.local`, gitignored)

| Var                     | Needed for             | Notes                                                        |
| ----------------------- | ---------------------- | ------------------------------------------------------------ |
| `SUPABASE_URL`          | live source            | `https://tssgulkyczfefucmrtda.supabase.co`                   |
| `SUPABASE_READONLY_KEY` | live source            | prefer a SELECT-only key; `anon` if RLS permits              |
| `SANITY_PROJECT_ID`     | live source (CRE pack) | defaults to `go8u2esq`                                       |
| `SANITY_DATASET`        | live source (CRE pack) | defaults to `production`                                     |
| `SANITY_READ_TOKEN`     | live source (CRE pack) | Viewer-role token, or omit if public                         |
| `ANTHROPIC_API_KEY`     | live agents            | unset → deterministic mock agents                            |
| `REFINERY_SOURCE`       | —                      | `fixture` to read committed fixtures instead of live sources |

## Packs

| Pack id              | Source                                  | Status                           |
| -------------------- | --------------------------------------- | -------------------------------- |
| `franchise-outcomes` | Supabase `sba_loans_franchise_outcomes` | built                            |
| `cre-swfl`           | Sanity `corridorProfile` + `promptRule` | not yet registered (plan step 7) |

A pack is just an entry in `config/packs.mts` plus a source connector. The engine
is pack-agnostic.

## The four-stage pipeline

1. **Ingest** (`stages/1-ingest.mts`) — deterministic fetch + normalize; raw rows
   snapshotted to `.refinery-cache/` ("raw text never lost").
2. **Triage** (`stages/2-triage.mts`) — deterministic `pack_fit` first (hard-drops
   fragments that don't belong), then a batched Haiku call for `content_score`;
   `composite = (pack_fit + content_score) * type_multiplier`, drop below cutoff.
3. **Synthesis** (`stages/3-synthesis.mts`) — one Sonnet call turns triaged
   fragments into refined, citable facts; provenance (`src`, `composite`, `date`)
   resolved here.
4. **Output** (`stages/4-output.mts`) — deterministic render to the spec-v1.1
   Master Index, then `spec-validator` + `facts-only-lint`. **If validation fails
   the run aborts and the existing pack is left intact.**

Each stage writes its artifact to `.refinery-cache/{pack}/` so stages are
independently inspectable and re-runnable.

## Layout

```
refinery/
  cli.mts            entrypoint
  config/            env loader, pack registry
  types/             fragment / event / pack / scoring types
  sources/           source connectors (the only files that know a source schema)
  stages/            1-ingest / 2-triage / 3-synthesis / 4-output
  agents/            shared Anthropic client, Haiku triage, Sonnet synthesis
  render/            PackOutput -> spec-v1.1 markdown
  validate/          spec-validator, facts-only-lint
  lib/               ids, dates, raw-store
  __fixtures__/      committed synthetic data for offline dev/test
```

Output format is defined by `docs/brain-url-spec-v1.md` (v1.1) — the source of truth.
