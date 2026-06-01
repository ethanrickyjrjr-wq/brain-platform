# DBPR Public Notices — SWFL Ingest Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scrape the DBPR public notices index weekly, extract PDF links for SWFL-region counties, parse notice metadata from each PDF, generate a Claude summary, and upsert into `public.dbpr_public_notices`.

**No consuming brain at ship time.** This is raw-data-only. The cadence registry entry is marked `not_yet_running` for the brain slot. A future `regulatory-swfl` pack will read this table — that pack ships in its own PR. The brain-first gate in CLAUDE.md applies to `data_lake.*`; this table lives in `public.*` (same Postgres instance, different schema). The gate doesn't formally trigger, but the spirit does — document the gap here explicitly.

**SWFL target counties:** Lee, Collier, Charlotte, Sarasota, Manatee, Hendry, Monroe

---

## What the data looks like (verified 2026-06-01)

Single index page at `https://www2.myfloridalicense.com/public-notices/` — all counties on one page, no JS required, Firecrawl markdown works cleanly.

Each county section is either `No Updated Notice` or a list of `[Respondent Name](PDF URL)` links.

Each PDF contains: county, respondent name + address, `CASE NO.:`, optionally `LICENSE NUMBER:`, `IN RE:` (practice type ± `UNLICENSED` prefix), `BEFORE THE [BOARD NAME]`, and a response deadline in the body text.

**Amendment pattern (discovered 2026-06-01 — Manatee case):** DBPR's correction mechanism is publishing a new PDF alongside the old one, not replacing in place. Both URLs remain live; the corrected version has a later `response_deadline`. The schema handles this as two distinct rows. A consuming brain should order by `response_deadline DESC` per `(county, case_number)` group to get the active version. A `superseded_by` FK column is deferred until a brain actually needs explicit amendment chain reconstruction.

