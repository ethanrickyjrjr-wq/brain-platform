"""ingest.scaffold — scaffold a new ingest pipeline from templates.

Usage:
  python -m ingest.scaffold --name=foo --tier=1 --cadence=monthly --release-day=15 --source-api=fred
  python -m ingest.scaffold --name=foo --tier=2 --cadence=annual --release-day=5 --source-api=census --dry

Atomically writes:
  ingest/pipelines/<name>/__init__.py
  ingest/pipelines/<name>/constants.py
  ingest/pipelines/<name>/resources.py
  ingest/pipelines/<name>/pipeline.py
  .github/workflows/ingest-<name>.yml
  ingest/tests/pipelines/<name>/__init__.py
  ingest/tests/pipelines/<name>/test_pipeline.py
  ingest/tests/pipelines/<name>/test_dry_run.py

The drift-guard test (ingest/tests/test_pipeline_drift.py) will fail for the
new pipeline until you run this scaffold — it's a forcing function.
"""
from __future__ import annotations

import argparse
import sys
import textwrap
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PIPELINES_DIR = REPO_ROOT / "ingest" / "pipelines"
WORKFLOWS_DIR = REPO_ROOT / ".github" / "workflows"
TESTS_DIR = REPO_ROOT / "ingest" / "tests" / "pipelines"

# Hour offset per cadence so workflows don't all fire at the same time.
_CADENCE_HOUR = {
    "daily": "0 12 * * *",
    "monthly": "0 12 <DAY> * *",
    "quarterly": "0 13 <DAY> 1,4,7,10 *",
    "annual": "0 12 <DAY> 4 *",  # April is a common annual release window
}

_TIER_SECRETS = {
    1: "SUPABASE_URL + SUPABASE_SERVICE_KEY + DESTINATION__POSTGRES__CREDENTIALS",
    2: "DESTINATION__POSTGRES__CREDENTIALS + SUPABASE_URL + SUPABASE_SERVICE_KEY",
}


def _cron(cadence: str, day: int) -> str:
    template = _CADENCE_HOUR.get(cadence, "0 12 <DAY> * *")
    return template.replace("<DAY>", str(day))


def _workflow_yml(name: str, tier: int, cadence: str, day: int, api_key: str | None) -> str:
    cron_expr = _cron(cadence, day)
    skip_note = "skip Storage upload" if tier == 1 else "skip dlt write"
    timeout = 15 if tier == 1 else 20
    api_block = f"          {api_key.upper()}_API_KEY: ${{{{ secrets.{api_key.upper()}_API_KEY }}}}\n" if api_key else ""
    return textwrap.dedent(f"""\
        name: {name.replace("_", "-")} {cadence}

        on:
          schedule:
            # {cron_expr} — see docs/standards/pipeline-freshness.md §3
            - cron: "{cron_expr}"
          workflow_dispatch:
            inputs:
              dry_run:
                description: "Dry run — fetch and validate only; {skip_note}"
                required: false
                default: "false"

        permissions:
          contents: read

        jobs:
          ingest:
            runs-on: ubuntu-latest
            timeout-minutes: {timeout}
            steps:
              - name: Checkout
                uses: actions/checkout@v6

              - name: Setup Python
                uses: actions/setup-python@v6
                with:
                  python-version: "3.13"

              - name: Install ingest dependencies
                run: pip install -r ingest/requirements.txt

              - name: Run {name} pipeline
                env:
        {api_block}          SUPABASE_URL: ${{{{ secrets.SUPABASE_URL }}}}
                  SUPABASE_SERVICE_KEY: ${{{{ secrets.SUPABASE_SERVICE_KEY }}}}
                  DESTINATION__POSTGRES__CREDENTIALS: ${{{{ secrets.DESTINATION__POSTGRES__CREDENTIALS }}}}
                run: |
                  if [ "${{{{ github.event.inputs.dry_run }}}}" = "true" ]; then
                    python -m ingest.pipelines.{name}.pipeline --dry-run
                  else
                    python -m ingest.pipelines.{name}.pipeline
                  fi
        """)


