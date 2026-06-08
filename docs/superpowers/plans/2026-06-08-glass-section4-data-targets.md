# The Glass §4 — `data_targets` generator + table — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate the auto-ranked "Shopping List" that feeds The Glass Pane 4 — a `data_targets` table populated nightly with every data gap the system can detect (stale sources, low-skill slugs, under-sampled slugs, deliberately-excluded-but-wanted signals, and the §6 falsifiability gap), each carrying its N.

**Architecture:** A single Python generator (`ingest/scripts/generate_data_targets.py`) reads five gap sources over **one direct-Postgres connection** — reusing `check_freshness`'s registry+probe for staleness (no re-implementation), a new `backtest_skill_by_slug` SQL view for per-slug lift (faithfully mirrors `computeSkillScore`), and `backtest_grades`/`predictions`/`grade_accuracy_by_slug` for counts — then **upserts ranked rows and auto-drops resolved ones** (mirroring `sync_gap_checks`). It writes `public.data_targets` (GRANT `service_role` only — internal, never `anon`). A nightly GHA + `--dry-run` ships in the same PR.

**Tech Stack:** Python 3.13, `psycopg[binary]>=3.2`, `pyyaml` (already in `ingest/requirements.txt`); pytest for the pure logic; SQL migration applied via psycopg per RULE 1.

---

## Why Python (decision, do not re-litigate)

`data_lake._dlt_loads` / `data_lake._tier1_inventory` (the staleness inputs) are **not PostgREST-exposed** — the freshness probe reads them over **direct Postgres**, not the Supabase JS client. `check_freshness.py` already exposes `_get_connection()`, `load_registry()`, and `run_probe()` returning `STALE`/`MISSING`/`LOW_VOLUME` status dicts. Reusing them is the whole "stale" half for free. The only non-trivial math (per-slug persistence-null lift) is pushed into a SQL view so Python never re-implements `computeSkillScore`. A TS generator would need two clients (PostgREST + raw PG) and a freshness re-impl — strictly worse.

## Pinned design decisions

- **Table `public.data_targets`** — natural key `target_key` (UNIQUE) for idempotent upsert; `source IN ('generator','manual')` so the generator's auto-drop never deletes an operator's manual row. `GRANT SELECT TO service_role` only (Glass guardrail 3: retrodicted-derived numbers stay internal).
- **View `public.backtest_skill_by_slug`** — per-slug `n`, `system_accuracy`, `persistence_accuracy`, `lift`, computed with `LAG(observed_direction)`. **Mirrors `computeSkillScore`'s locked denominator** (non-first-per-slug `AND` non-neutral target; a neutral *prior* counts as a persistence miss). Reconciled against the canonical TS scorer in Task 5. `GRANT service_role` only.
- **Five gap kinds** (DECISION-4 thresholds + the §6 trigger): `stale` (probe `STALE`/`MISSING`/`LOW_VOLUME`, threshold already = `cadence × tolerance`, default 2×), `low_skill` (`lift ≤ 0` over `n ≥ 15`), `low_n` (`n < 30` graded calls but `> 0`), `excluded_wanted` (the DIAL-2 ⛔ seeds), `falsifiability_gap` (a brain where ungradeable ≥ 40% of its **claim-bearing** predictions — `pending` husks excluded, matching Pane 2).
- **Auto-drop** — each run computes the current target set; generator rows whose key is no longer current are DELETEd (the list is a live shopping list, not a ledger). Manual rows survive.
- **Cadence** — daily `schedule` at 14:30 UTC (just after the 14:00 freshness probe) + `workflow_dispatch(dry_run)`. Reads only; no rebuild dependency. **Not** added to `cadence_registry.yaml` (it is a derived internal table, not an ingest source — so it is not an ODD surface and the probe must not watch it).

## File Structure

