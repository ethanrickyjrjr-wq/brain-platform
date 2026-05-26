"""Drift-guard: assert every pipeline dir has a matching GHA workflow.

Checks each non-orphan directory under ingest/pipelines/ and
ingest/duckdb_pipelines/ for:
  (a) a matching .github/workflows/*.yml (by name convention)
  (b) workflow_dispatch: present in the YAML
  (c) DESTINATION__POSTGRES__CREDENTIALS referenced in the YAML

Pipelines in ALLOW_LIST are exempt — they are covered in plan PR 3.
Remove entries from the allow-list as their workflows land.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
PIPELINES_DIR = REPO_ROOT / "ingest" / "pipelines"
DUCKDB_DIR = REPO_ROOT / "ingest" / "duckdb_pipelines"
WORKFLOWS_DIR = REPO_ROOT / ".github" / "workflows"

# Pipelines without a workflow yet — covered in plan PR 3.
ALLOW_LIST = {
    "ingest/pipelines/bls_qcew",           # covered in plan PR 3
    "ingest/pipelines/faf5",               # covered in plan PR 3
    "ingest/pipelines/lee_permits",        # covered in plan PR 3
    "ingest/pipelines/usgs",               # to be DELETED in plan PR 3 (superseded by duckdb lane)
    "ingest/pipelines/zori_swfl",          # covered in plan PR 3 (2-stage: pipelines/ feeds duckdb_pipelines/)
    "ingest/duckdb_pipelines/usgs",        # covered in plan PR 3
    "ingest/duckdb_pipelines/zori_swfl",   # covered in plan PR 3 (2-stage)
    "ingest/duckdb_pipelines/hurdat2_fl",  # covered in plan PR 3
    "ingest/duckdb_pipelines/redfin_swfl", # covered in plan PR 3
    "ingest/duckdb_pipelines/storm_history_swfl",  # covered in plan PR 3
}

# Pipeline dirs that are scaffolding/internal only (no workflow needed).
_SKIP_NAMES = {"__pycache__", "__init__.py"}


def _pipeline_dirs() -> list[tuple[Path, str]]:
    """Return (dir_path, allow_list_key) for every pipeline directory."""
    dirs: list[tuple[Path, str]] = []
    for base, prefix in [(PIPELINES_DIR, "ingest/pipelines"), (DUCKDB_DIR, "ingest/duckdb_pipelines")]:
        if not base.exists():
            continue
        for entry in sorted(base.iterdir()):
            if not entry.is_dir():
                continue
            if entry.name in _SKIP_NAMES:
                continue
            dirs.append((entry, f"{prefix}/{entry.name}"))
    return dirs


def _workflow_for(pipeline_name: str) -> Path | None:
    """Find the workflow YAML for a pipeline by name convention."""
    # Try both naming schemes: ingest-<name>.yml and <source>-<cadence>.yml
    snake = pipeline_name.replace("_", "-")
    candidates = [
        WORKFLOWS_DIR / f"ingest-{snake}.yml",
        WORKFLOWS_DIR / f"{snake}-monthly.yml",
        WORKFLOWS_DIR / f"{snake}-annual.yml",
        WORKFLOWS_DIR / f"{snake}-quarterly.yml",
        WORKFLOWS_DIR / f"{snake}-daily.yml",
    ]
    # Also search all workflow files for a run step referencing this pipeline module
    module_pattern = re.compile(
        rf"ingest\.(?:pipelines|duckdb_pipelines)\.{re.escape(pipeline_name)}\b"
    )
    for yml in WORKFLOWS_DIR.glob("*.yml"):
        if module_pattern.search(yml.read_text(encoding="utf-8")):
            return yml
    for c in candidates:
        if c.exists():
            return c
    return None


@pytest.mark.parametrize(
    "pipeline_dir,allow_key",
    [
        pytest.param(d, k, id=k)
        for d, k in _pipeline_dirs()
        if k not in ALLOW_LIST
    ],
)
def test_pipeline_has_workflow(pipeline_dir: Path, allow_key: str) -> None:
    """Every non-exempt pipeline dir must have a GHA workflow."""
    name = pipeline_dir.name
    workflow = _workflow_for(name)
    assert workflow is not None, (
        f"{allow_key}: no matching .github/workflows/*.yml found. "
        f"Run 'python -m ingest.scaffold --name={name} ...' to create one, "
        f"or add it to ALLOW_LIST with a 'covered in plan PR N' comment."
    )
    content = workflow.read_text(encoding="utf-8")

    assert "workflow_dispatch:" in content, (
        f"{workflow.name}: missing 'workflow_dispatch:' block. "
        "All ingest workflows must support manual dispatch (with dry_run input)."
    )

    assert "DESTINATION__POSTGRES__CREDENTIALS" in content, (
        f"{workflow.name}: missing DESTINATION__POSTGRES__CREDENTIALS in env block. "
        "All ingest workflows must declare this secret even if the pipeline is Tier 1 "
        "(tier1_inventory.upsert_inventory_row needs it)."
    )
