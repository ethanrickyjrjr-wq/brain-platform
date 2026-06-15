# 02 — Registry & Questions (the single spine) (Wave 1 ∥ 01)

> Build file for the Daily Freshness System. **Read `README.md` §1.3 (single-spine decision), §3b (the `live_search_config` contract this file authors).** No second "question catalog" file — sourced metrics live in `ingest/cadence_registry.yaml` next to vendor data, so the freshness probe + ops board + brains all derive from one source of truth.

**Model:** Opus · **Repo:** brain-platform · **Wave:** 1 (parallel with 01) · **Depends:** — · **Ships in the SAME PR as 01 + 03.**

**Goal:** Add the first sourced metrics to `cadence_registry.yaml` as `live_search_config:` blocks — median sale price (Cape Coral / Fort Myers / Naples, `search` mode) and 30-yr mortgage (`api` mode, FRED) — chosen because each has a vendor anchor (Redfin / FRED) that makes the validation loop (file 05) provable.

---

## Background facts (verified §0 — cite these, not the original draft)

- The registry entry schema (documented at `cadence_registry.yaml` L7-33): `name`, `lane` (`tier-1`|`tier-1-duckdb`|`tier-2`), `cadence_days`, `tolerance_multiplier` (default 2.0); tier-2 non-dlt may set `freshness_table` + `freshness_column` (default `inserted_at`) + `source_name`; optional `expected_rows_min` + `count_table`; plus `probe_mode` (`odd_window`), `first_expected_by`, `liveness_view`, `note`. There is a `not_yet_running:` section (L725).
- **The parked-ODD example is `sba_foia_franchise_outcomes`** (under `not_yet_running:`) or any `probe_mode: odd_window` entry (`crexi_listings`, `estero_edc`, …). **`marketbeat_swfl` is ACTIVE/graduated** (L559-571) — do not cite it as parked.
- Area validity: `refinery/lib/zip-resolver.mts` `resolveZip(zip).in_scope` + `fixtures/swfl-zip-county.json` (6-county, ~109 ZIPs) gate **ZIP-grain** areas (used by file 03). The city/county areas here (`cape_coral`/`fort_myers`/`naples`/`swfl`) are a fixed allowlist (Cape Coral + Fort Myers → Lee; Naples → Collier).

---

## Files

- **Modify:** `ingest/cadence_registry.yaml` — add two entries under `pipelines:` (NOT under `not_yet_running:` — these run daily).
- **Modify:** `CLAUDE.md` — one line under the Brain Factory rules documenting the single-spine rule (future-proofing point 1): *"Sourced (live-search) metrics register in `cadence_registry.yaml` as a `live_search_config:` block alongside vendor data — never a separate catalog file."*
- **Test:** `ingest/tests/test_cadence_registry_live_search.py` — schema-validates every `live_search_config` block.

---

## Task 1 — Add the registry entries

- [ ] **Step 1.1: Append the two entries** under `pipelines:` in `cadence_registry.yaml`, using the §3b contract verbatim. Median price (`search`) and mortgage (`api`):

```yaml
  live_search_daily_median_price:
    lane: tier-2
    cadence_days: 1
    tolerance_multiplier: 1.5
    freshness_table: data_lake.daily_truth
    freshness_column: retrieved_at
    source_name: live_search
    expected_rows_min: 1
    note: "Daily sourced median sale price; anchored to Redfin county tracker for validation."
    live_search_config:
      fetch_mode: search
      metric_key: median_sale_price
      areas: ["cape_coral", "fort_myers", "naples"]
      questions:
        - "What is the current median home sale price in {area_label}, Florida?"
        - "{area_label} FL median home sale price this month"
      denylist_domains: ["littlebird"]   # OPEN APERTURE: Gemini may source ANY real publisher it finds (a local realtor's online numbers count); only LittleBird Realty + competitors are thrown out. The `questions` ARE the grounded-search queries Gemini fires.
      vendor_anchor_table: data_lake.redfin_lee_market   # collier areas validate vs redfin_collier_market (file 05 maps area->county->anchor)
      unit: usd
      expected_range: [200000, 900000]
      tolerance_pct: 10            # optional verify-on-page numeric match only
      anomaly_threshold_pct: 8     # day-over-day vs OUR OWN prior value; >8% -> cron a second-source confirm before brain

  live_search_daily_mortgage:
    lane: tier-2
    cadence_days: 1
    tolerance_multiplier: 1.5
    freshness_table: data_lake.daily_truth
    freshness_column: retrieved_at
    source_name: live_search
    expected_rows_min: 1
    note: "Daily 30-yr fixed mortgage from FRED MORTGAGE30US (weekly Thu; api mode = authoritative, no search)."
    live_search_config:
      fetch_mode: api
      metric_key: mortgage_30yr_fixed
      areas: ["swfl"]
      api_config: { provider: fred, series_id: MORTGAGE30US, source_url: "https://fred.stlouisfed.org/series/MORTGAGE30US" }
      vendor_anchor_table: null
      unit: pct
      expected_range: [2.0, 12.0]
      tolerance_pct: 5
      anomaly_threshold_pct: 8     # mortgage rarely moves >8% rel day-over-day
```

`{area_label}` is expanded by `pipeline.py` (file 01) from a small map (`cape_coral → "Cape Coral"`, etc.). Note `tolerance_multiplier: 1.5` (tighter than the 2.0 default — a daily metric should be stale fast).

