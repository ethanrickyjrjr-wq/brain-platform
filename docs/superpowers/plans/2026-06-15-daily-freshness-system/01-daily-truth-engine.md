# 01 — Daily Truth Engine **[SPINE]** (Wave 1)

> Build file for the Daily Freshness System. **Read `README.md` §0 (ledger), §2 (loop), §3a (the `daily_truth` schema this file defines).** This is the MOAT core: a **fallback cascade** (`Gemini → Firecrawl → Spider → Claude`) returns a number **+ its real source URL** in one normal-path call and loads it to the brain; the cascade is the **uptime failsafe**; the only integrity gate is **a real source URL present** (never memory; LittleBird denylisted); and an **anomaly check vs our OWN prior value** holds a suspiciously large day-over-day move for a second-source confirm before it reaches the brain.

**Model:** Opus · **Repo:** brain-platform · **Wave:** 1 · **Depends:** 00 · **Ships in the SAME PR as 02 + 03** (brain-first gate).

**Goal:** A fallback-cascade engine — `api` mode for authoritative APIs we already have the URL for (FRED `MORTGAGE30US`); `search` mode = **one Gemini grounded search** returns number + real source, failing over to Firecrawl → Spider → Claude only if a leg yields no usable sourced result — writing `data_lake.daily_truth`, storing a value only when it arrives **with a real source URL** (never memory; not denylisted) and passes the **anomaly check vs our own prior value**.

**Architecture:** Two fetch modes. `api` = deterministic pull from an authoritative API we have the URL for (FRED `MORTGAGE30US`) — single reliable source. `search` = the **fallback cascade** `Gemini grounded → Firecrawl search/extract → Spider → Claude`, tried **in order; the first leg that returns a sourced number wins** (the cascade is for **uptime**, not consensus — **no daily cross-check**). Then: **provenance gate** (real source URL present → not memory; not denylisted) → **anomaly gate** (`|Δ|` vs our prior `daily_truth` row > `anomaly_threshold_pct` → cron a 2nd run from a **different** source: confirmed loads, else `anomaly_flag` + hold for human review). The **first run** for a metric **bootstraps with 2–3 sources** and confirms they agree closely. Nothing sourced from any leg → `NULL + status_reason`, never a guess. **The vendor is a periodic re-anchor (file 05), never a stale-vendor override.**

---

## STEP 0 — Rule 1 / Vendor-First (do this BEFORE writing any engine code)

The Gemini grounding surface drifts. README §0 captured it on 2026-06-15 — **re-verify it live in your session** with WebFetch on `https://ai.google.dev/gemini-api/docs/google-search`, `…/pricing`, and `…/models`, and confirm, verbatim: (a) the **Gemini 3 model id** — default `gemini-3.5-flash` (Stable); the models page doesn't map tool→model, so **confirm it supports the `google_search` grounding tool** with one real grounded call, (b) the tool key is still `tools:[{ "google_search": {} }]`, (c) the response path `candidates[].groundingMetadata.groundingChunks[].web.uri` + `.web.title` + `.webSearchQueries`, (d) the redirect host is still `vertexaisearch.cloud.google.com`, (e) pricing is still **$14/1k search queries, 5,000 prompts/mo free** (billed per search query). **The plan is a hypothesis; the live doc is authority.**

---

## Files

- **Create:** `ingest/pipelines/live_search/__init__.py`
- **Create:** `ingest/pipelines/live_search/engine.py` — the fallback cascade + provenance gate + anomaly check (pure, testable; no DB).
- **Create:** `ingest/pipelines/live_search/pipeline.py` — registry-driven runner + psycopg upsert + `--dry-run`.
- **Create:** `ingest/scripts/migrate_daily_truth.py` — idempotent DDL for `data_lake.daily_truth`.
- **Create:** `ingest/pipelines/live_search/tests/test_engine.py` — the test suite.
- **Reuse (do not copy blindly — import/mirror):** `ingest/lib/extract_client.py` (`scrape_with_fallback`, `extract`, `ExtractError` — Firecrawl primary, Spider fallback), `ingest/pipelines/fred_g17/resources.py` (FRED request shape: `https://api.stlouisfed.org/fred/series/observations`, params `{series_id, api_key, file_type:"json", observation_start, sort_order:"asc"}`), `ingest/scripts/migrate_nfip_flood_zone_current.py` (`_uri()` + `psycopg.connect` + `NOTIFY pgrst,'reload schema'` + idempotent DDL + `GRANT`), `ingest/lib/guards.py` (`assert_min_rows(landed:int, minimum:int, label="")`).
- **No new Python dependency:** Gemini grounding is called via **REST with `requests`** (already pinned), matching the `fred_g17` pattern. (`requests`, `psycopg`, `firecrawl-py`, `anthropic`, `pyyaml` are all already in `ingest/requirements.txt` → no lockfile churn.)

