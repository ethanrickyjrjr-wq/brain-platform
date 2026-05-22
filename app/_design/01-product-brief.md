# 01 — Product Brief

## What we're building

**SWFL Data Lake** — a real-time analyst-grade data product for Southwest
Florida (Lee, Collier, Charlotte counties). Covers housing, commercial real
estate, building permits, traffic, tourism, hurricane risk, logistics, and
macro context. **Every number has a source citation. Nothing is invented.**

## How it's accessed

- **Through AI assistants** (Claude, ChatGPT, Cursor, etc.) via the MCP
  protocol — this is the inline widget surface.
- **Through a web app** — full report pages at `/r/{report_id}`.
- **Through `/connect`** — landing page where new users install the MCP
  integration into their AI.

## Who it's for

Analysts, investors, developers, and smart locals who want **real answers
about SWFL**. Not vibes, not guesses. They will come back weekly. They run
this on a second monitor.

## Design philosophy

> Make people go "wow, that's cool AND informative" at the same time.

Data should feel like it's **surfacing** — like something emerging from
deep water. Not bouncing, not flashy. **Deliberate, smooth, surgical.** The
most important insight hits first. The hierarchy is ruthless — if something
doesn't earn its place above the fold, it doesn't get it.

> What if a premium research firm had the soul of a great data
> visualization studio?

## Hard "do nots"

- Don't lead with filler. A traffic chart is not the hook.
- Don't look like a government data portal.
- Don't look like a tourist brochure.
- Don't use stock-chart cliches (red/green candles, ticker tape).
- Don't over-animate. Every animation must earn its place.

## Hard "dos"

- Let the data speak through the design.
- Make the hierarchy feel inevitable — the eye lands where it should.
- Use animation to **reveal insight**, not to decorate.
- Design for someone who will come back every week.

## What success looks like

A user opens the report page and thinks: "This is more polished than
anything I've seen in Florida real estate data." The animations make data
feel alive without being gratuitous. The hierarchy is so clean they never
feel lost. When they see it render inline in their Claude conversation,
they immediately want to share it.

We show the great data. You show the great design.

## Data shape (so the design fits the content)

Every report carries:

- **Direction** — `bullish` / `bearish` / `mixed` / `neutral`. This is the
  headline verdict.
- **Key metrics** — each with a value, trend direction, and source URL
  (federal/state agencies, public datasets).
- **Drivers** — what's pushing the direction.
- **Caveats** — known limitations, data gaps, contradictions.
- **Freshness token** — when this data was last computed
  (e.g. `SWFL-7421-v5-20260522`).
- **Upstream links** — if this is a master report, it aggregates several
  upstream reports (housing, CRE, permits, tourism, etc.).

### Canonical mock data (use this in every design build)

When you need realistic placeholder content, use this SWFL master report
verbatim. Don't invent alternate numbers; the prompts and design demos
should align around a single example so the work composes coherently.

```json
{
  "id": "master",
  "direction": "mixed",
  "conclusion": "SWFL housing is cooling on demand metrics while supply tightens; commercial real estate diverges sharply by corridor with industrial outperforming office and retail.",
  "key_metrics": [
    {
      "label": "Median DOM, Lee single-family",
      "value": 51,
      "unit": "days",
      "trend": "up",
      "delta": "+6 vs prior month",
      "source_url": "https://www.leepa.org/"
    },
    {
      "label": "Cap rate, Lee multifamily",
      "value": 5.42,
      "unit": "%",
      "trend": "up",
      "delta": "+18 bps QoQ",
      "source_url": "https://www.leepa.org/"
    },
    {
      "label": "Building permits MTD, Lee",
      "value": 1247,
      "unit": "permits",
      "trend": "down",
      "delta": "-12% YoY",
      "source_url": "https://aca-prod.accela.com/LEECOUNTY/"
    },
    {
      "label": "Naples RevPAR",
      "value": 312,
      "unit": "USD",
      "trend": "up",
      "delta": "+4% YoY",
      "source_url": "https://floridarevenue.com/"
    },
    {
      "label": "Hurricane season probability",
      "value": 67,
      "unit": "%",
      "trend": "neutral",
      "delta": "vs 30-yr avg",
      "source_url": "https://www.noaa.gov/"
    }
  ],
  "drivers": [
    "Builder pipeline slowing — permits down 12% YoY across Lee while existing-home inventory rises.",
    "Industrial cap rates compressing on FAF5-flagged logistics corridors; office cap rates widening.",
    "Tourism strength holding NOI in Naples luxury segment despite cooler resi demand."
  ],
  "caveats": [
    "Cap rate sample size for Lee multifamily is small (n=12 transactions this quarter).",
    "FEMA NFIP claims data lags by ~45 days; flood-veto rules may shift on next refresh."
  ],
  "upstream_reports": [
    { "id": "housing-lee", "label": "Lee housing" },
    { "id": "cre-swfl", "label": "SWFL CRE" },
    { "id": "permits-swfl", "label": "Building permits" },
    { "id": "tourism-tdt", "label": "Tourism (TDT)" },
    { "id": "env-swfl", "label": "Hurricane / flood risk" },
    { "id": "macro-florida", "label": "Macro (Florida)" }
  ],
  "freshness_token": "SWFL-7421-v5-20260522"
}
```

For the MCP widget surface, use the same data but trim to 3 of the 5
metrics (the first three in the array) so the chat-bubble width works.

## Tiers (three views of the same report)

- **Tier 1** — Conversational, 2-5 sentence summary. Executive glance.
- **Tier 2** — Structured. Conclusion + metrics table + caveats. **The
  main view.** Default tab.
- **Tier 3** — Raw audit with full citation table. For people verifying
  every number.

All three are tabs/views on the same page, not separate pages.

## Animation engine

**Anime.js v4** for all motion. See `00-START-HERE.md` for the v4 module
surface and `02-motion-rules.md` for the personality.