**`anomaly_threshold_pct` is per-metric and load-bearing** (operator decree): it's the day-over-day band checked **against our OWN prior `daily_truth` value — never the vendor**. Set it to each series' real volatility — **not too tight** (a real market move must pass) but tight enough to catch a wrong number. A value beyond the band triggers an automatic **second-source confirm run** (file 01); still off → `anomaly_flag` + human review on the board. The **first run** for a metric bootstraps with 2–3 sources to confirm the baseline is tight.

**REQUIRED in Wave 1 — real per-metric defaults, NOT placeholders** (operator: "write them into the registry during Wave 1, not after"). Cap rates move differently than days-on-market; one global number is wrong. Starting values to tune against each series' observed day-over-day spread:

| metric | `anomaly_threshold_pct` (start) | why |
|---|---|---|
| `median_sale_price` | 8 | rolling median; rarely jumps >8%/day |
| `mortgage_30yr_fixed` | 8 | weekly PMMS; a 0.25pp move ≈ 4% rel |
| `active_inventory` / `active_listings` | 20 | count, genuinely choppy day-to-day |
| `median_dom` (days on market) | 25 | small-N, high variance |
| `cap_rate` | 10 | moves slowly; a 1pt jump on a 6% cap = ~17% rel → 10 catches real errors |
| `median_rent` (ZORI-like) | 6 | sticky monthly series |
| `new_construction_starts` | 30 | lumpy |

Every metric you add gets its own row here **and** in the registry entry before it goes live.

- [ ] **Step 1.2: Validate the YAML loads + the freshness probe still parses it.**

```bash
python -c "import yaml; d=yaml.safe_load(open('ingest/cadence_registry.yaml')); \
e=d['pipelines']['live_search_daily_median_price']; print(e['live_search_config']['metric_key'], e['live_search_config']['areas'])"
# Expected: median_sale_price ['cape_coral', 'fort_myers', 'naples']
python -m ingest.scripts.check_freshness --dry-run | grep -i live_search || echo "probe parsed registry OK (rows appear once daily_truth has data)"
```

---

## Task 2 — Schema-validate every `live_search_config` (TDD)

- [ ] **Step 2.1: Write the failing test** (`ingest/tests/test_cadence_registry_live_search.py`):

```python
import yaml, pathlib
REG = yaml.safe_load((pathlib.Path(__file__).parents[1] / "cadence_registry.yaml").read_text())

def _live_search_entries():
    return {k: v for k, v in REG["pipelines"].items() if "live_search_config" in v}

def test_every_live_search_config_is_well_formed():
    assert _live_search_entries(), "expected at least one live_search_config entry"
    for k, v in _live_search_entries().items():
        c = v["live_search_config"]
        assert c["fetch_mode"] in ("search", "api"), k
        assert c["metric_key"] and isinstance(c["areas"], list) and c["areas"], k
        assert c["unit"] in ("usd", "pct", "count"), k
        lo, hi = c["expected_range"]; assert lo < hi, k
        assert 0 < c["tolerance_pct"] <= 50, k
        assert 0 < c["anomaly_threshold_pct"] <= 100, k   # per-metric anomaly band (vs our OWN prior value, not vendor)
        if c["fetch_mode"] == "search":
            # open aperture: questions are required (the grounded-search queries); denylist is optional list (LittleBird always added in code)
            assert c["questions"] and isinstance(c.get("denylist_domains", []), list), k
        else:
            assert c["api_config"]["provider"] and c["api_config"]["series_id"], k

def test_freshness_table_is_daily_truth():
    for k, v in _live_search_entries().items():
        assert v["freshness_table"] == "data_lake.daily_truth", k
        assert v["freshness_column"] == "retrieved_at", k
```

- [ ] **Step 2.2: Run — expect pass** (`pytest ingest/tests/test_cadence_registry_live_search.py -v`). (It passes immediately because Task 1 added valid entries — that's fine; the test guards future edits.)

- [ ] **Step 2.3: Document the spine rule in `CLAUDE.md`** (one line, under the Brain Factory rules block).

- [ ] **Step 2.4: Commit** (`git add ingest/cadence_registry.yaml ingest/tests/test_cadence_registry_live_search.py CLAUDE.md`).

---

## Selection rule (why these two, and what comes next)

**Bootstrap on anchored metrics only.** Median price (anchored to `redfin_lee_market`/`redfin_collier_market`) and mortgage (FRED IS the authority) both have a vendor figure to grade the daily probe against — that's what proves the within-X% loop (file 05). Only after the loop's measured accuracy justifies trusting an ungraded number do we add **no-anchor** metrics (e.g. "active inventory today," "new construction starts this week"). Adding a metric = a new registry entry + (per future-proofing point 2) **no schema change** — validate this by adding one extra metric end-to-end during the build and noting any code touch.

---

## Definition of Done

- Two `live_search_config:` entries live under `pipelines:` in `cadence_registry.yaml`, schema-valid (Task 2 green), each pointing at `data_lake.daily_truth`.
- `CLAUDE.md` documents the single-spine rule.
- `check_freshness.py` parses the registry without error.
- **Every** `live_search_config` entry carries a **real, per-metric `anomaly_threshold_pct`** (tuned to that series' day-over-day volatility — see the table above), **not a placeholder**, BEFORE its metric goes live (operator decree: set during Wave 1, not after).
- **Board row:** `02-registry` GREEN — the spine knows about the daily metrics.
