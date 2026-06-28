# Homepage — Data Intelligence Showcase

---

## THE VISION (operator decree, 2026-06-28 — verbatim)

"WE AREN'T A LISTINGS COMPANY! THOUGH I LIKE SOME OF THOSE IDEAS FOR THE HOMEPAGE. WE HAVE NO PICTURES OF LISTINGS. NO ONE CARES ABOUT WORDS. WE ARE FOCUSED ON THE ENTIRE SITE AS A WHOLE.

WE DON'T WANT TOO MUCH ABOUT LISTINGS ON THE HOMEPAGE! WE JUST WANT NUMBERS THAT WILL ATTRACT INTEREST FROM ALL PEOPLE DOING RESEARCH.

FORGET BEING A LISTING COMPANY. WE TAKE ALL DATA, REAL DATA, IF WE DON'T HAVE IT, WE FIND IT AND WE HAVE AI PAINT THE ACTUAL PICTURE OF WHAT IS GOING ON.

FOR BUYERS, IS THIS A GOOD BUY?

SELLERS, WHAT SHOULD I PAY FOR THIS PROPERTY BASED ON CURRENT AND PAST AND POSSIBLE FUTURE SCENARIOS?

BROKERS, BUILD ME A DELIVERABLE THAT UPDATES DAILY WITH INFORMATION, CHARTS, GRAPHS, AI SALESMAN OR AI COMMENTARY AND ANALYSIS BASED ON REAL DATA!!!"

---

- Homepage = numbers that attract ALL research audiences. Not words. Not listings portal.
- Flood and Home Value pills exist. Map stays on flood default.
- The three builds: BUYER answer, SELLER pricing with scenarios, BROKER deliverable factory with charts/graphs/AI commentary/auto-send.
- AI paints the picture from real data. Find it if we don't have it. Never invent it.

---

**Status:** Ready to build  
**Date:** 2026-06-28 (v2 — vision corrected after operator decree)  
**Check:** `homepage_listing_showcase_live_verify`

---

## What We Are

A DATA INTELLIGENCE platform for SWFL. Not a listings site. Not a portal. Not a dashboard.

The product: AI that reads ALL of SWFL's real data and answers the real question each audience brings.

**Buyer:** "Is this a good buy in Cape Coral right now?"  
**Seller:** "What should I price my Fort Myers Beach home?"  
**Broker:** "Build me a market brief that sends to my clients every Monday."  
**Investor:** "Where in SWFL is growth actually happening?"

The map is the front door. Click a ZIP, get the full picture. The AI builds anything you ask for from the data.

---

## Research Findings (crawl4ai, June 28 2026)

**ATTOM Data:** "Property Data & Intelligence Built for AI." They don't lead with listings — they lead with DATA CATEGORIES. Breadth is the product. The broker pitch: "data your competitors don't have."

**CoreLogic/Cotality:** "Intelligence beyond bounds." "1 million+ data points refreshed monthly." "Navigate complexity with conviction." Five data categories shown simultaneously — property, climate/risk, market, customer. Never a single metric.

**What this means for us:**
- Listings count is ONE signal in the stats bar. Not the page narrative.
- Map pills should span the data breadth — every audience finds their signal
- Capabilities cards should voice the QUESTION the audience brings, then show we answer it

---

## Current State

Pills that exist: Flood Risk | Home Value | New Permits — all 3 working.
Map default: `flood` — should be `value` (flood alarming to new arrivals; value is universal).
Stats bar: 4 cells, all flood/value/permit/zip-count — need one signal per audience type.

---

## The Changes

### 1. Map default — `Hero.tsx` line 286

Change `applyMetric("flood")` to `applyMetric("value")`

Home Value is the right default. Everyone cares about home value. Flood is a signal you toggle to, not what you lead with.

### 2. Add "Active Listings" pill — `Hero.tsx` + `home-map-data.ts`

Add a 4th pill: `Active Listings`. Shows listing count per ZIP as a choropleth (amber gradient — more listings = warmer). Buyers read it as supply. Investors read it as market depth.

METRIC_ORDER: `["value", "listings", "permits", "flood"]`

Default pill order: Home Value | Active Listings | New Construction | Flood Risk

Data: query `data_lake.listing_state` for count per ZIP, bake into `home-map-data.ts` as the `listings` metric.

### 3. Stats bar — 4 cells, 4 audiences

Each cell answers a different audience's question. Label from the audience's perspective, not ours.

```
[Active Listings]  [Median Value]   [Fastest Growing]  [Highest Risk]
10,161             $496K            34120              33931
Lee + Collier      Lee County       423 permits        $30K/yr flood
```