---

## Task 1 — Migration: `data_lake.daily_truth`

- [ ] **Step 1.1: Write `ingest/scripts/migrate_daily_truth.py`** (mirror `migrate_nfip_flood_zone_current.py`):

```python
"""Idempotent DDL for data_lake.daily_truth (the sourced-freshness spine table)."""
import psycopg
from ingest.scripts.migrate_nfip_flood_zone_current import _uri  # reuse the exact creds resolver

DDL = """
CREATE SCHEMA IF NOT EXISTS data_lake;
CREATE TABLE IF NOT EXISTS data_lake.daily_truth (
  metric_key        text        NOT NULL,
  area              text        NOT NULL,
  period            date        NOT NULL,
  value             numeric,
  unit              text,
  source_url        text,
  source_title      text,
  engine            text,
  query_text        text,
  retrieved_at      timestamptz NOT NULL DEFAULT now(),
  agreement_n       int         NOT NULL DEFAULT 0,
  verified_on_page  boolean     NOT NULL DEFAULT false,
  source_tag        text        NOT NULL DEFAULT 'live_search',
  status_reason     text,
  anomaly_flag      boolean     NOT NULL DEFAULT false,
  anomaly_delta_pct numeric,
  metric_config     jsonb,
  CONSTRAINT daily_truth_pk PRIMARY KEY (metric_key, area, period, source_tag)
);
CREATE INDEX IF NOT EXISTS daily_truth_retrieved_idx ON data_lake.daily_truth (retrieved_at DESC);
GRANT SELECT ON data_lake.daily_truth TO service_role;
"""

def main() -> None:
    with psycopg.connect(_uri(), connect_timeout=30) as conn:
        with conn.cursor() as cur:
            cur.execute(DDL)
            cur.execute("NOTIFY pgrst, 'reload schema';")
        conn.commit()
        # verify
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM information_schema.columns "
                        "WHERE table_schema='data_lake' AND table_name='daily_truth';")
            assert cur.fetchone()[0] >= 17, "daily_truth columns missing"
    print("migrate_daily_truth: OK")

if __name__ == "__main__":
    main()
```

- [ ] **Step 1.2: Run it and verify.**

```bash
python -m ingest.scripts.migrate_daily_truth
# Expected: "migrate_daily_truth: OK"
python -c "import psycopg; from ingest.scripts.migrate_nfip_flood_zone_current import _uri; \
c=psycopg.connect(_uri()); print(c.execute('select count(*) from data_lake.daily_truth').fetchone())"
# Expected: (0,)
```

- [ ] **Step 1.3: Commit** (`git add ingest/scripts/migrate_daily_truth.py`).

---

## Task 2 — Engine: fallback cascade + provenance gate + anomaly check (TDD)

- [ ] **Step 2.1: Write the failing tests first** (`ingest/pipelines/live_search/tests/test_engine.py`). Cover the MOAT invariants:

```python
import pytest
from ingest.pipelines.live_search import engine

def test_extract_numbers_normalizes_money():
    # "$360K", "359,950", "$360,000" all parse near 360000
    nums = engine.extract_numbers("Median sale price was $360K (up from $359,950).")
    assert any(abs(n - 360000) <= 1000 for n in nums)
    assert any(abs(n - 359950) <= 1) for n in [n for n in nums]

def test_verify_on_page_numeric_tolerance(monkeypatch):
    monkeypatch.setattr(engine, "_scrape_text", lambda url: "Cape Coral median sale price: $362,000")
    assert engine.verify_on_page(360000, "https://anylocalrealtor.com/x", denylist_domains=[], tolerance_pct=10)
    assert not engine.verify_on_page(360000, "https://anylocalrealtor.com/x", denylist_domains=[], tolerance_pct=0.1)

def test_accepts_real_nonbrand_grounded_source(monkeypatch):
    # OPEN APERTURE: a real LOCAL realtor's site is a valid source (not only Redfin/Zillow).
    monkeypatch.setattr(engine, "_scrape_text", lambda url: "Our latest Cape Coral median: $361,500")
    assert engine.verify_on_page(360000, "https://gulfcoastrealtygroup.com/market", denylist_domains=[], tolerance_pct=10)

def test_verify_rejects_denylisted_source(monkeypatch):
    # LittleBird Realty is ALWAYS thrown out, even when the number matches.
    monkeypatch.setattr(engine, "_scrape_text", lambda url: "median $360,000")
    assert engine.is_denylisted("https://littlebird-realty.com/x", [])
    assert not engine.verify_on_page(360000, "https://littlebird-realty.com/x", denylist_domains=[], tolerance_pct=10)

def test_memory_number_skipped_no_source_url():
    # A number with NO source_url = model memory = never used; cascade falls through, nothing sourced -> NULL.
    row = engine.finalize_with_anomaly(None, cfg=_cfg(), area="cape_coral")
    assert row.value is None and "no source" in row.status_reason.lower()

def test_resolve_vertex_redirect(monkeypatch):
    monkeypatch.setattr(engine, "_follow_redirect",
                        lambda u: "https://www.redfin.com/news/data-center/")
    out = engine.resolve_source_url("https://vertexaisearch.cloud.google.com/grounding-api-redirect/AB12")
    assert "redfin.com" in out

def test_cascade_falls_through_when_gemini_empty(monkeypatch):
    # FAILSAFE: Gemini down / no usable grounded result -> next leg keeps data flowing.
    monkeypatch.setattr(engine, "gemini_grounded", lambda q: None)
    monkeypatch.setattr(engine, "firecrawl_search",
        lambda q, dl: engine.Candidate(361000, "realtor.com", "https://realtor.com/x", "firecrawl"))
    monkeypatch.setattr(engine, "_prior_value", lambda mk, a: 360000)
    row = engine.resolve_metric_search(_cfg(anomaly_threshold_pct=8), area="cape_coral")
    assert row.value == 361000 and row.engine == "firecrawl" and row.anomaly_flag is False

def test_bootstrap_uses_multiple_sources():
    # FIRST run confirms 2-3 sources agree closely before setting the baseline.
    cands = [engine.Candidate(360000, "redfin.com", "https://r/x", "gemini"),
             engine.Candidate(362000, "gulfcoastrealty.com", "https://g/x", "firecrawl")]
    n, winner = engine.cross_check(cands, tolerance_pct=8)
    assert n == 2 and abs(winner.value - 361000) < 3000

def test_within_band_loads_one_search(monkeypatch):
    monkeypatch.setattr(engine, "_prior_value", lambda mk, a: 360000)
    row = engine.finalize_with_anomaly(engine.Candidate(366000, "x.com", "https://x.com/u", "gemini"),
                                       cfg=_cfg(anomaly_threshold_pct=8), area="cape_coral")
    assert row.value == 366000 and row.anomaly_flag is False        # +1.7% within band -> no 2nd search

def test_anomaly_confirmed_by_second_source_loads(monkeypatch):
    # big move BUT a different source confirms ~same -> real move -> loads, no flag
    monkeypatch.setattr(engine, "_prior_value", lambda mk, a: 360000)
    monkeypatch.setattr(engine, "_second_source_value", lambda cfg, a: 498000)
    row = engine.finalize_with_anomaly(engine.Candidate(500000, "x.com", "https://x.com/u", "gemini"),
                                       cfg=_cfg(anomaly_threshold_pct=8), area="cape_coral")
    assert row.value == 500000 and row.anomaly_flag is False

def test_anomaly_holds_when_second_source_disagrees(monkeypatch):
    # +38.9% vs prior, 2nd source does NOT confirm -> stored but anomaly_flag=True (held for human review)
    monkeypatch.setattr(engine, "_prior_value", lambda mk, a: 360000)
    monkeypatch.setattr(engine, "_second_source_value", lambda cfg, a: None)
    row = engine.finalize_with_anomaly(engine.Candidate(500000, "x.com", "https://x.com/u", "gemini"),
                                       cfg=_cfg(anomaly_threshold_pct=8), area="cape_coral")
    assert row.anomaly_flag is True and round(row.anomaly_delta_pct) == 39

def test_out_of_range_flags_null():
    row = engine.finalize_with_anomaly(engine.Candidate(9_000_000, "x.com", "https://x.com/u", "gemini"),
                                       cfg=_cfg(expected_range=(200000, 900000)), area="cape_coral")
    assert row.value is None and "range" in row.status_reason.lower()

def test_api_mode_fred_happy_path(monkeypatch):
    monkeypatch.setattr(engine, "_fred_latest", lambda series_id: (6.52, "2026-06-11"))
    row = engine.resolve_metric_api(_cfg(fetch_mode="api",
        api_config={"provider": "fred", "series_id": "MORTGAGE30US"}, unit="pct"), area="swfl")
    assert row.value == 6.52 and row.engine == "fred"
```

