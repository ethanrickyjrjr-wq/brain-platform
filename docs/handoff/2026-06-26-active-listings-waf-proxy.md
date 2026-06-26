# Handoff — active-listings daily cron: survives single-county, 403s on the full sweep

**Date:** 2026-06-26
**Owner of next step:** whoever picks up the WAF/proxy work
**Status:** Cron is LIVE (un-parked, daily 09:00 UTC). Single-county scrape proven clean from the GHA runner IP. The **all-county** sweep 403s under sustained load — needs a residential proxy, and that proxy is **not yet wired into this pipeline's code path.**

---

## TL;DR

`ingest-active-listings` was un-parked today after the runner IP was proven WAF-clear for a single county (Collier: 116+ pages, **0 × 403**, 2,292 in-scope listings, run `28254764976`). But the **4-county** run (`28256971415`) came back `0 listings from all SWFL counties` with `HTTP 403` on Hendry — the source rate-limit-throttles sustained bursts (extract.py notes ~420+ requests trips it), and today's repeated test runs almost certainly escalated it to an IP-level block. Single-county still works; the daily all-county cron is at risk until a residential proxy is in place.

The documented remedy is `CRAWL4AI_PROXY`. **The trap:** that env var is only honored by `ingest/lib/crawl_client.py` (the *browser* strategy). `active_listings/extract.py` builds its own `AsyncHTTPCrawlerStrategy` + `HTTPCrawlerConfig` and **does not read `CRAWL4AI_PROXY`**. So setting the secret alone fixes nothing here — the proxy has to be plumbed into the HTTP path (or the pipeline switched to the browser path).

---

## What's already done (on `main`)

- **`crawl_client` rename** (`8fb76c9a`) — the `*crawl4ai*` gitignore had swallowed the shared wrapper; every crawl scraper (incl. this one) `ModuleNotFoundError`'d in CI. Fixed. This is *why* the cron could be un-parked at all.
- **Cron un-parked** (`e3aaa08f`) — `schedule: 0 9 * * *` live, `timeout-minutes` 30→55 (the 4-county walk ran ~23 min), `probe_mode: odd_window` removed, `expected_rows_min` 1→2000.
- **`--county` quoting bug fixed** (same commit) — the workflow built `--county '$X'` and leaked literal quotes into argv (`No SWFL county matches "'Collier'"`); now built with a bash array + env-passed inputs.
- **Check `listings_runner_ip_waf_proof` CLOSED** — on the single-county proof (rows landed, no 403).

## The open problem

- **All-county sweep 403s.** Run `28256971415`: every county returned nothing, ending with the loud `ERROR: 0 listings from all SWFL counties` (the pipeline's total-empty guard, exit 1). Hendry showed `HTTP 403`.
- **Likely cause:** the source 403-throttles sustained request bursts. extract.py: `_PAGE_DELAY = 1.0` and a note that the site "403-throttles sustained bursts ~420+ reqs". A full 4-county walk is hundreds of pages; today's *repeated* runs (a cancelled 23-min walk + two single-county runs + the all-county run, all within ~1 hour) plausibly tripped an IP-level escalation. **A clean retest tomorrow (after the throttle resets) may pass one sweep** — but sustained *daily* all-county load needs the proxy for reliability, not luck.

## The fix — and the gotcha

1. **Provision a residential/rotating proxy.** (Same remedy the `crexi_cron_cf_yield_verify` check already prescribes for Crexi's Cloudflare block. Consider sharing one proxy across both.)
2. **Set the secret + workflow env.** `gh secret set CRAWL4AI_PROXY -R ethanrickyjrjr-wq/brain-platform`, and add `CRAWL4AI_PROXY: ${{ secrets.CRAWL4AI_PROXY }}` to the `env:` block of `.github/workflows/active-listings-daily.yml` (Pre-push Gate 3: secret set + wired into the workflow are two separate steps — do both).
3. **PLUMB THE PROXY INTO THE PIPELINE (the real work).** `active_listings/extract.py` `_fetch_html()` currently does:
   ```python
   cfg = HTTPCrawlerConfig(method="GET", headers={"User-Agent": _UA}, follow_redirects=True, verify_ssl=True)
   strategy = AsyncHTTPCrawlerStrategy(browser_config=cfg)
   ```
   It never reads `CRAWL4AI_PROXY`. Two options:
   - **(a) Add proxy to the HTTP strategy.** VERIFY FIRST (vendor-first, crawl4ai docs in-session via crawl4ai) whether `HTTPCrawlerConfig` / `AsyncHTTPCrawlerStrategy` supports a `proxy=` / `proxy_config=`. If yes, read `CRAWL4AI_PROXY` (mirror `crawl_client._proxy_from_env()`) and pass it. Lightest change; keeps the fast raw-HTML path.
   - **(b) Switch to the browser path** (`crawl_client.py`, which already honors `CRAWL4AI_PROXY` + UndetectedAdapter stealth). Slower (browser render virtualizes the list to ~4 cards — the original reason extract.py went raw-HTML), and you'd have to solve the virtualization. Only if (a) isn't supported.
4. **Re-prove from the runner.** `gh workflow run active-listings-daily.yml` (no county → full sweep). Confirm rows land for all counties with no 403. Then watch ≥3 scheduled daily runs stay green before calling it done (mirror the crexi "≥3 runs" bar).

## Key facts / pointers

- **Source:** `johnrwood.com/listings/` — base URL is the `LISTINGS_SOURCE_BASE_URL` secret (kept out of the repo). robots allows `/listings/` + `/listing/*`.
- **Counties:** Collier, Lee, Charlotte, Sarasota (Glades/Hendry return ~0, harmless). ~2,292 listings in Collier alone; a clean full seed previously held **9,368 rows** (the volume guard's prior baseline — that's why a Collier-only real run trips `assert_vs_baseline` as a false "collapse"; not a bug).
- **Pipeline:** `ingest/pipelines/active_listings/{pipeline,extract,distill}.py`. Per-county idempotent upsert (a late-county 403 keeps earlier counties' rows). Fails loud only on total-empty.
- **Table:** `data_lake.active_listings_residential` (`source_name='active_listings_seed'`; the licensed RESO feed swaps `source_name` into the same table later).
- **Consumer brain:** `refinery/packs/active-listings-swfl.mts`.
- **Proxy precedent in-repo:** `crawl_client.py:51 _proxy_from_env()` reads `CRAWL4AI_PROXY` → `ProxyConfig`, applied at lines 139/355 (browser strategy only).
- **Evidence runs:** clean single-county = `28254764976` (Collier, 2,292, 0×403); failed all-county = `28256971415` (0 listings, Hendry 403); the volume-guard false-collapse = `28256392474` (2,292 upserted then guard exit 1).
