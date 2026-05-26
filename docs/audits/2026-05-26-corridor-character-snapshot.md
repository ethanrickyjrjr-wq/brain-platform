# Corridor character snapshot — 2026-05-26

Frozen snapshot of `corridor_profiles.character` (and adjacent editorial fields) for every verified non-deleted corridor in live Supabase, taken before the corridor-character generator pipeline replaces this text with synthesized output backed by deterministic local data + Gemini grounded answers.

**Why this file exists:** the strings below were Claude-drafted in May 2026 without per-claim primary sources. They are being replaced — but kept here as (a) a diff baseline for evaluating generator output, and (b) restore safety in case the generator regresses and the live column gets blanked.

**Do not edit.** This is a dated artifact. Future snapshots get new filenames.

**Stats:** 26 corridors · 10 Collier · 16 Lee · 0 pending broker narratives (expected — Firecrawl pipeline has not landed a row) · 0 unknown-county rows.

**Generator:** `refinery/tools/pull-corridor-character-snapshot.mts` (re-runnable; produces dated snapshot files).

---
## 5th Ave South / 3rd Street South  ·  Naples (Collier)  ·  mixed-use-downtown

**Current `source_url`:** https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/fort-myers-naples-marketbeats

**`character` (rendered verbatim to end users):**

> Ultra-luxury global retail destination. At capacity — redevelopment and lease turnover are the only plays. No visible gaps.
>    4th Ave S emerging as dining expansion zone driven by Gulfshore Playhouse Baker Theatre opening. Three boutique concepts
>   (coastal Italian, wine club) open on adjacent blocks targeting pre/post-theater crowd. Full dining row mid-2027.

**Other editorial fields:**
- `evolution_direction`: repositioning
- `tenant_mix`: Ultra-luxury retail, fine dining, art galleries, RH Gallery (5th & 4th St S), jewelry, designer fashion. 4th Ave S:
  emerging boutique dining.
- `active_flags`: ```json
[
  {
    "flag": "4th Ave S dining wave — 3 concepts open, full row mid-2027 (permitting backlog)",
    "type": "new_project",
    "status": "active",
    "resolution": "mid-2027"
  },
  {
    "flag": "RH Gallery + Rooftop Restaurant — opened Nov 2025, anchored west end",
    "type": "status_update",
    "status": "active",
    "resolution": "completed"
  }
]
```

**Metrics snapshot (for context):**
- cap_rate: 6.70% rising · vacancy: 1.80% stable
- absorption: 1500 sqft stable · asking_rent: $60.84 psf rising
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-16T22:59:18.653662+00:00 · **Updated:** 2026-05-16T22:59:18.653662+00:00

---
## Collier Blvd / CR-951  ·  Naples (Collier)  ·  highway-strip-mall

**Current `source_url`:** https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/fort-myers-naples-marketbeats

**`character` (rendered verbatim to end users):**

> North-south connector from I-75 south to Marco Island. Serves as the eastern boundary of developable Naples. Mix of big-box
>    retail near I-75 interchange and neighborhood-service retail further south. Growth constrained by Everglades to the east — all
>    expansion pressure pushes north toward Immokalee Rd interchange.

**Other editorial fields:**
- `evolution_direction`: growing
- `tenant_mix`: Big-box retail (Home Depot, Walmart), grocery-anchored plazas, medical office, auto services, Marco Island gateway
  services
- `active_flags`: (none)

**Metrics snapshot (for context):**
- cap_rate: 6.70% rising · vacancy: 3.30% falling
- absorption: 8500 sqft rising · asking_rent: $26.79 psf rising
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-16T22:59:18.653662+00:00 · **Updated:** 2026-05-16T22:59:18.653662+00:00

---
## Davis Blvd East Naples  ·  Naples (Collier)  ·  highway-strip-mall

**Current `source_url`:** https://lsicompanies.com/market-reports/

**`character` (rendered verbatim to end users):**

> The gentrification frontier of Naples. Bayshore Gateway Triangle is the most active redevelopment zone in the county.
>   Metropolitan Naples 'Aura' (15 stories, 53 luxury residences, 10k SF boutique retail) — residents moved in April 2026, retail
>   shells to tenants May 2026, Q4 2026 retail opening. Arts & Design District forming around Celebration Park. Gulf Gateway
>   Commons (US-41 & Rattlesnake Hammock Rd) is a named project capturing B-to-A class professional office spillover from City of
>   Naples.

**Other editorial fields:**
- `evolution_direction`: growing
- `tenant_mix`: Metropolitan Naples Aura (luxury residential + boutique retail), Celebration Park (food truck/outdoor dining anchor),
  adaptive reuse studios (fitness, cabinetry showrooms), Gulf Gateway Commons (professional services — insurance, law, pool
  services priced out of City core)