def _pipeline_py(name: str, tier: int) -> str:
    if tier == 2:
        return textwrap.dedent(f"""\
            \"\"\"Tier 2 dlt pipeline — {name}.

            See docs/standards/pipeline-freshness.md for the freshness contract.
            \"\"\"
            from __future__ import annotations

            import argparse
            import sys

            import dlt

            from .resources import {name}_resource


            def run() -> None:
                pipeline = dlt.pipeline(
                    pipeline_name="{name}",
                    destination="postgres",
                    dataset_name="data_lake",
                )
                load_info = pipeline.run({name}_resource())
                load_info.raise_on_failed_jobs()
                print("{name} pipeline complete.")


            def main(argv: list[str] | None = None) -> int:
                parser = argparse.ArgumentParser(description="{name} ingest pipeline.")
                parser.add_argument("--dry-run", action="store_true",
                                    help="Fetch and validate only; skip dlt write.")
                args = parser.parse_args(argv)
                if args.dry_run:
                    print("{name} dry-run: fetching...")
                    rows = list({name}_resource())
                    print(f"{name} dry-run: {{len(rows)}} rows")
                    if rows:
                        print("first row:", rows[0])
                    return 0
                run()
                return 0


            if __name__ == "__main__":
                sys.exit(main())
            """)
    # Tier 1 — storage uploader pattern
    return textwrap.dedent(f"""\
        \"\"\"Tier 1 storage pipeline — {name}.

        See docs/standards/pipeline-freshness.md for the freshness contract.
        \"\"\"
        from __future__ import annotations

        import argparse
        import sys
        from datetime import datetime, timezone

        from ingest.lib.storage_uploader import _upload_bytes  # type: ignore[attr-defined]
        from ingest.lib.tier1_inventory import upsert_inventory_row

        BUCKET = "lake-tier1"


        def fetch() -> list[dict]:
            \"\"\"TODO: implement fetch logic.\"\"\"
            raise NotImplementedError


        def main(argv: list[str] | None = None) -> int:
            parser = argparse.ArgumentParser(description="{name} ingest pipeline.")
            parser.add_argument("--dry-run", action="store_true",
                                help="Fetch and validate only; skip Storage upload.")
            args = parser.parse_args(argv)

            rows = fetch()
            print(f"{name}: {{len(rows)}} rows fetched.")

            if args.dry_run:
                print("{name}: --dry-run, skipping upload.")
                if rows:
                    print("first row:", rows[0])
                return 0

            now = datetime.now(timezone.utc)
            path = f"{name}/{{now.year:04d}}-{{now.month:02d}}-{{now.day:02d}}.json"
            body = b"[]"  # TODO: serialize rows
            _upload_bytes(BUCKET, path, body, "application/json")
            upsert_inventory_row(bucket=BUCKET, path=path,
                                 vintage=now.date().isoformat(),
                                 byte_size=len(body), pack_id=None, source_url=None)
            print(f"{name}: uploaded to {{BUCKET}}/{{path}}.")
            return 0


        if __name__ == "__main__":
            sys.exit(main())
        """)


def _resources_py(name: str, tier: int) -> str:
    if tier == 2:
        return textwrap.dedent(f"""\
            \"\"\"dlt resources for {name}.\"\"\"
            from __future__ import annotations

            from typing import Iterator

            import dlt


            # Incremental-aware by default (ingest/CLAUDE.md). For an append/event source
            # (permits, listings, licenses -- anything with a date or monotonic id), the cursor
            # pulls ONLY new/changed rows: feed cursor.start_value (the persisted high-water
            # mark) into your source request (API `since=`, scrape `--start`, file-by-period).
            # merge + primary_key keep it idempotent; on_cursor_value_missing="exclude" drops
            # rows with no cursor value instead of inventing one. Add `lag=N` to re-fetch the
            # last N days/units each run (late-arriving rows). Working reference:
            # ingest/pipelines/lee_permits/pipeline.py. Hardening: add a schema_contract freeze
            # (see ingest/lib/schema_contract.py) to fail on source-shape drift.
            #
            # SNAPSHOT SOURCE? If each release republishes the WHOLE table (Census ACS, FHFA
            # HPI, an annual roll, or a source with NO stable key -- e.g. FEMA NFIP, whose id
            # regenerates each refresh), DELETE the `cursor=` arg + `primary_key` and use
            # write_disposition="replace" -- and document WHY in this docstring. This is a
            # PER-SOURCE decision; do not blanket-convert either way.
            @dlt.resource(table_name="{name}", write_disposition="merge", primary_key="id")
            def {name}_resource(
                cursor=dlt.sources.incremental(
                    "updated_at",  # TODO: monotonic cursor column (updated_at / created_at / load date)
                    last_value_func=max,
                    on_cursor_value_missing="exclude",
                ),
            ) -> Iterator[dict]:
                \"\"\"TODO: implement resource generator.

                Use cursor.start_value to request only rows newer than the last load.
                \"\"\"
                raise NotImplementedError
                yield  # makes this a generator
            """)
    return textwrap.dedent(f"""\
        \"\"\"Fetch helpers for {name}.\"\"\"
        from __future__ import annotations


        def fetch_{name}() -> list[dict]:
            \"\"\"TODO: implement fetch logic.\"\"\"
            raise NotImplementedError
        """)


