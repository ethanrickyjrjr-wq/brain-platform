"""Unit tests for ingest.lib.schema_contract — the two pure formatters.

These pin behavior WITHOUT a dlt run: the live-dlt drift proof (gates #3/#4)
lives in ingest/tests/pipelines/news_swfl/test_schema_contract_drift.py.
"""
from __future__ import annotations

import pytest

from dlt.common.schema.exceptions import DataValidationError

from ingest.lib.schema_contract import explain_contract_failure, log_schema_update


# ── log_schema_update ────────────────────────────────────────────────────────


class _FakePackage:
    def __init__(self, schema_update):
        self.schema_update = schema_update


class _FakeLoadInfo:
    def __init__(self, packages):
        self.load_packages = packages


def _info(schema_update):
    return _FakeLoadInfo([_FakePackage(schema_update)])


def test_log_schema_update_emits_token_and_counts(capsys):
    info = _info(
        {"news_articles_swfl": {"columns": {"published_date": {"data_type": "text"}}}}
    )
    n = log_schema_update(info, "news_swfl")
    assert n == 1
    out = capsys.readouterr().out
    assert "[schema-update] news_swfl: news_articles_swfl.published_date added (text)" in out


def test_log_schema_update_counts_multiple_columns(capsys):
    info = _info(
        {"t": {"columns": {"a": {"data_type": "bigint"}, "b": {"data_type": "text"}}}}
    )
    assert log_schema_update(info, "lbl") == 2


def test_log_schema_update_empty_is_zero_and_silent(capsys):
    assert log_schema_update(_info({}), "lbl") == 0
    assert log_schema_update(_FakeLoadInfo([]), "lbl") == 0
    assert capsys.readouterr().out == ""


def test_log_schema_update_tolerates_missing_attrs():
    # A load_info without load_packages must not explode.
    assert log_schema_update(object(), "lbl") == 0


# ── explain_contract_failure ─────────────────────────────────────────────────


def _dve(table="news_articles_swfl", column="published_date"):
    return DataValidationError(
        schema_name="news_swfl",
        table_name=table,
        column_name=column,
        schema_entity="data_type",
        contract_mode="freeze",
        table_schema={},
        schema_contract={"data_type": "freeze"},
        data_item={column: "not-a-date"},
    )


def _chain(*excs):
    """Link excs as a __context__ chain: _chain(top, mid, leaf) sets
    top.__context__=mid, mid.__context__=leaf. Returns top."""
    for outer, inner in zip(excs, excs[1:]):
        outer.__context__ = inner
    return excs[0]


def test_reraises_original_and_prints_token_depth_2(capsys):
    dve = _dve()
    top = _chain(RuntimeError("PipelineStepFailed"), RuntimeError("normalize"), dve)
    with pytest.raises(RuntimeError, match="PipelineStepFailed"):
        explain_contract_failure(top, "news_swfl")
    out = capsys.readouterr().out
    assert "schema-contract failed validation" in out  # routes to SCHEMA_DRIFT
    assert "table=news_articles_swfl" in out
    assert "column=published_date" in out
    assert "contract_mode=freeze" in out


def test_walks_chain_deeper_than_two_levels(capsys):
    # The whole point of the operator's correction: a hardcoded
    # __context__.__context__ would MISS this (DVE is at depth 3).
    dve = _dve()
    top = _chain(
        RuntimeError("step"), RuntimeError("a"), RuntimeError("b"), dve
    )
    with pytest.raises(RuntimeError, match="step"):
        explain_contract_failure(top, "news_swfl")
    assert "schema-contract failed validation" in capsys.readouterr().out


def test_dve_at_top_level(capsys):
    dve = _dve()
    with pytest.raises(DataValidationError):
        explain_contract_failure(dve, "news_swfl")
    assert "schema-contract failed validation" in capsys.readouterr().out


def test_non_contract_failure_reraised_without_token(capsys):
    top = _chain(RuntimeError("boom"), ValueError("unrelated"))
    with pytest.raises(RuntimeError, match="boom"):
        explain_contract_failure(top, "news_swfl")
    assert "schema-contract failed validation" not in capsys.readouterr().out