- `active_flags`: ```json
[
  {
    "flag": "Metropolitan Naples Aura — residents April 2026, retail Q4 2026",
    "type": "construction",
    "status": "active",
    "resolution": "Q4 2026"
  },
  {
    "flag": "Gulf Gateway Commons (US-41 & Rattlesnake Hammock) — B-to-A office conversion",
    "type": "new_project",
    "status": "active",
    "resolution": "2026-2027"
  },
  {
    "flag": "Luxury line officially past Bayshore Drive — gentrification expanding east",
    "type": "status_update",
    "status": "active",
    "resolution": "structural"
  }
]
```

**Metrics snapshot (for context):**
- cap_rate: 6.70% rising · vacancy: 3.30% falling
- absorption: 9500 sqft rising · asking_rent: $26.79 psf rising
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-16T22:59:18.653662+00:00 · **Updated:** 2026-05-16T22:59:18.653662+00:00

---
## Immokalee Rd North Naples  ·  Naples (Collier)  ·  highway-strip-mall

**Current `source_url`:** https://cpswfl.com/wp-content/uploads/2025/07/Fort-Myers_Naples_Americas_Alliance_MarketBeat_Office_Q22025.pdf

**`character` (rendered verbatim to end users):**

> The 'Suburban 5th Avenue' — true commercial gravity center of Collier County. Arthrex HQ corridor on Creekside Blvd has
>   created a non-seasonal Med-Tech and Professional Service cluster that runs year-round. The 'Arthrex Effect' means high-end
>   fast-casual retail survives May-November because the corporate campus provides a captive workforce. Oakes Farms Seed to Table
>   (Immokalee & Livingston) is the de facto Arthrex cafeteria. Logans Landing (Logan Blvd) provides service-retail layer.

**Other editorial fields:**
- `evolution_direction`: stable
- `tenant_mix`: Arthrex HQ campus (Med-Tech anchor), Oakes Farms Seed to Table, Logans Landing (dentists, salons, pilates), Pointe at
  Founders Square (100% leased, Capital Grille), North Naples gated community services, high-end fast-casual
- `active_flags`: ```json
[
  {
    "flag": "Arthrex Effect — non-seasonal daytime economy, year-round captive workforce",
    "type": "status_update",
    "status": "active",
    "resolution": "structural"
  },
  {
    "flag": "Logan Blvd Extension — fully operational, traffic relief delivered",
    "type": "infrastructure",
    "status": "active",
    "resolution": "completed"
  }
]
```

**Metrics snapshot (for context):**
- cap_rate: 6.70% rising · vacancy: 3.30% stable
- absorption: 15000 sqft stable · asking_rent: $30.91 psf rising
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-16T22:59:18.653662+00:00 · **Updated:** 2026-05-16T22:59:18.653662+00:00

---
## Naples Airport-Pulling (North)  ·  Naples (Collier)  ·  industrial-flex

**Current `source_url`:** https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/fort-myers-naples-marketbeats

**`character` (rendered verbatim to end users):**

> Strip / neighborhood retail corridor, N Naples submarket, north of Pine Ridge Rd. Primarily residential-serving: grocery-anchored centers, services, neighborhood retail. Green Tree Center (Immokalee Rd + Airport-Pulling) reported nearly full with tenant waiting list as of Nov 2023. Airport-Pulling Rd widening project active (design completion targeted end 2025); may affect deal velocity near term. Net absorption null: corridor-level metric — Airport-Pulling is a multi-owner strip corridor, not a single-asset center; no aggregate leasing SF tracked at corridor level. Individual lease comps available via CoStar / CompStak. Source: Naples Daily News Nov 2023, Naples Daily News Mar 2025.

**Other editorial fields:**
- `evolution_direction`: null
- `tenant_mix`: null
- `active_flags`: (none)

**Metrics snapshot (for context):**
- cap_rate: 6.70% rising · vacancy: 3.30% stable
- absorption: null sqft — · asking_rent: $30.91 psf stable
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-16T22:59:18.653662+00:00 · **Updated:** 2026-05-16T22:59:18.653662+00:00

---
## Naples Airport-Pulling (South)  ·  Naples (Collier)  ·  industrial-flex

**Current `source_url`:** https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/fort-myers-naples-marketbeats

**`character` (rendered verbatim to end users):**

> Commercial / business-node corridor, Naples submarket, south of Pine Ridge Rd to Davis Blvd area. More intensely commercial than the north segment — professional services, medical, mixed-use retail. Promenade Plaza (1175-1269 Airport Pulling Rd) had 1,769 SF available as of Feb 2025. Road widening project active on the full corridor. Net absorption null: corridor-level metric — Airport-Pulling is a multi-owner strip corridor with no single owner or single-asset tracking; CoStar / CompStak required for deal-level data. Source: LoopNet Feb 2025, Naples Daily News Mar 2025.

**Other editorial fields:**
- `evolution_direction`: null
- `tenant_mix`: null
- `active_flags`: (none)

**Metrics snapshot (for context):**
- cap_rate: 6.70% rising · vacancy: 1.80% falling
- absorption: null sqft — · asking_rent: $60.84 psf rising
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-22T02:45:41.475402+00:00 · **Updated:** 2026-05-22T02:45:41.475402+00:00

