# BLS QCEW Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the BLS QCEW Tier 2 ingest pipeline and TS source connector that outputs `labor-swfl-summary` — private-sector vs total wages and employment YoY deltas for Florida, Lee County, and Collier County.

**Architecture:** Three BLS QCEW JSON API calls (one per area FIPS) fetch the latest available quarter AND the same quarter one year prior; rows are merged into `data_lake.bls_qcew` (30 rows at steady state). The TS connector runs three parallel Supabase queries, separates private-sector (`own_code="5"`) from total (`own_code="0"`), and computes YoY % for wages and employment in a `labor-swfl-summary` thin-pipe fragment.

**Tech Stack:** Python 3.12 + dlt + requests (ingest); TypeScript + Supabase JS client (connector); BLS QCEW Open Data API (no key required).

**Spec:** `docs/superpowers/specs/2026-05-18-bls-qcew-pipeline-design.md`

---

## File Map

| File                                         | Action | Responsibility                                              |
| -------------------------------------------- | ------ | ----------------------------------------------------------- |
| `ingest/pipelines/bls_qcew/__init__.py`      | Create | Package marker                                              |
| `ingest/pipelines/bls_qcew/constants.py`     | Create | FIPS codes + API base URL                                   |
| `ingest/pipelines/bls_qcew/resources.py`     | Create | Column hints, surrogate key, `_coerce_int`, `@dlt.resource` |
| `ingest/pipelines/bls_qcew/pipeline.py`      | Create | Quarter auto-detection, pipeline entry point                |
| `ingest/tests/test_bls_qcew.py`              | Create | Unit tests (pure functions + mocked HTTP)                   |
| `docs/sql/bls_qcew_grant.sql`                | Create | `GRANT SELECT ON data_lake.bls_qcew TO service_role`        |
| `refinery/__fixtures__/bls-qcew.sample.json` | Create | 30-row fixture (3 areas × 5 codes × 2 quarters)             |
| `refinery/sources/bls-qcew-source.mts`       | Create | TS connector — live fetch + fixture + fragment builder      |

---

## Task 1: Package skeleton + constants

**Files:**

- Create: `ingest/pipelines/bls_qcew/__init__.py`
- Create: `ingest/pipelines/bls_qcew/constants.py`

- [ ] **Step 1: Create package marker**

Create `ingest/pipelines/bls_qcew/__init__.py` — empty file.

- [ ] **Step 2: Create constants**

Create `ingest/pipelines/bls_qcew/constants.py`:

```python
BLS_QCEW_BASE_URL = "https://data.bls.gov/cew/data/api"

# Area FIPS codes for the three geographies we track
AREA_FIPS = {
    "florida":  "12000",
    "lee":      "12071",
    "collier":  "12021",
}
```

- [ ] **Step 3: Commit**

```bash
git add ingest/pipelines/bls_qcew/
git commit -m "feat(bls-qcew): scaffold package skeleton + FIPS constants"
```

---

## Task 2: TDD — surrogate key function

**Files:**

