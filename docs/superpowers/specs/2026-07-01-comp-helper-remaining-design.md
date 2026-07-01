# Comp helper: comps chart + pasted-link lane

**Date:** 2026-07-01
**For:** SteadyAPI Phase 2B Part B, Increments 2 & 3 (v1 core shipped in `6027a608`).
**Predecessor:** `docs/superpowers/plans/2026-07-01-steadyapi-comp-helper-remaining-handoff.md`.
**Process:** brainstormed per RULE 3.5; two `advisor()` (Opus) passes on the Increment 3 SSRF guard
(see `SESSION_LOG.md` for the raw findings) — no crawl4ai vendor-doc pass needed, nothing here names
a vendor MIME type / SDK shape / model id.

## Problem

Two items remain on the on-demand comp helper: comps have no visual (Increment 2), and a user who
pastes a listing link gets nothing folded in (Increment 3). Increment 3 is not cosmetic — wiring it
naively adds an outbound fetch of an arbitrary user-supplied URL to the answer engine, and the obvious
reuse candidate (`fetchListingFacts`) turned out to have **zero** SSRF guard on its primary fetch today
(already live, via Email Lab). This spec fixes that gap as part of building Increment 3.

## Goal

- A comp answer with ≥2 priced comps shows a bar chart, honestly labeled (an estimate/last-list price
  can never read as a sale).
- A user who pastes a listing link in an authenticated conversation gets that property folded in as one
  cited comp — cited to the site's homepage, never a permalink, never the string "SteadyAPI".
- The new outbound fetch this adds is real-SSRF-safe, not just pattern-plausible.

## Decisions locked with the operator

1. **Increment 3 scope: gated to authenticated (`analyst`) users only.** Public `/welcome` stays
   zero-fetch — a pasted link there gets a lane-4 ask for address + price (the existing user-typed-facts
   lane already relays that, no new code). This shrinks the attack surface from "anyone on the internet"
   to "our logged-in users," but does **not** remove the need for a real guard (see below) — an
   authenticated attacker can still reach an internal-network fetch if the guard is weak.
2. **Increment 2 chart: comps-only, no subject/median bar.** `buildCompsSpec` (the existing
   `lib/email/listing-comps.ts` builder) hard-requires a subject price; the geocoded comp-helper subject
   has none. Labeling the nearby-stats median "(Subject)" would misrepresent an area aggregate as this
   property's valuation — a no-invention collision. Comps-only avoids it entirely.

## What we're building

### Increment 2 — comps bar chart

New pure function in `lib/assistant/comp-helper.ts`:

```
buildCompsChartSpec(result: CompResult): ChartSpec | null
```

- Filters `result.comps` to those with a non-null `price`; returns `null` if fewer than 2 remain (a
  2-bar chart is the existing minimum-informative threshold used elsewhere in the codebase).
- Sorts price-desc. Each row's label is `addressLine`, with an honesty suffix so an estimate/last-list
  price can never look like a sale on the chart: `" (est.)"` for `priceKind:"estimate"`, `" (list)"` for
  `priceKind:"last_list"`, no suffix for `priceKind:"sold"` (bar-mode rendering — confirmed via
  `refinery/lib/chart-adapter.mts:adaptToHBar` — reads only `columns[0]`/`columns[1]`, so a third
  "basis" column would be invisible in the bar view; the label suffix is the only place this reads).
- `title`: `"Nearby comparable prices near {matchedAddress}"` (falls back to `"Nearby comparable
  prices"` if `matchedAddress` is absent). `columns: ["Property","Price"]`, `value_format:"usd"`,
  `chart_type:"bar"`, `frameId:"bar-table"` (same frame `buildCompsSpec` uses).
- `asOf`: converted from `CompResult.asOf` (MM/DD/YYYY) back to ISO `YYYY-MM-DD` via a small
  `mdyToIso` helper — `ChartSpec.asOf` / the caption renderer (`ChartBlockView.captionFor`) expect ISO.
- `source`: `{ citation: "Nearby comps, SWFL Data Gulf + realtor.com", url: "https://www.realtor.com" }`
  — mirrors `compSources()` exactly; never names SteadyAPI.

Wiring in `compForConversation` (`lib/assistant/conversation-path.ts`): its return type gains an
optional `chart?: ChartSpec`. In the existing (address/SteadyAPI) branch, when `result.comps` yields
≥2 priced comps, set `chart: buildCompsChartSpec(result)`. Both existing call sites (the no-location
region branch and the located branch) push `{ type: "chart", chart: comp.chart }` into `prelude` when
present — the same pattern already used for the region/located chart earlier in each branch. The LLM
never touches the chart's numbers (unchanged moat).

### Increment 3 — pasted-link lane