---
## Pine Ridge Rd Naples  ·  Naples (Collier)  ·  highway-strip-mall

**Current `source_url`:** https://cpswfl.com/wp-content/uploads/2025/07/Fort-Myers_Naples_Americas_Alliance_MarketBeat_Office_Q22025.pdf

**`character` (rendered verbatim to end users):**

> THE regulatory dividing line in Collier County. South of Pine Ridge = City of Naples jurisdiction (high-regulation,
>   slow-growth, low-density mandate, no high-rise mixed-use). North of Pine Ridge = Collier County jurisdiction (high-rise
>   mixed-use density allowed). Any site evaluation in Collier MUST establish which side of Pine Ridge it sits on before any other
>   analysis. This is non-negotiable.

**Other editorial fields:**
- `evolution_direction`: stable
- `tenant_mix`: South: low-density professional office, medical, gated community services. North: high-density mixed-use, national retail,
  corporate offices.
- `active_flags`: ```json
[
  {
    "flag": "Airport-Pulling Rd congestion between Pine Ridge and Golden Gate Pkwy — logistics bottleneck\r\n  creating rental rate discount vs Immokalee Rd node",
    "type": "infrastructure",
    "status": "active",
    "resolution": "structural"
  }
]
```

**Metrics snapshot (for context):**
- cap_rate: 8.30% falling · vacancy: 3.20% falling
- absorption: 21736 sqft rising · asking_rent: $39.20 psf rising
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-16T22:59:18.653662+00:00 · **Updated:** 2026-05-16T22:59:18.653662+00:00

---
## US-41 Tamiami Trail Naples  ·  Naples (Collier)  ·  highway-strip-mall

**Current `source_url`:** https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/fort-myers-naples-marketbeats

**`character` (rendered verbatim to end users):**

> The spine of Collier County commercial activity. Old Naples segment at effectively 0% vacancy with bidding wars for
>   expiring leases. RH Gallery opened November 2025 with rooftop restaurant — anchored westward luxury shift toward 4th St S. East
>    Naples segment gentrifying past Bayshore Drive — Metropolitan Naples 'Aura' delivering 2026. Medical node growing
>   mid-corridor.

**Other editorial fields:**
- `evolution_direction`: growing
- `tenant_mix`: Old Naples: ultra-luxury retail, RH Gallery, fine dining, art galleries. Mid-corridor: professional offices, medical
  specialists. East Naples: Celebration Park, adaptive reuse studios, Metropolitan Naples (53 luxury units + 10k SF retail,
  residents April 2026)
- `active_flags`: ```json
[
  {
    "flag": "5th Ave South 0% vacancy — lease bidding wars",
    "type": "status_update",
    "status": "active",
    "resolution": "structural"
  },
  {
    "flag": "Metropolitan Naples Aura — residents moved in April 2026, retail Q4 2026",
    "type": "construction",
    "status": "active",
    "resolution": "Q4 2026"
  },
  {
    "flag": "Baker Theatre ($72M) open Oct/Nov 2025 — pulling luxury gravity north of 5th Ave",
    "type": "new_project",
    "status": "active",
    "resolution": "completed"
  }
]
```

**Metrics snapshot (for context):**
- cap_rate: 6.70% rising · vacancy: 1.80% stable
- absorption: 6200 sqft stable · asking_rent: $60.84 psf rising
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-16T22:59:18.653662+00:00 · **Updated:** 2026-05-16T22:59:18.653662+00:00

---
## Vanderbilt Beach Rd / Mercato  ·  Naples (Collier)  ·  beachfront-tourism

**Current `source_url`:** https://cpswfl.com/wp-content/uploads/2025/07/Fort-Myers_Naples_Americas_Alliance_MarketBeat_Office_Q22025.pdf

**`character` (rendered verbatim to end users):**

> Emerging as 'North Naples 5th Avenue.' One Naples (Vanderbilt Beach Rd & Gulf Shore Dr) is mid-delivery — marina
>   operational, residential closing, 28k SF retail in fit-out with Grand Opening Late 2026. Mercato pivoting from shopping center
>   to entertainment district (Burn by Rocky Patel, The Vine Room speakeasy, AZN late-night lounge, Old Vines Supper Club).
>   Vanderbilt Beach Rd Extension pushing east is ending the era of affordable North Naples commercial — Founders Square/Arthrex
>   land values reaching coastal parity.

**Other editorial fields:**
- `evolution_direction`: growing
- `tenant_mix`: Mercato (nightlife-anchored entertainment district), One Naples (28k SF luxury retail + 15-slip marina), Pointe at Founders
   Square (100% leased — Capital Grille anchor), high-end dining, luxury real estate offices