**Current SWFL row counts (this week's scrape):**

- Lee: 0, Charlotte: 0, Hendry: 0, Monroe: 0
- Collier: 1 (Jhandy Garcia — unlicensed construction)
- Sarasota: 2 (Brian Fischer — real estate; Florida Investors PM LLC — real estate)
- Manatee: 3 (Dale Sexton ×2 versions, Christopher Weiss)

---

## Schema decisions (locked)

| Decision           | Choice                                | Rationale                                                                                                     |
| ------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Unique key         | `pdf_url`                             | URLs are genuinely distinct even for amendments; `(county, case_number)` collides on shared first case number |
| `case_number`      | First `CASE NO.:` value from PDF body | Canonical; filename fallback only if body parse fails                                                         |
| `all_case_numbers` | `text[]` from full `CASE NO.:` line   | Multi-case filenames exist (e.g. Osceola 5-case PDF)                                                          |
| Date field         | `response_deadline date`              | Real document metadata; `scraped_at` covers ingestion provenance                                              |
| `notice_date`      | Dropped                               | Would be a synthetic lie (GHA trigger date)                                                                   |
| `is_swfl`          | Dropped                               | Every row is SWFL by construction; add if scope expands                                                       |
| `superseded_by`    | Deferred                              | Implicit via `response_deadline DESC` ordering; Option 1 ships when a brain needs the chain                   |
| `last_seen_at`     | Ship                                  | Updated every run; gap signals expiry/removal                                                                 |

---

## File structure

| File                                                 | Responsibility                                                        | Create/Modify |
| ---------------------------------------------------- | --------------------------------------------------------------------- | ------------- |
| `docs/sql/2026-06-01_dbpr_public_notices.sql`        | Idempotent DDL                                                        | Create        |
| `ingest/pipelines/dbpr_public_notices/__init__.py`   | Package marker                                                        | Create        |
| `ingest/pipelines/dbpr_public_notices/pipeline.py`   | Scrape index → filter SWFL → scrape PDFs → parse → summarize → upsert | Create        |
| `ingest/pipelines/dbpr_public_notices/parse.py`      | PDF markdown → structured fields (no LLM)                             | Create        |
| `ingest/pipelines/dbpr_public_notices/summarize.py`  | Claude Sonnet 2-3 sentence summary                                    | Create        |
| `ingest/pipelines/dbpr_public_notices/test_parse.py` | Parse unit tests against real PDF samples                             | Create        |
| `.github/workflows/dbpr-public-notices-weekly.yml`   | Weekly cron + `--dry-run`                                             | Create        |
| `ingest/cadence_registry.yaml`                       | Add `dbpr_public_notices` entry                                       | Modify        |

**Branch:** `feat/dbpr-public-notices` (do NOT work on `main`). One PR.

---

## Task 1: SQL migration

**File:** `docs/sql/2026-06-01_dbpr_public_notices.sql`

- [ ] **Step 1: Write idempotent migration**

```sql
-- public.dbpr_public_notices — DBPR enforcement notices for SWFL counties.
-- Written by ingest/pipelines/dbpr_public_notices/pipeline.py (psycopg3, non-dlt).
-- Source: https://www2.myfloridalicense.com/public-notices/ — weekly update.
-- SWFL scope: Lee, Collier, Charlotte, Sarasota, Manatee, Hendry, Monroe.
--
-- Amendment pattern: DBPR corrects notices by publishing a new PDF alongside the old one.
-- Both rows live in this table; the corrected version has a later response_deadline.
-- A consuming brain should ORDER BY response_deadline DESC per (county, case_number)
-- group to get the active version. A superseded_by column is deferred until needed.
--
-- last_seen_at: updated every scrape for URLs found on the index page.
-- A gap in last_seen_at relative to the current run means the notice expired or was removed.

CREATE TABLE IF NOT EXISTS public.dbpr_public_notices (
  id                  bigint generated always as identity primary key,
  pdf_url             text unique not null,
  respondent_name     text,
  county              text not null,
  case_number         text,           -- first case number from CASE NO.: in PDF body
  all_case_numbers    text[],         -- full set from CASE NO.: line (some PDFs bundle multiple)
  violation_type      text,           -- 'unlicensed_activity' | 'disciplinary' | free text if ambiguous
  industry            text,           -- derived from BEFORE THE [BOARD] line
  pdf_summary         text,           -- 2-3 sentence Claude summary
  response_deadline   date,           -- parsed from "by Month DD, YYYY" in PDF body
  last_seen_at        timestamptz,    -- updated on every run; gap = notice expired/removed
  scraped_at          timestamptz,    -- first ingestion timestamp
  created_at          timestamptz     default now()
);

CREATE INDEX IF NOT EXISTS dbpr_public_notices_county_idx      ON public.dbpr_public_notices (county);
CREATE INDEX IF NOT EXISTS dbpr_public_notices_case_number_idx ON public.dbpr_public_notices (case_number);
CREATE INDEX IF NOT EXISTS dbpr_public_notices_last_seen_idx   ON public.dbpr_public_notices (last_seen_at);
CREATE INDEX IF NOT EXISTS dbpr_public_notices_deadline_idx    ON public.dbpr_public_notices (response_deadline);
```

- [ ] **Step 2: Run migration directly** (creds in `.dlt/secrets.toml`, psycopg3)
- [ ] **Step 3: Verify table exists:** `SELECT COUNT(*) FROM public.dbpr_public_notices;` → 0

---

## Task 2: Parse module

**File:** `ingest/pipelines/dbpr_public_notices/parse.py`

No LLM. All fields extractable with regex from the PDF markdown Firecrawl returns.

- [ ] **Step 1: Write `parse_pdf_markdown(text: str, pdf_url: str, respondent_hint: str) -> dict`**

```python
import re
from datetime import datetime
from dateutil.parser import parse as parse_date

SWFL_COUNTIES = {'lee', 'collier', 'charlotte', 'sarasota', 'manatee', 'hendry', 'monroe'}

# Maps BEFORE THE [BOARD] text → industry slug.
# Match is case-insensitive substring search; first match wins.
BOARD_INDUSTRY_MAP = [
    ('REAL ESTATE',                   'real_estate'),
    ('CONSTRUCTION INDUSTRY',         'construction'),
    ('ELECTRICAL CONTRACTORS',        'electrical'),
    ('COSMETOLOGY',                   'cosmetology'),
    ('PHARMACY',                      'pharmacy'),
    ('PROFESSIONAL ENGINEERS',        'engineering'),
    ('LANDSCAPE ARCHITECTS',          'landscape'),
    ('ARCHITECTS',                    'architecture'),
    ('ACCOUNTANCY',                   'accounting'),
    ('MEDICAL',                       'medical'),
    ('NURSING',                       'nursing'),
    ('VETERINARY',                    'veterinary'),
    ('GENERAL CONTRACTORS',           'construction'),
]

def parse_pdf_markdown(text: str, pdf_url: str, respondent_hint: str = '') -> dict:
    """Parse PDF markdown from Firecrawl into structured notice fields.

    respondent_hint: name from the index page link text (pre-parsed, used as fallback).
    Returns a dict matching the dbpr_public_notices columns (excluding id, created_at).
    """
    result = {
        'pdf_url': pdf_url,
        'respondent_name': respondent_hint or None,
        'county': None,
        'case_number': None,
        'all_case_numbers': [],
        'violation_type': None,
        'industry': None,
        'pdf_summary': None,   # filled by summarize.py
        'response_deadline': None,
    }

    # County — first ## header ending in COUNTY
    county_m = re.search(r'^## (.+?) COUNTY', text, re.MULTILINE | re.IGNORECASE)
    if county_m:
        result['county'] = county_m.group(1).strip().title()

    # Case numbers — CASE NO.: 2025057489, 2025063707
    case_m = re.search(r'CASE NO\.\s*:\s*([^\n]+)', text, re.IGNORECASE)
    if case_m:
        raw = case_m.group(1).strip()
        parts = [p.strip() for p in re.split(r'[,\s]+', raw) if p.strip()]
        result['all_case_numbers'] = parts
        result['case_number'] = parts[0] if parts else None

    # Violation type — IN RE: The practice of [UNLICENSED] X
    in_re_m = re.search(r'IN RE:\s*The practice of\s+(.+)', text, re.IGNORECASE)
    if in_re_m:
        practice = in_re_m.group(1).strip()
        if re.match(r'UNLICENSED', practice, re.IGNORECASE):
            result['violation_type'] = 'unlicensed_activity'
        else:
            result['violation_type'] = 'disciplinary'

    # Industry — BEFORE THE [BOARD NAME]
    board_m = re.search(r'BEFORE THE\s+(.+)', text, re.IGNORECASE)
    if board_m:
        board_text = board_m.group(1).upper()
        for keyword, slug in BOARD_INDUSTRY_MAP:
            if keyword in board_text:
                result['industry'] = slug
                break
        if not result['industry']:
            # Fallback: derive from IN RE text
            if in_re_m:
                practice_lower = in_re_m.group(1).lower()
                for keyword, slug in BOARD_INDUSTRY_MAP:
                    if keyword.lower() in practice_lower:
                        result['industry'] = slug
                        break

    # Response deadline — "by Month DD, YYYY"
    deadline_m = re.search(r'by\s+([A-Z][a-z]+ \d{1,2},\s*\d{4})', text)
    if deadline_m:
        try:
            result['response_deadline'] = parse_date(deadline_m.group(1)).date()
        except Exception:
            pass

    return result
```

- [ ] **Step 2: Write `parse_index_markdown(text: str) -> list[dict]`**

```python
def parse_index_markdown(text: str) -> list[dict]:
    """Extract SWFL notice links from the index page markdown.

    Returns list of {'county': str, 'respondent_name': str, 'pdf_url': str}.
    Skips counties with no active notices. Skips non-SWFL counties.
    """
    notices = []
    current_county = None

    for line in text.splitlines():
        # County header: ##### Lee County  or  ##### **Lee County✓**
        county_m = re.match(r'^#+\s+\*{0,2}([A-Za-z\s]+?)\s*(?:County|COUNTY)\s*[✓✔]?\*{0,2}\s*$', line)
        if county_m:
            name = county_m.group(1).strip().lower()
            current_county = name if name in SWFL_COUNTIES else None
            continue

        if current_county is None:
            continue

        # PDF link: [Respondent Name](https://...pdf)
        link_m = re.match(r'^\s*\[(.+?)\]\((https?://[^\)]+\.pdf)\)', line, re.IGNORECASE)
        if link_m:
            notices.append({
                'county': current_county.title(),
                'respondent_name': link_m.group(1).strip(),
                'pdf_url': link_m.group(2).strip(),
            })

    return notices
```

- [ ] **Step 3: Write `test_parse.py`** — fixture-based unit tests using the real PDF text samples from `.firecrawl/`:
  - Collier (unlicensed construction → `violation_type='unlicensed_activity'`, `industry='construction'`)
  - Sarasota (real estate disciplinary → `violation_type='disciplinary'`, `industry='real_estate'`)
  - Manatee typo (two-case `CASE NO.:` → `all_case_numbers` has 2 elements, `case_number` = first)
  - Index page → 6 SWFL links extracted, non-SWFL counties absent

---

## Task 3: Summarize module

**File:** `ingest/pipelines/dbpr_public_notices/summarize.py`

- [ ] **Step 1: Write `summarize_notice(pdf_text: str, model: str = 'claude-sonnet-4-6') -> str`**

```python
import anthropic

def summarize_notice(pdf_text: str, model: str = 'claude-sonnet-4-6') -> str:
    """Generate a 2-3 sentence plain-English summary of a DBPR notice.

    Returns the summary string. On API error, returns empty string (caller logs, row still upserts).
    """
    client = anthropic.Anthropic()
    prompt = (
        "Summarize this DBPR enforcement notice in 2-3 plain English sentences. "
        "Include: who is named, what practice is at issue, and the response deadline. "
        "Do not use legal jargon. Do not add commentary or opinion.\n\n"
        f"{pdf_text[:3000]}"   # cap to avoid token blowout on edge cases
    )
    try:
        msg = client.messages.create(
            model=model,
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )
        return msg.content[0].text.strip()
    except Exception as e:
        print(f"[summarize] Claude API error: {e}")
        return ''
```

---

## Task 4: Main pipeline

**File:** `ingest/pipelines/dbpr_public_notices/pipeline.py`

- [ ] **Step 1: Write pipeline entrypoint**

```python
#!/usr/bin/env python3
"""DBPR public notices ingest — SWFL weekly.

Usage:
    python -m ingest.pipelines.dbpr_public_notices.pipeline [--dry-run]

Scrapes https://www2.myfloridalicense.com/public-notices/, filters SWFL counties,
fetches each PDF via Firecrawl, parses metadata, generates a Claude summary,
and upserts into public.dbpr_public_notices.
"""
import argparse
import os
import subprocess
import json
import sys
from datetime import datetime, timezone

import psycopg

from .parse import parse_index_markdown, parse_pdf_markdown
from .summarize import summarize_notice

INDEX_URL = 'https://www2.myfloridalicense.com/public-notices/'

def firecrawl_scrape(url: str) -> str:
    """Scrape a URL via Firecrawl CLI, return markdown string. Raises on non-zero exit."""
    result = subprocess.run(
        ['firecrawl', 'scrape', url, '--format', 'markdown', '--only-main-content'],
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Firecrawl failed for {url}: {result.stderr[:200]}")
    return result.stdout

def get_db_conn():
    import tomllib
    secrets_path = os.path.join(os.path.dirname(__file__), '..', '..', '..', '.dlt', 'secrets.toml')
    with open(secrets_path, 'rb') as f:
        secrets = tomllib.load(f)
    creds = secrets['destination']['postgres']['credentials']
    return psycopg.connect(creds if isinstance(creds, str) else
                           f"postgresql://{creds['username']}:{creds['password']}@{creds['host']}:{creds.get('port', 5432)}/{creds['database']}")

UPSERT_SQL = """
INSERT INTO public.dbpr_public_notices
  (pdf_url, respondent_name, county, case_number, all_case_numbers,
   violation_type, industry, pdf_summary, response_deadline, last_seen_at, scraped_at)
VALUES
  (%(pdf_url)s, %(respondent_name)s, %(county)s, %(case_number)s, %(all_case_numbers)s,
   %(violation_type)s, %(industry)s, %(pdf_summary)s, %(response_deadline)s,
   %(last_seen_at)s, %(scraped_at)s)
ON CONFLICT (pdf_url) DO UPDATE SET
  respondent_name   = EXCLUDED.respondent_name,
  county            = EXCLUDED.county,
  case_number       = EXCLUDED.case_number,
  all_case_numbers  = EXCLUDED.all_case_numbers,
  violation_type    = EXCLUDED.violation_type,
  industry          = EXCLUDED.industry,
  pdf_summary       = COALESCE(EXCLUDED.pdf_summary, public.dbpr_public_notices.pdf_summary),
  response_deadline = EXCLUDED.response_deadline,
  last_seen_at      = EXCLUDED.last_seen_at
  -- scraped_at intentionally NOT updated on conflict (preserves first-seen timestamp)
"""

def run(dry_run: bool = False):
    run_ts = datetime.now(timezone.utc)
    print(f"[dbpr-notices] run_ts={run_ts.isoformat()} dry_run={dry_run}")

    # 1. Scrape index
    print(f"[dbpr-notices] scraping index: {INDEX_URL}")
    index_md = firecrawl_scrape(INDEX_URL)
    notices = parse_index_markdown(index_md)
    print(f"[dbpr-notices] found {len(notices)} SWFL notices on index page")

    if not notices:
        print("[dbpr-notices] no SWFL notices this week — nothing to do")
        return

    rows = []
    for n in notices:
        url = n['pdf_url']
        print(f"[dbpr-notices] fetching PDF: {url}")
        try:
            pdf_md = firecrawl_scrape(url)
        except RuntimeError as e:
            print(f"[dbpr-notices] SKIP (scrape failed): {e}")
            continue

        if not pdf_md.strip():
            print(f"[dbpr-notices] SKIP (empty response): {url}")
            continue

        parsed = parse_pdf_markdown(pdf_md, url, respondent_hint=n['respondent_name'])
        parsed['county'] = parsed['county'] or n['county']  # fallback to index-page county

        summary = summarize_notice(pdf_md) if not dry_run else '[dry-run]'
        parsed['pdf_summary'] = summary or None

        parsed['last_seen_at'] = run_ts
        parsed['scraped_at'] = run_ts

        rows.append(parsed)
        print(f"  county={parsed['county']} respondent={parsed['respondent_name']} "
              f"case={parsed['case_number']} violation={parsed['violation_type']} "
              f"deadline={parsed['response_deadline']}")

    if dry_run:
        print(f"[dbpr-notices] dry-run: would upsert {len(rows)} rows")
        for r in rows:
            print(f"  {json.dumps({k: str(v) for k, v in r.items()}, indent=2)}")
        return

    # 2. Upsert
    with get_db_conn() as conn:
        with conn.cursor() as cur:
            for row in rows:
                cur.execute(UPSERT_SQL, row)
        conn.commit()

    print(f"[dbpr-notices] upserted {len(rows)} rows")

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    run(dry_run=args.dry_run)
```

---

## Task 5: GHA workflow

**File:** `.github/workflows/dbpr-public-notices-weekly.yml`

- [ ] **Step 1: Write workflow**

```yaml
name: DBPR Public Notices — Weekly SWFL

on:
  schedule:
    - cron: "30 6 * * 1" # Mondays 06:30 UTC — after press releases, before rebuild
  workflow_dispatch:
    inputs:
      dry_run:
        description: "Dry run (no DB writes)"
        required: false
        default: "false"

jobs:
  ingest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.13"

      - name: Install dependencies
        run: pip install firecrawl-py anthropic psycopg[binary] python-dateutil tomli

      - name: Install Firecrawl CLI
        run: npm install -g @mendableai/firecrawl-cli

      - name: Run ingest
        env:
          FIRECRAWL_API_KEY: ${{ secrets.FIRECRAWL_API_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SUPABASE_PG_PASSWORD: ${{ secrets.SUPABASE_SERVICE_KEY }}
        run: |
          DRY_RUN_FLAG=""
          if [ "${{ github.event.inputs.dry_run }}" = "true" ]; then
            DRY_RUN_FLAG="--dry-run"
          fi
          python -m ingest.pipelines.dbpr_public_notices.pipeline $DRY_RUN_FLAG
```

- [ ] **Step 2: Verify secrets exist in repo:** `FIRECRAWL_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_KEY`

---

## Task 6: Cadence registry

**File:** `ingest/cadence_registry.yaml`

- [ ] **Step 1: Add entry** (append to tier-2 non-dlt section)

```yaml
- name: dbpr_public_notices
  lane: tier-2
  cadence_days: 7
  tolerance_multiplier: 3.0
  freshness_table: public.dbpr_public_notices
  expected_rows_min: 1 # floor at 1; 0 = real alert (Lee/Monroe may be empty but Sarasota isn't)
  # Non-dlt pipeline — freshness checked via MAX(last_seen_at) on the table directly.
  # Source: FL DBPR public notices index (www2.myfloridalicense.com/public-notices/).
  # SWFL scope: Lee, Collier, Charlotte, Sarasota, Manatee, Hendry, Monroe.
  # Cron: Monday 06:30 UTC via dbpr-public-notices-weekly.yml.
  # NOTE: No consuming brain at ship time. Table is raw data only.
  # A future regulatory-swfl pack will consume this; that pack ships in its own PR.
  # Amendment pattern: DBPR publishes corrections as new URLs alongside old ones.
  # Two rows for same respondent = normal; order by response_deadline DESC for active version.
  # First run: pending (manual dispatch after SQL migration).
```

---

## Acceptance criteria

- [ ] `public.dbpr_public_notices` exists with correct schema + indexes
- [ ] `--dry-run` runs clean and prints expected row count + field values
- [ ] Live run upserts at least 3 rows (Collier + Sarasota + Manatee this week)
- [ ] Both Manatee Dale Sexton rows land with distinct `pdf_url` and distinct `response_deadline` (June 1 + June 15)
- [ ] `last_seen_at` populates on both new and existing rows
- [ ] `case_number` for the typo PDF is `2025057489` (first case), not `202563707`
- [ ] `response_deadline` for Sarasota Brian Fischer is `2026-06-08`
- [ ] `response_deadline` for Collier Jhandy Garcia is `2026-06-15`
- [ ] Cadence registry entry present, `not_yet_running` note in comments
- [ ] Parse unit tests pass against real PDF fixtures