**The guard (closes a live gap, not just a new one).** `fetchListingFacts`
(`lib/email/listing-scrape.ts:406`) does `fetch(url, { redirect: "follow", ... })` with **no host
check at all** — unlike `fetchOgImage` (`lib/email/og-image.ts`), which at least pattern-matches the
initial hostname via `isSafePublicUrl` before fetching. Neither function re-validates the host on each
redirect hop, so even `isSafePublicUrl` is bypassable: a hostname that resolves fine passes the check,
then 302s to `169.254.169.254` (cloud metadata) or `127.0.0.1`, and `redirect:"follow"` fetches it
anyway. Fixing only `fetchListingFacts` (not `fetchOgImage`, which stays as-is — pre-existing, lower
severity, out of scope here) closes the actual gap for both its current caller (Email Lab, authenticated)
and the new one (pasted-link comp).

New shared module `lib/email/safe-fetch.ts`:

```
isPrivateOrReservedIp(address: string): boolean   // pure; IPv4 + IPv6 incl. IPv4-mapped
safeListingUrl(rawUrl: string): Promise<URL | null>
safeFetchPublicUrl(rawUrl: string, opts?: { timeoutMs?: number; accept?: string }): Promise<Response | null>
```

- `isPrivateOrReservedIp` rejects loopback (`127.0.0.0/8`, `::1`), RFC1918 private ranges
  (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local incl. the cloud metadata address
  (`169.254.0.0/16`), CGNAT (`100.64.0.0/10`), `0.0.0.0/8`, IPv6 ULA (`fc00::/7`), and IPv6 link-local
  (`fe80::/10`).
- `safeListingUrl`: https-only; rejects `localhost` / `.local` / single-label hosts (same posture as
  `isSafePublicUrl`); then **resolves the hostname via `node:dns/promises` `lookup(host, {all:true})`
  and rejects if any resolved address is private/reserved** — the piece a hostname-pattern check alone
  misses (a domain whose A-record points at an internal IP passes pattern matching, fails this).
- `safeFetchPublicUrl`: calls `safeListingUrl` first; fetches with `redirect:"manual"` and **rejects any
  3xx response outright** rather than following it — sidesteps re-validating each redirect hop (and the
  Node/undici "manual" opaque-response ambiguity) at the cost of not following a legitimate redirecting
  listing URL. Documented trade-off, not silently accepted: most listing URLs a user copies from their
  own browser address bar are already the final resolved URL, so this is expected to be rare in
  practice; if real pastes start failing on a redirect, the fast-follow is `redirect:"manual"` +
  per-hop re-validation instead of an outright reject. Existing timeout/size-cap/browser-UA posture
  carried over from `fetchListingFacts`'s current constants.
- **Residual risk, deliberately deferred (documented, not silently skipped):** full DNS-rebinding
  protection (pinning the connection to the exact IP that was validated, so a second DNS lookup at
  connect time can't return a different, private address) is not built. The DNS-resolve check above
  closes the practical gap (a malicious host record); the TOCTOU race between our `lookup()` and the
  runtime's own connection-time resolution is a much smaller residual window, left for a future pass
  if the operator wants that bar.

`fetchListingFacts` change: its primary `fetch(url, ...)` call is replaced with
`safeFetchPublicUrl(url)`. Everything downstream (parse/merge/LLM-fallback cascade) is unchanged.

**New module** `lib/assistant/pasted-link-comp.ts`:

```
looksLikePastedListingLink(question: string): boolean
pastedLinkComp(question: string, allowFetch: boolean, deps: CompDeps): Promise<{
  comp: RenderComp | null;
  source: WelcomeSource | null;
  needs: string[];
}>
```

- `looksLikePastedListingLink` = `looksLikeCompAsk(question) && extractUrls(question).length > 0`
  (reuses the existing comp-ask gate + `extractUrls` from `lib/email/og-image.ts`). A bare pasted link
  with zero comp-ish wording does not trigger this lane in v1 — documented limitation, not a silent
  drop (the message still gets a normal answer; a fast-follow can loosen the gate if it proves too
  narrow in practice).
- Gate order inside `pastedLinkComp`:
  1. Not a pasted-listing-link ask → no-op (`comp:null, source:null, needs:[]`) — caller falls through.
  2. `!allowFetch` → `needs: ["I can't open links directly here — reply with the address and price and
     I'll add it as a comp."]` (no network call at all — see "fetch-free by construction" below).
  3. Fetch (`deps.fetchPastedFacts ?? fetchListingFacts`, already guarded internally) fails or returns
     no `price` → `needs: ["I couldn't read that link — reply with the address and price and I'll add
     it as a comp."]`.
  4. `facts.zip` missing, or `resolveZip(facts.zip).primary_county` is not `12071`/`12021` → same
     needs-ask, reworded to name the footprint (`"I couldn't confirm that's a Lee or Collier property
     with a price — reply with the address and price and I'll add it as a comp."`). Uses the existing
     `refinery/lib/zip-resolver.mts:resolveZip` — cheap, no paid geocode call, unlike the address-typed
     lane (which needs lat/lon for the SteadyAPI query; this lane doesn't call SteadyAPI at all).
  5. Else → build one `RenderComp` (`priceKind:"last_list"` — a scraped listing page price is a current
     ask, never a confirmed sale; `priceDate: null`; `status:"active"`) + one `WelcomeSource` citing
     that host's homepage only (never the pasted permalink) + `needs: []`.

**`compForConversation` branch.** A pasted link takes over the whole request — it does *not* also run
through the address/SteadyAPI `compHelper` lane. Running both would produce two contradictory
needs-messages (compHelper asking for "the full street address" while the user just supplied a link).
The branch: `looksLikePastedListingLink(question)` → delegate entirely to `pastedLinkComp`, wrap its
single comp (if any) in a `CompResult`-shaped object, render via the existing `renderCompBlock` (already
generic over `RenderComp[]`, no changes needed there) and the pasted source directly (bypasses
`compSources()`, which is specific to the SteadyAPI lane's fixed two sources). Otherwise, unchanged
`compHelper` flow.

**Fetch-free by construction.** `CompDeps` (in `comp-helper.ts`) gains:

```
allowPastedFetch?: boolean;   // default false
fetchPastedFacts?: (url: string) => Promise<ListingFacts | null>;
```

`allowPastedFetch` defaults to `false` when omitted, so every existing test and the public `/welcome`
path stay fetch-free without an explicit opt-in — the guard can't be "forgotten" by a future third
caller. `conversation-path.ts` passes `{ allowPastedFetch: analyst }` at both existing
`compForConversation(...)` call sites (`analyst` is already in scope at both).

## Error handling / no-invention floor

Every failure mode in the pasted-link lane resolves to a `needs[]` ask, never a guess and never a
silent drop: fetch not permitted, fetch failed, page unreadable, no price found, zip missing, zip
outside Lee/Collier. `safeFetchPublicUrl` never throws (mirrors every other network wrapper in this
codebase) — guard failure and network failure both collapse to `null`, and `pastedLinkComp` turns a
`null` fetch into the same "couldn't read that link" ask as an unreadable page.

## Testing (TDD)

- `lib/email/safe-fetch.test.ts` (new): `isPrivateOrReservedIp` table (loopback, RFC1918 ×3,
  link-local incl. `169.254.169.254`, CGNAT, `::1`, ULA, a public IP passing). `safeListingUrl` with a
  mocked `dns/promises.lookup`: http rejected, a host resolving to a private IP rejected, a host
  resolving to a public IP passing. `safeFetchPublicUrl` with a mocked `fetch`: a 3xx response rejected
  (returns `null`, fetch not followed), a 200 response passed through.
- `lib/assistant/pasted-link-comp.test.ts` (new): gate cases for `looksLikePastedListingLink`;
  `pastedLinkComp` — `allowFetch:false` returns the ask **and never calls the injected fetch spy**
  (asserts zero-call, not just the return value); injected fetch returning `null`/no price → "couldn't
  read" ask; valid facts with an out-of-footprint zip → footprint ask, `comp:null`; valid Lee/Collier
  facts with a price → correct `RenderComp` (`priceKind:"last_list"`) + homepage-only source.
- `lib/assistant/comp-helper.test.ts` (extend): `buildCompsChartSpec` — null under 2 priced comps,
  correct sort + label suffixes per `priceKind`, correct title/source/asOf conversion.
- `lib/assistant/comp-for-conversation.test.ts` (extend): the pasted-link branch is selected over the
  address branch when a link is present; `chart` is populated when ≥2 priced comps come back from the
  address lane and absent otherwise; `allowPastedFetch:false` (the public-path default) never invokes
  the injected fetch even when a link is pasted.

Verify with `bunx next build` (not bare `tsc`) per project convention. No live SteadyAPI/Mapbox/Anthropic
call in any of the above — fully offline, DI-injected.

## Out of scope (documented, not silently dropped)

- Public `/welcome` auto-fetch of a pasted link — explicit operator call, not a bug.
- `fetchOgImage`'s own weaker guard (pattern-only, follows redirects) — pre-existing, unchanged.
- Full DNS-rebinding connection pinning — see residual-risk note above.
- Combining a typed address *and* a pasted link in the same message — falls to the pasted-link lane
  only; the address portion is ignored for SteadyAPI purposes in v1.