- `active_flags`: ```json
[
  {
    "flag": "One Naples Phase 1 retail — fit-out stage, Grand Opening Late 2026",
    "type": "construction",
    "status": "active",
    "resolution": "Late 2026"
  },
  {
    "flag": "Vanderbilt Beach Rd Extension — land values near Founders Square reaching coastal Naples\r\n  parity",
    "type": "infrastructure",
    "status": "active",
    "resolution": "2026-2027"
  },
  {
    "flag": "Mercato nightlife pivot — Burn, Vine Room, AZN, Old Vines anchoring entertainment district",
    "type": "status_update",
    "status": "active",
    "resolution": "completed"
  }
]
```

**Metrics snapshot (for context):**
- cap_rate: 6.70% rising · vacancy: 3.30% stable
- absorption: 8500 sqft stable · asking_rent: $30.91 psf rising
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-16T22:59:18.653662+00:00 · **Updated:** 2026-05-16T22:59:18.653662+00:00

---
## Waterside Shops  ·  Naples (Collier)  ·  beachfront-tourism

**Current `source_url`:** https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/fort-myers-naples-marketbeats

**`character` (rendered verbatim to end users):**

> $100M repositioning play; luxury uptiering underway. 280,000 SF GLA (Forbes Co. / Simon managed), open-air, Pelican Bay / N Naples. Saks Fifth Avenue is the sole remaining anchor after Nordstrom (80,000 SF, 2-level) closed May 2020 and was demolished Sept–Dec 2024. RH (Restoration Hardware) is under construction on the former Nordstrom site — 29,382 SF one-story gallery with courtyards, skylights, wine bar, and rooftop restaurant — targeted late 2026 opening. Named 2024-2025 inflows: RH 29,382 SF + Christian Dior 5,888 SF flagship (merged former Williams Sonoma + 3 adjacent storefronts) + Brunello Cucinelli ~4,000 SF + Lafayette 148 3,020 SF = ~42,310 SF sized gross inflow. Hermès (returning after 9-year hiatus), Panerai, and Eddie V's also signed; SF not public. Williams Sonoma and Pottery Barn relocated from inline to the former Barnes & Noble outparcel (B&N closed July 2024); their vacated inline space was absorbed by Dior and Cucinelli. Rough net absorption bracket: named outflows (Nordstrom 80K + B&N est. 15–25K SF) vs named inflows (~42K sized + unsized Hermès/Panerai/Eddie V's) = -50K to -60K SF estimated net before unsized inflows land — floor estimate, not a publishable figure, but frames the magnitude of the repositioning gap. Net absorption null: center-level figure not publicly available; CoStar or direct broker contact required. Sources: Gulf Shore Business Sep 2025, naplesjamie.com Jul 2025, NaplesPress Oct 2025, Wikipedia.

**Other editorial fields:**
- `evolution_direction`: null
- `tenant_mix`: null
- `active_flags`: (none)

**Metrics snapshot (for context):**
- cap_rate: 6.70% rising · vacancy: 1.80% stable
- absorption: null sqft — · asking_rent: $60.84 psf rising
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-16T22:59:18.653662+00:00 · **Updated:** 2026-05-16T22:59:18.653662+00:00

---
## Bonita Beach Rd (US-41 to Sanibel Causeway)  ·  Bonita Springs (Lee)  ·  beachfront-tourism

**Current `source_url`:** https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/fort-myers-naples-marketbeats

**`character` (rendered verbatim to end users):**

> Split personality corridor. East of I-75: Midtown at Bonita (Zuckerman Group, 68 acres) under construction —
>   TJ Maxx and Ulta Beauty confirmed signed leases, Q2 2027 first retail delivery. Actively competing with North Naples for
>   weekend errand traffic. West end: pure tourism — boat rentals, beach supply, casual dining. Post-Ian recovery complete.

**Other editorial fields:**
- `evolution_direction`: growing
- `tenant_mix`: East: Midtown at Bonita (TJ Maxx, Ulta Beauty anchors, lifestyle retail). West: Bonita Bill's, boat rentals,
  beach-supply retail, casual dining. Medical/dental along central corridor.
- `active_flags`: ```json
[
  {
    "flag": "Midtown at Bonita — TJ Maxx + Ulta confirmed leases, Q2 2027 delivery",
    "type": "new_project",
    "status": "active",
    "resolution": "Q2 2027"
  },
  {
    "flag": "Coming Soon signage expected Fall 2026",
    "type": "construction",
    "status": "active",
    "resolution": "Fall 2026"
  }
]
```

**Metrics snapshot (for context):**
- cap_rate: 6.70% rising · vacancy: 2.30% falling
- absorption: 18000 sqft rising · asking_rent: $27.51 psf rising
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-16T22:59:18.653662+00:00 · **Updated:** 2026-05-16T22:59:18.653662+00:00

---
## US-41 Bonita Springs  ·  Bonita Springs (Lee)  ·  highway-strip-mall

**Current `source_url`:** https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/fort-myers-naples-marketbeats

**`character` (rendered verbatim to end users):**

> Healthy at the corridor ends, struggling in the middle. North end (Coconut Point border) and south end
>   (Naples/Vanderbilt border) see strong retail gravity. Central portion near West Terry St is the 'dead stretch' — aging plazas
>   converting to residential infill. Increasingly a specialized medical node capturing services priced out of Naples.