- **Create `docs/sql/20260608_data_targets.sql`** — the table + the view + grants. Idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE VIEW`). One responsibility: the §4 DB surface.
- **Create `ingest/scripts/generate_data_targets.py`** — the generator. Pure builders (testable, no I/O) + a thin DB-glue `main()`.
- **Create `ingest/tests/scripts/test_generate_data_targets.py`** — pytest over the pure builders (mirrors `test_check_freshness.py`).
- **Create `.github/workflows/data-targets-daily.yml`** — nightly + `--dry-run` (mirrors `freshness-probe-daily.yml`).

---

### Task 1: Migration — `data_targets` table + `backtest_skill_by_slug` view

**Files:**
- Create: `docs/sql/20260608_data_targets.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 20260608_data_targets.sql
-- The Glass §4 — the auto-generated "Shopping List" surface.
--
-- Two objects:
--   1. public.data_targets   — ranked data-gap rows, upserted nightly by
--      ingest/scripts/generate_data_targets.py. Internal (Pane 4 reads it with the
--      service-role key); NEVER granted to anon (Glass guardrail 3 — a retrodicted-
--      derived number is not a public accuracy claim).
--   2. public.backtest_skill_by_slug — per-slug skill (lift over a persistence null),
--      a SQL re-expression of refinery/lib/backtest/skill-baseline.mts computeSkillScore.
--      Reconciled against the TS scorer (see plan Task 5).
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE VIEW. Run via psycopg
-- per CLAUDE.md RULE 1 (creds in .dlt/secrets.toml); verify row counts after.

BEGIN;

