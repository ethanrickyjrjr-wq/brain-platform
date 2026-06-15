# 05 — Vendor Re-Anchor & Retrospective Health Check (Wave 3)

> Build file for the Daily Freshness System. **Read `README.md` §2 (the vendor is a periodic re-anchor, NOT a kill-switch) + §0.** The daily data-quality gate is the **anomaly-vs-our-own-history** check in the **engine (file 01)** — this file is what happens when the **vendor finally refreshes on its native cadence**: a retrospective "was our daily system tracking?" health check + **re-anchoring** the anomaly baseline to the vendor's fresh number. It does **NOT** reject fresh sourced numbers, and a **stale vendor NEVER overrides a fresher sourced value.**

**Model:** Opus · **Repo:** brain-platform · **Wave:** 3 · **Depends:** 01, 04, and a vendor pipeline landing (Redfin county tracker is monthly).

**Goal:** When the vendor (Redfin county tracker) refreshes, reconcile: compare the new vendor value to what our daily system had the prior day → a **health signal** (board green/red); then **re-anchor** the anomaly baseline to the vendor's number for the next day's cron. There is **no per-day within-X%-of-vendor rejection band.**

---

## ⚠️ Why this is NOT a within-X%-of-vendor gate (operator decree — answers the coherence check)

The whole system exists because the vendor file is **~2 months stale and the market moved**. The **success case** is a fresher sourced number that legitimately **DIVERGES** from the stale vendor value. So two things that an earlier draft got wrong are **removed**:

1. **No "reject sourced if outside X% of vendor."** That would auto-kill the success case (a real divergence because the market moved). The only daily band is **anomaly vs OUR OWN prior value** (file 01), which tracks the market's real day-over-day movement — a real move passes (or is second-source-confirmed), never rejected against the vendor.
2. **No "vendor precedence" override.** While the vendor file is **stale**, the **sourced value is what surfaces** (the bridge). A **stale vendor value never overrides** a fresher sourced number. The vendor reclaims authority **only once it actually updates**, at which point it re-anchors the baseline (below).

**Coherence confirmed, with the exact logic this file ships:**
- (1) A fresh sourced number that diverges from a 2-month-stale vendor is **never auto-rejected** — this file does not compare daily sourced values to the vendor at all during the gap (`test_divergence_is_not_rejected`).
- (2) The bridge **sourced** value surfaces while the vendor is stale; the vendor **reclaims precedence only when its `period_end` actually advances** (`test_stale_vendor_no_op`, `test_reanchor_only_on_new_vendor_period`).

---

## Files

- **Create:** `ingest/scripts/reanchor_daily_truth.py` — the retrospective reconcile + re-anchor.
- **Create:** `ingest/scripts/tests/test_reanchor_daily_truth.py`.
- **Create:** `.github/workflows/reanchor-daily-truth.yml` — triggered on `workflow_run` completion of the vendor anchor workflow (`redfin-monthly.yml`).

---

## §0 facts to honor

- **Re-anchor mechanism:** the engine's `_prior_value` (file 01) reads the **most-recent existing row by `retrieved_at DESC`**. To re-anchor, this script **writes a `source_tag='vendor'` row** into `daily_truth` at vendor-update time — so the **next** day's anomaly check compares the new sourced value against the **vendor** number, then resumes the sourced chain. One-day re-anchor, then the bridge tracks the market again until the next vendor update.
- **Checks ledger** (`scripts/check.mjs`, verified): `open <project> <check_key> "<label>" [--detail]`, `close`, `update`. `open` fails loud if the key exists → use a deterministic `check_key` and `update` on repeat.
- **Vendor anchors** (verified): `data_lake.redfin_lee_market` / `redfin_collier_market` (`property_type='All Residential'`, latest `period_end`, `median_sale_price`). Lee covers Cape Coral + Fort Myers; Collier covers Naples.
- **`api`-mode metrics (mortgage) need no re-anchor** — FRED IS the authority and updates weekly; its daily_truth value is already vendor-grade.

---

## Task 1 — Retrospective reconcile + re-anchor (TDD)

- [ ] **Step 1.1: Write failing tests** (`ingest/scripts/tests/test_reanchor_daily_truth.py`):

```python
from ingest.scripts import reanchor_daily_truth as R

def test_health_ok_when_daily_tracked():
    # vendor lands 365000; our prior-day sourced 362000 -> within the GENEROUS health band -> OK (board green)
    assert R.health(our_prior=362000, vendor_value=365000, health_band_pct=25) == "OK"

def test_health_flag_when_daily_drifted():
    # our prior-day sourced 290000 vs vendor 365000 -> daily system was way off -> DRIFT (board red + a check)
    assert R.health(our_prior=290000, vendor_value=365000, health_band_pct=25) == "DRIFT"

def test_divergence_is_not_rejected():
    # this script NEVER touches/rejects the daily sourced rows; it only reconciles ON a vendor update
    assert not hasattr(R, "reject_sourced")   # there is no such gate

def test_stale_vendor_no_op():
    # vendor period_end unchanged since last re-anchor -> do nothing (stale vendor never overrides the bridge)
    assert R.should_reanchor(last_reanchored_period="2026-04-30", vendor_period="2026-04-30") is False

def test_reanchor_only_on_new_vendor_period():
    assert R.should_reanchor(last_reanchored_period="2026-04-30", vendor_period="2026-05-31") is True

def test_check_key_deterministic():
    assert R.check_key("median_sale_price", "naples", "2026-05-31") == R.check_key("median_sale_price", "naples", "2026-05-31")
```

