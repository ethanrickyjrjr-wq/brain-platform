"""Unit tests for check_data_quality.py — SQL builders, schema diff, registry.

Safety is proven STRUCTURALLY (isinstance Composable + bound params), not by
string-matching: a raw f-string would be a plain `str` and fail the type assert.
The DB-touching paths are proven separately by the live "done when" proofs in the
spec; these tests stay offline (no psycopg connection)."""
import json
import os
import sys

import pytest
from psycopg import sql as pgsql

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))

from ingest.scripts.check_data_quality import (  # noqa: E402
    build_accepted_values_sql,
    build_not_null_sql,
    build_unique_sql,
    diff_schema,
    load_quality_registry,
    _quality_check_key,
    _schema_check_key,
)

_REGISTRY_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "ingest", "quality", "quality_registry.yaml"
)


# ── SQL builders: structural safety ─────────────────────────────────────────────


def test_not_null_builder_is_composable_no_params():
    query, params = build_not_null_sql("data_lake.news_articles_swfl", "article_url")
    assert isinstance(query, pgsql.Composable)  # a raw str would fail this
    assert params == []


def test_unique_builder_is_composable_no_params():
    query, params = build_unique_sql("data_lake.leepa_parcels", "folioid")
    assert isinstance(query, pgsql.Composable)
    assert params == []


def test_accepted_values_binds_values_not_interpolates():
    """The accepted set must be a bound array param (params), NEVER in the SQL —
    this is the SQL-injection guarantee for the one test that takes user values."""
    vals = ["a", "b", "c"]
    query, params = build_accepted_values_sql("data_lake.news_articles_swfl", "source_name", vals)
    assert isinstance(query, pgsql.Composable)
    # values are bound as a single list param (the LOCKED `<> ALL(%s::text[])` form),
    # cast to str — not formatted into the query text.
    assert params == [["a", "b", "c"]]


def test_accepted_values_query_uses_all_array_form_not_in():
    """Render check (readability, not the safety guarantee): the locked form is
    `<> ALL(%s::text[])`, NOT `NOT IN %s` (which is a psycopg3 SyntaxError)."""
    query, _ = build_accepted_values_sql("data_lake.x", "c", ["v"])
    rendered = query.as_string(None) if hasattr(query, "as_string") else str(query)
    assert "ALL(%s::text[])" in rendered
    assert "NOT IN %s" not in rendered


# ── schema diff classifier ──────────────────────────────────────────────────────


def test_diff_schema_identical_is_empty():
    base = {"a": "text", "b": "integer"}
    assert diff_schema(base, dict(base)) == []


def test_diff_schema_classifies_all_three():
    baseline = {"keep": "text", "gone": "integer", "shifted": "date"}
    live = {"keep": "text", "shifted": "text", "added": "boolean"}
    out = diff_schema(baseline, live)
    by_col = {d["col"]: d for d in out}
    assert by_col["added"] == {"col": "added", "change": "ADDED", "baseline_type": None, "live_type": "boolean"}
    assert by_col["gone"] == {"col": "gone", "change": "REMOVED", "baseline_type": "integer", "live_type": None}
    assert by_col["shifted"] == {
        "col": "shifted", "change": "TYPE_CHANGED", "baseline_type": "date", "live_type": "text",
    }
    # "keep" is unchanged -> must NOT appear
    assert "keep" not in by_col
    # sorted by col
    assert [d["col"] for d in out] == sorted(d["col"] for d in out)


def test_diff_schema_published_date_class():
    """The load-bearing case: news published_date text<->date is TYPE_CHANGED."""
    out = diff_schema({"published_date": "text"}, {"published_date": "date"})
    assert out == [{"col": "published_date", "change": "TYPE_CHANGED",
                    "baseline_type": "text", "live_type": "date"}]


# ── check_key slugging ──────────────────────────────────────────────────────────


def test_check_keys_slug_qualified_table():
    """The qualified table's dot/underscore must be slugged into the key so it
    stays a clean kebab token (mirrors the gap detector's _slug)."""
    qk = _quality_check_key("data_lake.news_articles_swfl", "article_url", "unique")
    assert qk == "quality_fail_data-lake-news-articles-swfl_article_url_unique"
    assert "." not in qk
    sk = _schema_check_key("data_lake.news_articles_swfl", "published_date")
    assert sk == "schema_drift_data-lake-news-articles-swfl_published_date"
    assert "." not in sk


# ── registry smoke ──────────────────────────────────────────────────────────────


def test_quality_registry_parses_and_is_well_formed():
    reg = load_quality_registry(_REGISTRY_PATH)
    assert "tables" in reg and reg["tables"], "registry must have at least one table"
    for table, cfg in reg["tables"].items():
        for spec in cfg.get("value_tests", []):
            for k in ("col", "test", "severity"):
                assert k in spec, f"{table} value_test missing {k}: {spec}"
            assert spec["severity"] in ("warn", "error")
            assert spec["test"] in ("not_null", "unique", "accepted_values")
            if spec["test"] == "accepted_values":
                assert isinstance(spec.get("values"), list) and spec["values"], \
                    f"{table} accepted_values must carry a non-empty 'values' list"


def test_quality_registry_has_four_pilot_tables():
    reg = load_quality_registry(_REGISTRY_PATH)
    for t in ("data_lake.news_articles_swfl", "data_lake.zhvi_swfl",
              "data_lake.zori_swfl", "data_lake.leepa_parcels"):
        assert t in reg["tables"], f"pilot table {t} missing from registry"


def test_committed_baselines_exist_and_parse():
    """The four pilot baselines must be committed (else first CI run shows
    BASELINE_MISSING). Each must be a {column: data_type} JSON map."""
    bdir = os.path.join(os.path.dirname(_REGISTRY_PATH), "schema_baselines")
    for t in ("data_lake.news_articles_swfl", "data_lake.zhvi_swfl",
              "data_lake.zori_swfl", "data_lake.leepa_parcels"):
        p = os.path.join(bdir, f"{t}.json")
        assert os.path.exists(p), f"missing baseline {p} — run --update-baseline"
        data = json.loads(open(p, encoding="utf-8").read())
        assert isinstance(data, dict) and data
        assert all(isinstance(k, str) and isinstance(v, str) for k, v in data.items())
