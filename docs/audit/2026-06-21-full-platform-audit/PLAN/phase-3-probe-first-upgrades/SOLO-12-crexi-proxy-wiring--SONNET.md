# 12 — Crexi datacenter-IP escape: default-off `CRAWL4AI_PROXY` wiring — **SOLO + PROBE-GATED**

**Model: Sonnet.** ~30–40 lines, one file. **SOLO — serializes AFTER build 07** (shares
`ingest/lib/crawl4ai_client.py`). **Priority: P2 (gated).** Full plan: `BRIEF.md` #8 + cap #11.

## What it buys (verified)
The **only** in-process lever for Crexi's datacenter-ASN block. Per-request
`CrawlerRunConfig.proxy_config` is the recommended path; `BrowserConfig.proxy` is **deprecated**;
`ProxyConfig.from_string`/`from_env` exist on 0.9.0.

## ⚠️ Premise corrections (BRIEF #8 — verified)
- **Collier is NOT a proxy target.** `collier_permits/fetcher.py` documents an **Akamai JA3/TLS
  fingerprint** block from *any* IP — a residential proxy changes the IP, not the JA3. **Honest target =
  Crexi only.**
- Wire the **per-request** `proxy_config`, not the deprecated `BrowserConfig.proxy`.

## Steps
1. **Probe first.** Read `crawl4ai_client.py` (Session + `fetch_many`) after build 07 has landed; confirm
   `ProxyConfig` import + `from_string`/`from_env` on the installed 0.9.0.
2. Add `_proxy_from_env()` reading `CRAWL4AI_PROXY` → unset returns `None` (**zero behavior change**); thread
   `proxy_config` into each per-step `CrawlerRunConfig` + `fetch_many`. Do not touch the remote-server path
   (0.9.0 server hard-400s `proxy`/`proxy_config` sent over the network — in-process SDK is the ONLY valid lane).
3. Offline tests: default-off (no env → `None`, byte-identical) + a `from_string` round-trip.

## Gate (do NOT close the check until this passes)
A **live Crexi yield probe with a real proxy credential** showing the datacenter block lifts. Until then
this is dormant default-off wiring. No vendor/cron flip on a guess.

## Best-practice fold-in
This build is moot unless build 11 P0b confirms a GHA datacenter IP is the actual Crexi blocker.
Sequence after the build 11 P0b verdict: if the IP is NOT the blocker, park this; if it IS, activate
with a real proxy credential and run the live Crexi yield gate before flipping any cron.

## Risk
Low code / med outcome (empirical). Depends on 11's P0b verdict — if GHA can reach Crexi without a proxy,
this may be unnecessary; if it can't, this is the fix to validate.

## References (added 2026-06-22 — crawl4ai-live + best-practices fold-in)
**crawl4ai-live (tool-usage reference, docs/audit/2026-06-21-crawl4ai-live/):**
- `docs/audit/2026-06-21-crawl4ai-live/round2/12-proxy-security.md` — CrawlerRunConfig.proxy_config is per-request + RECOMMENDED; BrowserConfig.proxy is DEPRECATED; ProxyConfig.from_string/from_env
- `docs/audit/2026-06-21-crawl4ai-live/round2/13-identity-based-crawling.md` — identity/proxy escape for blocked ASNs
**best-practices-research (how to build/operate what we build, docs/audit/2026-06-21-best-practices-research/):**
- (n/a — crawl4ai tool-usage build)
**Verified:** confirmed in-process proxy is the ONLY datacenter-IP escape (0.9.0 server 400-rejects proxy over the network) — folded into Steps above where applicable.
