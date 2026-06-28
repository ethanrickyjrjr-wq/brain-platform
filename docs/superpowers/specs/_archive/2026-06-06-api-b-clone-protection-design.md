# /api/b + /api/mcp clone-protection — decision record (2026-06-06)

**Status:** decided; awaiting operator dashboard action (the rate-limit rule). Lightweight
decision record, not a multi-step plan — implementation is one Vercel Firewall rule
(operator) + optional generic hardening (deferred). Check: `api_b_open_rate_limit`.

## Problem (audit-proven, not assumed)

The synthesized lake is trivially clonable from one IP with no auth:

- `GET /sitemap.xml` → 200, **54 URLs in one 8.5KB flat file** (every brain + corridor child
  - provenance page) — the full enumeration map in one fetch.
- `/api/b/{slug}?format=json` → 200, `Access-Control-Allow-Origin: *`, `Cache-Control:
no-store`, **no auth, no throttle**. Master 52KB, cre-swfl 135KB. `no-store` also forces a
  function re-run on every hit (`X-Vercel-Cache: MISS`) → a scraper runs up our compute bill.
- 5 rapid hits from one IP → all 200, **no `x-ratelimit-*`, no 429**. Zero throttle live.
- Origin is **pure Vercel, not Cloudflare-proxied** (DNS CNAMEs to `vercel-dns`, headers
  `Server: Vercel`, no `cf-ray`). robots.txt (ef8b522) even documents this gap in a comment.

## Decision

**Rate-limit, do not auth-gate.** A `429` ("slow down") is retried transparently by a legit
slow client; auth or a JS _challenge_ breaks every programmatic client — i.e. the open-MCP
GTM. So the action is **429, never challenge, never a login wall**, and `MCP_BEARER_TOKEN`
stays unset (public MCP is the GTM).

**Mechanism: Vercel WAF Custom Rule with a Rate Limit action.** Chosen over Upstash-in-
middleware and `@vercel/firewall` SDK because the origin is 100% Vercel: it is free (within 1M
allowed-req/mo), zero-code, no redeploy, applies instantly, and **blocked traffic is not
billed** (verified live: vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting). An in-code
counter can't work — Vercel functions are stateless/distributed, so rate-limiting needs shared
edge state (WAF) or a shared store (Redis); WAF is the least operator effort.

### The rule (operator action, ~5 min, no deploy)

> Vercel dashboard → project → **Firewall** → new **Custom Rule**
> **If** Request Path starts with `/api/b` **OR** starts with `/api/mcp`
> **Then** **Rate Limit** 20 requests / 10s, key **IP**, response **429** (default)

Tuned so a human + a single Claude/MCP session (≤~6 req in a burst per data-protocol routing)
never trips, while a 54-slug parallel slurp does. Tunable — loosen if the Firewall log shows a
429 on legit traffic. Scoped to `/api/b` + `/api/mcp` only (the clone vectors); leaves
`/api/landing-data`, `/api/waitlist`, `/api/build-report`, `/r/*` browsing untouched so
shared-NAT/office IPs and SEO crawls are unaffected.

## Why the data is still worth protecting (operator's sharp point)

"Data goes stale, so they re-scrape on each update" is correct — **no security fully stops a
determined re-copy of a public API.** The rate limit turns a free 3-second slurp into a slow,
conspicuous, multi-minute crawl and caps our bill. The durable moat is what a snapshot can't
copy: (1) the `SWFL-7421-vN-DATE` freshness token is a **watermark** → republishing is
provably theft; (2) the **graded-call flywheel** compounds for us over time. Escalation lever
if a determined nightly mirror appears in logs: a free, **revokable** API key on the bulk path
— build only against an observed abuser, never on spec.

## Parked / rejected (with reason)

- **Cloudflare WAF/Bot-Fight** — REJECTED. Origin is DNS-only (grey-cloud) at Cloudflare;
  Cloudflare HTTP products only see _proxied_ traffic. Would require rerouting all Vercel
  traffic through Cloudflare for a marginal gain. No.
- **Edge-cache `/api/b` (s-maxage)** — PARKED. Would cut scraper compute, but the rate limit
  already throttles the scraper to few hits, and caching risks the freshness token lagging
  ≤60s after a nightly rebuild (touches the locked freshness contract). Marginal real-user
  speed gain (function already fast). Revisit only if scrape compute shows on the bill.
- **Gut the sitemap** — REJECTED. SEO tax to hide a slug list a cloner can guess; the rate
  limit makes the enumeration _source_ moot (54 rapid fetches get throttled regardless).
- **Hide `/api/mcp` `reports:27` banner** — REJECTED as theater while the sitemap is public.
- **Generic junk-path deny (`/.env`, `/.git`) + method hardening** — DEFERRED to a routine PR;
  pure hygiene, not the clone threat, not urgent. (Next.js already 405s unhandled methods, so
  a GET-lock on `/api/b` is redundant.)
- **Optional free API key tier** — DEFERRED; it's the escalation lever, added against a real
  observed abuser, not speculatively.