- [ ] **Step 1.2: Run — expect fail.**

- [ ] **Step 1.3: Implement `reanchor_daily_truth.py`:**

```python
"""On a vendor refresh: retrospective health check of our daily system + re-anchor the anomaly baseline.
   Does NOT reject sourced values. A stale vendor never overrides a fresher sourced value."""
import subprocess, psycopg
from ingest.scripts.migrate_nfip_flood_zone_current import _uri

AREA_ANCHOR = {  # search-mode city areas -> (vendor table, vendor region)
  "cape_coral": ("data_lake.redfin_lee_market", "Lee County, FL"),
  "fort_myers": ("data_lake.redfin_lee_market", "Lee County, FL"),
  "naples":     ("data_lake.redfin_collier_market", "Collier County, FL"),
}

def health(our_prior, vendor_value, health_band_pct=25):
    # GENEROUS, coarse "was the daily system roughly tracking reality?" — NOT an 8% gate against a stale number.
    if our_prior in (None, 0): return "NO_PRIOR"
    drift = abs(our_prior - vendor_value) / vendor_value * 100.0
    return "OK" if drift <= health_band_pct else "DRIFT"

def should_reanchor(last_reanchored_period, vendor_period):
    return vendor_period > (last_reanchored_period or "")   # only when the vendor's period actually advances

def check_key(metric_key, area, period): return f"daily_truth_health_{metric_key}_{area}_{period}"

def reanchor(metric_key, area, vendor_value, vendor_period):
    # write a source_tag='vendor' row at retrieved_at=now -> becomes _prior_value for the NEXT day's anomaly check
    src = f"https://www.redfin.com/news/data-center/"
    with psycopg.connect(_uri(), connect_timeout=30) as conn, conn.cursor() as cur:
        cur.execute("""INSERT INTO data_lake.daily_truth
            (metric_key, area, period, value, unit, source_url, source_title, engine, source_tag,
             agreement_n, verified_on_page, anomaly_flag)
          VALUES (%s,%s,%s,%s,'usd',%s,'Redfin County Market Tracker','vendor','vendor',1,true,false)
          ON CONFLICT (metric_key, area, period, source_tag) DO UPDATE SET value=EXCLUDED.value, retrieved_at=now()""",
          (metric_key, area, vendor_period, vendor_value, src))
        conn.commit()

def flag_drift(metric_key, area, period, our_prior, vendor_value):
    key = check_key(metric_key, area, period)
    label = f"daily system drifted from vendor on {metric_key}/{area} {period} (ours {our_prior} vs vendor {vendor_value})"
    p = subprocess.run(["node","scripts/check.mjs","open","freshness",key,label], capture_output=True, text=True)
    if p.returncode and "exists" in (p.stdout+p.stderr).lower():
        subprocess.run(["node","scripts/check.mjs","update",key,"--detail",label], check=True)
```

The runner: for each `search`-mode metric+area with an anchor, read the vendor's latest `(median_sale_price, period_end)`; if `should_reanchor(last_vendor_period_in_daily_truth, vendor_period)` → look up our prior-day sourced value, run `health(...)`; **OK** → board green; **DRIFT** → `flag_drift(...)` (retrospective signal — our daily system may have been off while that vendor period was live); then **`reanchor(...)`** (write the vendor row → next day's baseline). Stale vendor (`should_reanchor` False) → no-op.

- [ ] **Step 1.4: Run tests — expect pass.**

---

## Task 2 — Fire it when the vendor lands

- [ ] **Step 2.1:** `reanchor-daily-truth.yml` on `workflow_run: { workflows: ["<redfin monthly workflow name>"], types: [completed] }`, `permissions: contents: read` + checks/DB creds in env, runs `python -m ingest.scripts.reanchor_daily_truth`.

- [ ] **Step 2.2: Dry-run against the last landed Redfin period.**

```bash
python -m ingest.scripts.reanchor_daily_truth --dry-run
# Expected: per (metric, area) -> "should_reanchor? / health OK|DRIFT / would re-anchor baseline to <vendor_value>@<period>". No writes under --dry-run.
```

- [ ] **Step 2.3: Commit** (`git add ingest/scripts/reanchor_daily_truth.py ingest/scripts/tests/ .github/workflows/reanchor-daily-truth.yml`).

---

## Definition of Done

- When the Redfin county tracker advances its `period_end`, `reanchor_daily_truth.py`: (a) runs a **generous retrospective health check** (was our daily system roughly tracking? — OK/DRIFT, NOT an 8% gate), opening a `checks` entry only on real DRIFT; (b) **re-anchors** the anomaly baseline by writing a `source_tag='vendor'` row so the next day's cron compares against the vendor number.
- A fresh sourced number that **diverges** from a still-stale vendor is **never rejected** by this file. A stale vendor (`period_end` unchanged) is a **no-op** — it never overrides the bridge.
- `api`-mode metrics (mortgage) are skipped (FRED is already the authority).
- **Board row:** `05-reanchor` GREEN — vendor refresh triggers a health check + re-anchor; a deliberately-drifted prior opens a red flag; a divergence-because-the-market-moved does NOT.