-- 1. data_targets --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.data_targets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_key  text NOT NULL UNIQUE,
  kind        text NOT NULL CHECK (kind IN (
                'stale','low_skill','low_n','excluded_wanted','falsifiability_gap')),
  subject     text NOT NULL,        -- slug | source name | brain_id
  label       text NOT NULL,        -- human headline
  reason      text NOT NULL,        -- why it's a target, N-stamped
  status      text NOT NULL DEFAULT 'want'
                CHECK (status IN ('live','building','new','want')),
  priority    smallint NOT NULL DEFAULT 5,   -- 1 = most urgent
  metric      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {n, lift, age_days, ...}
  source      text NOT NULL DEFAULT 'generator'
                CHECK (source IN ('generator','manual')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS data_targets_priority_idx
  ON public.data_targets (priority, kind);

GRANT SELECT ON public.data_targets TO service_role;

-- 2. backtest_skill_by_slug ----------------------------------------------------
-- Per-slug lift = system_accuracy - persistence_accuracy over the SHARED scored set:
--   • non-first-per-slug   → LAG(...) IS NOT NULL  (persistence needs a prior)
--   • non-neutral target   → observed_direction <> 'neutral'
--   • a neutral PRIOR is kept and scores as a persistence MISS (prior <> directional
--     target) — matches computeSkillScore's "neutral prior counts as a persistence
--     miss" pin, making naive carry-forward harder to beat (lift = clean lower bound).
CREATE OR REPLACE VIEW public.backtest_skill_by_slug AS
WITH ordered AS (
  SELECT
    slug, as_of_date, predicted_direction, observed_direction,
    LAG(observed_direction) OVER (PARTITION BY slug ORDER BY as_of_date) AS prior_observed
  FROM public.backtest_grades
  WHERE grade_method = 'retrodicted'
),
scored AS (
  SELECT
    slug,
    (predicted_direction = observed_direction)::int AS system_correct,
    (prior_observed     = observed_direction)::int  AS persistence_correct
  FROM ordered
  WHERE prior_observed IS NOT NULL
    AND observed_direction <> 'neutral'
)
SELECT
  slug,
  count(*)                                                              AS n,
  round(avg(system_correct)::numeric, 4)                               AS system_accuracy,
  round(avg(persistence_correct)::numeric, 4)                          AS persistence_accuracy,
  round((avg(system_correct) - avg(persistence_correct))::numeric, 4)  AS lift
FROM scored
GROUP BY slug
ORDER BY n DESC;

GRANT SELECT ON public.backtest_skill_by_slug TO service_role;

COMMIT;

-- Verify after running:
--   SELECT count(*) FROM public.data_targets;             -- table exists (0 until first run)
--   SELECT * FROM public.backtest_skill_by_slug;          -- 2 rows today (LAUS Lee/Collier)
```

- [ ] **Step 2: Apply the migration to the live DB**

Run (reads creds from `.dlt/secrets.toml`; do NOT inline the password):

```bash
python -c "import psycopg,tomllib;cr=tomllib.load(open('.dlt/secrets.toml','rb'))['destination']['postgres']['credentials'];sql=open('docs/sql/20260608_data_targets.sql').read();c=psycopg.connect(f\"postgresql://{cr['username']}:{cr['password']}@{cr['host']}:{cr['port']}/{cr['database']}\",sslmode='require');c.execute(sql);c.commit();print('applied')"
```

Expected: `applied`

- [ ] **Step 3: Verify the objects**

```bash
python -c "import psycopg,tomllib;cr=tomllib.load(open('.dlt/secrets.toml','rb'))['destination']['postgres']['credentials'];c=psycopg.connect(f\"postgresql://{cr['username']}:{cr['password']}@{cr['host']}:{cr['port']}/{cr['database']}\");cur=c.cursor();cur.execute('select count(*) from public.data_targets');print('data_targets',cur.fetchone());cur.execute('select slug,n,lift from public.backtest_skill_by_slug');print('skill',cur.fetchall())"
```

Expected: `data_targets (0,)` and `skill [...]` with 2 LAUS slug rows (lift values printed).

- [ ] **Step 4: Commit**

```bash
git add docs/sql/20260608_data_targets.sql
git commit -m "feat(glass): §4 data_targets table + backtest_skill_by_slug view"
```

---

### Task 2: Pure builders + ranking (TDD)

**Files:**
- Create: `ingest/scripts/generate_data_targets.py` (pure section only)
- Test: `ingest/tests/scripts/test_generate_data_targets.py`

- [ ] **Step 1: Write the failing tests**

```python
"""Unit tests for generate_data_targets.py pure builders — no DB."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from ingest.scripts.generate_data_targets import (
    EXCLUDED_WANTED_SEEDS,
    build_stale_targets,
    build_skill_targets,
    build_low_n_targets,
    build_excluded_targets,
    build_falsifiability_targets,
    keys_to_drop,
)


def test_build_stale_targets_flags_stale_missing_and_low_volume():
    probe = [
        {"name": "fresh_one", "lane": "tier-2", "status": "FRESH",
         "age_days": 1, "threshold_days": 60, "cadence_days": 30, "volume_status": None},
        {"name": "stale_one", "lane": "tier-2", "status": "STALE",
         "age_days": 90, "threshold_days": 60, "cadence_days": 30, "volume_status": None},
        {"name": "missing_one", "lane": "tier-1", "status": "MISSING",
         "age_days": None, "threshold_days": 60, "cadence_days": 30, "volume_status": None},
        {"name": "low_vol", "lane": "tier-2", "status": "FRESH",
         "age_days": 1, "threshold_days": 60, "cadence_days": 30,
         "volume_status": "LOW_VOLUME", "volume_landed": 2, "volume_min": 100},
    ]
    out = build_stale_targets(probe)
    keys = {t["target_key"] for t in out}
    assert keys == {"stale:stale_one", "stale:missing_one", "stale:low_vol"}
    missing = next(t for t in out if t["subject"] == "missing_one")
    assert missing["priority"] == 1               # MISSING is most urgent
    assert all(t["kind"] == "stale" for t in out)
    stale = next(t for t in out if t["subject"] == "stale_one")
    assert "90" in stale["reason"] and "60" in stale["reason"]   # N-stamped (age vs threshold)


def test_build_skill_targets_flags_nonpositive_lift_above_min_n():
    rows = [
        {"slug": "a", "n": 70, "system_accuracy": 0.42, "persistence_accuracy": 0.49, "lift": -0.07},
        {"slug": "b", "n": 70, "system_accuracy": 0.60, "persistence_accuracy": 0.50, "lift": 0.10},
        {"slug": "c", "n": 8,  "system_accuracy": 0.30, "persistence_accuracy": 0.50, "lift": -0.20},
    ]
    out = build_skill_targets(rows, min_n=15)
    keys = {t["target_key"] for t in out}
    assert keys == {"low_skill:a"}               # b beats naive; c is below min_n
    assert out[0]["metric"]["lift"] == -0.07
    assert "N=70" in out[0]["reason"]


def test_build_low_n_targets_flags_under_floor_but_positive():
    counts = {"a": 70, "b": 12, "c": 0}
    out = build_low_n_targets(counts, floor=30, corpus="backtest")
    keys = {t["target_key"] for t in out}
    assert keys == {"low_n:b"}                    # a is fine; c has zero (no calls to grow)
    assert "N=12" in out[0]["reason"]


def test_build_excluded_targets_has_four_seeds():
    out = build_excluded_targets()
    assert len(out) == len(EXCLUDED_WANTED_SEEDS) == 4
    assert {t["subject"] for t in out} == {"zori_rent", "census_acs", "bls_qcew", "tdt_collections"}
    assert all(t["kind"] == "excluded_wanted" and t["status"] == "want" for t in out)


def test_build_falsifiability_targets_flags_high_ungradeable_brain():
    # master: 6 gradeable + 5 ungradeable (claim-bearing) → 45% ungradeable, 0 slug preds.
    claim_counts = {"master": {"gradeable": 6, "ungradeable": 5}}
    out = build_falsifiability_targets(claim_counts, slug_predictions_logged=0,
                                       min_claims=8, max_ungradeable_rate=0.4)
    assert {t["target_key"] for t in out} == {"falsifiability_gap:master"}
    m = out[0]["metric"]
    assert m["ungradeable_n"] == 5 and m["gradeable_n"] == 6 and m["slug_predictions_logged"] == 0


def test_build_falsifiability_targets_ignores_healthy_brain():
    claim_counts = {"good": {"gradeable": 18, "ungradeable": 2}}
    out = build_falsifiability_targets(claim_counts, slug_predictions_logged=5,
                                       min_claims=8, max_ungradeable_rate=0.4)
    assert out == []


def test_keys_to_drop_returns_resolved_generator_keys():
    existing = {"stale:a", "low_skill:b", "excluded_wanted:zori_rent"}
    current = {"low_skill:b", "excluded_wanted:zori_rent"}
    assert keys_to_drop(existing, current) == {"stale:a"}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest ingest/tests/scripts/test_generate_data_targets.py -v`
Expected: FAIL — `ModuleNotFoundError`/`ImportError` (generate_data_targets not yet written).

- [ ] **Step 3: Write the pure section of the generator**

```python
"""Generate the Glass §4 'Shopping List' — public.data_targets.

Reads five gap sources over one direct-Postgres connection and upserts ranked
rows, auto-dropping resolved generator rows. Internal only (service_role); a
retrodicted-derived number is never a public claim (Glass guardrail 3).

Run:
  python -m ingest.scripts.generate_data_targets --dry-run   # compute + print, no write
  python -m ingest.scripts.generate_data_targets             # upsert + auto-drop
Creds: DESTINATION__POSTGRES__CREDENTIALS, else .dlt/secrets.toml (via check_freshness).
"""
import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

# Reuse the freshness probe's connection + registry + STALE/MISSING/LOW_VOLUME probe.
from ingest.scripts.check_freshness import _get_connection, load_registry, run_probe

# ── DIAL-2 ⛔ excluded-but-wanted (canonical: docs/.../flywheel-bootstrap-REVIEW-knobs.md
#    DIAL 2, mirrored by refinery/tools/flywheel-backtest.mts EXCLUDED). Listed, never
#    silently dropped — these need kept point-in-time vintages before they can be graded.
EXCLUDED_WANTED_SEEDS: list[dict[str, str]] = [
    {"subject": "zori_rent", "label": "ZORI rent — needs kept vintages",
     "reason": "Excluded from backtest: Zillow re-writes history; no retained vintages. "
               "Qualifies only if we archive ZORI vintages going forward."},
    {"subject": "census_acs", "label": "Census ACS aggregates — needs point-in-time archive",
     "reason": "Excluded: revised; no point-in-time archive held. Needs vintage retention."},
    {"subject": "bls_qcew", "label": "BLS QCEW — benchmark-revised",
     "reason": "Excluded: benchmark revisions overwrite the past. Needs vintage retention."},
    {"subject": "tdt_collections", "label": "TDT collections — fixture-only",
     "reason": "Excluded: fixture-only; self-ingest still pending. Qualifies after self-ingest lands."},
]


def _target(kind: str, subject: str, label: str, reason: str, *,
            status: str, priority: int, metric: dict[str, Any]) -> dict[str, Any]:
    return {
        "target_key": f"{kind}:{subject}",
        "kind": kind, "subject": subject, "label": label, "reason": reason,
        "status": status, "priority": priority, "metric": metric,
    }


def build_stale_targets(probe_results: list[dict]) -> list[dict]:
    """STALE/MISSING/LOW_VOLUME pipelines → stale targets (threshold already cadence×tolerance)."""
    out: list[dict] = []
    for r in probe_results:
        status = r.get("status")
        vol = r.get("volume_status")
        if status not in ("STALE", "MISSING") and vol != "LOW_VOLUME":
            continue
        name = r["name"]
        if status == "MISSING":
            priority, label = 1, f"{name} — never landed (MISSING)"
            reason = (f"No row in inventory/_dlt_loads (cadence {r['cadence_days']}d, "
                      f"threshold {r['threshold_days']}d).")
        elif status == "STALE":
            priority, label = 2, f"{name} — stale {r['age_days']}d"
            reason = (f"Last load {r['age_days']}d ago > threshold {r['threshold_days']}d "
                      f"(cadence {r['cadence_days']}d).")
        else:  # LOW_VOLUME on an otherwise-fresh pipeline
            priority, label = 2, f"{name} — low volume"
            reason = f"Landed {r.get('volume_landed')} rows < floor {r.get('volume_min')}."
        out.append(_target(
            "stale", name, label, reason, status="building", priority=priority,
            metric={k: r.get(k) for k in
                    ("age_days", "threshold_days", "cadence_days", "lane",
                     "volume_landed", "volume_min", "status", "volume_status")}))
    return out


def build_skill_targets(skill_rows: list[dict], *, min_n: int = 15) -> list[dict]:
    """Slugs whose lift ≤ 0 over n ≥ min_n — the system does not beat naive carry-forward."""
    out: list[dict] = []
    for row in skill_rows:
        n = int(row["n"])
        lift = float(row["lift"])
        if n < min_n or lift > 0:
            continue
        out.append(_target(
            "low_skill", row["slug"],
            f"{row['slug']} — lift {lift:+.1%} (N={n})",
            f"Backtest lift {lift:+.1%} ≤ 0 over N={n} graded calls "
            f"(system {float(row['system_accuracy']):.1%} vs naive "
            f"{float(row['persistence_accuracy']):.1%}) — call logic needs work before weighting.",
            status="building", priority=3,
            metric={"n": n, "lift": lift,
                    "system_accuracy": float(row["system_accuracy"]),
                    "persistence_accuracy": float(row["persistence_accuracy"])}))
    return out


def build_low_n_targets(slug_counts: dict[str, int], *, floor: int = 30,
                        corpus: str = "backtest") -> list[dict]:
    """Slugs with some graded calls but fewer than `floor` — under-sampled, grow the N."""
    out: list[dict] = []
    for slug, n in slug_counts.items():
        if n <= 0 or n >= floor:
            continue
        out.append(_target(
            "low_n", slug,
            f"{slug} — only N={n} graded calls",
            f"{corpus} corpus has N={n} < {floor} graded calls — too few to trust the rate.",
            status="building", priority=4, metric={"n": n, "floor": floor, "corpus": corpus}))
    return out


def build_excluded_targets() -> list[dict]:
    """The DIAL-2 ⛔ excluded-but-wanted signals (want kept vintages)."""
    return [_target("excluded_wanted", s["subject"], s["label"], s["reason"],
                    status="want", priority=5, metric={"backtestable": False})
            for s in EXCLUDED_WANTED_SEEDS]


def build_falsifiability_targets(claim_counts: dict[str, dict[str, int]],
                                 *, slug_predictions_logged: int,
                                 min_claims: int = 8,
                                 max_ungradeable_rate: float = 0.4) -> list[dict]:
    """Brains where ungradeable ≥ max_rate of CLAIM-BEARING predictions (husks excluded).
    The system noticing it isn't making falsifiable bets (the §6 finding)."""
    out: list[dict] = []
    for brain, c in claim_counts.items():
        g = int(c.get("gradeable", 0))
        u = int(c.get("ungradeable", 0))
        total = g + u
        if total < min_claims:
            continue
        rate = u / total if total else 0.0
        if rate < max_ungradeable_rate:
            continue
        out.append(_target(
            "falsifiability_gap", brain,
            f"{brain} — {rate:.0%} of calls ungradeable (N={total})",
            f"{u}/{total} claim-bearing predictions are ungradeable (no registered numeric "
            f"driver); {slug_predictions_logged} leaf slug-predictions logged. Lift gradeable "
            f"yield (Glass §6).",
            status="new", priority=4,
            metric={"gradeable_n": g, "ungradeable_n": u, "ungradeable_rate": round(rate, 3),
                    "slug_predictions_logged": slug_predictions_logged}))
    return out


def keys_to_drop(existing_generator_keys: set[str], current_keys: set[str]) -> set[str]:
    """Generator rows no longer in the current target set → auto-drop (resolved)."""
    return existing_generator_keys - current_keys
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest ingest/tests/scripts/test_generate_data_targets.py -v`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add ingest/scripts/generate_data_targets.py ingest/tests/scripts/test_generate_data_targets.py
git commit -m "feat(glass): §4 data_targets pure builders + tests"
```

---

### Task 3: DB glue (`main`) + upsert/auto-drop + `--dry-run`

**Files:**
- Modify: `ingest/scripts/generate_data_targets.py` (append the I/O section)

- [ ] **Step 1: Append the DB readers, writer, and main**

```python
# ── DB readers (one direct-Postgres connection) ─────────────────────────────────
def read_skill_rows(conn) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute("SELECT slug, n, system_accuracy, persistence_accuracy, lift "
                    "FROM public.backtest_skill_by_slug")
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def read_slug_counts(conn) -> dict[str, int]:
    with conn.cursor() as cur:
        cur.execute("SELECT slug, count(*) FROM public.backtest_grades "
                    "WHERE grade_method='retrodicted' GROUP BY slug")
        return {r[0]: int(r[1]) for r in cur.fetchall()}


def read_live_slug_counts(conn) -> dict[str, int]:
    """Live graded-call counts per slug (grade_accuracy_by_slug); empty until outcomes land."""
    with conn.cursor() as cur:
        cur.execute("SELECT gradeable_slug, n FROM public.grade_accuracy_by_slug "
                    "WHERE gradeable_slug IS NOT NULL")
        return {r[0]: int(r[1]) for r in cur.fetchall()}


def read_claim_counts(conn) -> tuple[dict[str, dict[str, int]], int]:
    """Per-brain gradeable/ungradeable over CLAIM-BEARING predictions (pending husks
    excluded), plus the live count of leaf slug-predictions."""
    counts: dict[str, dict[str, int]] = {}
    with conn.cursor() as cur:
        cur.execute("SELECT brain_id, grade_status, count(*) FROM public.predictions "
                    "WHERE grade_status IN ('gradeable','ungradeable') GROUP BY 1,2")
        for brain, status, n in cur.fetchall():
            counts.setdefault(brain, {})[status] = int(n)
        cur.execute("SELECT count(*) FROM public.predictions WHERE prediction_kind='slug'")
        slug_preds = int(cur.fetchone()[0])
    return counts, slug_preds


# ── writer: upsert current set, auto-drop resolved generator rows ────────────────
def upsert_targets(conn, targets: list[dict], *, dry_run: bool) -> tuple[set[str], set[str]]:
    current_keys = {t["target_key"] for t in targets}
    with conn.cursor() as cur:
        cur.execute("SELECT target_key FROM public.data_targets WHERE source='generator'")
        existing = {r[0] for r in cur.fetchall()}
        drop = keys_to_drop(existing, current_keys)
        if dry_run:
            return current_keys, drop
        for t in targets:
            cur.execute(
                "INSERT INTO public.data_targets "
                "(target_key, kind, subject, label, reason, status, priority, metric, source, updated_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'generator',now()) "
                "ON CONFLICT (target_key) DO UPDATE SET "
                "kind=EXCLUDED.kind, subject=EXCLUDED.subject, label=EXCLUDED.label, "
                "reason=EXCLUDED.reason, status=EXCLUDED.status, priority=EXCLUDED.priority, "
                "metric=EXCLUDED.metric, updated_at=now()",
                (t["target_key"], t["kind"], t["subject"], t["label"], t["reason"],
                 t["status"], t["priority"], json.dumps(t["metric"])))
        for k in drop:
            cur.execute("DELETE FROM public.data_targets WHERE target_key=%s AND source='generator'", (k,))
    conn.commit()
    return current_keys, drop


def collect_targets(conn) -> list[dict]:
    registry = load_registry(Path(__file__).parent.parent / "cadence_registry.yaml")
    probe = run_probe(conn, registry)
    claim_counts, slug_preds = read_claim_counts(conn)
    targets: list[dict] = []
    targets += build_stale_targets(probe)
    targets += build_skill_targets(read_skill_rows(conn))
    targets += build_low_n_targets(read_slug_counts(conn), corpus="backtest")
    targets += build_low_n_targets(read_live_slug_counts(conn), corpus="live")
    targets += build_excluded_targets()
    targets += build_falsifiability_targets(claim_counts, slug_predictions_logged=slug_preds)
    targets.sort(key=lambda t: (t["priority"], t["kind"], t["subject"]))
    return targets


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate The Glass §4 data_targets.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Compute + print the ranked targets, write nothing.")
    args = parser.parse_args(argv)

    try:
        conn = _get_connection()
    except Exception as exc:  # noqa: BLE001 — fail loud, this is not observability-only
        print(f"generate_data_targets: DB connection failed: {exc}", file=sys.stderr)
        return 1

    try:
        targets = collect_targets(conn)
        current, drop = upsert_targets(conn, targets, dry_run=args.dry_run)
    finally:
        conn.close()

    print(f"{'[DRY-RUN] ' if args.dry_run else ''}data_targets: "
          f"{len(targets)} current, {len(drop)} resolved/dropped")
    by_kind: dict[str, int] = {}
    for t in targets:
        by_kind[t["kind"]] = by_kind.get(t["kind"], 0) + 1
    for kind in ("stale", "low_skill", "low_n", "excluded_wanted", "falsifiability_gap"):
        print(f"  {kind}: {by_kind.get(kind, 0)}")
    for t in targets:
        print(f"  [P{t['priority']}] {t['kind']:<18} {t['label']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Re-run the pure tests (still green after the append)**

Run: `python -m pytest ingest/tests/scripts/test_generate_data_targets.py -v`
Expected: PASS (7 tests) — the I/O additions don't touch the pure builders.

- [ ] **Step 3: Dry-run against the live DB**

Run: `python -m ingest.scripts.generate_data_targets --dry-run`
Expected: a `[DRY-RUN]` summary, `0 resolved/dropped`, and the by-kind breakdown — today likely `excluded_wanted: 4`, `low_skill: 1–2` (LAUS slugs, lift ≤ 0), `falsifiability_gap: 1` (master ~45%), `low_n: 0`, `stale: N` (whatever the probe flags). No rows written.

- [ ] **Step 4: Commit**

```bash
git add ingest/scripts/generate_data_targets.py
git commit -m "feat(glass): §4 data_targets DB glue — readers, upsert/auto-drop, --dry-run"
```

---

### Task 4: Nightly GHA + `--dry-run`

**Files:**
- Create: `.github/workflows/data-targets-daily.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: Data Targets (daily)

# Regenerates public.data_targets — The Glass §4 "Shopping List". Reads only
# (backtest_grades / predictions / freshness); writes the derived data_targets table.
# Runs after the 14:00 UTC freshness probe so newly-stale sources show up same-day.
# Non-ingest: NOT in cadence_registry.yaml. Manual dry-run via workflow_dispatch.

on:
  schedule:
    - cron: "30 14 * * *"
  workflow_dispatch:
    inputs:
      dry_run:
        description: "Dry run — compute + print, write nothing"
        type: boolean
        default: false

permissions:
  contents: read

jobs:
  generate:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.13"
      - run: pip install -r ingest/requirements.txt
      - env:
          DESTINATION__POSTGRES__CREDENTIALS: ${{ secrets.DESTINATION__POSTGRES__CREDENTIALS }}
        run: |
          if [ "${{ github.event.inputs.dry_run }}" = "true" ]; then
            python -m ingest.scripts.generate_data_targets --dry-run
          else
            python -m ingest.scripts.generate_data_targets
          fi
```

- [ ] **Step 2: Confirm the secret exists**

`DESTINATION__POSTGRES__CREDENTIALS` is already used by `freshness-probe-daily.yml`, so it's set in repo secrets. Verify:

Run: `gh secret list | findstr DESTINATION__POSTGRES__CREDENTIALS`
Expected: the secret name printed (already configured — no `gh secret set` needed).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/data-targets-daily.yml
git commit -m "feat(glass): §4 data_targets nightly GHA + --dry-run"
```

---

### Task 5: End-to-end write + skill-view reconcile + row-count verify

**Files:** none (verification only)

- [ ] **Step 1: Reconcile the SQL view against the canonical TS scorer**

The view's per-slug formula must match `computeSkillScore`. Compare the GLOBAL aggregate (same `scored` CTE, no GROUP BY) to the TS scorer's printed aggregate:

Run: `bun refinery/tools/flywheel-backtest.mts --dry-run`
Note its `system accuracy`, `persistence accuracy`, `LIFT`, and scored `N`.

Then run the global SQL aggregate:
```bash
python -c "import psycopg,tomllib;cr=tomllib.load(open('.dlt/secrets.toml','rb'))['destination']['postgres']['credentials'];c=psycopg.connect(f\"postgresql://{cr['username']}:{cr['password']}@{cr['host']}:{cr['port']}/{cr['database']}\");cur=c.cursor();cur.execute(\"WITH o AS (SELECT slug,predicted_direction,observed_direction,LAG(observed_direction) OVER (PARTITION BY slug ORDER BY as_of_date) p FROM backtest_grades WHERE grade_method='retrodicted'), s AS (SELECT (predicted_direction=observed_direction)::int sc,(p=observed_direction)::int pc FROM o WHERE p IS NOT NULL AND observed_direction<>'neutral') SELECT count(*),avg(sc),avg(pc),avg(sc)-avg(pc) FROM s\");print(cur.fetchone())"
```
Expected: N, system_acc, persistence_acc, lift **equal to the TS scorer's** (within rounding). If they diverge, the view formula is wrong — fix before proceeding (do NOT write data_targets off a wrong skill view).

- [ ] **Step 2: Real write run**

Run: `python -m ingest.scripts.generate_data_targets`
Expected: `data_targets: N current, 0 resolved/dropped` (first run drops nothing).

- [ ] **Step 3: Verify the table populated + grants**

```bash
python -c "import psycopg,tomllib;cr=tomllib.load(open('.dlt/secrets.toml','rb'))['destination']['postgres']['credentials'];c=psycopg.connect(f\"postgresql://{cr['username']}:{cr['password']}@{cr['host']}:{cr['port']}/{cr['database']}\");cur=c.cursor();cur.execute('select kind,count(*) from public.data_targets group by 1 order by 2 desc');print(cur.fetchall());cur.execute('select priority,label from public.data_targets order by priority limit 10');[print(r) for r in cur.fetchall()]"
```
Expected: per-kind counts matching the dry-run, ranked rows printed.

- [ ] **Step 4: Idempotency check (re-run drops nothing, no dupes)**

Run: `python -m ingest.scripts.generate_data_targets`
Then re-count: total row count is unchanged from Step 3 (upsert, not insert-dupe); `0 resolved/dropped`.

---

### Task 6: Reconcile the ledger + SESSION_LOG + push (gated)

**Files:**
- Modify: `SESSION_LOG.md`

- [ ] **Step 1: Open the §4 check (if not already open) and note the live-proof gate**

```bash
node scripts/check.mjs open glass glass_section4_data_targets "Glass §4 data_targets generator + table live" --detail "Nightly GHA populates public.data_targets; Pane 4 (§5) renders it. Close after one scheduled GHA run writes rows in prod."
```

- [ ] **Step 2: Append the SESSION_LOG entry (top of file, newest-first)**

Cover: the migration (table + view applied to live DB, verified counts), the generator (pure builders + tests, DB glue, dry-run + write verified), the GHA, and the reconcile result (view == TS scorer). Note Pane 4 (§5) is now unblocked.

- [ ] **Step 3: Show the diff and STOP for operator review** (feedback_no-autonomous-push — §4 is a "diff-review before push" change: new table + GHA)

Run: `git --no-pager diff --stat main` and summarize. **Do not push until the operator says go**; then `node scripts/safe-push.mjs`.

---

## Self-Review

**1. Spec coverage** (decomposition §4): idempotent migration ✓ (Task 1, mirrors `20260601`, psycopg per RULE 1, row-count verify); nightly GHA + `--dry-run` ✓ (Task 4); DECISION-4 thresholds — low-N `<30` ✓ (`build_low_n_targets`), low-skill `lift ≤ 0` over `N ≥ 15` ✓ (`build_skill_targets`), stale `>2× cadence` ✓ (reuses probe threshold = `cadence×tolerance`, default 2×), excluded-but-wanted ✓ (DIAL-2 seeds); upsert ranked rows + auto-drop ✓ (Task 3); the §6 falsifiability-gap trigger ✓ (`build_falsifiability_targets`). Pinned `backtest_grades` contract honored (read-only). Internal-only grants ✓.

**2. Placeholder scan:** none — every step has real SQL/Python/YAML and runnable commands.

**3. Type/name consistency:** `target_key`, `kind`, `subject`, `label`, `reason`, `status`, `priority`, `metric`, `source` identical across the migration, the `_target()` helper, the upsert SQL, and the tests. Builder names (`build_stale_targets`, `build_skill_targets`, `build_low_n_targets`, `build_excluded_targets`, `build_falsifiability_targets`, `keys_to_drop`) match between the test imports (Task 2 Step 1) and the implementation (Task 2 Step 3 / Task 3). View columns (`slug, n, system_accuracy, persistence_accuracy, lift`) match `read_skill_rows` and `build_skill_targets`.

**Note on DRY (skill formula in two places):** the persistence-null lift lives canonically in TS (`computeSkillScore`) and is re-expressed once in SQL (`backtest_skill_by_slug`) because the Python consumer can't import TS. Task 5 Step 1 reconciles them against the live corpus and blocks the write on a mismatch — the duplication is converted into a checked invariant, not left to drift.