- [ ] **Step 2.2: Run them — expect failures** (`pytest ingest/pipelines/live_search/tests/test_engine.py -x`). Expected: import/attribute errors (engine not implemented).

- [ ] **Step 2.3: Implement `engine.py`** to pass. Key surfaces (complete enough to implement, not paraphrase):

```python
"""Gemini-discovery + verify engine for data_lake.daily_truth. Pure (no DB). MOAT: never return a memory number — every value must trace to a real groundingChunk URL."""
from __future__ import annotations
import os, re, requests
from dataclasses import dataclass, field
from statistics import median
from ingest.lib.extract_client import scrape_with_fallback, ExtractError

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")  # Gemini 3 stable; confirm grounding support per STEP 0
DENYLIST_DEFAULT = ("littlebird",)   # LittleBird Realty — always thrown out; extend via metric_config.denylist_domains
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
_MONEY = re.compile(r"\$?\s*([\d]{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([KkMm])?")

@dataclass
class Candidate:
    value: float; domain: str; source_url: str; engine: str
    grounded: bool = False        # True ONLY if value traces to a Gemini groundingChunk URL (NOT model memory)
    source_title: str = ""

@dataclass
class DailyTruthRow:
    metric_key: str; area: str; period: str; value: float | None; unit: str
    source_url: str | None = None; source_title: str | None = None; engine: str | None = None
    query_text: str | None = None; agreement_n: int = 0; verified_on_page: bool = False
    source_tag: str = "live_search"; status_reason: str | None = None
    anomaly_flag: bool = False; anomaly_delta_pct: float | None = None
    metric_config: dict = field(default_factory=dict)

def extract_numbers(text: str) -> list[float]:
    out = []
    for raw, suffix in _MONEY.findall(text or ""):
        n = float(raw.replace(",", ""))
        if suffix and suffix.lower() == "k": n *= 1_000
        if suffix and suffix.lower() == "m": n *= 1_000_000
        out.append(n)
    return out

def _follow_redirect(url: str) -> str:
    r = requests.head(url, allow_redirects=True, timeout=20)
    return r.url

def resolve_source_url(url: str) -> str:
    return _follow_redirect(url) if "vertexaisearch.cloud.google.com" in (url or "") else url

def _domain_of(url: str) -> str:
    m = re.match(r"https?://([^/]+)/?", url or ""); return (m.group(1).lower() if m else "").lstrip("www.")

def _scrape_text(url: str) -> str:
    try: return scrape_with_fallback(url, formats=("markdown",)) or ""
    except ExtractError: return ""

def is_denylisted(url: str, denylist: list[str]) -> bool:
    dom = _domain_of(resolve_source_url(url))
    terms = tuple(denylist or ()) + DENYLIST_DEFAULT
    return any(t in dom for t in terms)

def verify_on_page(value: float, source_url: str, denylist_domains: list[str], tolerance_pct: float) -> bool:
    # OPEN APERTURE: any REAL source is allowed; only a denylisted source (LittleBird/competitors) is rejected.
    if is_denylisted(source_url, denylist_domains):
        return False
    text = _scrape_text(resolve_source_url(source_url))   # re-fetch the grounded URL (Firecrawl→Spider)
    tol = abs(value) * tolerance_pct / 100.0
    return any(abs(n - value) <= tol for n in extract_numbers(text))

def cross_check(cands: list[Candidate], tolerance_pct: float) -> tuple[int, Candidate | None]:
    if not cands: return 0, None
    vals = [c.value for c in cands]; m = median(vals); tol = abs(m) * tolerance_pct / 100.0
    agree = [c for c in cands if abs(c.value - m) <= tol]
    winner = min(agree or cands, key=lambda c: abs(c.value - m))
    return len(agree), winner

# --- CASCADE LEGS (failsafe order; each returns ONE sourced Candidate or None — first hit wins) ---
def gemini_grounded(question: str) -> Candidate | None:        # REST POST tools:[{google_search:{}}]
    ...  # number from candidates[0].content...text; source_url = resolve_source_url(groundingChunks[0].web.uri).
         # NO groundingChunk -> return None (the number would be model memory). Surface len(webSearchQueries) for billing.
def firecrawl_search(question: str, denylist: list[str]) -> Candidate | None: ...  # Firecrawl search/extract -> number + scraped url
def spider_search(question: str, denylist: list[str]) -> Candidate | None: ...     # Spider search/scrape -> number + url
def claude_last_resort(question: str) -> Candidate | None: ...                     # Haiku ONLY if it can attach a real fetched url; else None (never memory)

CASCADE = (lambda q, dl: gemini_grounded(q), firecrawl_search, spider_search, lambda q, dl: claude_last_resort(q))

def run_cascade(cfg, area) -> Candidate | None:
    dl = cfg.get("denylist_domains", [])
    for leg in CASCADE:                       # FAILSAFE: first leg returning a SOURCED, non-denylisted Candidate wins
        c = leg(_question(cfg, area), dl)
        if c and c.source_url and not is_denylisted(c.source_url, dl):
            return c
    return None                               # nothing sourced -> NULL + reason (never a memory guess)

# --- ANOMALY (vs OUR OWN prior daily_truth row; NOT the vendor) ---
def _prior_value(metric_key, area) -> float | None: ...        # most-recent EXISTING row: ORDER BY retrieved_at DESC LIMIT 1 (a vendor re-anchor row from file 05 becomes this baseline the day after the vendor updates)
def _second_source_value(cfg, area) -> float | None: ...       # one re-run from the NEXT cascade leg / a different source

def finalize_with_anomaly(winner, cfg, area) -> DailyTruthRow:
    if winner is None or not winner.source_url:
        return _null_row(cfg, area, "all cascade legs returned no sourced number")
    lo, hi = cfg["expected_range"]
    if not (lo <= winner.value <= hi):
        return _null_row(cfg, area, f"value {winner.value} outside expected_range")
    prior = _prior_value(cfg["metric_key"], area)
    delta = None if not prior else (winner.value - prior) / prior * 100.0
    if delta is not None and abs(delta) > cfg["anomaly_threshold_pct"]:
        second = _second_source_value(cfg, area)               # cron a 2nd run, DIFFERENT source
        confirmed = second is not None and abs(second - winner.value) / winner.value * 100.0 <= cfg["anomaly_threshold_pct"]
        if not confirmed:
            return _row(winner, cfg, area, anomaly_flag=True, anomaly_delta_pct=delta)   # stored, HELD for review
    return _row(winner, cfg, area, anomaly_flag=False, anomaly_delta_pct=delta)

def resolve_metric_search(cfg, area) -> DailyTruthRow:         # NORMAL path: one cascade pass -> anomaly -> row
    return finalize_with_anomaly(run_cascade(cfg, area), cfg, area)
def resolve_metric_api(cfg, area) -> DailyTruthRow: ...        # FRED-style: _fred_latest(series_id) -> deterministic row (we HAVE the url)
def bootstrap_metric(cfg, area) -> DailyTruthRow: ...          # FIRST run only: 2-3 sources via cross_check; confirm close; set baseline
```