- Create: `ingest/tests/__init__.py` (if it doesn't exist — empty)
- Create: `ingest/tests/test_bls_qcew.py`
- Create: `ingest/pipelines/bls_qcew/resources.py` (stub — key function only)

The surrogate key uniquely identifies one ownership×industry×area×period row. dlt uses it for merge idempotency so re-runs don't duplicate rows.

- [ ] **Step 1: Write failing test**

Create `ingest/tests/test_bls_qcew.py`:

```python
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from pipelines.bls_qcew.resources import _make_id


def test_make_id_stable():
    row = {
        "area_fips": "12071",
        "own_code": "5",
        "industry_code": "10",
        "size_code": "0",
        "year": "2024",
        "qtr": "3",
    }
    assert _make_id(row) == "12071|5|10|0|2024|3"


def test_make_id_different_areas_differ():
    base = {"area_fips": "12071", "own_code": "0", "industry_code": "10",
            "size_code": "0", "year": "2024", "qtr": "3"}
    other = {**base, "area_fips": "12021"}
    assert _make_id(base) != _make_id(other)


def test_make_id_different_qtrs_differ():
    base = {"area_fips": "12071", "own_code": "0", "industry_code": "10",
            "size_code": "0", "year": "2024", "qtr": "3"}
    other = {**base, "qtr": "4"}
    assert _make_id(base) != _make_id(other)
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd ingest && pytest tests/test_bls_qcew.py -v
```

Expected: `ImportError: cannot import name '_make_id'`

- [ ] **Step 3: Create resources.py stub with key function**

Create `ingest/pipelines/bls_qcew/resources.py`:

```python
from datetime import datetime, timezone

import dlt
import requests

from .constants import BLS_QCEW_BASE_URL, AREA_FIPS


def _make_id(row: dict) -> str:
    return "|".join([
        str(row.get("area_fips", "")),
        str(row.get("own_code", "")),
        str(row.get("industry_code", "")),
        str(row.get("size_code", "")),
        str(row.get("year", "")),
        str(row.get("qtr", "")),
    ])
```

- [ ] **Step 4: Run tests — expect 3 PASS**

```bash
cd ingest && pytest tests/test_bls_qcew.py -v
```

Expected: `3 passed`

---

## Task 3: TDD — quarter auto-detection

**Files:**

- Modify: `ingest/tests/test_bls_qcew.py` (append 3 tests)
- Create: `ingest/pipelines/bls_qcew/pipeline.py` (detection function only)

QCEW lags ~5–6 months. The detector probes the BLS API backward from the previous calendar quarter until it gets a non-empty JSON array (max 6 attempts). `_now_year`/`_now_month` are test injection points to avoid datetime coupling.

- [ ] **Step 1: Append failing tests to test file**

Append to `ingest/tests/test_bls_qcew.py`:

```python
from unittest.mock import patch, MagicMock
from pipelines.bls_qcew.pipeline import _find_latest_quarter


def _mock_resp(ok=True, data=None):
    m = MagicMock()
    m.ok = ok
    m.json.return_value = data if data is not None else []
    return m


def test_find_latest_quarter_first_try():
    """Returns the first quarter back that has data."""
    # May 2026 → current = Q2 → start probe at Q1 2026
    with patch("pipelines.bls_qcew.pipeline.requests.get") as mock_get:
        mock_get.return_value = _mock_resp(data=[{"own_code": "0"}])
        year, qtr = _find_latest_quarter(probe_fips="12071", _now_year=2026, _now_month=5)
    assert year == 2026
    assert qtr == "1"


def test_find_latest_quarter_backoff():
    """Falls back to a prior quarter if the first probe returns empty."""
    responses = [
        _mock_resp(data=[]),                       # Q1 2026 empty
        _mock_resp(data=[{"own_code": "0"}]),      # Q4 2025 has data
    ]
    with patch("pipelines.bls_qcew.pipeline.requests.get", side_effect=responses):
        year, qtr = _find_latest_quarter(probe_fips="12071", _now_year=2026, _now_month=5)
    assert year == 2025
    assert qtr == "4"


def test_find_latest_quarter_raises_after_6():
    """Raises RuntimeError if no data found within 6 back-steps."""
    with patch("pipelines.bls_qcew.pipeline.requests.get") as mock_get:
        mock_get.return_value = _mock_resp(data=[])
        try:
            _find_latest_quarter(probe_fips="12071", _now_year=2026, _now_month=5)
            assert False, "Should have raised"
        except RuntimeError:
            pass
```

- [ ] **Step 2: Run new tests — expect FAIL**

```bash
cd ingest && pytest tests/test_bls_qcew.py -k "quarter" -v
```

Expected: `ImportError: cannot import name '_find_latest_quarter'`

- [ ] **Step 3: Create pipeline.py with detection function**

Create `ingest/pipelines/bls_qcew/pipeline.py`:

```python
import requests
from datetime import datetime, timezone

import dlt

from .constants import BLS_QCEW_BASE_URL, AREA_FIPS


def _find_latest_quarter(
    probe_fips: str = "12071",
    _now_year: int | None = None,
    _now_month: int | None = None,
) -> tuple[int, str]:
    """
    Back-step from the previous calendar quarter until BLS returns a
    non-empty JSON array for probe_fips. QCEW typically lags 2 quarters.
    _now_year/_now_month are injection points for unit tests.
    """
    now = datetime.now(timezone.utc)
    year = _now_year if _now_year is not None else now.year
    month = _now_month if _now_month is not None else now.month

    # Start one quarter before the current calendar quarter (current Q is never ready)
    qtr = (month - 1) // 3 + 1   # 1-4, current quarter
    qtr -= 1
    if qtr == 0:
        qtr, year = 4, year - 1

    for _ in range(6):
        url = f"{BLS_QCEW_BASE_URL}/{year}/q{qtr}/area/{probe_fips}.json"
        try:
            resp = requests.get(url, timeout=30)
            if resp.ok:
                data = resp.json()
                if isinstance(data, list) and data:
                    return year, str(qtr)
        except Exception:
            pass
        qtr -= 1
        if qtr == 0:
            qtr, year = 4, year - 1

    raise RuntimeError(
        "BLS QCEW: could not find latest available quarter within 6 back-steps"
    )


def run() -> None:
    from .resources import bls_qcew_resource  # local import so pipeline.py is importable before Task 4
    latest_year, latest_qtr = _find_latest_quarter()
    prior_year = latest_year - 1
    prior_qtr = latest_qtr   # same quarter number, one year back

    quarters: list[tuple[int, str]] = [(latest_year, latest_qtr), (prior_year, prior_qtr)]
    print(
        f"Ingesting BLS QCEW: "
        f"{latest_year}-Q{latest_qtr} + {prior_year}-Q{prior_qtr} "
        f"for {len(AREA_FIPS)} areas..."
    )

    pipeline = dlt.pipeline(
        pipeline_name="bls_qcew",
        destination="postgres",
        dataset_name="data_lake",
    )
    load_info = pipeline.run(bls_qcew_resource(quarters))
    load_info.raise_on_failed_jobs()
    print("BLS QCEW pipeline complete.")


if __name__ == "__main__":
    run()
```

Note: `bls_qcew_resource` does not exist yet — Task 4 adds it. The import will fail at module load unless the resource stub is present, but pytest only imports `_find_latest_quarter` so the test isolation holds.

- [ ] **Step 4: Run quarter tests — expect 3 PASS**

```bash
cd ingest && pytest tests/test_bls_qcew.py -k "quarter" -v
```

Expected: `3 passed`

---

## Task 4: dlt resource — column hints, coercion, `@dlt.resource`

**Files:**

- Modify: `ingest/pipelines/bls_qcew/resources.py` (replace stub with full implementation)

The BLS QCEW JSON API returns all values as strings. `_coerce_int` handles empty strings, spaces, and commas from the API before dlt writes bigint columns.

- [ ] **Step 1: Replace resources.py with full implementation**

Overwrite `ingest/pipelines/bls_qcew/resources.py` with:

```python
from datetime import datetime, timezone

import dlt
import requests

from .constants import BLS_QCEW_BASE_URL, AREA_FIPS


_BLS_QCEW_COLUMNS: dict = {
    "id":                {"data_type": "text",      "nullable": False, "primary_key": True},
    "area_fips":         {"data_type": "text",      "nullable": False},
    "own_code":          {"data_type": "text",      "nullable": False},
    "industry_code":     {"data_type": "text",      "nullable": False},
    "agglvl_code":       {"data_type": "text",      "nullable": True},
    "size_code":         {"data_type": "text",      "nullable": True},
    "year":              {"data_type": "bigint",    "nullable": False},
    "qtr":               {"data_type": "text",      "nullable": False},
    "area_title":        {"data_type": "text",      "nullable": True},
    "own_title":         {"data_type": "text",      "nullable": True},
    "industry_title":    {"data_type": "text",      "nullable": True},
    "qtrly_estabs":      {"data_type": "bigint",    "nullable": True},
    "month1_emplvl":     {"data_type": "bigint",    "nullable": True},
    "month2_emplvl":     {"data_type": "bigint",    "nullable": True},
    "month3_emplvl":     {"data_type": "bigint",    "nullable": True},
    "total_qtrly_wages": {"data_type": "bigint",    "nullable": True},
    "avg_wkly_wage":     {"data_type": "bigint",    "nullable": True},
    "_source_url":       {"data_type": "text",      "nullable": True},
    "_ingested_at":      {"data_type": "timestamp", "nullable": True},
}


def _make_id(row: dict) -> str:
    return "|".join([
        str(row.get("area_fips", "")),
        str(row.get("own_code", "")),
        str(row.get("industry_code", "")),
        str(row.get("size_code", "")),
        str(row.get("year", "")),
        str(row.get("qtr", "")),
    ])


def _coerce_int(v) -> int | None:
    if v in (None, "", " "):
        return None
    try:
        return int(str(v).replace(",", "").strip())
    except (ValueError, TypeError):
        return None


@dlt.resource(
    name="bls_qcew",
    write_disposition="merge",
    primary_key="id",
    columns=_BLS_QCEW_COLUMNS,
)
def bls_qcew_resource(quarters: list[tuple[int, str]]):
    """
    Fetches BLS QCEW JSON area files for the 3 SWFL geographies across
    the requested quarters. Filters to industry_code="10" (all industries).
    Stores all 5 ownership codes so the TS connector can isolate
    private-sector (own_code=5) from government wages.
    """
    ingested_at = datetime.now(timezone.utc).isoformat()

    for year, qtr in quarters:
        for _geo_key, fips in AREA_FIPS.items():
            url = f"{BLS_QCEW_BASE_URL}/{year}/q{qtr}/area/{fips}.json"
            resp = requests.get(url, timeout=60)
            resp.raise_for_status()

            for row in resp.json():
                if str(row.get("industry_code", "")).strip() != "10":
                    continue
                yield {
                    "id":                _make_id(row),
                    "area_fips":         str(row.get("area_fips", fips)),
                    "own_code":          str(row.get("own_code", "")),
                    "industry_code":     str(row.get("industry_code", "10")),
                    "agglvl_code":       str(row.get("agglvl_code", "")),
                    "size_code":         str(row.get("size_code", "0")),
                    "year":              int(row.get("year", year)),
                    "qtr":               str(row.get("qtr", qtr)),
                    "area_title":        row.get("area_title"),
                    "own_title":         row.get("own_title"),
                    "industry_title":    row.get("industry_title"),
                    "qtrly_estabs":      _coerce_int(row.get("qtrly_estabs")),
                    "month1_emplvl":     _coerce_int(row.get("month1_emplvl")),
                    "month2_emplvl":     _coerce_int(row.get("month2_emplvl")),
                    "month3_emplvl":     _coerce_int(row.get("month3_emplvl")),
                    "total_qtrly_wages": _coerce_int(row.get("total_qtrly_wages")),
                    "avg_wkly_wage":     _coerce_int(row.get("avg_wkly_wage")),
                    "_source_url":       url,
                    "_ingested_at":      ingested_at,
                }
```

- [ ] **Step 2: Verify all 6 Python tests still pass**

```bash
cd ingest && pytest tests/test_bls_qcew.py -v
```

Expected: `6 passed`

- [ ] **Step 3: Commit**

```bash
git add ingest/pipelines/bls_qcew/ ingest/tests/
git commit -m "feat(bls-qcew): dlt merge pipeline — quarter detection, resource, column hints"
```

---

## Task 5: SQL grant

**Files:**

- Create: `docs/sql/bls_qcew_grant.sql`

- [ ] **Step 1: Create grant file**

Create `docs/sql/bls_qcew_grant.sql`:

```sql
-- Grant brain-platform's service_role read access to the Tier 2 BLS QCEW table.
-- Apply ONCE after the first dlt run creates data_lake.bls_qcew
-- (python -m ingest.pipelines.bls_qcew.pipeline from brain-platform/ingest/).
--
-- Brain-platform's Supabase key is service_role (not anon). Without USAGE on
-- the schema + SELECT on the table, the bls-qcew-source connector returns 0
-- rows silently. See memory: feedback_premise-engine-supabase-roles.md.
--
-- Schema is auto-created by dlt with the 19 columns pinned in
-- ingest/pipelines/bls_qcew/resources.py:_BLS_QCEW_COLUMNS.
-- Primary key: surrogate "id" (pipe-delimited: area_fips|own_code|industry_code|size_code|year|qtr).
-- write_disposition="merge": 30 rows at steady state (3 areas × 5 ownership codes × 2 quarters).

GRANT USAGE ON SCHEMA data_lake TO service_role;
GRANT SELECT ON data_lake.bls_qcew TO service_role;
```

- [ ] **Step 2: Commit**

```bash
git add docs/sql/bls_qcew_grant.sql
git commit -m "feat(bls-qcew): add Supabase service_role grant SQL"
```

---

## Task 6: Fixture file

**Files:**

- Create: `refinery/__fixtures__/bls-qcew.sample.json`

The fixture covers exactly what the TS connector needs: both quarters (2024-Q3 and 2025-Q3 as stand-ins), all 5 `own_code` values, for all 3 FIPS. Numbers are realistic for the SWFL market. The connector's smoke test will confirm non-null YoY fields from this fixture.

- [ ] **Step 1: Create fixture**

Create `refinery/__fixtures__/bls-qcew.sample.json`:

```json
{
  "records": [
    {
      "area_fips": "12000",
      "own_code": "0",
      "industry_code": "10",
      "agglvl_code": "50",
      "size_code": "0",
      "year": 2024,
      "qtr": "3",
      "area_title": "Florida -- Statewide",
      "own_title": "Total Covered",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 725000,
      "month1_emplvl": 10100000,
      "month2_emplvl": 10200000,
      "month3_emplvl": 10300000,
      "total_qtrly_wages": 158000000000,
      "avg_wkly_wage": 1210
    },
    {
      "area_fips": "12000",
      "own_code": "5",
      "industry_code": "10",
      "agglvl_code": "50",
      "size_code": "0",
      "year": 2024,
      "qtr": "3",
      "area_title": "Florida -- Statewide",
      "own_title": "Private",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 685000,
      "month1_emplvl": 8900000,
      "month2_emplvl": 8950000,
      "month3_emplvl": 9000000,
      "total_qtrly_wages": 126000000000,
      "avg_wkly_wage": 1105
    },
    {
      "area_fips": "12000",
      "own_code": "1",
      "industry_code": "10",
      "agglvl_code": "50",
      "size_code": "0",
      "year": 2024,
      "qtr": "3",
      "area_title": "Florida -- Statewide",
      "own_title": "Federal Government",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 3200,
      "month1_emplvl": 110000,
      "month2_emplvl": 111000,
      "month3_emplvl": 112000,
      "total_qtrly_wages": 2100000000,
      "avg_wkly_wage": 1480
    },
    {
      "area_fips": "12000",
      "own_code": "2",
      "industry_code": "10",
      "agglvl_code": "50",
      "size_code": "0",
      "year": 2024,
      "qtr": "3",
      "area_title": "Florida -- Statewide",
      "own_title": "State Government",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 4500,
      "month1_emplvl": 380000,
      "month2_emplvl": 382000,
      "month3_emplvl": 385000,
      "total_qtrly_wages": 5800000000,
      "avg_wkly_wage": 1190
    },
    {
      "area_fips": "12000",
      "own_code": "3",
      "industry_code": "10",
      "agglvl_code": "50",
      "size_code": "0",
      "year": 2024,
      "qtr": "3",
      "area_title": "Florida -- Statewide",
      "own_title": "Local Government",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 32000,
      "month1_emplvl": 710000,
      "month2_emplvl": 713000,
      "month3_emplvl": 715000,
      "total_qtrly_wages": 10100000000,
      "avg_wkly_wage": 1115
    },
    {
      "area_fips": "12000",
      "own_code": "0",
      "industry_code": "10",
      "agglvl_code": "50",
      "size_code": "0",
      "year": 2025,
      "qtr": "3",
      "area_title": "Florida -- Statewide",
      "own_title": "Total Covered",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 738000,
      "month1_emplvl": 10250000,
      "month2_emplvl": 10350000,
      "month3_emplvl": 10450000,
      "total_qtrly_wages": 165000000000,
      "avg_wkly_wage": 1248
    },
    {
      "area_fips": "12000",
      "own_code": "5",
      "industry_code": "10",
      "agglvl_code": "50",
      "size_code": "0",
      "year": 2025,
      "qtr": "3",
      "area_title": "Florida -- Statewide",
      "own_title": "Private",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 698000,
      "month1_emplvl": 9050000,
      "month2_emplvl": 9100000,
      "month3_emplvl": 9150000,
      "total_qtrly_wages": 132000000000,
      "avg_wkly_wage": 1138
    },
    {
      "area_fips": "12000",
      "own_code": "1",
      "industry_code": "10",
      "agglvl_code": "50",
      "size_code": "0",
      "year": 2025,
      "qtr": "3",
      "area_title": "Florida -- Statewide",
      "own_title": "Federal Government",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 3250,
      "month1_emplvl": 112000,
      "month2_emplvl": 113000,
      "month3_emplvl": 114000,
      "total_qtrly_wages": 2200000000,
      "avg_wkly_wage": 1524
    },
    {
      "area_fips": "12000",
      "own_code": "2",
      "industry_code": "10",
      "agglvl_code": "50",
      "size_code": "0",
      "year": 2025,
      "qtr": "3",
      "area_title": "Florida -- Statewide",
      "own_title": "State Government",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 4550,
      "month1_emplvl": 385000,
      "month2_emplvl": 387000,
      "month3_emplvl": 390000,
      "total_qtrly_wages": 6100000000,
      "avg_wkly_wage": 1238
    },
    {
      "area_fips": "12000",
      "own_code": "3",
      "industry_code": "10",
      "agglvl_code": "50",
      "size_code": "0",
      "year": 2025,
      "qtr": "3",
      "area_title": "Florida -- Statewide",
      "own_title": "Local Government",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 32500,
      "month1_emplvl": 720000,
      "month2_emplvl": 723000,
      "month3_emplvl": 726000,
      "total_qtrly_wages": 10600000000,
      "avg_wkly_wage": 1155
    },
    {
      "area_fips": "12071",
      "own_code": "0",
      "industry_code": "10",
      "agglvl_code": "70",
      "size_code": "0",
      "year": 2024,
      "qtr": "3",
      "area_title": "Lee County, Florida",
      "own_title": "Total Covered",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 21800,
      "month1_emplvl": 278000,
      "month2_emplvl": 281000,
      "month3_emplvl": 285000,
      "total_qtrly_wages": 3380000000,
      "avg_wkly_wage": 934
    },
    {
      "area_fips": "12071",
      "own_code": "5",
      "industry_code": "10",
      "agglvl_code": "70",
      "size_code": "0",
      "year": 2024,
      "qtr": "3",
      "area_title": "Lee County, Florida",
      "own_title": "Private",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 20900,
      "month1_emplvl": 250000,
      "month2_emplvl": 253000,
      "month3_emplvl": 256000,
      "total_qtrly_wages": 2920000000,
      "avg_wkly_wage": 898
    },
    {
      "area_fips": "12071",
      "own_code": "1",
      "industry_code": "10",
      "agglvl_code": "70",
      "size_code": "0",
      "year": 2024,
      "qtr": "3",
      "area_title": "Lee County, Florida",
      "own_title": "Federal Government",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 120,
      "month1_emplvl": 4200,
      "month2_emplvl": 4250,
      "month3_emplvl": 4300,
      "total_qtrly_wages": 85000000,
      "avg_wkly_wage": 1556
    },
    {
      "area_fips": "12071",
      "own_code": "2",
      "industry_code": "10",
      "agglvl_code": "70",
      "size_code": "0",
      "year": 2024,
      "qtr": "3",
      "area_title": "Lee County, Florida",
      "own_title": "State Government",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 95,
      "month1_emplvl": 9800,
      "month2_emplvl": 9850,
      "month3_emplvl": 9900,
      "total_qtrly_wages": 148000000,
      "avg_wkly_wage": 1182
    },
    {
      "area_fips": "12071",
      "own_code": "3",
      "industry_code": "10",
      "agglvl_code": "70",
      "size_code": "0",
      "year": 2024,
      "qtr": "3",
      "area_title": "Lee County, Florida",
      "own_title": "Local Government",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 685,
      "month1_emplvl": 14000,
      "month2_emplvl": 14100,
      "month3_emplvl": 14200,
      "total_qtrly_wages": 227000000,
      "avg_wkly_wage": 1264
    },
    {
      "area_fips": "12071",
      "own_code": "0",
      "industry_code": "10",
      "agglvl_code": "70",
      "size_code": "0",
      "year": 2025,
      "qtr": "3",
      "area_title": "Lee County, Florida",
      "own_title": "Total Covered",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 22400,
      "month1_emplvl": 282000,
      "month2_emplvl": 285000,
      "month3_emplvl": 289000,
      "total_qtrly_wages": 3540000000,
      "avg_wkly_wage": 965
    },
    {
      "area_fips": "12071",
      "own_code": "5",
      "industry_code": "10",
      "agglvl_code": "70",
      "size_code": "0",
      "year": 2025,
      "qtr": "3",
      "area_title": "Lee County, Florida",
      "own_title": "Private",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 21500,
      "month1_emplvl": 254000,
      "month2_emplvl": 257000,
      "month3_emplvl": 260000,
      "total_qtrly_wages": 3060000000,
      "avg_wkly_wage": 927
    },
    {
      "area_fips": "12071",
      "own_code": "1",
      "industry_code": "10",
      "agglvl_code": "70",
      "size_code": "0",
      "year": 2025,
      "qtr": "3",
      "area_title": "Lee County, Florida",
      "own_title": "Federal Government",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 122,
      "month1_emplvl": 4300,
      "month2_emplvl": 4350,
      "month3_emplvl": 4400,
      "total_qtrly_wages": 90000000,
      "avg_wkly_wage": 1607
    },
    {
      "area_fips": "12071",
      "own_code": "2",
      "industry_code": "10",
      "agglvl_code": "70",
      "size_code": "0",
      "year": 2025,
      "qtr": "3",
      "area_title": "Lee County, Florida",
      "own_title": "State Government",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 97,
      "month1_emplvl": 9900,
      "month2_emplvl": 9950,
      "month3_emplvl": 10000,
      "total_qtrly_wages": 156000000,
      "avg_wkly_wage": 1231
    },
    {
      "area_fips": "12071",
      "own_code": "3",
      "industry_code": "10",
      "agglvl_code": "70",
      "size_code": "0",
      "year": 2025,
      "qtr": "3",
      "area_title": "Lee County, Florida",
      "own_title": "Local Government",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 698,
      "month1_emplvl": 14200,
      "month2_emplvl": 14300,
      "month3_emplvl": 14400,
      "total_qtrly_wages": 238000000,
      "avg_wkly_wage": 1307
    },
    {
      "area_fips": "12021",
      "own_code": "0",
      "industry_code": "10",
      "agglvl_code": "70",
      "size_code": "0",
      "year": 2024,
      "qtr": "3",
      "area_title": "Collier County, Florida",
      "own_title": "Total Covered",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 18200,
      "month1_emplvl": 161000,
      "month2_emplvl": 163000,
      "month3_emplvl": 166000,
      "total_qtrly_wages": 2310000000,
      "avg_wkly_wage": 1099
    },
    {
      "area_fips": "12021",
      "own_code": "5",
      "industry_code": "10",
      "agglvl_code": "70",
      "size_code": "0",
      "year": 2024,
      "qtr": "3",
      "area_title": "Collier County, Florida",
      "own_title": "Private",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 17600,
      "month1_emplvl": 144000,
      "month2_emplvl": 146000,
      "month3_emplvl": 148000,
      "total_qtrly_wages": 1980000000,
      "avg_wkly_wage": 1056
    },
    {
      "area_fips": "12021",
      "own_code": "1",
      "industry_code": "10",
      "agglvl_code": "70",
      "size_code": "0",
      "year": 2024,
      "qtr": "3",
      "area_title": "Collier County, Florida",
      "own_title": "Federal Government",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 85,
      "month1_emplvl": 2800,
      "month2_emplvl": 2850,
      "month3_emplvl": 2900,
      "total_qtrly_wages": 64000000,
      "avg_wkly_wage": 1741
    },
    {
      "area_fips": "12021",
      "own_code": "2",
      "industry_code": "10",
      "agglvl_code": "70",
      "size_code": "0",
      "year": 2024,
      "qtr": "3",
      "area_title": "Collier County, Florida",
      "own_title": "State Government",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 72,
      "month1_emplvl": 5600,
      "month2_emplvl": 5650,
      "month3_emplvl": 5700,
      "total_qtrly_wages": 99000000,
      "avg_wkly_wage": 1369
    },
    {
      "area_fips": "12021",
      "own_code": "3",
      "industry_code": "10",
      "agglvl_code": "70",
      "size_code": "0",
      "year": 2024,
      "qtr": "3",
      "area_title": "Collier County, Florida",
      "own_title": "Local Government",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 443,
      "month1_emplvl": 8600,
      "month2_emplvl": 8650,
      "month3_emplvl": 8700,
      "total_qtrly_wages": 167000000,
      "avg_wkly_wage": 1516
    },
    {
      "area_fips": "12021",
      "own_code": "0",
      "industry_code": "10",
      "agglvl_code": "70",
      "size_code": "0",
      "year": 2025,
      "qtr": "3",
      "area_title": "Collier County, Florida",
      "own_title": "Total Covered",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 18700,
      "month1_emplvl": 163000,
      "month2_emplvl": 165000,
      "month3_emplvl": 168000,
      "total_qtrly_wages": 2430000000,
      "avg_wkly_wage": 1141
    },
    {
      "area_fips": "12021",
      "own_code": "5",
      "industry_code": "10",
      "agglvl_code": "70",
      "size_code": "0",
      "year": 2025,
      "qtr": "3",
      "area_title": "Collier County, Florida",
      "own_title": "Private",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 18100,
      "month1_emplvl": 146000,
      "month2_emplvl": 148000,
      "month3_emplvl": 150000,
      "total_qtrly_wages": 2090000000,
      "avg_wkly_wage": 1091
    },
    {
      "area_fips": "12021",
      "own_code": "1",
      "industry_code": "10",
      "agglvl_code": "70",
      "size_code": "0",
      "year": 2025,
      "qtr": "3",
      "area_title": "Collier County, Florida",
      "own_title": "Federal Government",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 87,
      "month1_emplvl": 2850,
      "month2_emplvl": 2900,
      "month3_emplvl": 2950,
      "total_qtrly_wages": 68000000,
      "avg_wkly_wage": 1815
    },
    {
      "area_fips": "12021",
      "own_code": "2",
      "industry_code": "10",
      "agglvl_code": "70",
      "size_code": "0",
      "year": 2025,
      "qtr": "3",
      "area_title": "Collier County, Florida",
      "own_title": "State Government",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 74,
      "month1_emplvl": 5700,
      "month2_emplvl": 5750,
      "month3_emplvl": 5800,
      "total_qtrly_wages": 105000000,
      "avg_wkly_wage": 1422
    },
    {
      "area_fips": "12021",
      "own_code": "3",
      "industry_code": "10",
      "agglvl_code": "70",
      "size_code": "0",
      "year": 2025,
      "qtr": "3",
      "area_title": "Collier County, Florida",
      "own_title": "Local Government",
      "industry_title": "Total, All Industries",
      "qtrly_estabs": 452,
      "month1_emplvl": 8700,
      "month2_emplvl": 8750,
      "month3_emplvl": 8800,
      "total_qtrly_wages": 176000000,
      "avg_wkly_wage": 1577
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add refinery/__fixtures__/bls-qcew.sample.json
git commit -m "feat(bls-qcew): fixture — 30 rows (3 areas × 5 ownership codes × 2 quarters)"
```

---

## Task 7: TS source connector

**Files:**

- Create: `refinery/sources/bls-qcew-source.mts`

Mirrors the structure of `refinery/sources/fhfa-hpi-source.mts`. Two fragment types: `bls-qcew-record` (one per DB row) and `labor-swfl-summary` (thin-pipe rollup with private-sector YoY).

The file includes a runnable smoke-test block at the bottom (guarded by `import.meta.url`) that prints the summary fragment when executed directly.

- [ ] **Step 1: Create connector**

Create `refinery/sources/bls-qcew-source.mts`:

```typescript
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RawFragment } from "../types/fragment.mts";
import type { SourceConnector, CitationRow } from "../types/pack.mts";
import { env } from "../config/env.mts";
import { getSupabase } from "./supabase.mts";
import { fragmentId } from "../lib/ids.mts";
import { isoTimestamp, expiresDate } from "../lib/dates.mts";

/**
 * BLS QCEW source connector.
 *
 * Live mode: queries data_lake.bls_qcew (Tier 2, populated by
 * ingest/pipelines/bls_qcew/pipeline.py). Three parallel Supabase queries —
 * one per area FIPS (FL state, Lee County, Collier County). The table holds
 * the latest available quarter AND the same quarter one year prior, enabling
 * deterministic YoY wage and employment deltas.
 *
 * Fixture mode: reads refinery/__fixtures__/bls-qcew.sample.json.
 *
 * Private-sector (own_code="5") is the primary signal for CRE/franchise
 * purchasing-power models — government wages (codes "1"/"2"/"3") are stored
 * but not surfaced in the thin-pipe summary.
 */

const SOURCE_ID = "bls_qcew";
const SCHEMA = "data_lake";
const TABLE = "bls_qcew";
const API_BASE = "https://data.bls.gov/cew/data/api";

const FL_FIPS = "12000";
const LEE_FIPS = "12071";
const COLLIER_FIPS = "12021";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "refinery",
  "__fixtures__",
  "bls-qcew.sample.json",
);

// ── Types ──────────────────────────────────────────────────────────────────────

interface DbRow {
  area_fips: string;
  own_code: string;
  industry_code: string;
  year: number;
  qtr: string;
  area_title: string | null;
  own_title: string | null;
  qtrly_estabs: number | null;
  month1_emplvl: number | null;
  month2_emplvl: number | null;
  month3_emplvl: number | null;
  total_qtrly_wages: number | null;
  avg_wkly_wage: number | null;
}

interface AreaMetrics {
  avg_wkly_wage: number | null;
  avg_wkly_wage_yoy_pct: number | null;
  month3_emplvl: number | null;
  employment_yoy_pct: number | null;
  qtrly_estabs: number | null;
  total_qtrly_wages: number | null;
}

interface AreaTotalMetrics {
  avg_wkly_wage: number | null;
  month3_emplvl: number | null;
  qtrly_estabs: number | null;
}

interface AreaSummary {
  private: AreaMetrics;
  total: AreaTotalMetrics;
}

export interface LaborSwflSummary {
  kind: "labor-swfl-summary";
  latest_quarter: string | null;
  prior_quarter: string | null;
  fl_state: AreaSummary;
  lee_county: AreaSummary;
  collier_county: AreaSummary;
}

export interface QcewRecord {
  kind: "bls-qcew-record";
  area_fips: string;
  own_code: string;
  year: number;
  qtr: string;
  avg_wkly_wage: number | null;
  month3_emplvl: number | null;
  qtrly_estabs: number | null;
  total_qtrly_wages: number | null;
}

// ── Computation helpers ────────────────────────────────────────────────────────

function toQtrString(year: number, qtr: string): string {
  return `${year}-Q${qtr}`;
}

function yoyPct(latest: number | null, prior: number | null): number | null {
  if (latest == null || prior == null || prior === 0) return null;
  return Math.round(((latest - prior) / prior) * 100 * 100) / 100;
}

function computeAreaSummary(
  rows: DbRow[],
  fips: string,
): { summary: AreaSummary; latestQtr: string | null; priorQtr: string | null } {
  const areaRows = rows.filter((r) => r.area_fips === fips);

  const qtrs = [
    ...new Set(areaRows.map((r) => toQtrString(r.year, r.qtr))),
  ].sort();
  const latestQtr = qtrs[qtrs.length - 1] ?? null;
  const priorQtr = qtrs[qtrs.length - 2] ?? null;

  const findRow = (qtrStr: string | null, ownCode: string): DbRow | null => {
    if (!qtrStr) return null;
    const [yr, q] = qtrStr.split("-Q");
    return (
      areaRows.find(
        (r) => r.year === Number(yr) && r.qtr === q && r.own_code === ownCode,
      ) ?? null
    );
  };

  const latestPrivate = findRow(latestQtr, "5");
  const priorPrivate = findRow(priorQtr, "5");
  const latestTotal = findRow(latestQtr, "0");

  return {
    latestQtr,
    priorQtr,
    summary: {
      private: {
        avg_wkly_wage: latestPrivate?.avg_wkly_wage ?? null,
        avg_wkly_wage_yoy_pct: yoyPct(
          latestPrivate?.avg_wkly_wage ?? null,
          priorPrivate?.avg_wkly_wage ?? null,
        ),
        month3_emplvl: latestPrivate?.month3_emplvl ?? null,
        employment_yoy_pct: yoyPct(
          latestPrivate?.month3_emplvl ?? null,
          priorPrivate?.month3_emplvl ?? null,
        ),
        qtrly_estabs: latestPrivate?.qtrly_estabs ?? null,
        total_qtrly_wages: latestPrivate?.total_qtrly_wages ?? null,
      },
      total: {
        avg_wkly_wage: latestTotal?.avg_wkly_wage ?? null,
        month3_emplvl: latestTotal?.month3_emplvl ?? null,
        qtrly_estabs: latestTotal?.qtrly_estabs ?? null,
      },
    },
  };
}

function buildLaborSwflSummary(rows: DbRow[]): LaborSwflSummary {
  const fl = computeAreaSummary(rows, FL_FIPS);
  const lee = computeAreaSummary(rows, LEE_FIPS);
  const collier = computeAreaSummary(rows, COLLIER_FIPS);

  return {
    kind: "labor-swfl-summary",
    latest_quarter: lee.latestQtr, // Lee County is the primary market ref
    prior_quarter: lee.priorQtr,
    fl_state: fl.summary,
    lee_county: lee.summary,
    collier_county: collier.summary,
  };
}

// ── Live fetch ─────────────────────────────────────────────────────────────────

const COLS =
  "area_fips,own_code,industry_code,year,qtr,area_title,own_title," +
  "qtrly_estabs,month1_emplvl,month2_emplvl,month3_emplvl,total_qtrly_wages,avg_wkly_wage";

async function fetchLive(): Promise<DbRow[]> {
  const sb = getSupabase().schema(SCHEMA);

  const [flResp, leeResp, collierResp] = await Promise.all([
    sb
      .from(TABLE)
      .select(COLS)
      .eq("area_fips", FL_FIPS)
      .order("year")
      .order("qtr"),
    sb
      .from(TABLE)
      .select(COLS)
      .eq("area_fips", LEE_FIPS)
      .order("year")
      .order("qtr"),
    sb
      .from(TABLE)
      .select(COLS)
      .eq("area_fips", COLLIER_FIPS)
      .order("year")
      .order("qtr"),
  ]);

  if (flResp.error)
    throw new Error(
      `bls-qcew-source: FL query failed — ${flResp.error.message}`,
    );
  if (leeResp.error)
    throw new Error(
      `bls-qcew-source: Lee query failed — ${leeResp.error.message}`,
    );
  if (collierResp.error)
    throw new Error(
      `bls-qcew-source: Collier query failed — ${collierResp.error.message}`,
    );

  return [
    ...((flResp.data ?? []) as DbRow[]),
    ...((leeResp.data ?? []) as DbRow[]),
    ...((collierResp.data ?? []) as DbRow[]),
  ];
}

// ── Fixture ────────────────────────────────────────────────────────────────────

interface FixtureShape {
  records: DbRow[];
}

async function loadFixture(): Promise<DbRow[]> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  const data = JSON.parse(raw) as FixtureShape;
  return data.records;
}

// ── Connector ──────────────────────────────────────────────────────────────────

export const blsQcewSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 1,

  async fetch(): Promise<RawFragment[]> {
    const rows =
      env.source === "fixture" ? await loadFixture() : await fetchLive();

    const fetched_at = isoTimestamp();
    const fragments: RawFragment[] = [];

    for (const r of rows) {
      const norm: QcewRecord = {
        kind: "bls-qcew-record",
        area_fips: r.area_fips,
        own_code: r.own_code,
        year: r.year,
        qtr: r.qtr,
        avg_wkly_wage: r.avg_wkly_wage,
        month3_emplvl: r.month3_emplvl,
        qtrly_estabs: r.qtrly_estabs,
        total_qtrly_wages: r.total_qtrly_wages,
      };
      fragments.push({
        fragment_id: fragmentId(
          SOURCE_ID,
          `${r.area_fips}-${r.own_code}-${r.year}-${r.qtr}`,
        ),
        source_id: SOURCE_ID,
        source_trust_tier: 1,
        fetched_at,
        raw: {
          area_fips: r.area_fips,
          own_code: r.own_code,
          year: r.year,
          qtr: r.qtr,
        },
        normalized: norm,
      });
    }

    const summary = buildLaborSwflSummary(rows);
    fragments.push({
      fragment_id: fragmentId(SOURCE_ID, "labor-swfl-summary"),
      source_id: SOURCE_ID,
      source_trust_tier: 1,
      fetched_at,
      raw: {
        latest_quarter: summary.latest_quarter,
        prior_quarter: summary.prior_quarter,
      },
      normalized: summary,
    });

    return fragments;
  },

  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    const isLive = env.source !== "fixture";
    return {
      source: isLive
        ? `BLS Quarterly Census of Employment and Wages via data_lake.bls_qcew (${API_BASE}/{year}/q{qtr}/area/{fips}.json; FL state + Lee County + Collier County, all industries, all ownership codes, merge-tracked 2 quarters)`
        : `BLS QCEW (fixture; bls-qcew.sample.json, 30 rows)`,
      verified: verifiedDate,
      expires: expiresDate(verifiedDate, ttlSeconds),
    };
  },
};

// ── Smoke-test entry point ─────────────────────────────────────────────────────
// Windows PowerShell: $env:REFINERY_SOURCE="fixture"; npx tsx refinery/sources/bls-qcew-source.mts
// Bash/zsh:          REFINERY_SOURCE=fixture npx tsx refinery/sources/bls-qcew-source.mts

if (
  process.argv[1] &&
  import.meta.url.endsWith(path.basename(process.argv[1]))
) {
  blsQcewSource.fetch().then((fragments) => {
    const summary = fragments.find(
      (f) => (f.normalized as { kind?: string }).kind === "labor-swfl-summary",
    );
    console.log(JSON.stringify(summary?.normalized ?? null, null, 2));
    console.log(`\nTotal fragments: ${fragments.length}`);
  });
}
```

- [ ] **Step 2: Run fixture smoke test**

On Windows PowerShell:

```powershell
$env:REFINERY_SOURCE = "fixture"
npx tsx refinery/sources/bls-qcew-source.mts
```

On bash:

```bash
REFINERY_SOURCE=fixture npx tsx refinery/sources/bls-qcew-source.mts
```

Expected output:

```json
{
  "kind": "labor-swfl-summary",
  "latest_quarter": "2025-Q3",
  "prior_quarter": "2024-Q3",
  "fl_state": {
    "private": {
      "avg_wkly_wage": 1138,
      "avg_wkly_wage_yoy_pct": 2.99,
      "month3_emplvl": 9150000,
      "employment_yoy_pct": 1.67,
      "qtrly_estabs": 698000,
      "total_qtrly_wages": 132000000000
    },
    "total": { "avg_wkly_wage": 1248, "month3_emplvl": 10450000, "qtrly_estabs": 738000 }
  },
  "lee_county": {
    "private": {
      "avg_wkly_wage": 927,
      "avg_wkly_wage_yoy_pct": 3.23,
      "month3_emplvl": 260000,
      "employment_yoy_pct": 1.56,
      "qtrly_estabs": 21500,
      "total_qtrly_wages": 3060000000
    },
    "total": { "avg_wkly_wage": 965, "month3_emplvl": 289000, "qtrly_estabs": 22400 }
  },
  "collier_county": { ... }
}

Total fragments: 31
```

- [ ] **Step 3: Commit**

```bash
git add refinery/sources/bls-qcew-source.mts
git commit -m "feat(bls-qcew): TS source connector — LaborSwflSummary with private-sector YoY"
```

---

## Task 8: Final verification + wrap-up commit

- [ ] **Step 1: Confirm all Python tests green**

```bash
cd ingest && pytest tests/test_bls_qcew.py -v
```

Expected: `6 passed, 0 failed`

- [ ] **Step 2: Confirm fixture smoke test clean**

Re-run the smoke test from Task 7 Step 2. Confirm:

- `latest_quarter` and `prior_quarter` are both non-null
- `lee_county.private.avg_wkly_wage_yoy_pct` is non-null (proves YoY path works)
- `Total fragments: 31` (30 record fragments + 1 summary)

- [ ] **Step 3: Wrap-up commit**

```bash
git add docs/superpowers/plans/2026-05-18-bls-qcew-pipeline.md docs/superpowers/specs/2026-05-18-bls-qcew-pipeline-design.md
git commit -m "docs(bls-qcew): add spec + implementation plan

Next step: python -m ingest.pipelines.bls_qcew.pipeline (from ingest/)
then apply docs/sql/bls_qcew_grant.sql in Supabase SQL editor."
```

---

## Post-implementation checklist (manual, not in this plan)

After dlt ingest runs against live Supabase:

1. Apply `docs/sql/bls_qcew_grant.sql` in the Supabase SQL editor
2. Run `REFINERY_SOURCE=live npx tsx refinery/sources/bls-qcew-source.mts` — confirm live data shape matches fixture shape
3. Wire `blsQcewSource` into `macro-swfl` pack in a follow-on sprint