**Other editorial fields:**
- `evolution_direction`: repositioning
- `tenant_mix`: Coconut Point spillover retail (north), Naples spillover professional (south), Terry Apartments 200+ units
  (central infill), specialty medical offices, aging strip plazas
- `active_flags`: ```json
[
  {
    "flag": "Terry Apartments (200+ units) site prep — residential infill",
    "type": "new_project",
    "status": "active",
    "resolution": "2027"
  },
  {
    "flag": "Medical node growth — capturing Naples specialty service spillover",
    "type": "status_update",
    "status": "active",
    "resolution": "ongoing"
  }
]
```

**Metrics snapshot (for context):**
- cap_rate: 6.70% rising · vacancy: 2.30% falling
- absorption: 12500 sqft rising · asking_rent: $27.51 psf rising
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-16T22:59:18.653662+00:00 · **Updated:** 2026-05-16T22:59:18.653662+00:00

---
## Cape Coral – Coral Pointe  ·  Cape Coral (Lee)  ·  unknown

**Current `source_url`:** https://services2.arcgis.com/LvWGAAhHwbCJ2GMP/arcgis/rest/services/Development_Activity_Projects_(public)/FeatureServer/0

**`character` (rendered verbatim to end users):**

> Power-node anchor cluster at Del Prado Blvd & Midpoint Blvd — Cape Coral's densest national-retail concentration east of Pine Island Rd. Dual anchor (Walmart Supercenter + Publix) with value-retail shadow (Ross, TJ Maxx, Dollar Tree, Staples) and sit-down dining emerging (Perkins, Ariani, Hart & Soul). Del Prado Mall and Coral Pointe SC form a contiguous 600m retail band. Bowlero adds entertainment-anchor draw. Walgreens on northern node. Serves a residential catchment with limited commercial alternatives — 33905/33916 ZIPs are underzoned for commercial relative to population. No seasonal tourism component; daytime traffic is resident-driven year-round.

**Other editorial fields:**
- `evolution_direction`: growing
- `tenant_mix`: Grocery + big-box anchored value-retail power node with growing sit-down dining and entertainment layer.
- `active_flags`: ```json
[
  {
    "flag": "Structural commercial undersupply east of Pine Island Rd — demand outpacing zoned supply",
    "type": "regulatory",
    "status": "active",
    "resolution": "ongoing"
  },
  {
    "flag": "Bowlero Midpoint — entertainment anchor differentiates node from pure value-retail strip",
    "type": "status_update",
    "status": "active",
    "resolution": "completed"
  },
  {
    "flag": "Ariani Ristorante (1055 ratings) + Hart & Soul (790 ratings) — sit-down dining cluster forming",
    "type": "status_update",
    "status": "active",
    "resolution": "ongoing"
  }
]
```

**Metrics snapshot (for context):**
- cap_rate: 6.70% rising · vacancy: 2.50% falling
- absorption: 4500 sqft rising · asking_rent: $23.09 psf rising
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-16T22:59:18.653662+00:00 · **Updated:** 2026-05-16T22:59:18.653662+00:00

---
## Cape Coral Pkwy E  ·  Cape Coral (Lee)  ·  suburban-residential

**Current `source_url`:** https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/fort-myers-naples-marketbeats

**`character` (rendered verbatim to end users):**

> Government and professional corridor centered on Cape Coral City Hall. CRA commercial incentives (BURST
>   program retreated) still attracting small professional office. Bridge projects (2027) are the key variable — improved
>   connectivity to Fort Myers could reshape traffic patterns. Currently underserved relative to population.

**Other editorial fields:**
- `evolution_direction`: growing
- `tenant_mix`: City Hall, professional offices (legal, accounting, insurance), small medical, neighborhood-service retail,
  limited dining
- `active_flags`: ```json
[
  {
    "flag": "Bridge projects 2027 — connectivity to Fort Myers",
    "type": "infrastructure",
    "status": "active",
    "resolution": "2027"
  },
  {
    "flag": "BURST regulatory retreat — CRA incentives recalibrated",
    "type": "regulatory",
    "status": "active",
    "resolution": "completed"
  }
]
```

**Metrics snapshot (for context):**
- cap_rate: 6.70% rising · vacancy: 2.50% stable
- absorption: 3500 sqft stable · asking_rent: $23.09 psf rising
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-16T22:59:18.653662+00:00 · **Updated:** 2026-05-16T22:59:18.653662+00:00

---
## Pine Island Rd Cape Coral  ·  Cape Coral (Lee)  ·  suburban-residential

**Current `source_url`:** https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/fort-myers-naples-marketbeats

**`character` (rendered verbatim to end users):**

> Primary commercial spine of Cape Coral. Only corridor with meaningful national retail anchors in the city.
>   High-growth due to Cape Coral's residential explosion but commercial zoning is severely constrained — supply-demand imbalance
>   is structural. Retail rents trending up due to limited supply.