**Gemini leg detail (the first, normal-path leg):** POST `GEMINI_URL?key=$GEMINI_API_KEY` with `{"contents":[{"parts":[{"text": question}]}],"tools":[{"google_search":{}}]}`. The number comes from `candidates[0].content.parts[*].text` → `extract_numbers`; the source is `candidates[0].groundingMetadata.groundingChunks[0].web.uri` (+ `.web.title`) → `resolve_source_url`. **If `groundingChunks` is empty/absent the number is model memory → return `None`** and the cascade falls through to Firecrawl. **Instrument** `len(groundingMetadata.webSearchQueries)` per call, summed per run (the billed unit — $14/1k; warn near the 5,000-prompt/mo free ceiling).

**`finalize_with_anomaly` store rule (MOAT):** the cascade already guarantees `winner.source_url` is present + not denylisted. `finalize_with_anomaly` then: NULL if no sourced winner; NULL if outside `expected_range`; else compute `anomaly_delta_pct` vs our prior `daily_truth` row and, if `|Δ| > anomaly_threshold_pct`, run ONE second-source confirm — confirmed → store (`anomaly_flag=false`); not confirmed → **store with `anomaly_flag=true`** (held for human review, NOT propagated to the brain). `verify_on_page` is **optional** (the source URL is the gate, not a re-scrape). `status_reason` values: `"all cascade legs returned no sourced number"` / `"value … outside expected_range"`.

- [ ] **Step 2.4: Run tests — expect pass** (`pytest ingest/pipelines/live_search/tests/test_engine.py -v`). Expected: all green.

