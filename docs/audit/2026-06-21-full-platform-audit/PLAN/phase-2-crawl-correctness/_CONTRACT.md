# Phase 2 — shared contract (06–10 run together)

These five are **build-now** (no live probe). They touch disjoint files, so run them concurrently.

| Build | Owns | Collides with 06–10? |
|---|---|---|
| 06 | `ingest/lib/extract_client.py` | no |
| 07 | `ingest/lib/crawl4ai_client.py` | no |
| 08 | the 11 crawl `*.yml` | no |
| 09 | new `ingest/requirements-probe.txt`, `freshness-probe-daily.yml`, `daily-rebuild.yml` | no (different ymls than 08) |
| 10 | `ingest/pipelines/dbpr_sirs/pipeline.py` | no |

## The one binding contract — build 07 MUST keep defaults byte-identical
06, 10, and (later) 11/13 all call into the shared client `ingest/lib/crawl4ai_client.py`. Build 07 adds
new knobs (jitter, monitor, `stream`, `after_goto` gate, `fit_markdown`) — **every one default-OFF /
default-unchanged**, so existing callers (`Crawl4aiSession`, `fetch_many`, `_scrape_page`) behave
byte-identically. This is the existing repo invariant ("6 callers stay byte-identical" — BRIEF #7). 07's
verification gate is exactly this: the full ingest smoke + the supercrawl bench/test still pass with no
behavior change. If 07 can't stay byte-identical for a given knob, that knob moves to its own SOLO build.

## Phase-2 → Phase-3 hand-off
- 11 (Crexi) consumes 06's chunker + 07's additive `step()` params → starts after 06+07 land.
- 12 (proxy) and 13 (`fetch_tables`) also touch `crawl4ai_client.py` → they serialize AFTER 07 (Phase 3).
