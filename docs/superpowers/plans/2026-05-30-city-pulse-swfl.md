# City Pulse SWFL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a daily, city-grain current-events layer — a `city-pulse-swfl` reporter brain fed by a daily web-search ingest, distilled into a TTL'd `data_lake.city_pulse` table, wired as a `master` upstream.

**Architecture:** A daily Python pipeline runs one `web_search_20250305` call per city (7 cities), writes raw captures to Tier-1 cold storage, then an LLM distill step turns each capture into citation-backed per-fact rows in `data_lake.city_pulse` (deduped, TTL'd by topic). A deterministic `city-pulse-swfl` pack reads non-expired rows and emits a standard `BrainOutput` whose every surfaced signal carries a `key_metrics[].source` receipt. Master consumes it as a Tier-1 reporter; the already-live Tier-3 carry contract handles question-time relevance.

**Tech Stack:** Python 3.13 (`anthropic`, `psycopg` v3) for ingest/distill; TypeScript `.mts` (refinery, `@supabase/supabase-js`) for the source + pack; Postgres (Supabase) Tier-2 table; GitHub Actions cron.

**Spec:** `docs/superpowers/specs/2026-05-30-city-pulse-flywheel-design.md`

---

## Corrections to the spec (apply mentally; spec patched separately)

1. **Citation gate.** The spec §8 says the corridor-character `[web-N]` write-blocking lint governs this pack. It does not — that lint is for the free-form corridor-character surface. A standard reporter pack's provenance is the **`key_metrics[].source` receipt** (`BrainOutputMetricSource`, enforced by `spec-validator`) plus the standard `facts-only-lint` / `inference-bait-lint` / `smoothing-lint` render stack (CLAUDE.md Brain Factory rule 7). The structural "no unbacked claim" guarantee here = **the distill step drops any fact lacking a backing citation**, and every surfaced signal becomes a `key_metric` carrying its source `url` + `cited_text`.
2. **v1 flywheel scope.** v1 = **dedup-on-write** (`ON CONFLICT (dedup_key) DO NOTHING`) + **TTL-filtered reads** (the pack reads only non-expired rows). Search volume stays constant at 7 calls/day in v1 (one broad query per city covers all topics). True **search-volume-shrink** (skip the search when a city's topics are all fresh) requires topic-scoped queries and is a **v2 refinement** (ships with the weekly corridor trigger). Cost is ~$0.9–1.5/day either way — noise.

---

## File structure

| File                                                               | Responsibility                                                      | Create/Modify |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- | ------------- |
| `docs/sql/2026-05-30_city_pulse.sql`                               | Tier-2 table + grants (idempotent)                                  | Create        |
| `ingest/pipelines/city_pulse/__init__.py`                          | package marker                                                      | Create        |
| `ingest/pipelines/city_pulse/pipeline.py`                          | capture (7-city web_search) → Tier-1 NDJSON → orchestrate distill   | Create        |
| `ingest/pipelines/city_pulse/distill.py`                           | raw capture → citation-backed Tier-2 rows (LLM + dedup + TTL)       | Create        |
| `ingest/pipelines/city_pulse/test_pipeline.py`                     | capture-loop + record-shape tests                                   | Create        |
| `ingest/pipelines/city_pulse/test_distill.py`                      | distill: topic/TTL/dedup/citation-drop tests                        | Create        |
| `refinery/sources/city-pulse-source.mts`                           | read non-expired `data_lake.city_pulse` → `RawFragment[]`           | Create        |
| `refinery/sources/fixtures/city-pulse.json`                        | fixture rows for `env.source === "fixture"`                         | Create        |
| `refinery/packs/city-pulse-swfl.mts`                               | deterministic pack: corpusSummary + outputProducer + PackDefinition | Create        |
| `refinery/packs/city-pulse-swfl.test.mts`                          | pack snapshot + citation-receipt + empty-guard tests                | Create        |
| `refinery/packs/index.mts`                                         | register pack (import + `PER_PACK_REGISTRY` entry)                  | Modify        |
| `refinery/packs/catalog.mts`                                       | add `BRAIN_CATALOG` entry                                           | Modify        |
| `refinery/packs/master.mts:270-286`                                | add `input_brains` edge                                             | Modify        |
| `ingest/cadence_registry.yaml`                                     | add city_pulse entry; remove `news_swfl` not_yet_running entry      | Modify        |
| `.github/workflows/city-pulse-daily.yml`                           | daily cron + `--dry-run`                                            | Create        |
| `ingest/pipelines/news_swfl/` + `.github/workflows/news-daily.yml` | delete dead scraper                                                 | Delete        |

**Branch:** create a feature branch `feat/city-pulse-swfl` (do NOT work on `main`). Everything below is ONE PR (brain-first gate: pack + migration land together).

---

## Task 1: Tier-2 table migration

**Files:**

- Create: `docs/sql/2026-05-30_city_pulse.sql`

- [ ] **Step 1: Write the idempotent migration SQL**

```sql
-- data_lake.city_pulse — distilled daily city-grain current-events facts.
-- One row per distilled fact; TTL + dedup operate at fact grain (the flywheel).
-- Written by ingest/pipelines/city_pulse/distill.py (psycopg, non-dlt).
-- Read by refinery/sources/city-pulse-source.mts via getSupabase().schema("data_lake").
CREATE TABLE IF NOT EXISTS data_lake.city_pulse (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  city          TEXT        NOT NULL,   -- one of the 7 pipeline CITIES
  topic         TEXT        NOT NULL,   -- volatility class: breaking|transactions|development|business|structural
  fact          TEXT        NOT NULL,   -- distilled claim, numbers verbatim
  source_url    TEXT        NOT NULL,   -- backs the metric source receipt
  source_title  TEXT,
  cited_text    TEXT,                   -- <=150-char span from the web_search citation
  captured_at   TIMESTAMPTZ NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,   -- captured_at + TTL(topic) — drives the flywheel
  dedup_key     TEXT        NOT NULL,   -- sha256(city|topic|normalized-fact)
  superseded_by BIGINT      REFERENCES data_lake.city_pulse(id),  -- reserved (v2)
  run_at        TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS city_pulse_dedup_uidx ON data_lake.city_pulse (dedup_key);
CREATE INDEX        IF NOT EXISTS city_pulse_live_idx   ON data_lake.city_pulse (city, topic, expires_at);
GRANT SELECT ON data_lake.city_pulse TO service_role;  -- brain-platform read key (read-only)
```

- [ ] **Step 2: Apply the migration directly (Claude's job, not the operator's)**

Run (idempotent; safe to re-run):

```bash
python -c "import psycopg, pathlib; \
conninfo=__import__('tomllib').load(open('.dlt/secrets.toml','rb'))['destination']['postgres']['credentials']; \
sql=pathlib.Path('docs/sql/2026-05-30_city_pulse.sql').read_text(); \
con=psycopg.connect(f\"postgresql://{conninfo['username']}:{conninfo['password']}@{conninfo['host']}:{conninfo.get('port',5432)}/{conninfo.get('database','postgres')}\", sslmode='require'); \
con.execute(sql); con.commit(); \
print(con.execute(\"SELECT count(*) FROM data_lake.city_pulse\").fetchone()); con.close()"
```

Expected: prints `(0,)` — table exists, empty. If `.dlt/secrets.toml` shape differs, fall back to `DESTINATION__POSTGRES__CREDENTIALS` connstring directly.

- [ ] **Step 3: Commit**

```bash
git add docs/sql/2026-05-30_city_pulse.sql
git commit -m "feat(city-pulse): data_lake.city_pulse Tier-2 table migration"
```

---

## Task 2: Capture pipeline skeleton (package + cities + slug)

**Files:**

- Create: `ingest/pipelines/city_pulse/__init__.py` (empty)
- Create: `ingest/pipelines/city_pulse/pipeline.py`
- Test: `ingest/pipelines/city_pulse/test_pipeline.py`

- [ ] **Step 1: Write the failing test for the city list + slug**

`ingest/pipelines/city_pulse/test_pipeline.py`:

```python
from ingest.pipelines.city_pulse.pipeline import CITIES, slug


def test_seven_cities_including_lehigh():
    assert CITIES == [
        "Lehigh Acres", "Cape Coral", "Fort Myers", "Naples",
        "Estero", "Bonita Springs", "Fort Myers Beach",
    ]


def test_slug_is_filesystem_safe():
    assert slug("Fort Myers Beach") == "fort-myers-beach"
    assert slug("Lehigh Acres") == "lehigh-acres"
```

- [ ] **Step 2: Run it, verify failure**

Run: `python -m pytest ingest/pipelines/city_pulse/test_pipeline.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ingest.pipelines.city_pulse'`

- [ ] **Step 3: Create the package marker and the skeleton with CITIES + slug**

Create empty `ingest/pipelines/city_pulse/__init__.py`.

`ingest/pipelines/city_pulse/pipeline.py` (header + constants + slug; rest filled in later tasks):

```python
"""SWFL city pulse — daily current-events capture -> Tier-1 cold + Tier-2 distilled.

Per city: one Anthropic web_search_20250305 call captures current signals
(openings, layoffs, construction starts, major sales, disasters). The raw
response + flattened citations[] is written to Tier-1 cold storage; distill.py
then turns it into citation-backed rows in data_lake.city_pulse.

Tool version: web_search_20250305 — NOT web_search_20260209. The 20260209
dynamic filtering suppresses per-claim citations[] (repo A/B 2026-05-26:
9 vs 0 cited_text spans). Per-claim citations are the no-hallucination spine.
See ingest/pipelines/corridor_grounded/pipeline.py and
docs/vendor-notes/anthropic-web-search-wire-up.md.

Env: ANTHROPIC_API_KEY + SUPABASE_URL + SUPABASE_SERVICE_KEY +
DESTINATION__POSTGRES__CREDENTIALS.

CLI:
  python -m ingest.pipelines.city_pulse.pipeline
  python -m ingest.pipelines.city_pulse.pipeline --dry-run
  python -m ingest.pipelines.city_pulse.pipeline --city "Naples"
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import anthropic
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[3] / ".env.local")

from ingest.lib.storage_uploader import _upload_bytes  # noqa: E402
from ingest.lib.tier1_inventory import upsert_inventory_row  # noqa: E402

CITIES = [
    "Lehigh Acres", "Cape Coral", "Fort Myers", "Naples",
    "Estero", "Bonita Springs", "Fort Myers Beach",
]

MODEL = "claude-sonnet-4-6"
SEARCH_TOOL_VERSION = "web_search_20250305"
BUCKET = "lake-tier1"

# Audited domains. naplesnews.com + news-press.com BLOCK Anthropic's crawler
# (verified in corridor_grounded), so SWFL news comes from the publishers below
# plus county/gov/state primary sources. Do NOT add the blocked papers.
ALLOWED_DOMAINS = [
    "gulfshorebusiness.com",
    "businessobserverfl.com",
    "winknews.com",
    "leegov.com",
    "colliercountyfl.gov",
    "capecoral.gov",
    "cityftmyers.com",
    "leepa.org",
    "collierappraiser.com",
    "floridajobs.org",
    "bls.gov",
    "census.gov",
]


def slug(city: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", city.lower()).strip("-")
```

- [ ] **Step 4: Run the test, verify pass**

Run: `python -m pytest ingest/pipelines/city_pulse/test_pipeline.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add ingest/pipelines/city_pulse/__init__.py ingest/pipelines/city_pulse/pipeline.py ingest/pipelines/city_pulse/test_pipeline.py
git commit -m "feat(city-pulse): capture pipeline skeleton (CITIES + slug)"
```

---

## Task 3: Capture — web_search call + record builder

**Files:**

- Modify: `ingest/pipelines/city_pulse/pipeline.py`
- Test: `ingest/pipelines/city_pulse/test_pipeline.py`

- [ ] **Step 1: Write the failing test for `_extract_citations` and `build_record`**

Append to `test_pipeline.py`:

```python
from ingest.pipelines.city_pulse.pipeline import _extract_citations, build_record


def test_extract_citations_dedupes_by_url_and_text():
    content = [
        {"citations": [
            {"url": "https://gulfshorebusiness.com/a", "title": "A", "cited_text": "Amazon bought 60M of land", "type": "web_search_result_location"},
            {"url": "https://gulfshorebusiness.com/a", "title": "A", "cited_text": "Amazon bought 60M of land", "type": "web_search_result_location"},
        ]},
        {"citations": None},
    ]
    out = _extract_citations(content)
    assert len(out) == 1
    assert out[0]["url"] == "https://gulfshorebusiness.com/a"


def test_build_record_shape():
    dump = {"content": [{"citations": [{"url": "https://x.com", "title": "T", "cited_text": "c"}]}],
            "usage": {"input_tokens": 10, "output_tokens": 5}, "stop_reason": "end_turn"}
    rec = build_record("Naples", "q", dump, "2026-05-30T00:00:00Z")
    assert rec["city"] == "Naples"
    assert rec["city_slug"] == "naples"
    assert rec["tool_version"] == "web_search_20250305"
    assert rec["cited_text_count"] == 1
    assert rec["response"] == dump
```

- [ ] **Step 2: Run, verify failure**

Run: `python -m pytest ingest/pipelines/city_pulse/test_pipeline.py -v`
Expected: FAIL — `ImportError: cannot import name '_extract_citations'`

- [ ] **Step 3: Implement the query template, citation extractor, record builder, search call**

Append to `pipeline.py`:

```python
QUERY_TEMPLATE = (
    "Provide a current-events briefing for {city}, Florida (Southwest Florida, "
    "Lee or Collier County) covering the LAST 60 DAYS. Surface concrete, dated "
    "developments in these areas:\n"
    "- New business openings, closings, expansions, or major hiring/layoffs.\n"
    "- Commercial building sales, large lease signings, or land acquisitions.\n"
    "- Construction starts, planning-board approvals, or permit milestones.\n"
    "- Storm, flood, or disaster impacts to the local economy.\n\n"
    "Quote specific figures, company names, dollar amounts, and dates. Cite each "
    "claim to its primary source (local news, county records, company releases)."
)

USER_LOCATION = {
    "type": "approximate",
    "city": "Fort Myers",
    "region": "Florida",
    "country": "US",
    "timezone": "America/New_York",
}


def _extract_citations(content: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Flatten all non-null citations from model_dump() content blocks, deduped."""
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for block in content:
        for c in block.get("citations") or []:
            key = f"{c.get('url')}|{c.get('cited_text', '')[:60]}"
            if key in seen:
                continue
            seen.add(key)
            out.append({
                "url": c.get("url"),
                "title": c.get("title"),
                "cited_text": c.get("cited_text"),
                "type": c.get("type"),
            })
    return out


def build_record(city: str, query: str, response_dump: dict[str, Any], run_at: str) -> dict[str, Any]:
    content = response_dump.get("content", [])
    citations = _extract_citations(content)
    usage = response_dump.get("usage", {}) or {}
    return {
        "city": city,
        "city_slug": slug(city),
        "query": query,
        "model": MODEL,
        "tool_version": SEARCH_TOOL_VERSION,
        "run_at": run_at,
        "input_tokens": usage.get("input_tokens"),
        "output_tokens": usage.get("output_tokens"),
        "stop_reason": response_dump.get("stop_reason"),
        "response": response_dump,
        "citations": citations,
        "cited_text_count": len(citations),
    }


def run_city_search(city: str, run_at: str) -> dict[str, Any]:
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    query = QUERY_TEMPLATE.format(city=city)
    response = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        tools=[{
            "type": SEARCH_TOOL_VERSION,
            "name": "web_search",
            "max_uses": 8,
            "allowed_domains": ALLOWED_DOMAINS,
            "user_location": USER_LOCATION,
        }],
        messages=[{"role": "user", "content": query}],
    )
    return build_record(city, query, response.model_dump(), run_at)
```

- [ ] **Step 4: Run, verify pass**

Run: `python -m pytest ingest/pipelines/city_pulse/test_pipeline.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add ingest/pipelines/city_pulse/pipeline.py ingest/pipelines/city_pulse/test_pipeline.py
git commit -m "feat(city-pulse): web_search capture call + citation extractor + record builder"
```

---

## Task 4: Distill — topic classes, TTL, dedup key

**Files:**

- Create: `ingest/pipelines/city_pulse/distill.py`
- Test: `ingest/pipelines/city_pulse/test_distill.py`

- [ ] **Step 1: Write failing tests for TTL + dedup_key + normalization (pure functions)**

`ingest/pipelines/city_pulse/test_distill.py`:

```python
from datetime import datetime, timezone

from ingest.pipelines.city_pulse.distill import (
    TTL_DAYS, dedup_key, expires_at_for, normalize_fact, VALID_TOPICS,
)


def test_ttl_classes():
    assert TTL_DAYS == {
        "breaking": 1, "transactions": 7, "development": 14,
        "business": 14, "structural": 90,
    }
    assert VALID_TOPICS == set(TTL_DAYS)


def test_normalize_fact_is_stable_under_whitespace_and_case():
    assert normalize_fact("Amazon  bought\n$60M  of LAND.") == normalize_fact("amazon bought $60m of land")


def test_dedup_key_is_deterministic_and_city_topic_scoped():
    a = dedup_key("Naples", "transactions", "Amazon bought $60M of land")
    b = dedup_key("Naples", "transactions", "amazon bought   $60m of LAND")
    c = dedup_key("Cape Coral", "transactions", "Amazon bought $60M of land")
    assert a == b
    assert a != c
    assert len(a) == 64  # sha256 hexdigest


def test_expires_at_adds_ttl():
    cap = datetime(2026, 5, 30, tzinfo=timezone.utc)
    exp = expires_at_for("breaking", cap)
    assert (exp - cap).days == 1
    assert expires_at_for("structural", cap).year == 2026
    assert (expires_at_for("structural", cap) - cap).days == 90
```

- [ ] **Step 2: Run, verify failure**

Run: `python -m pytest ingest/pipelines/city_pulse/test_distill.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ingest.pipelines.city_pulse.distill'`

- [ ] **Step 3: Implement the pure helpers**

`ingest/pipelines/city_pulse/distill.py`:

```python
"""SWFL city pulse — distill step.

Reads a Tier-1 capture record (one city), makes ONE cheap Anthropic call (no
web search — forced tool_use structured output) that turns the captured prose +
citations[] into discrete, citation-backed facts. Each fact is classified into a
volatility `topic` (which sets its TTL), backed by one of the supplied citation
URLs, and given a dedup_key. Facts with no backing citation are DROPPED — that is
the no-unbacked-claim guarantee, enforced before the row exists.

Writes to data_lake.city_pulse via psycopg with ON CONFLICT (dedup_key) DO NOTHING.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import anthropic

from ingest.lib.tier1_inventory import _get_connection

MODEL = "claude-sonnet-4-6"

TTL_DAYS: dict[str, int] = {
    "breaking": 1,
    "transactions": 7,
    "development": 14,
    "business": 14,
    "structural": 90,
}
VALID_TOPICS: set[str] = set(TTL_DAYS)


def normalize_fact(fact: str) -> str:
    """Lowercase + collapse whitespace + strip trailing punctuation for stable dedup."""
    return re.sub(r"\s+", " ", fact.lower()).strip().rstrip(".")


def dedup_key(city: str, topic: str, fact: str) -> str:
    raw = f"{city}|{topic}|{normalize_fact(fact)}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def expires_at_for(topic: str, captured_at: datetime) -> datetime:
    return captured_at + timedelta(days=TTL_DAYS[topic])
```

- [ ] **Step 4: Run, verify pass**

Run: `python -m pytest ingest/pipelines/city_pulse/test_distill.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add ingest/pipelines/city_pulse/distill.py ingest/pipelines/city_pulse/test_distill.py
git commit -m "feat(city-pulse): distill helpers — TTL classes, dedup key, normalization"
```

---

## Task 5: Distill — LLM extraction with citation enforcement

**Files:**

- Modify: `ingest/pipelines/city_pulse/distill.py`
- Test: `ingest/pipelines/city_pulse/test_distill.py`

- [ ] **Step 1: Write a failing test for `rows_from_extraction` (the pure post-processor)**

Append to `test_distill.py`:

```python
from ingest.pipelines.city_pulse.distill import rows_from_extraction


def _capture():
    return {
        "city": "Naples",
        "run_at": "2026-05-30T00:00:00Z",
        "citations": [
            {"url": "https://gulfshorebusiness.com/a", "title": "A", "cited_text": "Amazon bought $60M of land"},
        ],
    }


def test_rows_from_extraction_keeps_cited_facts_and_assigns_ttl():
    extraction = {"facts": [
        {"topic": "transactions", "fact": "Amazon bought $60M of land in Naples", "source_url": "https://gulfshorebusiness.com/a"},
    ]}
    rows = rows_from_extraction(_capture(), extraction)
    assert len(rows) == 1
    r = rows[0]
    assert r["city"] == "Naples" and r["topic"] == "transactions"
    assert r["source_url"] == "https://gulfshorebusiness.com/a"
    assert r["cited_text"] == "Amazon bought $60M of land"
    assert r["expires_at"] > r["captured_at"]
    assert len(r["dedup_key"]) == 64


def test_rows_from_extraction_drops_uncited_facts():
    extraction = {"facts": [
        {"topic": "transactions", "fact": "Unbacked rumor", "source_url": "https://made-up.com/x"},
    ]}
    assert rows_from_extraction(_capture(), extraction) == []


def test_rows_from_extraction_drops_invalid_topic():
    extraction = {"facts": [
        {"topic": "gossip", "fact": "x", "source_url": "https://gulfshorebusiness.com/a"},
    ]}
    assert rows_from_extraction(_capture(), extraction) == []
```

- [ ] **Step 2: Run, verify failure**

Run: `python -m pytest ingest/pipelines/city_pulse/test_distill.py -v`
Expected: FAIL — `ImportError: cannot import name 'rows_from_extraction'`

- [ ] **Step 3: Implement `rows_from_extraction` + the LLM `distill_capture` call**

Append to `distill.py`:

```python
EXTRACT_TOOL = {
    "name": "record_city_facts",
    "description": "Record discrete, citation-backed current-events facts for one SWFL city.",
    "input_schema": {
        "type": "object",
        "properties": {
            "facts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "topic": {"type": "string", "enum": sorted(VALID_TOPICS),
                                  "description": "Volatility class. breaking=disaster/sudden closure/major layoff; transactions=sales/big leases/land buys; development=construction/permits/approvals; business=openings/closings/expansions/hiring; structural=ownership/long-run posture."},
                        "fact": {"type": "string", "description": "One concrete claim, numbers and dates verbatim."},
                        "source_url": {"type": "string", "description": "MUST be one of the URLs from the provided citations — the source that backs this fact."},
                    },
                    "required": ["topic", "fact", "source_url"],
                },
            }
        },
        "required": ["facts"],
    },
}


def rows_from_extraction(capture: dict[str, Any], extraction: dict[str, Any]) -> list[dict[str, Any]]:
    """Turn the model's extraction into city_pulse rows, dropping any fact whose
    source_url is not in the capture's citations or whose topic is invalid.
    citation lookup carries title + cited_text onto the row."""
    by_url = {c.get("url"): c for c in capture.get("citations", []) if c.get("url")}
    captured_at = datetime.fromisoformat(capture["run_at"].replace("Z", "+00:00"))
    rows: list[dict[str, Any]] = []
    for f in extraction.get("facts", []):
        topic = f.get("topic")
        fact = (f.get("fact") or "").strip()
        url = f.get("source_url")
        if topic not in VALID_TOPICS or not fact:
            continue
        cite = by_url.get(url)
        if cite is None:  # uncited -> dropped (the guarantee)
            continue
        rows.append({
            "city": capture["city"],
            "topic": topic,
            "fact": fact,
            "source_url": url,
            "source_title": cite.get("title"),
            "cited_text": cite.get("cited_text"),
            "captured_at": captured_at,
            "expires_at": expires_at_for(topic, captured_at),
            "dedup_key": dedup_key(capture["city"], topic, fact),
            "run_at": captured_at,
        })
    return rows


def distill_capture(capture: dict[str, Any]) -> list[dict[str, Any]]:
    """One forced-tool-use call: extract facts from the capture's response text +
    citations, then post-process into rows. No web search here."""
    if not capture.get("citations"):
        return []  # nothing citable -> nothing to distill
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    response_text = json.dumps(capture["response"].get("content", []), ensure_ascii=False)
    citations_block = json.dumps(capture["citations"], ensure_ascii=False)
    prompt = (
        f"City: {capture['city']}.\n\n"
        f"Captured web_search response content:\n{response_text}\n\n"
        f"Available citations (you MUST set each fact's source_url to one of these URLs):\n{citations_block}\n\n"
        "Extract every concrete, dated current-events fact. Numbers and company "
        "names verbatim. Skip vague or undated statements. Call record_city_facts."
    )
    msg = client.messages.create(
        model=MODEL,
        max_tokens=2048,
        tools=[EXTRACT_TOOL],
        tool_choice={"type": "tool", "name": "record_city_facts"},
        messages=[{"role": "user", "content": prompt}],
    )
    extraction = next(
        (b.input for b in msg.content if getattr(b, "type", None) == "tool_use"),
        {"facts": []},
    )
    return rows_from_extraction(capture, extraction)
```

- [ ] **Step 4: Run, verify pass**

Run: `python -m pytest ingest/pipelines/city_pulse/test_distill.py -v`
Expected: PASS (7 passed)

- [ ] **Step 5: Commit**

```bash
git add ingest/pipelines/city_pulse/distill.py ingest/pipelines/city_pulse/test_distill.py
git commit -m "feat(city-pulse): distill LLM extraction + citation-drop enforcement"
```

---

## Task 6: Distill — Tier-2 upsert (dedup-on-write)

**Files:**

- Modify: `ingest/pipelines/city_pulse/distill.py`
- Test: `ingest/pipelines/city_pulse/test_distill.py`

- [ ] **Step 1: Write a failing test for the INSERT SQL builder (`_insert_sql`)**

Append to `test_distill.py`:

```python
from ingest.pipelines.city_pulse.distill import _insert_sql


def test_insert_sql_uses_on_conflict_do_nothing():
    sql = _insert_sql()
    assert "INSERT INTO data_lake.city_pulse" in sql
    assert "ON CONFLICT (dedup_key) DO NOTHING" in sql
    # all 10 insertable columns present (id + superseded_by are not inserted)
    for col in ["city", "topic", "fact", "source_url", "source_title",
                "cited_text", "captured_at", "expires_at", "dedup_key", "run_at"]:
        assert col in sql
```

- [ ] **Step 2: Run, verify failure**

Run: `python -m pytest ingest/pipelines/city_pulse/test_distill.py::test_insert_sql_uses_on_conflict_do_nothing -v`
Expected: FAIL — `ImportError: cannot import name '_insert_sql'`

- [ ] **Step 3: Implement `_insert_sql` + `write_rows`**

Append to `distill.py`:

```python
_INSERT_COLUMNS = [
    "city", "topic", "fact", "source_url", "source_title",
    "cited_text", "captured_at", "expires_at", "dedup_key", "run_at",
]


def _insert_sql() -> str:
    cols = ", ".join(_INSERT_COLUMNS)
    placeholders = ", ".join(f"%({c})s" for c in _INSERT_COLUMNS)
    return (
        f"INSERT INTO data_lake.city_pulse ({cols}) VALUES ({placeholders}) "
        "ON CONFLICT (dedup_key) DO NOTHING"
    )


def write_rows(rows: list[dict[str, Any]]) -> int:
    """Upsert rows; returns number of NEW rows inserted (dedup skips count as 0)."""
    if not rows:
        return 0
    conn = _get_connection()
    inserted = 0
    try:
        with conn.cursor() as cur:
            for row in rows:
                cur.execute(_insert_sql(), row)
                inserted += cur.rowcount  # 0 on conflict, 1 on insert
        conn.commit()
    finally:
        conn.close()
    return inserted
```

- [ ] **Step 4: Run, verify pass**

Run: `python -m pytest ingest/pipelines/city_pulse/test_distill.py -v`
Expected: PASS (8 passed)

- [ ] **Step 5: Commit**

```bash
git add ingest/pipelines/city_pulse/distill.py ingest/pipelines/city_pulse/test_distill.py
git commit -m "feat(city-pulse): distill Tier-2 upsert with ON CONFLICT dedup"
```

---

## Task 6B: Prune expired Tier-2 rows (keep the lake clean)

> The reader filters `expires_at > now()`, but expired rows would otherwise accumulate forever. A daily deterministic prune deletes them from Tier-2. **Safe because Tier-1 cold storage holds the permanent raw audit** — pruning Tier-2 loses nothing recoverable. (Content-aware _supersession_ — "announced" → "broke ground" — is a separate v2 concern; see spec §12. This task is time-based prune only.)

**Files:**

- Modify: `ingest/pipelines/city_pulse/distill.py`
- Test: `ingest/pipelines/city_pulse/test_distill.py`

- [ ] **Step 1: Write a failing test for `_prune_sql`**

Append to `test_distill.py`:

```python
from ingest.pipelines.city_pulse.distill import _prune_sql


def test_prune_sql_deletes_only_expired():
    sql = _prune_sql()
    assert sql.startswith("DELETE FROM data_lake.city_pulse")
    assert "expires_at < now()" in sql
```

- [ ] **Step 2: Run, verify failure**

Run: `python -m pytest ingest/pipelines/city_pulse/test_distill.py::test_prune_sql_deletes_only_expired -v`
Expected: FAIL — `ImportError: cannot import name '_prune_sql'`

- [ ] **Step 3: Implement `_prune_sql` + `prune_expired`**

Append to `distill.py`:

```python
def _prune_sql() -> str:
    # Tier-1 cold storage retains the permanent raw audit, so deleting expired
    # Tier-2 rows loses nothing recoverable. The reader already ignores them.
    return "DELETE FROM data_lake.city_pulse WHERE expires_at < now()"


def prune_expired() -> int:
    """Delete expired Tier-2 rows. Returns the number deleted."""
    conn = _get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(_prune_sql())
            deleted = cur.rowcount
        conn.commit()
    finally:
        conn.close()
    return deleted
```

- [ ] **Step 4: Run, verify pass**

Run: `python -m pytest ingest/pipelines/city_pulse/test_distill.py -v`
Expected: PASS (9 passed)

- [ ] **Step 5: Commit**

```bash
git add ingest/pipelines/city_pulse/distill.py ingest/pipelines/city_pulse/test_distill.py
git commit -m "feat(city-pulse): prune expired Tier-2 rows (Tier-1 keeps the audit)"
```

---

## Task 7: Capture pipeline `main()` — orchestrate capture → Tier-1 → distill

**Files:**

- Modify: `ingest/pipelines/city_pulse/pipeline.py`
- Test: `ingest/pipelines/city_pulse/test_pipeline.py`

- [ ] **Step 1: Write a failing test for `to_ndjson` + `tier1_path`**

Append to `test_pipeline.py`:

```python
from ingest.pipelines.city_pulse.pipeline import to_ndjson, tier1_path


def test_to_ndjson_round_trips():
    import json
    body = to_ndjson([{"city": "Naples", "a": 1}])
    assert json.loads(body.decode("utf-8").strip()) == {"city": "Naples", "a": 1}


def test_tier1_path_is_date_partitioned_and_slugged():
    p = tier1_path("Fort Myers Beach", "20260530T091500Z", "2026", "05")
    assert p == "city_pulse/fort-myers-beach/year=2026/month=05/run-20260530T091500Z.ndjson"
```

- [ ] **Step 2: Run, verify failure**

Run: `python -m pytest ingest/pipelines/city_pulse/test_pipeline.py -v`
Expected: FAIL — `ImportError: cannot import name 'to_ndjson'`

- [ ] **Step 3: Implement `to_ndjson`, `tier1_path`, and `main()`**

Append to `pipeline.py`:

```python
from ingest.pipelines.city_pulse.distill import distill_capture, write_rows, prune_expired  # noqa: E402


def to_ndjson(records: list[dict[str, Any]]) -> bytes:
    return ("\n".join(json.dumps(r, ensure_ascii=False) for r in records) + "\n").encode("utf-8")


def tier1_path(city: str, run_key: str, yyyy: str, mm: str) -> str:
    return f"city_pulse/{slug(city)}/year={yyyy}/month={mm}/run-{run_key}.ndjson"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--city", metavar="NAME", help="Run a single city by exact name.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Run search + distill; print rows, skip Tier-1 upload and DB write.")
    args = parser.parse_args(argv)

    cities = [args.city] if args.city else CITIES
    if args.city and args.city not in CITIES:
        parser.error(f"--city must be one of {CITIES}")

    now = datetime.now(timezone.utc)
    run_at = now.isoformat()
    run_key = now.strftime("%Y%m%dT%H%M%SZ")
    yyyy, mm = f"{now.year:04d}", f"{now.month:02d}"

    errors: list[str] = []
    total_new = 0
    for city in cities:
        print(f"city_pulse: querying '{city}'...")
        try:
            record = run_city_search(city, run_at)
        except Exception as exc:
            print(f"  -> ERROR (search): {exc!r}")
            errors.append(city)
            continue

        cited = record["cited_text_count"]
        print(f"  -> {cited} cited_text spans | {record['input_tokens']} in / {record['output_tokens']} out")
        if cited == 0:
            print(f"  -> WARNING: zero cited_text spans — verify SEARCH_TOOL_VERSION is '{SEARCH_TOOL_VERSION}'")

        path = tier1_path(city, run_key, yyyy, mm)
        body = to_ndjson([record])

        try:
            rows = distill_capture(record)
        except Exception as exc:
            print(f"  -> ERROR (distill): {exc!r}")
            errors.append(city)
            continue
        print(f"  -> distilled {len(rows)} citation-backed facts")

        if args.dry_run:
            for r in rows:
                print(f"     [{r['topic']}] {r['fact']}  <{r['source_url']}>")
            print(f"  -> --dry-run: would upload {len(body)} bytes to {BUCKET}/{path} and write {len(rows)} rows")
            continue

        _upload_bytes(BUCKET, path, body, "application/x-ndjson")
        upsert_inventory_row(bucket=BUCKET, path=path, vintage=f"{yyyy}-{mm}",
                             byte_size=len(body), pack_id="city-pulse-swfl", source_url=None)
        new = write_rows(rows)
        total_new += new
        print(f"  -> uploaded Tier-1 + wrote {new} new rows (deduped {len(rows) - new})")

    if not args.dry_run:
        pruned = prune_expired()
        print(f"city_pulse: pruned {pruned} expired Tier-2 rows (raw audit retained in Tier-1).")

    print(f"city_pulse: complete. {total_new} new rows across {len(cities)} cities.")
    if errors:
        print(f"city_pulse: {len(errors)} city(ies) errored: {errors}")
        if len(errors) == len(cities):
            raise RuntimeError("city_pulse: all cities failed — investigate.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run, verify pass**

Run: `python -m pytest ingest/pipelines/city_pulse/test_pipeline.py -v`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add ingest/pipelines/city_pulse/pipeline.py ingest/pipelines/city_pulse/test_pipeline.py
git commit -m "feat(city-pulse): pipeline main() — capture -> Tier-1 -> distill -> Tier-2"
```

---

## Task 8: Source connector — read non-expired `data_lake.city_pulse`

**Files:**

- Create: `refinery/sources/city-pulse-source.mts`
- Create: `refinery/sources/fixtures/city-pulse.json`
- Test: covered by the pack test (Task 10); this task ships the connector + fixture.

> Mirror `refinery/sources/tourism-tdt-source.mts` for the connector skeleton and `refinery/sources/bls-laus-source.mts:217` for the `.schema("data_lake")` read. Reuse `getSupabase()` from `refinery/sources/supabase.mts`; reuse `fragmentId`, `isoTimestamp`, `str` helpers from the shared source utils (same imports tourism-tdt uses — copy its import block at `tourism-tdt-source.mts:1-9`).

- [ ] **Step 1: Write the fixture**

`refinery/sources/fixtures/city-pulse.json`:

```json
[
  {
    "id": 1,
    "city": "Naples",
    "topic": "transactions",
    "fact": "Amazon acquired roughly $60M of inland land near Lehigh Acres for a distribution build-out",
    "source_url": "https://gulfshorebusiness.com/amazon-lehigh",
    "source_title": "Amazon expands inland",
    "cited_text": "Amazon paid about $60 million for the parcels",
    "captured_at": "2026-05-29T09:00:00Z",
    "expires_at": "2099-01-01T00:00:00Z",
    "dedup_key": "fixture-naples-transactions-amazon",
    "run_at": "2026-05-29T09:00:00Z"
  },
  {
    "id": 2,
    "city": "Cape Coral",
    "topic": "development",
    "fact": "City approved a 120,000 sqft mixed-use center at Pine Island Rd",
    "source_url": "https://capecoral.gov/pine-island-approval",
    "source_title": "Council approves mixed-use",
    "cited_text": "the 120,000-square-foot project cleared the council 7-1",
    "captured_at": "2026-05-29T09:00:00Z",
    "expires_at": "2099-01-01T00:00:00Z",
    "dedup_key": "fixture-capecoral-development-pineisland",
    "run_at": "2026-05-29T09:00:00Z"
  }
]
```

(Note `expires_at` set far in the future so fixture rows always read as live.)

- [ ] **Step 2: Write the connector**

`refinery/sources/city-pulse-source.mts`:

```typescript
/**
 * city-pulse source connector — reads non-expired rows from data_lake.city_pulse
 * (Tier 2, written daily by ingest/pipelines/city_pulse). Each row is one
 * citation-backed current-events fact; the pack turns them into key_metrics
 * with per-metric source receipts.
 *
 * Live mode: getSupabase().schema("data_lake").from("city_pulse"), filtered to
 * expires_at > now(). Fixture mode (env.source === "fixture"): loads the JSON
 * fixture. Throws on 0 live rows so a hollow brain never ships.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { env } from "../config/env.mts";
import { getSupabase } from "./supabase.mts";
import { fragmentId, isoTimestamp, str } from "./util.mts";
import type {
  SourceConnector,
  RawFragment,
  CitationRow,
} from "../types/source.mts";

const SOURCE_ID = "city-pulse";
const SCHEMA = "data_lake";
const TABLE = "city_pulse";

export interface CityPulseNormalized {
  kind: "city-pulse";
  city: string;
  topic: string;
  fact: string;
  source_url: string;
  source_title: string | null;
  cited_text: string | null;
  captured_at: string;
  expires_at: string;
}

function normalizeRow(row: Record<string, unknown>): CityPulseNormalized {
  return {
    kind: "city-pulse",
    city: str(row.city) ?? "",
    topic: str(row.topic) ?? "",
    fact: str(row.fact) ?? "",
    source_url: str(row.source_url) ?? "",
    source_title: str(row.source_title) ?? null,
    cited_text: str(row.cited_text) ?? null,
    captured_at: str(row.captured_at) ?? "",
    expires_at: str(row.expires_at) ?? "",
  };
}

function loadFixtureRows(): Record<string, unknown>[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(
    path.join(here, "fixtures", "city-pulse.json"),
    "utf-8",
  );
  return JSON.parse(raw) as Record<string, unknown>[];
}

async function fetchRows(): Promise<Record<string, unknown>[]> {
  if (env.source === "fixture") return loadFixtureRows();
  const nowIso = new Date().toISOString();
  const { data, error } = await getSupabase()
    .schema(SCHEMA)
    .from(TABLE)
    .select(
      "id, city, topic, fact, source_url, source_title, cited_text, captured_at, expires_at, run_at",
    )
    .gt("expires_at", nowIso);
  if (error) {
    throw new Error(
      `city-pulse-source: ${SCHEMA}.${TABLE} fetch failed — ${error.message}`,
    );
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) {
    throw new Error(
      `city-pulse-source: ${SCHEMA}.${TABLE} returned 0 non-expired rows.`,
    );
  }
  return rows;
}

export const cityPulseSource: SourceConnector = {
  source_id: SOURCE_ID,
  trust_tier: 2,
  async fetch(): Promise<RawFragment[]> {
    const rows = await fetchRows();
    const fetched_at = isoTimestamp();
    return rows.map((row): RawFragment<CityPulseNormalized> => {
      const normalized = normalizeRow(row);
      const idKey =
        str(row.id) ??
        `${normalized.city}:${normalized.topic}:${normalized.fact.slice(0, 24)}`;
      return {
        fragment_id: fragmentId(SOURCE_ID, idKey),
        source_id: SOURCE_ID,
        source_trust_tier: 2,
        fetched_at,
        raw: row,
        normalized,
      };
    });
  },
  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id"> {
    return {
      source:
        env.source === "fixture"
          ? "SWFL city pulse (fixture; daily web_search current-events facts)"
          : "SWFL city pulse — daily web_search current-events facts via Supabase data_lake.city_pulse (per-fact source URLs; topic-TTL'd)",
      verified: verifiedDate,
      expires: expiresFromVerified(verifiedDate, ttlSeconds),
    };
  },
};

function expiresFromVerified(verifiedDate: string, ttlSeconds: number): string {
  return new Date(new Date(verifiedDate).getTime() + ttlSeconds * 1000)
    .toISOString()
    .slice(0, 10);
}
```

> If `util.mts` does not export `str`/`fragmentId`/`isoTimestamp` under those exact names, check the import block of `tourism-tdt-source.mts:1-9` and use whatever it imports — the helpers exist; only the module path/names may differ. `expiresDate` may already exist in that util; prefer it over the local `expiresFromVerified` if present.

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit -p tsconfig.json` (or the repo's typecheck script, e.g. `bun run typecheck`)
Expected: no new errors in `city-pulse-source.mts`. Fix import-name mismatches against `tourism-tdt-source.mts`.

- [ ] **Step 4: Commit**

```bash
git add refinery/sources/city-pulse-source.mts refinery/sources/fixtures/city-pulse.json
git commit -m "feat(city-pulse): source connector reading non-expired data_lake.city_pulse"
```

---

## Task 9: Pack — corpusSummary (facts + snapshot stash)

**Files:**

- Create: `refinery/packs/city-pulse-swfl.mts`
- Test: `refinery/packs/city-pulse-swfl.test.mts` (Task 10)

> Model the whole pack on `refinery/packs/tourism-tdt.mts`: module-level closure state (`let lastSnapshot`), `corpusSummary` builds `SynthesisFact[]` and stashes the snapshot, `outputProducer` reads the snapshot and builds the `BrainOutputProducerResult`. Imports mirror `tourism-tdt.mts:1-14` (`env`, `PackDefinition`, `SynthesisFact`, `RawFragment`, `PackOutput`, `BrainOutputProducerResult`, `BrainOutputMetric`).

- [ ] **Step 1: Write the corpusSummary + types + slug constants**

`refinery/packs/city-pulse-swfl.mts`:

```typescript
/**
 * city-pulse-swfl — deterministic Tier-1 reporter for daily SWFL current events.
 *
 * Reads non-expired data_lake.city_pulse rows (one citation-backed fact each)
 * and emits a standard BrainOutput. Every surfaced signal becomes a key_metric
 * with a per-metric source receipt (url + cited_text) — that receipt is the
 * structural no-unbacked-claim guarantee on this surface (the distill step
 * already dropped any uncited fact). Reporter = cited facts, NO opinions;
 * direction/speculation stay with master.
 */
import { env } from "../config/env.mts";
import {
  cityPulseSource,
  type CityPulseNormalized,
} from "../sources/city-pulse-source.mts";
import type { PackDefinition } from "../types/pack.mts";
import type {
  RawFragment,
  SynthesisFact,
  PackOutput,
} from "../types/synthesis.mts";
import type {
  BrainOutputProducerResult,
  BrainOutputMetric,
} from "../types/brain-output.mts";

/** Topic display order + how many signals we surface as metrics (newest first). */
const TOPIC_PRIORITY = [
  "breaking",
  "transactions",
  "development",
  "business",
  "structural",
];
const MAX_SIGNALS = 8;

interface CityPulseSnapshot {
  signals: CityPulseNormalized[]; // non-expired, sorted
  fetched_at: string | null;
  cityCounts: Record<string, number>;
}

let lastSnapshot: CityPulseSnapshot | null = null;

function pulseRowsFrom(fragments: RawFragment[]): CityPulseNormalized[] {
  return fragments
    .map((f) => f.normalized as unknown as CityPulseNormalized)
    .filter((n) => n && n.kind === "city-pulse" && n.fact.length > 0);
}

function sortSignals(rows: CityPulseNormalized[]): CityPulseNormalized[] {
  return [...rows].sort((a, b) => {
    const t = TOPIC_PRIORITY.indexOf(a.topic) - TOPIC_PRIORITY.indexOf(b.topic);
    if (t !== 0) return t;
    return b.captured_at.localeCompare(a.captured_at); // newest first
  });
}

function cityPulseCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  const rows = sortSignals(pulseRowsFrom(allFragments));
  const cityCounts: Record<string, number> = {};
  for (const r of rows) cityCounts[r.city] = (cityCounts[r.city] ?? 0) + 1;
  const sourceFragment = allFragments.find(
    (f) =>
      (f.normalized as unknown as CityPulseNormalized)?.kind === "city-pulse",
  );
  lastSnapshot = {
    signals: rows,
    fetched_at: sourceFragment?.fetched_at ?? null,
    cityCounts,
  };

  if (rows.length === 0) return [];

  const facts: SynthesisFact[] = [];
  facts.push({
    topic: "city-pulse:summary",
    fact: `Live SWFL current-events signals`,
    value: `${rows.length} non-expired signals across ${Object.keys(cityCounts).length} cities (${Object.entries(
      cityCounts,
    )
      .map(([c, n]) => `${c}: ${n}`)
      .join(", ")}).`,
    source_fragment_ids: [],
  });
  for (const r of rows.slice(0, MAX_SIGNALS)) {
    facts.push({
      topic: `city-pulse:${r.topic}`,
      fact: `${r.city} — ${r.topic}`,
      value: `${r.fact} (source: ${r.source_url})`,
      source_fragment_ids: [],
    });
  }
  return facts;
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck` (or `bunx tsc --noEmit`)
Expected: no new errors. Fix any `synthesis.mts` import-name mismatches against `tourism-tdt.mts`.

- [ ] **Step 3: Commit**

```bash
git add refinery/packs/city-pulse-swfl.mts
git commit -m "feat(city-pulse): pack corpusSummary + snapshot stash"
```

---

## Task 10: Pack — outputProducer + PackDefinition + tests

**Files:**

- Modify: `refinery/packs/city-pulse-swfl.mts`
- Test: `refinery/packs/city-pulse-swfl.test.mts`

- [ ] **Step 1: Write the failing pack test**

`refinery/packs/city-pulse-swfl.test.mts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { cityPulseSwfl } from "./city-pulse-swfl.mts";
import type { RawFragment } from "../types/synthesis.mts";

function frag(over: Record<string, unknown>): RawFragment {
  return {
    fragment_id: "city-pulse:x",
    source_id: "city-pulse",
    source_trust_tier: 2,
    fetched_at: "2026-05-30T00:00:00Z",
    raw: {},
    normalized: {
      kind: "city-pulse",
      city: "Naples",
      topic: "transactions",
      fact: "Amazon bought $60M of land",
      source_url: "https://gulfshorebusiness.com/a",
      source_title: "A",
      cited_text: "Amazon paid $60M",
      captured_at: "2026-05-29T09:00:00Z",
      expires_at: "2099-01-01T00:00:00Z",
      ...over,
    } as unknown,
  } as RawFragment;
}

test("city-pulse-swfl: deterministic flags", () => {
  assert.equal(cityPulseSwfl.skipSynthesisAgent, true);
  assert.equal(cityPulseSwfl.skipTriageAgent, true);
  assert.equal(cityPulseSwfl.input_brains.length, 0);
});

test("city-pulse-swfl: each surfaced signal carries a source receipt with its url", () => {
  cityPulseSwfl.corpusSummary([frag({})]);
  const out = cityPulseSwfl.outputProducer({} as never);
  assert.ok(out.key_metrics.length >= 1);
  for (const m of out.key_metrics) {
    assert.ok(m.source.url.length > 0, "metric missing source url");
    assert.ok(m.source.citation.length > 0, "metric missing citation");
  }
  // the Amazon signal's receipt points at its real source
  assert.ok(
    out.key_metrics.some(
      (m) => m.source.url === "https://gulfshorebusiness.com/a",
    ),
  );
});

test("city-pulse-swfl: empty data yields a valid neutral output, no throw", () => {
  cityPulseSwfl.corpusSummary([]);
  const out = cityPulseSwfl.outputProducer({} as never);
  assert.equal(out.key_metrics.length, 0);
  assert.equal(out.direction, "neutral");
  assert.ok(out.caveats.length >= 1);
});
```

- [ ] **Step 2: Run, verify failure**

Run: `bun test refinery/packs/city-pulse-swfl.test.mts`
Expected: FAIL — `outputProducer`/`cityPulseSwfl` not exported.

- [ ] **Step 3: Implement outputProducer + PackDefinition**

Append to `refinery/packs/city-pulse-swfl.mts`:

```typescript
function cityPulseOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const snapshot = lastSnapshot;
  const fetched_at =
    snapshot?.fetched_at ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  if (!snapshot || snapshot.signals.length === 0) {
    return {
      conclusion:
        "city-pulse-swfl: no non-expired current-events signals in this build window — no live pulse to report.",
      key_metrics: [],
      caveats: [
        env.source === "fixture"
          ? "City pulse is reading FIXTURE data — unset REFINERY_SOURCE to read the live data_lake.city_pulse table."
          : "No non-expired city_pulse rows. Either the daily pulse has not run or all signals have aged past their TTL.",
      ],
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  const surfaced = snapshot.signals.slice(0, MAX_SIGNALS);
  const key_metrics: BrainOutputMetric[] = surfaced.map(
    (s, i): BrainOutputMetric => ({
      metric: `signal_${s.topic}_${i + 1}`,
      value: `${s.city}: ${s.fact}`,
      direction: "stable", // reporter facts carry no trend; master interprets
      label: `${s.city} — ${s.topic}`,
      variable_type: "categorical",
      source: {
        url: s.source_url,
        fetched_at,
        tier: 2,
        citation: s.cited_text
          ? `${s.source_title ?? s.city}: "${s.cited_text}"`
          : `${s.source_title ?? s.city} (${s.source_url})`,
      },
    }),
  );

  const cityList = Object.entries(snapshot.cityCounts)
    .map(([c, n]) => `${c} (${n})`)
    .join(", ");
  const conclusionParts = [
    `SWFL city pulse as of ${fetched_at.slice(0, 10)}: ${snapshot.signals.length} live current-events signals across ${Object.keys(snapshot.cityCounts).length} cities — ${cityList}.`,
  ];
  if (surfaced.length) {
    conclusionParts.push(
      `Most current: ${surfaced[0].city} — ${surfaced[0].fact}`,
    );
  }
  conclusionParts.push(
    "These are current cited facts only; the cross-vertical read and any direction call live downstream in master.",
  );

  const caveats: string[] = [];
  if (snapshot.signals.length > MAX_SIGNALS) {
    caveats.push(
      `${snapshot.signals.length - MAX_SIGNALS} additional live signals not surfaced here (cap ${MAX_SIGNALS}); the full set is in data_lake.city_pulse.`,
    );
  }
  caveats.push(
    "Each signal is dated current-events context with a per-signal source; freshness is TTL-bounded by topic (breaking 1d → structural 90d).",
  );

  return {
    conclusion: conclusionParts.join(" "),
    key_metrics,
    caveats,
    direction: "neutral",
    magnitude: 0,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
  };
}

export const cityPulseSwfl: PackDefinition = {
  id: "city-pulse-swfl",
  brain_id: "city-pulse-swfl",
  domain: "macro",
  scope:
    "SWFL (Lee + Collier) daily current-events pulse — dated business openings/closings, transactions, construction, and disaster signals for 7 cities (Lehigh Acres, Cape Coral, Fort Myers, Naples, Estero, Bonita Springs, Fort Myers Beach), each cited to a primary source.",
  ttl_seconds: 86400, // 1 day — daily pulse
  sources: [cityPulseSource],
  input_brains: [],
  fitScore: (): number => 8,
  compositeCutoff: 0,
  skipTriageAgent: true,
  skipSynthesisAgent: true,
  corpusSummary: cityPulseCorpusSummary,
  outputProducer: cityPulseOutputProducer,
  synthesisStrategy: "deterministic",
  preferences: [
    "The user reads city pulse as the fast 'what is happening right now' layer that the slower corridor and economic brains lack.",
    "The user expects every surfaced signal to be a dated, cited fact — never an opinion or a forecast.",
    "The user expects master to weigh these current signals against the structural reads downstream.",
  ],
  activeProject:
    "city-pulse-swfl: daily SWFL city-grain current-events reporter over data_lake.city_pulse (TTL'd, citation-backed).",
  prompts: {
    triageContext:
      "These fragments are non-expired city_pulse rows — one dated, citation-backed current-events fact each. Decision-relevant by construction; the pack is pure deterministic selection.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). Facts come from cityPulseCorpusSummary; the BrainOutput is built by cityPulseOutputProducer. Every metric carries a source receipt.",
  },
};
```

- [ ] **Step 4: Run, verify pass**

Run: `bun test refinery/packs/city-pulse-swfl.test.mts`
Expected: PASS (3 tests). If `domain: "macro"` is rejected by the `BrainDomain` type, use a valid domain from `pack.mts` (check the union; `"macro"` is used by macro-swfl so it is valid).

- [ ] **Step 5: Commit**

```bash
git add refinery/packs/city-pulse-swfl.mts refinery/packs/city-pulse-swfl.test.mts
git commit -m "feat(city-pulse): pack outputProducer + PackDefinition + tests"
```

---

## Task 11: Register the pack (index + catalog)

**Files:**

- Modify: `refinery/packs/index.mts`
- Modify: `refinery/packs/catalog.mts`

- [ ] **Step 1: Add the import + registry entry in `index.mts`**

After the existing pack imports (mirror the `tourism-tdt` import line), add:

```typescript
import { cityPulseSwfl } from "./city-pulse-swfl.mts";
```

Inside the `PER_PACK_REGISTRY` object (mirror the `[tourismTdt.id]: tourismTdt,` line), add:

```typescript
  [cityPulseSwfl.id]: cityPulseSwfl,
```

- [ ] **Step 2: Add the catalog entry in `catalog.mts`**

Add to the `BRAIN_CATALOG` array (mirror the `tourism-tdt` entry at `catalog.mts:82-88`):

```typescript
  {
    id: "city-pulse-swfl",
    domain: "macro",
    scope:
      "SWFL (Lee + Collier) daily current-events pulse — dated business openings/closings, transactions, construction, and disaster signals for 7 cities, each cited to a primary source.",
    ttl_seconds: 86400,
  },
```

- [ ] **Step 3: Run the catalog drift + registry tests**

Run: `bun test refinery/packs/catalog.test.mts refinery/packs/index.test.mts` (run whichever exist)
Expected: PASS — catalog and registry agree; `city-pulse-swfl` resolvable.

- [ ] **Step 4: Commit**

```bash
git add refinery/packs/index.mts refinery/packs/catalog.mts
git commit -m "feat(city-pulse): register city-pulse-swfl in pack index + catalog"
```

---

## Task 12: Wire as a master upstream

**Files:**

- Modify: `refinery/packs/master.mts:270-286`

- [ ] **Step 1: Add the input_brains edge**

In the `input_brains` array, after the existing entries (e.g. after `{ id: "housing-swfl", edge_type: "input" }`), add:

```typescript
    { id: "city-pulse-swfl", edge_type: "input" },
```

- [ ] **Step 2: Run master tests + a fixture rebuild**

Run: `bun test refinery/packs/master.test.mts`
Then a dry rebuild against fixtures: `REFINERY_SOURCE=fixture bun run <refinery build entrypoint> master --target-only --dry-run` (use the repo's documented master dry-run command).
Expected: master resolves the new edge; with the city-pulse fixture present it surfaces ≥1 city-pulse driver; PASS. If master degrades when city-pulse is empty, that is correct (graceful — no hollow brain).

- [ ] **Step 3: Commit**

```bash
git add refinery/packs/master.mts
git commit -m "feat(city-pulse): wire city-pulse-swfl as a master input_brains edge"
```

---

## Task 13: GHA daily cron + `--dry-run`

**Files:**

- Create: `.github/workflows/city-pulse-daily.yml`

- [ ] **Step 1: Write the workflow (model on `.github/workflows/fl-dor-tdt-monthly.yml`)**

`.github/workflows/city-pulse-daily.yml`:

```yaml
name: City pulse daily

on:
  schedule:
    # 09:00 UTC = 5 AM ET daily. Verify this slot does not collide with an
    # existing cron in .github/workflows/ before merging.
    - cron: "0 9 * * *"
  workflow_dispatch:
    inputs:
      dry_run:
        description: "Dry run — search + distill, print rows, no upload/DB write"
        required: false
        default: "false"
      city:
        description: "Single city by exact name (blank = all 7)"
        required: false
        default: ""

permissions:
  contents: read

jobs:
  ingest:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Setup Python
        uses: actions/setup-python@v6
        with:
          python-version: "3.13"

      - name: Install ingest dependencies
        run: pip install -r ingest/requirements.txt

      - name: Run city_pulse pipeline
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          DESTINATION__POSTGRES__CREDENTIALS: ${{ secrets.DESTINATION__POSTGRES__CREDENTIALS }}
        run: |
          EXTRA=""
          if [ "${{ github.event.inputs.dry_run }}" = "true" ]; then EXTRA="--dry-run"; fi
          if [ -n "${{ github.event.inputs.city }}" ]; then
            python -m ingest.pipelines.city_pulse.pipeline --city "${{ github.event.inputs.city }}" $EXTRA
          else
            python -m ingest.pipelines.city_pulse.pipeline $EXTRA
          fi
```

- [ ] **Step 2: Validate the workflow + confirm no cron collision**

Run: list existing cron lines to confirm `0 9 * * *` is free:
`grep -rh "cron:" .github/workflows/` (pick a different minute/hour if taken).
Validate YAML parses (e.g. `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/city-pulse-daily.yml'))"`).
Expected: unique slot, valid YAML.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/city-pulse-daily.yml
git commit -m "feat(city-pulse): daily GHA cron wrapper with --dry-run"
```

---

## Task 14: Cadence registry entry

**Files:**

- Modify: `ingest/cadence_registry.yaml`

- [ ] **Step 1: Add the city_pulse entry under `pipelines:`**

Model on the tier-1 prefix entry (`fred_g17`) since the raw capture is Tier-1 cold; freshness is tracked on the cold prefix. Add:

```yaml
- name: city_pulse
  lane: tier-1
  cadence_days: 1
  tolerance_multiplier: 3.0
  inventory_id: lake-tier1/city_pulse/
  inventory_key_type: prefix
  # Daily web_search current-events capture for 7 SWFL cities; distilled into
  # data_lake.city_pulse (Tier-2) and read by the city-pulse-swfl brain.
  # First run: <fill on first successful GHA run>.
```

- [ ] **Step 2: Validate YAML**

Run: `python -c "import yaml; yaml.safe_load(open('ingest/cadence_registry.yaml'))"`
Expected: parses, no error.

- [ ] **Step 3: Commit**

```bash
git add ingest/cadence_registry.yaml
git commit -m "feat(city-pulse): cadence_registry entry (daily, tier-1 prefix)"
```

---

## Task 15: Delete the dead `news_swfl` scraper

**Files:**

- Delete: `ingest/pipelines/news_swfl/` (whole directory)
- Delete: `.github/workflows/news-daily.yml` (if present)
- Modify: `ingest/cadence_registry.yaml` (remove the `not_yet_running: news_swfl` entry)

- [ ] **Step 1: Confirm the workflow filename**

Run: `grep -rl "news_swfl" .github/workflows/`
Note the exact file (the agent reported `news-daily.yml`; confirm before deleting).

- [ ] **Step 2: Remove the `not_yet_running` entry**

In `ingest/cadence_registry.yaml`, delete the `news_swfl` block under `not_yet_running:`. If it was the only entry, replace with `not_yet_running: []` (keep the key so the freshness probe's loader doesn't KeyError).

- [ ] **Step 3: Delete the pipeline + workflow**

```bash
git rm -r ingest/pipelines/news_swfl
git rm .github/workflows/news-daily.yml   # use the filename confirmed in Step 1
```

- [ ] **Step 4: Confirm nothing imports it**

Run: `grep -rn "news_swfl" --include=*.py --include=*.yml --include=*.yaml --include=*.mts .`
Expected: zero references outside SESSION_LOG / docs. If any code references it, stop and resolve.

- [ ] **Step 5: Validate registry + commit**

Run: `python -c "import yaml; yaml.safe_load(open('ingest/cadence_registry.yaml'))"`
Expected: parses.

```bash
git add -A ingest/cadence_registry.yaml
git commit -m "chore(city-pulse): remove dead news_swfl scraper (superseded by city_pulse)"
```

---

## Task 16: Full verification + live smoke test

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `bun test` and `python -m pytest ingest/pipelines/city_pulse/ -v`
Expected: all green; the city_pulse Python tests (pipeline + distill, ~15) and the pack/source TS tests pass; no regressions in the existing suite.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no new errors.

- [ ] **Step 3: Live single-city dry run (real API, no writes)**

Run: `python -m ingest.pipelines.city_pulse.pipeline --city "Naples" --dry-run`
Expected: prints `> 0 cited_text spans`, then `distilled N citation-backed facts`, then the per-fact lines with real source URLs, then "would upload … and write N rows". If 0 cited_text spans: STOP — confirm `SEARCH_TOOL_VERSION == "web_search_20250305"` and the allowed domains.

- [ ] **Step 4: Live single-city real run, verify the table**

Run: `python -m ingest.pipelines.city_pulse.pipeline --city "Naples"`
Then: `python -c "import psycopg,tomllib; c=tomllib.load(open('.dlt/secrets.toml','rb'))['destination']['postgres']['credentials']; con=psycopg.connect(f\"postgresql://{c['username']}:{c['password']}@{c['host']}:{c.get('port',5432)}/{c.get('database','postgres')}\", sslmode='require'); print(con.execute('SELECT city, topic, left(fact,50), source_url FROM data_lake.city_pulse ORDER BY id DESC LIMIT 10').fetchall())"`
Expected: rows present, each with a real `source_url`. Re-run the pipeline once more and confirm row count does NOT double (dedup working).

- [ ] **Step 5: Live master rebuild reads the brain**

Run a live master rebuild (the repo's master build command, REFINERY_SOURCE=live) and confirm `city-pulse-swfl` resolves as an upstream and master renders without error.
Expected: master OUTPUT includes city-pulse among drivers (or degrades cleanly if empty). spec-validator / facts-only-lint / smoothing-lint all pass on the city-pulse render.

- [ ] **Step 6: Update SESSION_LOG + open the PR**

Append a SESSION_LOG.md entry (newest at top): what shipped, the live smoke result, the cron slot, that `news_swfl` was removed. Then:

```bash
git push -u origin feat/city-pulse-swfl
gh pr create --title "feat: city-pulse-swfl daily current-events reporter + flywheel table" --body "<summary + spec link + brain-first note: pack + data_lake.city_pulse migration ship together>"
```

---

## Self-review notes (author)

- **Spec coverage:** §2 cadence (Task 13 daily cron), §3 cities (Task 2 CITIES), §4 vendor lock 20250305 (Tasks 3/16), §5 hybrid storage (Tasks 1/7), §5a capture+distill (Tasks 3/5), §6 schema (Task 1), §7 TTL + dedup (Tasks 4/6), §8 reporter pack (Tasks 9/10) — corrected to key_metrics[].source provenance, §9 carry contract (no task — already live, correctly), §10 single-PR brain-first (one branch, all tasks), §13 testing (per-task TDD + Task 16), §14 decisions (naming city-pulse, scraper delete Task 15, batch deferred). All covered.
- **Open risk flagged for executor:** exact helper export names in `refinery/sources/util.mts` and the `BrainDomain` union value — verify against `tourism-tdt` rather than assume. The master dry-run command and bun typecheck script names are repo-specific; use the documented ones.