**Other editorial fields:**
- `evolution_direction`: growing
- `tenant_mix`: Publix-anchored centers, Walmart, Home Depot, Aldi, national fast-casual chains, urgent care, auto services
- `active_flags`: ```json
[
  {
    "flag": "Structural commercial zoning shortage — demand outstripping supply",
    "type": "regulatory",
    "status": "active",
    "resolution": "ongoing"
  }
]
```

**Metrics snapshot (for context):**
- cap_rate: 6.70% rising · vacancy: 2.50% falling
- absorption: 6200 sqft rising · asking_rent: $23.09 psf rising
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-16T22:59:18.653662+00:00 · **Updated:** 2026-05-16T22:59:18.653662+00:00

---
## Ben Hill Griffin Pkwy  ·  Estero (Lee)  ·  anchor-dependent

**Current `source_url`:** https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/fort-myers-naples-marketbeats

**`character` (rendered verbatim to end users):**

> Regional lifestyle and entertainment corridor anchored by Coconut Point and Miromar Outlets. FGCU campus
>   provides non-seasonal university traffic. Seasonal swing is pronounced — 'Season' (Jan-Apr) vs off-season creates a bimodal
>   economy. Coconut Point Muvico site being rescued by high-density residential infill.

**Other editorial fields:**
- `evolution_direction`: growing
- `tenant_mix`: Coconut Point Mall (anchored), Miromar Outlets, Hertz HQ, FGCU campus traffic, national dining chains,
  Ritz-Carlton Estero Bay (opening 2026)
- `active_flags`: ```json
[
  {
    "flag": "Coconut Point Muvico site — residential rescue of aging retail anchor",
    "type": "new_project",
    "status": "active",
    "resolution": "2027-2028"
  },
  {
    "flag": "Ritz-Carlton Estero Bay opening 2026",
    "type": "new_project",
    "status": "active",
    "resolution": "2026"
  }
]
```

**Metrics snapshot (for context):**
- cap_rate: 6.70% rising · vacancy: 7.70% stable
- absorption: 4200 sqft stable · asking_rent: $34.24 psf rising
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-16T22:59:18.653662+00:00 · **Updated:** 2026-05-16T22:59:18.653662+00:00

---
## Coconut Point Mall  ·  Estero (Lee)  ·  anchor-dependent

**Current `source_url`:** https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/fort-myers-naples-marketbeats

**`character` (rendered verbatim to end users):**

