# Live Data Integration Strategy — Owning the Property-Data Layer

**Date:** 2026-06-11
**Author:** Claude (session research memo)
**Status:** Strategy / pre-design. One verification gate before any build.

---

## Context — the question that started this

The operator asked for a **"hook up your MLS" button**: let an agent who has MLS access feed their listing/project data into SWFL Data Gulf, and figure out how to **connect to the systems agents already use** — CRMs, MLS logins, valuation platforms, property portals.

The real pain underneath it (operator's words): *"everyone we are pushing our product to already has these types of systems, but we can't get them [the data] and we can't have them easily add them to our system when they buy."*

## The decisive reframe — stop chasing their systems; own the data

There are two philosophies:

- **Pull-from-their-systems** (their MLS, CRM, valuation platform): brittle by nature. Every vendor has a different API or none; needs per-customer auth; breaks when they switch tools; and scraping an MLS login is legally radioactive (costs the agent their membership). This is **N integrations to onboard N customers** — a tax, not a moat.
- **License the aggregated data ourselves** (RentCast / Realie / ATTOM-class): **one** integration, native day-one. The agent signs up and comps/AVM/listings are simply *there*.

**The fact that agents already pay for this data is not a wall — it is proof the data is cheaply licensable and that they value it.** So we license the same primitive and add the layer nobody else has: **flood AAL, permit pulse, and the cited / can't-invent-a-number deliverable.**

## What we actually have today (verified in code this session)

- **Live property data:** Zillow ZORI (rents, ZIP-level), LeePA parcels (Lee County — **no sale price, 100% NULL**), FHFA HPI (appreciation). Redfin pipeline is built but **never fired**.
- **CLAUDE.md is wrong about ATTOM:** there is **no ATTOM MCP server** wired. ATTOM / RentCast / Realie are catalogued in `docs/data-intel.md` only, tagged `🔍 SOURCE KNOWN` ("we know where to get it, haven't built it").
- **No MLS / IDX / RESO / CRM inbound.** The only inbound write path is the per-project capability key (`X-Project-Key`, MCP co-build). **No billing / Stripe** — monetization is env-var gates, not enforced; `uid` attribution on web usage is the blocker for per-account gates.
- **"Add a new REST API" is a proven ~2-3 day pattern:** ingest pipeline → `refinery/sources/*-source.mts` connector → `refinery/packs/*` pack → GHA cron → `cadence_registry.yaml` entry. Keys live in `.dlt/secrets.toml` / GH secrets.

## Vendor findings (Vendor-First — fetched live 2026-06-11)

| | **RentCast** | **Realie** |
|---|---|---|
| **Strength** | Market side: **comps, AVM (value + rent), active for-sale/for-rent listings (MLS #, DOM, list price), sale transaction history, ZIP market stats** | Parcel side: **ownership, deeds, mortgages, assessments, zoning, parcel geometry**, AVM, neighborhood insights |
| **Coverage** | 140M+ properties, nationwide incl. FL, **address-level**, 500k updates/day | 3,100+ counties, all 50 states, parcel shapes, sub-10ms lookups |
| **Pricing** | free dev (50 req/mo, $0.20/over) → **$74** (1k) → **$199** (5k) → **$449** (25k)/mo | free → **$50** → **$150** → **$350**/mo; up to 100 parcels/call |
| **Licensing** | **May store data on our systems + distribute to end-users of our app + build derivative commercial products.** May NOT resell raw API access or share the key. | API + bulk delivery (AWS/GCP/Azure); commercial licensing |
| **Best for** | **The CMA** — comps + AVM + listings without touching the agent's MLS | Parcel/ownership/zoning enrichment; fills the **Collier parcel gap** we already have |

**Licensing verdict (the crux):** RentCast's [API Terms](https://www.rentcast.io/terms-api) explicitly permit storing the data and **distributing it to the end-users of our application**, plus building derivative products. We hold **one** subscription, wrap the data in our product, and serve it to agents and their clients. We just can't resell raw API access or hand over the key — which we never need to.

## The MLS / IDX reality (answering "or an idx for mls?")

- **Scraping the agent's MLS portal is out** — licensed data behind their credential; bulk-harvesting it can de-list them and exposes us.
- **The legit path is IDX / RESO Web API:** per-MLS vendor approval (Florida Gulf Coast MLS / Stellar MLS / NABOR), signed agreements, fees, display rules — weeks-to-months each. Freshest hyper-local truth and a genuine long-term moat, but **not v1**.
- **RentCast already carries MLS-derived listings** (that's the source of its MLS number + DOM fields), so we get ~80% of the "connect your MLS" value **today** without the approval slog.

## Integration archetypes, ranked

1. **License an aggregator — RentCast first, Realie fast-follow. DO THIS.** One integration, ~2-3 days on the proven pattern, ~$75-200/mo, native day-one, legally clean, creates lock-in (data lives in *our* product).
2. **IDX / RESO MLS feed — long-term moat,** not v1. Per-MLS approval; RentCast covers most of it now.
3. **Agent's MLS export (manual) — the "verified comps" upgrade lane,** not the requirement.
4. **Web search (Zillow/Redfin) — the unstamped fallback,** "Speculative — double-check."
5. **Direct CRM / portal integration — not a strategy.** Only one build if a single CRM dominates SWFL agents.

## MOAT / provenance fit (stays on-brand)

RentCast/Realie are **licensed third-party sources → cited to the source** (a "stamped third-party" tier — real records, attributed). Their **AVM is an algorithmic estimate → disclaimed** like a Zestimate. Both slot into the existing `source_tag` / provenance system (same machinery as the `character_speculative` "Speculative — double-check" lane and the `agent_supplied` / `web_unstamped` tags). It does **not** masquerade as our proprietary lake. No MOAT violation.

## Business math (no sugar-coating)

This would be the **first recurring data subscription in the repo** (no buy-vs-build policy exists yet — a real, if tiny, commitment). But **one** $39-79/mo agent customer covers RentCast Foundation ($74/mo). ROI answers itself on the first paying agent. We absorb the bill and pass value through the subscription.

**Lean cost control:** for the CMA, call RentCast **at request-time per subject property** (a few calls = one CMA) rather than bulk-ingesting the lake. Only paid customers trigger paid calls; always fresh; zero Tier-2 storage. Bulk-ingest into the lake is a separate, later decision for lake-wide analytics.

## How this reshapes the CMA v1

> Agent picks a subject property → we pull **comps + AVM + active listings from RentCast** → wrap them in **our flood / permit / ZIP layer** → branded, fully-cited CMA one-pager in seconds. **Zero data entry.**

**Three-tier comp sourcing** (descending trust, each firewalled by provenance tag + disclaimer):

1. **RentCast** → native default, licensed-third-party, cited.
2. **Agent's MLS export** → `agent_supplied`, verified upgrade (freshest, agent-vouched).
3. **Web search (Zillow/Redfin)** → `web_unstamped`, "Speculative — double-check" fallback.

This kills the adoption friction the operator flagged ("hard to get people to do it") — there's nothing for the agent to *do* but sign up. The on-site assistant carries our data already (Goal 2 carry contract), so **no MCP connector is required** for the on-site flow; the connector stays a power-user convenience.

## Open decisions / next steps

1. **VERIFICATION GATE (before any build):** spin up a free RentCast dev key and fire ~10 live calls at real **Lee + Collier** addresses/ZIPs to confirm coverage and comp quality are real for *our* market — not just the nationwide marketing claim. This is the one thing that could change the plan.
2. **RentCast vs Realie as primary:** likely **both** (RentCast for comps/AVM/listings, Realie for parcel/ownership/zoning + Collier gap), RentCast first.
3. **Request-time vs bulk-ingest:** request-time per-property for the CMA; bulk-ingest deferred.
4. **Then:** `superpowers:brainstorming` → design doc under `docs/superpowers/specs/` → `superpowers:writing-plans`.

## Sources

- RentCast API — https://www.rentcast.io/api
- RentCast API Terms of Use — https://www.rentcast.io/terms-api
- RentCast help center — https://help.rentcast.io/en/articles/7992900-rentcast-property-data-api
- Realie real-estate data API — https://www.realie.ai/real-estate-data-api
- Realie pricing — https://www.realie.ai/pricing
- Internal: `docs/data-intel.md` (`SOURCE KNOWN` catalog), `docs/API_BLUEPRINTS.md` (Data Tier Policy), `docs/paywall-moat-gates.md`, `.mcp.json`
