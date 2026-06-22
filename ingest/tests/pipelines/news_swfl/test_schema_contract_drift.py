"""Live-dlt proof for build 22 — gates #3 and #4 of SOLO-22 "Done when".

Runs a real dlt pipeline against a local DuckDB destination (hermetic, no
Postgres/creds) to prove the schema_contract is NOT a silent no-op:

  Gate #3 — a non-coercible value against a frozen data_type fails LOUD: dlt
            raises PipelineStepFailed whose __context__ chain carries a
            DataValidationError with table/column/contract_mode — NOT a bare
            psycopg DatatypeMismatch. explain_contract_failure surfaces it.
  Gate #4 — a forced ADDED column appears in load_info.load_packages[].schema_update
            and log_schema_update emits the [schema-update] token.

This mirrors the news_swfl shape: a complete typed column already exists at the
destination (build 01's ALTER), then a later run drifts its type.
"""
from __future__ import annotations

import dlt
import pytest
from dlt.common.schema.exceptions import DataValidationError
from dlt.pipeline.exceptions import PipelineStepFailed

from ingest.lib.schema_contract import explain_contract_failure, log_schema_update


def _pipeline(tmp_path, name="sc_drift"):
    return dlt.pipeline(
        pipeline_name=name,
        destination=dlt.destinations.duckdb(str(tmp_path / f"{name}.duckdb")),
        dataset_name="test",
        pipelines_dir=str(tmp_path / "pdir"),
    )


# ── Gate #3 — drift fails loud, with context ─────────────────────────────────


def test_freeze_data_type_drift_raises_with_context(tmp_path, capsys):
    pipe = _pipeline(tmp_path, "sc_drift_3")

    @dlt.resource(
        name="rows",
        # `val` is a complete bigint column from run 1 (the analogue of the
        # live, already-typed published_date column).
        columns={"val": {"data_type": "bigint"}},
        schema_contract={"data_type": "freeze"},
    )
    def rows(items):
        yield from items

    # Run 1: establish the table + the complete `val: bigint` column.
    pipe.run(rows([{"id": 1, "val": 100}]))

    # Run 2: a non-coercible value drifts `val`'s type. freeze must raise.
    with pytest.raises(PipelineStepFailed) as excinfo:
        try:
            pipe.run(rows([{"id": 2, "val": "not-a-number"}]))
        except PipelineStepFailed as exc:
            explain_contract_failure(exc, "news_swfl")

    # The context chain carries a DataValidationError (NOT a DatatypeMismatch).
    chain, found = excinfo.value, None
    while chain is not None:
        if isinstance(chain, DataValidationError):
            found = chain
            break
        chain = chain.__context__
    assert found is not None, "expected a DataValidationError in the __context__ chain"
    assert found.table_name == "rows"
    # dlt names the column after the variant it WOULD have created under evolve
    # (e.g. `val__v_text`), so the original column is the prefix. This is real
    # dlt behavior (verified live), not a guess — still diagnosable: a human
    # reads "val drifted to text".
    assert found.column_name.startswith("val"), found.column_name
    assert found.contract_mode == "freeze"

    # And our helper surfaced the classifier-routable plain-English line.
    out = capsys.readouterr().out
    assert "schema-contract failed validation" in out
    assert "table=rows" in out
    assert "column=val" in out


# ── Gate #4 — schema_update surfaced on a successful added column ─────────────


def test_added_column_surfaces_in_schema_update(tmp_path, capsys):
    pipe = _pipeline(tmp_path, "sc_drift_4")

    @dlt.resource(name="rows", schema_contract={"data_type": "freeze"})
    def rows(items):
        yield from items

    # Run 1: create the table with a single column.
    pipe.run(rows([{"id": 1}]))

    # Run 2: add a brand-new column (columns stays at evolve default → allowed).
    info = pipe.run(rows([{"id": 2, "extra_col": "hello"}]))

    n = log_schema_update(info, "news_swfl")
    assert n >= 1, "log_schema_update should have emitted the added column"
    out = capsys.readouterr().out
    assert "[schema-update] news_swfl: rows.extra_col added" in out


# ── Happy path — the contract does not break a clean, in-type load ───────────


def test_in_type_load_passes_clean(tmp_path, capsys):
    pipe = _pipeline(tmp_path, "sc_drift_happy")

    @dlt.resource(
        name="rows",
        columns={"val": {"data_type": "bigint"}},
        schema_contract={"data_type": "freeze"},
    )
    def rows(items):
        yield from items

    pipe.run(rows([{"id": 1, "val": 100}]))
    # A second in-type row must NOT raise under freeze.
    info = pipe.run(rows([{"id": 2, "val": 200}]))
    assert info is not None