> Active churn, net-positive direction. 1.2M SF GLA (Simon Property Group), open-air, Estero / Lee County. 110+ stores, 24 restaurants. Simon "2024 Best of the Best" award (regional + national). Two-year refresh plan underway as of Oct 2025. Nordstrom Rack signed for fall 2025 opening in former Christmas Tree Shops / Bed Bath & Beyond junior anchor space (~25–30K SF estimate). Named new tenants (past ~12 months, all backfilling prior departures): Real Seafood Co. (former Bokamper's — "enormous space"); Bonita Smoke Shop & Cigar Lounge 6,600 SF (former Joann Fabrics); Fresh Catch Inland (former TGI Fridays); PJK Neighborhood Chinese (former The Saloon); Cold Stone Creamery (former Stone Mountain); SB Bar (new). New specialty retail: Park Shores, Evereve, Sunglass World, UNTUCKit, BH2.0. Inline churn is net-positive — named replacements for most departures — but unnamed departures are unknown, so "likely positive" is the honest read rather than confirmed. Net absorption null: center-level net SF not publicly available; Nordstrom Rack anchor backfill is the strongest single signal. Sources: Estero Life Magazine Aug 2025, Gulf Shore Business Oct 2025, Business Observer May 2025.

**Other editorial fields:**
- `evolution_direction`: null
- `tenant_mix`: null
- `active_flags`: (none)

**Metrics snapshot (for context):**
- cap_rate: 6.70% rising · vacancy: 7.70% stable
- absorption: null sqft — · asking_rent: $34.24 psf stable
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-16T22:59:18.653662+00:00 · **Updated:** 2026-05-16T22:59:18.653662+00:00

---
## Three Oaks Pkwy / Coconut Rd (Estero/Bonita boundary)  ·  Estero (Lee)  ·  highway-strip-mall

**Current `source_url`:** https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/fort-myers-naples-marketbeats

**`character` (rendered verbatim to end users):**

> Transitional corridor at the Estero-Bonita border. Residential growth outpacing commercial — new rooftops
>   creating demand for neighborhood services. Corkscrew Road Phase II widening (east of I-75) is the primary 2026 commercial
>   unlock for this zone. Currently underserved.

**Other editorial fields:**
- `evolution_direction`: growing
- `tenant_mix`: Neighborhood service retail, medical/dental, daycare, gym, limited dining
- `active_flags`: ```json
[
  {
    "flag": "Corkscrew Road Phase II widening — primary 2026 commercial unlock",
    "type": "infrastructure",
    "status": "active",
    "resolution": "2026-2027"
  }
]
```

**Metrics snapshot (for context):**
- cap_rate: 6.70% rising · vacancy: 5.00% stable
- absorption: 7500 sqft stable · asking_rent: $30.88 psf rising
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-16T22:59:18.653662+00:00 · **Updated:** 2026-05-16T22:59:18.653662+00:00

---
## Colonial Blvd East (US-41 to I-75)  ·  Fort Myers (Lee)  ·  highway-strip-mall

**Current `source_url`:** https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/fort-myers-naples-marketbeats

**`character` (rendered verbatim to end users):**

> Healthcare-anchored corridor. Lee Health $820M Colonial campus topped out March 2026 — definitive healthcare
>   anchor for the next decade. Hotel cluster near I-75 interchange serves medical visitors and corporate travelers. Transitional  
>   zone between downtown core and suburban I-75 node.

**Other editorial fields:**
- `evolution_direction`: growing
- `tenant_mix`: Lee Health campus (anchor), hotel cluster (Marriott, Hampton, Holiday Inn), urgent care/outpatient facilities,
   fast-casual dining serving hospital workforce
- `active_flags`: ```json
[
  {
    "flag": "Lee Health $820M campus topped out March 2026",
    "type": "construction",
    "status": "active",
    "resolution": "2027-2028"
  }
]
```

**Metrics snapshot (for context):**
- cap_rate: 6.70% rising · vacancy: 3.20% falling
- absorption: 5500 sqft rising · asking_rent: $23.27 psf rising
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-16T22:59:18.653662+00:00 · **Updated:** 2026-05-16T22:59:18.653662+00:00

---
## Daniels Pkwy (I-75 to Ben Hill Griffin)  ·  Fort Myers (Lee)  ·  anchor-dependent

**Current `source_url`:** https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/fort-myers-naples-marketbeats

**`character` (rendered verbatim to end users):**

> Corporate-logistics corridor serving the I-75/airport node. FGCU-adjacent professional services growing. Mix
>   of Class B office, flex industrial, and national retail anchors along the I-75 interchange. Daytime population driven by
>   airport and university employment.

**Other editorial fields:**
- `evolution_direction`: growing
- `tenant_mix`: Bass Pro Shops, Costco, Target, Class B professional office, flex/warehouse, airport-adjacent hotels
- `active_flags`: (none)

**Metrics snapshot (for context):**
- cap_rate: 6.70% rising · vacancy: 3.20% stable
- absorption: 4200 sqft stable · asking_rent: $23.27 psf rising
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-16T22:59:18.653662+00:00 · **Updated:** 2026-05-16T22:59:18.653662+00:00

---
## Gulf Coast Town Center  ·  Fort Myers (Lee)  ·  anchor-dependent

**Current `source_url`:** https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/fort-myers-naples-marketbeats

**`character` (rendered verbatim to end users):**

> Super-regional open-air power center, 1.3M SF retail GLA on 158 acres, Alico Rd / I-75, Fort Myers / Lee County. Owned and managed by NADG (North American Development Group, private Canadian developer; acquired ~2017). Anchors: Target, Costco, Bass Pro Shops, Regal Cinemas, Dick's Sporting Goods, HomeGoods, HomeSense, Marshalls, Ross, Burlington. Added 277 luxury apartments (Ilumina GCTC) — mixed-use conversion underway. 50+ mile trade area draw, FGCU proximity. Net absorption null: NADG is privately held with no public filings; no SEC disclosures, no broker deal announcements surfaced via public search. Center-level leasing data requires direct NADG contact or CoStar subscription. Source: NADG property page Jan 2026, Wikipedia.

**Other editorial fields:**
- `evolution_direction`: null
- `tenant_mix`: null
- `active_flags`: (none)

**Metrics snapshot (for context):**
- cap_rate: 6.70% rising · vacancy: 7.70% stable
- absorption: null sqft — · asking_rent: $34.24 psf stable
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-16T22:59:18.653662+00:00 · **Updated:** 2026-05-16T22:59:18.653662+00:00

---
## Six Mile Cypress Pkwy  ·  Fort Myers (Lee)  ·  medical-anchored

**Current `source_url`:** https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/fort-myers-naples-marketbeats

**`character` (rendered verbatim to end users):**

> Industrial-flex connector corridor linking I-75 to south Fort Myers. Growing medical office presence. Low
>   visibility, low rent, high utility — businesses here prioritize function over foot traffic. Warehousing and distribution hub
>   for the metro area.

**Other editorial fields:**
- `evolution_direction`: growing
- `tenant_mix`: Flex/warehouse, light industrial, medical office (growing), auto repair, contractor services
- `active_flags`: (none)

**Metrics snapshot (for context):**
- cap_rate: 8.30% falling · vacancy: 4.00% falling
- absorption: 14000 sqft rising · asking_rent: $26.03 psf rising
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-16T22:59:18.653662+00:00 · **Updated:** 2026-05-16T22:59:18.653662+00:00

---
## Summerlin Rd Fort Myers  ·  Fort Myers (Lee)  ·  medical-anchored

**Current `source_url`:** https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/fort-myers-naples-marketbeats

**`character` (rendered verbatim to end users):**

> High-income residential gateway corridor with limited commercial zoning. Professional services (insurance,
>   wealth management, law) dominate the sparse retail nodes. Residential density is high, commercial density is low — captive
>   audience for service providers. Gateway to Sanibel/Fort Myers Beach.

**Other editorial fields:**
- `evolution_direction`: stable
- `tenant_mix`: Insurance offices, wealth management, medical specialists, pharmacy, upscale casual dining at key
  intersections
- `active_flags`: (none)

**Metrics snapshot (for context):**
- cap_rate: 8.30% falling · vacancy: 7.20% falling
- absorption: 8500 sqft rising · asking_rent: $32.73 psf rising
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-16T22:59:18.653662+00:00 · **Updated:** 2026-05-16T22:59:18.653662+00:00

---
## US-41 / Cleveland Ave Fort Myers  ·  Fort Myers (Lee)  ·  mixed-use-downtown

**Current `source_url`:** https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/fort-myers-naples-marketbeats

**`character` (rendered verbatim to end users):**

> Legacy commercial spine in structural decline. Auto-row dealerships thinning. Edison Mall node losing medical
>    office tenants to newer corridors. Southern segment near downtown showing early adaptive reuse signals. Northern segment
>   remains low-rent service retail.

**Other editorial fields:**
- `evolution_direction`: declining
- `tenant_mix`: Auto dealerships (declining), Edison Mall (struggling), discount retail, check-cashing/title loan, medical
  office migrating out, early adaptive reuse near downtown
- `active_flags`: ```json
[
  {
    "flag": "Edison Mall medical office outmigration",
    "type": "status_update",
    "status": "active",
    "resolution": "ongoing"
  }
]
```

**Metrics snapshot (for context):**
- cap_rate: 6.70% rising · vacancy: 2.90% rising
- absorption: -8679 sqft falling · asking_rent: $16.04 psf falling
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-16T22:59:18.653662+00:00 · **Updated:** 2026-05-16T22:59:18.653662+00:00

---
## Veterans Pkwy / Colonial Blvd (Midpoint Bridge Corridor)  ·  Fort Myers (Lee)  ·  highway-strip-mall

**Current `source_url`:** https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/fort-myers-naples-marketbeats

**`character` (rendered verbatim to end users):**

> Mature value-retail corridor in transition. Bell Tower Shops pivoting from traditional mall to
>   entertainment-driven destination. DDI interchange at I-75 under construction creating 2-year traffic disruption. Legacy retail
>   anchors stable but not growing.

**Other editorial fields:**
- `evolution_direction`: repositioning
- `tenant_mix`: Bell Tower Shops (entertainment pivot), Ross/TJ Maxx/Marshalls, mid-box retail, sit-down dining cluster, car
  dealerships on east end
- `active_flags`: ```json
[
  {
    "flag": "DDI interchange construction at I-75",
    "type": "infrastructure",
    "status": "active",
    "resolution": "2028"
  },
  {
    "flag": "Bell Tower entertainment pivot",
    "type": "status_update",
    "status": "active",
    "resolution": "ongoing"
  }
]
```

**Metrics snapshot (for context):**
- cap_rate: 6.70% rising · vacancy: 3.20% rising
- absorption: -5500 sqft falling · asking_rent: $23.27 psf stable
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-16T22:59:18.653662+00:00 · **Updated:** 2026-05-16T22:59:18.653662+00:00

---
## Estero Blvd Fort Myers Beach  ·  Fort Myers Beach (Lee)  ·  beachfront-tourism

**Current `source_url`:** https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/fort-myers-naples-marketbeats

**`character` (rendered verbatim to end users):**

> Post-Hurricane Ian reconstruction zone. Tourism-only economy. Recovery largely complete in 2026 but elevated
>   insurance costs are permanently reshaping the commercial tenant mix — lower-margin operators being priced out by insurance
>   costs rather than rent. Waterfront properties with completed elevation upgrades seeing record traffic.

**Other editorial fields:**
- `evolution_direction`: repositioning
- `tenant_mix`: Beach tourism retail, casual dining, boat/kayak rentals, vacation rental management, surf shops, souvenir
- `active_flags`: ```json
[
  {
    "flag": "Post-Ian insurance costs reshaping tenant mix",
    "type": "status_update",
    "status": "active",
    "resolution": "permanent structural change"
  }
]
```

**Metrics snapshot (for context):**
- cap_rate: 6.70% rising · vacancy: 2.90% rising
- absorption: -13220 sqft falling · asking_rent: $26.13 psf stable
- metrics_period: 2026-Q1 · metrics_verified_date: 2026-05-21

**Broker narrative state:**
- Live (`character_broker_narrative`): (none — expected)
- Quarantined (`character_broker_narrative_pending`): (none — pipeline has not yet produced rows)

**Created:** 2026-05-16T22:59:18.653662+00:00 · **Updated:** 2026-05-16T22:59:18.653662+00:00

---