Labels are conversational, not technical:
- Cell 1: "Active Listings" — answers "how much is out there?"
- Cell 2: "Median Home Value — Lee" — answers "what are homes going for?"
- Cell 3: "Most Building Activity" — answers "where is growth happening?"
- Cell 4: "Highest Flood Exposure" — answers "what's the risk here?"

### 4. Capabilities cards — `Capabilities.tsx`

Replace generic feature cards with audience-voiced question cards. The card IS the question the user brings.

**Card 1 — Buyer**
- Title: `"Is this a good time to buy in Cape Coral?"`
- Body: `"Compare asking prices to historical values, see how long homes are sitting, check permit activity and flood exposure — all in one answer, with every number sourced."`
- Chips: `[Buyers]` `[ZIP Analysis]` `[Cited Data]`

**Card 2 — Seller**
- Title: `"What should I price my Fort Myers Beach home?"`
- Body: `"We pull comps, DOM per ZIP, price-cut trends, and YoY value direction. The answer tells you what the market will pay — not what you hope it will."`
- Chips: `[Sellers]` `[Pricing]` `[No Guessing]`

**Card 3 — Broker**
- Title: `"Build me a daily market brief for my clients."`
- Body: `"Describe the report. AI writes it from live data, adds charts and commentary, and sends it on schedule — to every client, automatically."`
- Chips: `[Brokers]` `[Auto-Send]` `[Daily Updates]`

**Card 4 — Investor**
- Title: `"Where in SWFL is growth actually happening?"`
- Body: `"Permit activity, inventory shifts, price direction — we track every signal across 57 ZIPs. The map shows you where the momentum is before anyone else does."`
- Chips: `[Investors]` `[Market Trends]` `[57 ZIPs]`

### 5. Hero badge + pill labels

Badge: `"Lee · Collier Counties · Updated Daily"` (remove "Sample data" when live)

Pill labels:
- `value` → "Home Value"
- `listings` → "Active Listings"
- `permits` → "New Construction"
- `flood` → "Flood Risk"

Rail sublabel for flood: `"Avg annual insurance loss per property"` (plain English, not "FEMA NFIP AAL")

---

## The /listings Page — a Data Tool, Not a Portal

The `/listings` page exists because 10,161 listings with addresses is a DATA ASSET — buyers and investors care about supply depth, DOM, and price distribution by ZIP. It is NOT the product. It is reached from the "Active Listings" stat cell.

**Page purpose:** Show the data dimension of listing inventory — count, price distribution, DOM.

**Implementation:**
- Filter: county / price range / beds
- Card: price · beds/baths/sqft · street address · city/ZIP · days on market
- No photos (IDX-gated; we don't need them for data utility)
- AI summary line per filtered result: "847 Lee County homes under $400K — median $328K, 23% have cut their price"

**Entry points:**
- Clicking the "Active Listings" stat cell on the homepage
- "See all X listings in [ZIP]" link on /z/[zip] pages
- Direct URL `/listings`

NOT linked from main nav. NOT in capabilities cards. Deep-dive data tool.

---

## What Does NOT Change

- Map SVG, ZIP interaction, tooltip logic
- Competitor comparison strip ("What everyone else charges")
- Waitlist section
- ZIP report pages

---

## Files

| File | Change |
|---|---|
| `lib/landing/home-map-data.ts` | Add `listings` MetricDef · METRIC_ORDER `["value","listings","permits","flood"]` |
| `components/landing/Hero.tsx` | Default `value` · 4th pill "Active Listings" · badge · flood sublabel |
| `components/landing/Capabilities.tsx` | 4 audience-voiced question cards |
| `app/listings/page.tsx` | New — data tool page |
| `app/api/listings/route.ts` | New — filtered query endpoint |
| `components/listings/ListingCard.tsx` | New — compact data card |
| `components/listings/ListingFilters.tsx` | New — county/price/beds filter |

---

## Verification

**Homepage:**
1. Opens with Home Value choropleth (teal gradient, not flood orange)
2. Pills: Home Value (active) | Active Listings | New Construction | Flood Risk
3. Stats bar: 4 cells, one per audience type
4. Capabilities cards show buyer/seller/broker/investor questions
5. Search still routes ZIP → /z/[zip], text → /ask

**Listings page:**
1. `/listings` loads — cards with address, price, beds/baths/sqft, DOM
2. County filter works
3. AI summary line present
4. `bunx next build` clean

---

## Phase 2 — After Realtor.com Ingest

Once `data_lake.realtor_zip_metrics` is live:
- Stats bar can show median DOM per county: "87 days on market in Lee"
- Stats bar can show price_reduced_share: "22% of Lee sellers cut their price"
- Listings page cards gain DOM-per-ZIP context
- Map gets 5th pill: "Days on Market" (blue = slower, amber = fast)

No structural homepage changes — just data populating existing slots.
