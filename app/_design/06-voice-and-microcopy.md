# 06 — Voice and Microcopy

How the SWFL Data Lake talks. This is as load-bearing as the motion
rules. Bad copy on a data product destroys the trust the design built.

## The voice in one paragraph

**Confident, sourced, specific. No hedging, no marketing fluff, no
hype.** Numbers are stated, not described. Sources are linked, not
explained. When we don't know, we say so cleanly. The product is the
opposite of a sales deck: it assumes the reader is smart, busy, and
will check the math.

## The four rules

1. **Quantify, don't characterize.** "Permits down 12% YoY" — not
   "permits have been trending lower."
2. **Name the source.** Every metric and every caveat references a
   dataset or agency by name. "Per LeePA." "Per FEMA NFIP." "Per FDOT
   AADT." If we can't name it, we can't ship it.
3. **Lowercase verdicts.** The direction word is always lowercase
   prose — "bullish," "bearish," "mixed," "neutral." Never Title Case,
   never ALL CAPS. The conviction is in the data, not the typography.
4. **Plain English errors.** No error codes, no "fetch failed," no
   "500." Translate everything to what a human can act on.

## Number formatting

| Type                  | Format                                               | Example                            |
| --------------------- | ---------------------------------------------------- | ---------------------------------- |
| Whole numbers ≥ 1,000 | Comma-grouped                                        | `1,247 permits`                    |
| Currency, dollars     | `$` prefix, comma-grouped, no decimals unless < $100 | `$312`, `$1,450,000`               |
| Percentages           | `%` suffix, 1 decimal place if shown                 | `5.4%`, `67%`                      |
| Basis points          | `bps` suffix, no decimals                            | `+18 bps`                          |
| Counts in headlines   | Spell out one through nine, numerals otherwise       | "Three drivers", "12 transactions" |
| Days / time periods   | Number + unit                                        | `51 days`, `45 days`               |
| Sample sizes          | `n=` prefix                                          | `n=12 transactions`                |
| Trends (deltas)       | Explicit sign and reference period                   | `+6 vs prior month`, `-12% YoY`    |

**Always use tabular figures for column values:**
`font-variant-numeric: tabular-nums`.

## Trend language

State direction and reference period. Never use vague comparators.

- ✅ `+6 vs prior month`
- ✅ `+18 bps QoQ`
- ✅ `-12% YoY`
- ✅ `Flat vs prior quarter`
- ❌ `Up significantly`
- ❌ `Trending higher`
- ❌ `Modest decline`

## Caveat language

Caveats are facts about the data's limits, not apologies. State the
limit in the same tone as the metric itself.

- ✅ `Cap rate sample size is small (n=12 this quarter).`
- ✅ `FEMA NFIP claims lag by ~45 days.`
- ✅ `Source TDT data covers Lee + Collier only; Charlotte not included.`
- ❌ `Some data may be limited.`
- ❌ `Please note these numbers are preliminary.`
- ❌ `Results may vary.`

## Direction word usage

The verdict word lives on its own at the top of every report. Set it
in the direction color. Lowercase. No surrounding punctuation.

- ✅ `bullish`
- ✅ `mixed`
- ❌ `Bullish.`
- ❌ `BULLISH`
- ❌ `Trending: bullish`

The headline conclusion sentence follows the verdict and **never
repeats the verdict word**. The verdict is the answer; the sentence is
the why.

- ✅ Verdict: `mixed` →
  Conclusion: "SWFL housing is cooling on demand metrics while supply
  tightens; commercial real estate diverges sharply by corridor."
- ❌ Verdict: `mixed` →
  Conclusion: "Things are mixed in SWFL."

## Freshness token

Always quote the freshness token verbatim. It's a proof element.

- ✅ `SWFL-7421-v5-20260522`
- ✅ Inline label: `Last computed: SWFL-7421-v5-20260522`
- ❌ `Last updated recently`
- ❌ Relative-time formatting like "2 hours ago" or "this morning"

Set in monospace, `--text-tertiary`, smaller than body. Never animated.

## Source citations

Every metric carries a source URL. The chip text is the dataset/agency
shorthand, not the full URL.

| Source                                   | Chip label    |
| ---------------------------------------- | ------------- |
| `https://www.leepa.org/`                 | `LeePA`       |
| `https://aca-prod.accela.com/LEECOUNTY/` | `Lee Accela`  |
| `https://floridarevenue.com/`            | `Florida DOR` |
| `https://www.noaa.gov/`                  | `NOAA`        |
| `https://www.census.gov/`                | `Census`      |
| `https://www.fema.gov/`                  | `FEMA NFIP`   |
| FDOT AADT dataset                        | `FDOT`        |
| BTS FAF5 dataset                         | `BTS FAF5`    |

Link color: `--gulf-teal-dim`. No underline by default. 1px underline
fades in on hover (120ms). Never use `--gulf-teal` (full intensity) for
source links — that's reserved for CTAs.

## Microcopy patterns

### Animations toggle

- Label: `Animations`
- States: `On` / `Off`
- Helper text (in popover): "When off, the page renders instantly with
  no motion."

### Copy button (on /connect install command)

- Idle: `Copy`
- After success: `Copied ✓` (1500ms, then revert)

### Waitlist submit

- Idle: `Get notified`
- After success: `On the list ✓` (1500ms, then revert)
- Validation error: `Please enter a valid email.` (inline, beside input)

### Tab labels (report page)

- Tier 1: `Glance`
- Tier 2: `Report` (default)
- Tier 3: `Audit`

### View-more / expand patterns

- Collapsed caveats link: `▸ 2 caveats`
- Expanded link: `▾ 2 caveats`
- Never `Show more` / `Read more` — say what's there.

### Upstream report chips (on master report)

Label format: `<scope> <topic>`, e.g., `Lee housing`, `SWFL CRE`,
`Tourism (TDT)`. Use the labels in `01-product-brief.md` canonical mock
data verbatim.

## Empty state copy

Always specific. Name what's empty.

- ✅ `No multifamily transactions in Cape Coral Tier-A this quarter (n=0).`
- ✅ `No permits filed in 33908 over the last 30 days.`
- ❌ `No data.`
- ❌ `Nothing to show here.`

## Error state copy

Translate to plain English with a path forward.

- Per-metric failure:
  `Couldn't reach LeePA. Try the source directly.` (link the source URL)
- Whole-page failure:
  `We couldn't load this report right now. The data lives at <source>
if you need it now.`
- Stale data:
  `This report is 3 days past its expected refresh.` (in `--neutral-gold`)

Never use:

- ❌ Error codes (`500`, `503`, `ENETUNREACH`)
- ❌ Stack-traces in user-facing copy
- ❌ Generic "Something went wrong"
- ❌ Apologetic copy ("Sorry," "Unfortunately,")

## Brand prose patterns (homepage / connect hero)

The hero copy on `/connect` and other marketing surfaces follows the
same voice rules. Examples that fit:

- ✅ "Real answers about Southwest Florida. Sourced. Fresh. Surgical."
- ✅ "Install once. Your AI gets sourced data on housing, CRE, permits,
  traffic, tourism, hurricane risk, and the macro context behind them."
- ❌ "The future of Florida data is here."
- ❌ "Unlock insights you didn't know you needed."
- ❌ "Revolutionary AI-powered intelligence for SWFL real estate."

## When in doubt

If you're about to write a sentence that doesn't survive the test
"would an analyst on a deadline want to read this?", delete it. Replace
with the number and the source.
