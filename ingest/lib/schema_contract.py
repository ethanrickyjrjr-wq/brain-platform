"""Schema-contract observability helpers for dlt ingest pipelines.

Two dead-simple formatters — NOT a wrapper that intercepts ``pipeline.run()``.
Each pipeline opts in where its curator decides a dlt ``schema_contract`` earns
its keep (RULE 3 C2: per-pipeline, never a global pre-materialization gate). The
moment this grows toward "every pipeline passes through it" it has become the
global gate the architecture explicitly rejects — keep it two pure formatters.

- ``log_schema_update`` — after a successful run, print every added/changed
  column dlt applied during the load, so a *benign* schema delta is VISIBLE on a
  green run, not just the breaking ones (the observability half of build 22).
- ``explain_contract_failure`` — on a ``freeze``-mode contract violation, print a
  plain-English line carrying the table/column/contract_mode context and re-raise
  the original failure. Walks the whole ``__context__`` chain rather than guessing
  the nesting depth.

Vendor surfaces (verified in-session against live dlt docs 1.28.1 + installed
dlt 1.27.2, RULE 1):
- ``load_info.load_packages[i].schema_update`` — dict keyed by table name whose
  values carry a ``columns`` dict, each column carrying ``data_type``.
- ``DataValidationError`` (``dlt.common.schema.exceptions``) re-raised via
  ``PipelineStepFailed`` (``dlt.pipeline.exceptions``); context attrs
  ``schema_name`` / ``table_name`` / ``column_name`` / ``schema_entity`` /
  ``contract_mode`` / ``table_schema`` / ``schema_contract`` / ``data_item``.
"""
from __future__ import annotations

from typing import Any

from dlt.common.schema.exceptions import DataValidationError


def log_schema_update(load_info: Any, label: str) -> int:
    """Print every added/changed column dlt applied during this load.

    Reads ``load_info.load_packages[i].schema_update`` (a dict keyed by table
    name whose values carry a ``columns`` dict). Returns the number of column
    deltas emitted so callers and tests can assert it actually fired — a green
    run with no schema change emits nothing and returns 0.

    The emitted token ``[schema-update] <label>: <table>.<col> added (<type>)``
    matches NONE of the cron classifier's failure arms, so a benign delta on a
    successful run never false-trips ``classify-cron-failure.mjs``.
    """
    count = 0
    for package in getattr(load_info, "load_packages", None) or []:
        schema_update = getattr(package, "schema_update", None) or {}
        for table_name, table in schema_update.items():
            for column_name, column in (table.get("columns") or {}).items():
                data_type = column.get("data_type", "unknown")
                print(f"[schema-update] {label}: {table_name}.{column_name} added ({data_type})")
                count += 1
    return count


def explain_contract_failure(exc: BaseException, label: str) -> None:
    """Print a plain-English line for a freeze-mode contract violation, then
    re-raise the *original* exception untouched.

    dlt re-raises ``DataValidationError`` wrapped in ``PipelineStepFailed``, and
    the nesting depth differs between the ``extract`` and ``normalize`` steps —
    a hardcoded ``__context__.__context__`` would silently miss the deeper case
    and degrade to a bare re-raise, misclassifying a schema event as a crawl
    flap (the exact failure this build exists to prevent). So walk the entire
    ``__context__`` chain.

    The ``schema-contract failed validation`` token routes the failure to the
    cron classifier's SCHEMA_DRIFT arm (``classify-cron-failure.mjs`` arm 5) — a
    schema event, never a TRANSIENT retry. The original ``PipelineStepFailed``
    (with its ``DataValidationError`` context intact) is re-raised so the full
    stack still reaches the GHA log and the run still exits non-zero.
    """
    cur: BaseException | None = exc
    while cur is not None:
        if isinstance(cur, DataValidationError):
            # ASCII-only line (no em-dash) so it never mojibakes through a
            # cp1252 console or log tail; the "failed validation" token is what
            # the cron classifier matches.
            print(
                f"[schema-contract] {label}: FREEZE violation - "
                f"table={cur.table_name} column={cur.column_name} "
                f"schema_entity={cur.schema_entity} contract_mode={cur.contract_mode} "
                f"- schema-contract failed validation"
            )
            break
        cur = cur.__context__
    raise exc
