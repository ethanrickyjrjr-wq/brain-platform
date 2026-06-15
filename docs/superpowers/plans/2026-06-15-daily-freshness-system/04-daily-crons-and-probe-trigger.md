# 04 — Daily Crons & Probe-Trigger (Wave 2)

> Build file for the Daily Freshness System. **Read `README.md` §2 (loop), §6 (Gate 3 — secrets in every env).** Two deliverables: (A) the daily cron that runs the engine per registry entry; (B) the probe-trigger that dispatches a *vendor* ingest within hours of a fresher vendor file appearing (so Zillow/Redfin land soon after publish instead of on the fixed cron day).

**Model:** Opus · **Repo:** brain-platform · **Wave:** 2 · **Depends:** 01, 02.

**Goal:** `live-search-daily.yml` iterates the registry's `live_search_config` entries → engine → `data_lake.daily_truth`, daily; and a probe-trigger compares the vendor file's published timestamp to our last load and `workflow_dispatch`es the lagging vendor ingest.

---

## §0 facts to honor

- **Reuse template = `.github/workflows/city-pulse-daily.yml`** (verified): cron `0 9 * * *`, `workflow_dispatch` (inputs), `permissions: contents: read`, env secrets `ANTHROPIC_API_KEY`, `FIRECRAWL_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `DESTINATION__POSTGRES__CREDENTIALS`.
- **`GEMINI_API_KEY` is a NEW secret** — `gh secret set` is step 1; wiring it into the workflow `env:` is step 2 (Gate 3 — a secret isn't live until it's in the `env:` block).
- **Cost / budget (verified live 2026-06-15, pricing page updated 2026-06-09):** Gemini 3 grounding = **5,000 prompts/month free** (shared across Gemini 3), then **$14 / 1,000 search queries**, billed **per search query** (one prompt can fire several). The engine logs `len(groundingMetadata.webSearchQueries)` per call; the cron sums it and **warns when the running monthly query count nears the free ceiling**. Daily target **<100 prompts/day (~3,000/mo) → $0/month**. Default model `gemini-3.5-flash`.
- **`check_freshness.py` does NOT compare to the vendor's publish date today** (it classifies our landed data by age vs `cadence_days`). The probe-trigger is therefore **new** work — a HEAD/ETag/Last-Modified comparison — not a one-line extension. Scope it as its own sub-task (B) and keep (A) shippable alone.
- Every scheduled workflow has `workflow_dispatch` (59/59) → the probe-trigger can dispatch any vendor ingest via `gh workflow run` / the Actions API.

---

## Files

- **Create:** `.github/workflows/live-search-daily.yml` — the daily engine cron.
- **Create:** `ingest/scripts/probe_vendor_freshness.py` — vendor-publish-vs-our-load comparator + dispatcher (sub-task B).
- **Modify:** `ingest/cadence_registry.yaml` — add an optional `vendor_probe:` block (file URL + method) to the vendor pipelines that publish on an irregular cadence (ZHVI/ZORI/Redfin) so B knows what to HEAD.

---

## Task A — Daily engine cron

- [ ] **Step A.1: `gh secret set GEMINI_API_KEY`** (Gate 3 step 1). Confirm with `gh secret list -R ethanrickyjrjr-wq/brain-platform` (memory `keys-in-gh-dont-ask` — never ask the operator to paste it; it's already a repo secret if set). Also set the Spider key if the cascade's Spider leg needs one (`SPIDER_API_KEY`).

- [ ] **Step A.2: Write `.github/workflows/live-search-daily.yml`** (copy `city-pulse-daily.yml` structure):

```yaml
name: Live Search Daily (sourced freshness)
on:
  schedule:
    - cron: "0 12 * * *"        # 12:00 UTC = 8 AM ET — after overnight vendor publishes, before market hours
  workflow_dispatch:
    inputs:
      dry_run: { description: "Print without writing", type: boolean, default: false }
      metric:  { description: "Single metric id (else all)", type: string, default: "" }
permissions:
  contents: read                # NO bot commit — engine writes to the lake via psycopg, like every pipeline
jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2     # (only if a step needs bun; the engine is python)
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - name: Install deps
        run: pip install -r ingest/requirements.txt
      - name: Migrate daily_truth (idempotent guard)
        run: python -m ingest.scripts.migrate_daily_truth
        env: { DESTINATION__POSTGRES__CREDENTIALS: ${{ secrets.DESTINATION__POSTGRES__CREDENTIALS }} }
      - name: Run live-search engine
        run: |
          python -m ingest.pipelines.live_search.pipeline \
            ${{ inputs.dry_run && '--dry-run' || '' }} \
            ${{ inputs.metric && format('--metric {0}', inputs.metric) || '' }}
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          FIRECRAWL_API_KEY: ${{ secrets.FIRECRAWL_API_KEY }}
          SPIDER_API_KEY: ${{ secrets.SPIDER_API_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          FRED_API_KEY: ${{ secrets.FRED_API_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          DESTINATION__POSTGRES__CREDENTIALS: ${{ secrets.DESTINATION__POSTGRES__CREDENTIALS }}
```

- [ ] **Step A.3: Dry-run dispatch to validate wiring.**

```bash
gh workflow run live-search-daily.yml -f dry_run=true
gh run watch
# Expected: green; logs show cascade returning {value, source_url, verified} per metric/area. No commit to main.
```

- [ ] **Step A.4: Live dispatch, then confirm rows landed.**

```bash
gh workflow run live-search-daily.yml
gh run watch
# then SELECT metric_key, area, value, source_tag, verified_on_page, retrieved_at FROM data_lake.daily_truth ORDER BY retrieved_at DESC LIMIT 10;
```

- [ ] **Step A.5: Budget instrumentation.** Confirm the run logs the summed `groundingMetadata.webSearchQueries` count (the billed unit) to the Actions step summary, and emits a WARN if the rolling monthly total approaches the 5,000-prompt free ceiling. (At <100 prompts/day this is $0 — the warn is a tripwire, not a gate.)

- [ ] **Step A.6: Commit** (`git add .github/workflows/live-search-daily.yml`).

---

## Task B — Probe-trigger (vendor file lands within hours, not on the fixed cron day)

Honest scope: the vendor publishes on its own calendar; our monthly cron may be days behind. The probe runs daily, HEADs the vendor file, and if it's newer than our last load, dispatches that vendor's ingest immediately.

- [ ] **Step B.1: Add a `vendor_probe:` block** to the irregular-cadence vendor pipelines in `cadence_registry.yaml` (ZHVI/ZORI/Redfin first — the ones behind `/charts`):

```yaml
  zhvi_t1:
    # …existing…
    vendor_probe:
      url: "https://files.zillowstatic.com/research/public_csvs/zhvi/...latest.csv"   # the published file
      method: head                 # HEAD → Last-Modified / ETag
      dispatch_workflow: zhvi-tier1-monthly.yml
```

- [ ] **Step B.2: Write `ingest/scripts/probe_vendor_freshness.py`.** For each pipeline with a `vendor_probe`, HEAD the URL, read `Last-Modified`/`ETag`, compare to our last load (`_dlt_loads` / `MAX(freshness_column)` — reuse `check_freshness.py`'s tier-2/tier-1 freshness readers), and if newer, dispatch:

```python
import requests, subprocess
def vendor_is_newer(url: str, our_last_load) -> bool:
    r = requests.head(url, allow_redirects=True, timeout=30)
    lm = r.headers.get("Last-Modified")          # e.g. "Wed, 11 Jun 2026 14:00:00 GMT"
    return lm is not None and parse_http_date(lm) > our_last_load
def dispatch(workflow: str) -> None:
    subprocess.run(["gh", "workflow", "run", workflow], check=True)   # workflow_dispatch exists on all crons
```
**Probe-first (BIBLE §0.1):** HEAD is a <1s request; never download the file to check freshness. If the vendor file 403s a HEAD (some CDNs do), fall back to a ranged GET of the first bytes or the publisher's release-calendar page via `scrape_with_fallback` — do not silently treat "can't probe" as "fresh."

- [ ] **Step B.3: Add a daily probe step** to `live-search-daily.yml` (or a tiny separate `vendor-probe-daily.yml`) that runs `probe_vendor_freshness.py`; it needs `actions:write` (or a PAT) to dispatch other workflows — set `permissions: { contents: read, actions: write }`.

- [ ] **Step B.4: Test the comparator** (`ingest/scripts/tests/test_probe_vendor_freshness.py`): newer Last-Modified → dispatch called; same/older → not; missing header → conservative no-dispatch + a logged WARN (never assume fresh).

- [ ] **Step B.5: Commit** (`git add ingest/scripts/probe_vendor_freshness.py ingest/cadence_registry.yaml .github/workflows/`).

---

## Definition of Done

- `live-search-daily.yml` runs green on a schedule + `workflow_dispatch`; a live run writes verified `daily_truth` rows; `permissions: contents: read` (no bot commit).
- `GEMINI_API_KEY` (+ `SPIDER_API_KEY` if used) is set AND present in the workflow `env:` (Gate 3 both steps).
- Probe-trigger: a newer vendor `Last-Modified` triggers a `workflow_dispatch` of that vendor's ingest; a missing header logs a WARN and does **not** falsely report fresh.
- **Board row:** each daily metric shows a recent green run; `04-crons` GREEN.