def _test_dry_run_py(name: str, tier: int) -> str:
    if tier == 2:
        return textwrap.dedent(f"""\
            from unittest.mock import patch


            def test_dry_run_skips_dlt():
                with patch("dlt.pipeline") as mock_pipeline, \\
                     patch("ingest.pipelines.{name}.resources.{name}_resource",
                           return_value=iter([{{"id": "stub"}}])):
                    from ingest.pipelines.{name}.pipeline import main

                    result = main(["--dry-run"])

                assert result == 0
                mock_pipeline.assert_not_called()
            """)
    return textwrap.dedent(f"""\
        from unittest.mock import patch


        def test_dry_run_skips_upload():
            with patch("ingest.pipelines.{name}.pipeline.fetch", return_value=[{{"id": "stub"}}]), \\
                 patch("ingest.lib.storage_uploader._upload_bytes") as mock_upload:
                from ingest.pipelines.{name}.pipeline import main

                result = main(["--dry-run"])

            assert result == 0
            mock_upload.assert_not_called()
        """)


def _constants_py(name: str) -> str:
    return textwrap.dedent(f"""\
        \"\"\"Constants for {name} pipeline.\"\"\"

        # TODO: add source URL, API endpoint, or file path constants here.
        """)


def scaffold(
    name: str,
    tier: int,
    cadence: str,
    release_day: int,
    source_api: str | None,
    dry: bool,
) -> None:
    pipeline_dir = PIPELINES_DIR / name
    test_dir = TESTS_DIR / name
    workflow_path = WORKFLOWS_DIR / f"ingest-{name.replace('_', '-')}.yml"

    files: dict[Path, str] = {
        pipeline_dir / "__init__.py": "",
        pipeline_dir / "constants.py": _constants_py(name),
        pipeline_dir / "resources.py": _resources_py(name, tier),
        pipeline_dir / "pipeline.py": _pipeline_py(name, tier),
        workflow_path: _workflow_yml(name, tier, cadence, release_day, source_api),
        test_dir / "__init__.py": "",
        test_dir / "test_pipeline.py": textwrap.dedent(f"""\
            \"\"\"Integration smoke test for {name}. Requires live env vars.\"\"\"
            import pytest


            @pytest.mark.skip(reason="live integration test — run manually with env vars")
            def test_pipeline_runs():
                from ingest.pipelines.{name}.pipeline import main
                assert main([]) == 0
            """),
        test_dir / "test_dry_run.py": _test_dry_run_py(name, tier),
    }

    print(f"scaffold: {'DRY RUN — ' if dry else ''}writing {len(files)} files for '{name}' (tier {tier}, {cadence})")
    for path, content in files.items():
        rel = path.relative_to(REPO_ROOT)
        print(f"  {'[skip] ' if dry else '[write]'} {rel}")
        if not dry:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")

    if not dry:
        print(f"\nscaffold: done. Next steps:")
        print(f"  1. Implement ingest/pipelines/{name}/resources.py")
        print(f"  2. Fill in any constants in ingest/pipelines/{name}/constants.py")
        print(f"  3. Run: pytest ingest/tests/pipelines/{name}/test_dry_run.py")
        print(f"  4. Update the cron slot comment in {workflow_path.name} if you changed it")
        print(f"  5. Add the new slot to docs/standards/pipeline-freshness.md §3")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--name", required=True,
                        help="Pipeline name (snake_case, e.g. fred_econ)")
    parser.add_argument("--tier", type=int, choices=[1, 2], required=True,
                        help="Storage tier: 1=Supabase Storage, 2=Postgres data_lake.*")
    parser.add_argument("--cadence", choices=["daily", "monthly", "quarterly", "annual"],
                        required=True)
    parser.add_argument("--release-day", type=int, default=15,
                        help="Day-of-month for the cron trigger (default: 15)")
    parser.add_argument("--source-api", default=None,
                        help="Short name of the source API key (e.g. 'fred' → FRED_API_KEY secret)")
    parser.add_argument("--dry", action="store_true",
                        help="Print what would be written without writing")
    args = parser.parse_args(argv)

    name = args.name.lower().replace("-", "_")
    scaffold(name, args.tier, args.cadence, args.release_day, args.source_api, args.dry)
    return 0


if __name__ == "__main__":
    sys.exit(main())
