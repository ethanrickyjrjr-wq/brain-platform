# ingest/pipelines

Each subdirectory is one ingest pipeline. Every pipeline must satisfy the
[Pipeline Freshness Standard](../../docs/standards/pipeline-freshness.md).

## Adding a new pipeline

```bash
python -m ingest.scaffold \
  --name=my_source \
  --tier=2 \
  --cadence=monthly \
  --release-day=10 \
  --source-api=my_api
```

This atomically writes the four pipeline files, the GHA workflow, and the two
pytest stubs. The drift-guard test (`ingest/tests/test_pipeline_drift.py`) will
fail for any pipeline directory that lacks a matching workflow — scaffolding
satisfies the guard automatically.

Preview what would be written without writing:

```bash
python -m ingest.scaffold --name=my_source --tier=2 --cadence=monthly --release-day=10 --dry
```

## Pipeline directory layout

```
ingest/pipelines/<name>/
  __init__.py       # empty
  constants.py      # source URL, API endpoint, field lists
  resources.py      # dlt @resource generators (Tier 2) or fetch helpers (Tier 1)
  pipeline.py       # main() entry point with --dry-run support
```

## Workflow naming convention

- Scaffold writes `.github/workflows/ingest-<name>.yml`.
- Existing pipelines that predate the scaffold use `<source>-<cadence>.yml`
  (e.g. `bls-laus-monthly.yml`). Both conventions are recognized by the
  drift-guard test.