- [ ] **Step 2.5: Commit** (`git add ingest/pipelines/live_search/`).

---

## Task 3 — Pipeline: registry-driven runner + idempotent upsert

- [ ] **Step 3.1: Implement `pipeline.py`.** Read the `live_search_config:` entries from `cadence_registry.yaml` (file 02 authors them), run `engine.resolve_metric_*` per `(metric, area)`, and upsert:

```python
def upsert(rows: list[DailyTruthRow]) -> int:
    landed = [r for r in rows if r.value is not None or r.status_reason]  # store NULL+reason rows too (audit trail)
    assert_min_rows(len([r for r in rows]), 1, "daily_truth")             # we ran at least one metric
    with psycopg.connect(_uri(), connect_timeout=30) as conn, conn.cursor() as cur:
        for r in rows:
            cur.execute("""
              INSERT INTO data_lake.daily_truth
                (metric_key, area, period, value, unit, source_url, source_title, engine,
                 query_text, agreement_n, verified_on_page, source_tag, status_reason,
                 anomaly_flag, anomaly_delta_pct, metric_config)
              VALUES (%(metric_key)s,%(area)s,%(period)s,%(value)s,%(unit)s,%(source_url)s,%(source_title)s,
                 %(engine)s,%(query_text)s,%(agreement_n)s,%(verified_on_page)s,%(source_tag)s,
                 %(status_reason)s,%(anomaly_flag)s,%(anomaly_delta_pct)s,%(metric_config)s)
              ON CONFLICT (metric_key, area, period, source_tag) DO UPDATE SET
                value=EXCLUDED.value, source_url=EXCLUDED.source_url, source_title=EXCLUDED.source_title,
                engine=EXCLUDED.engine, agreement_n=EXCLUDED.agreement_n,
                verified_on_page=EXCLUDED.verified_on_page, status_reason=EXCLUDED.status_reason,
                anomaly_flag=EXCLUDED.anomaly_flag, anomaly_delta_pct=EXCLUDED.anomaly_delta_pct,
                retrieved_at=now(), metric_config=EXCLUDED.metric_config
            """, _as_params(r))
        conn.commit()
    return len(rows)
```

This is a **non-destructive merge** (no `replace`/truncate) → the Gate-4 non-null guard does not apply (README §6). CLI: `python -m ingest.pipelines.live_search.pipeline [--dry-run] [--metric <id>]`. `--dry-run` prints rows (value + source + agreement + verified) without writing — mirror `estero_edc/pipeline.py`.

- [ ] **Step 3.2: End-to-end smoke (one metric).**

```bash
python -m ingest.pipelines.live_search.pipeline --dry-run --metric live_search_daily_median_price
# Expected: the cascade returns {value, real source_url, engine, anomaly_flag} for cape_coral/fort_myers/naples (Gemini on the normal path)
python -m ingest.pipelines.live_search.pipeline --metric live_search_daily_median_price
python -c "import psycopg; from ingest.scripts.migrate_nfip_flood_zone_current import _uri; \
print(psycopg.connect(_uri()).execute(\"select metric_key,area,value,source_tag,verified_on_page from data_lake.daily_truth order by retrieved_at desc limit 10\").fetchall())"
# Expected: rows with verified_on_page=true and a non-vertexaisearch source_url, OR value=NULL with a status_reason — never a bare number.
```

- [ ] **Step 3.3: Commit** (`git add ingest/pipelines/live_search/pipeline.py`).

---

## Definition of Done

- `data_lake.daily_truth` exists with the §3a schema, PK `(metric_key, area, period, source_tag)`, `GRANT SELECT TO service_role`, PostgREST reloaded.
- `pytest ingest/pipelines/live_search/tests/test_engine.py` is green, covering: cascade failover (Gemini empty → Firecrawl keeps data flowing), bootstrap multi-source agreement, within-band one-search load, anomaly confirmed-by-2nd-source → loads, anomaly unconfirmed → `anomaly_flag=true`, memory/no-source → NULL, range-guard → NULL, denylist (LittleBird) reject, redirect-resolve, api-mode FRED.
- A live run writes rows that are **either** sourced (`source_url` present, not denylisted, within band, anomaly-checked) **or** `NULL + status_reason` — **never a memory number** (grep: no row has `value IS NOT NULL AND source_url IS NULL`). A big day-over-day move is either second-source-confirmed or carries `anomaly_flag=true` for review (never silently swallowed).
- **Board row:** `01-daily-truth-engine` GREEN — engine smoke passes, table populated for the first metric.
