# EMAIL.md — Governing Rules for the SWFL Data Gulf Daily Digest

**This file governs every email this system sends. It is the email equivalent of CLAUDE.md.**
**Never reorder sections. Never invent data. Never skip the log.**

---

## Rule 1 — READ THE MOST RECENT LOG FIRST

Before composing, read the **most recent existing** `email-logs/*.json` by filename descending —
NOT calendar-yesterday. If the last send was Friday and today is Monday, the most recent log
is Friday's. If the system skipped a holiday, the most recent log is the last pre-holiday send.

Use that log's `last_send_date` field (not the filename) to compute the DELTA gap.

Dedup rules against that log:
- Signal was `top_story: true` → downgrade to brief mention UNLESS it escalated (metric moved
  beyond its escalation threshold OR a new official source confirmed/contradicted it)
- Metric was flagged `stale` → re-check freshness today; if still stale, keep the caveat
- No log exists (first run) → build fresh with no dedup constraint

If `send_status` in the most recent log is `error`: treat as **no prior log** — the email was
never delivered, no content was shown to readers, dedup is irrelevant; cover the data gap in DELTA.
If `send_status` is `skipped`: treat as a **valid prior log** — the skip was intentional, use it
for dedup; DELTA covers the time gap since `last_send_date`.

---

## Rule 2 — SECTIONS NEVER REORDER

Every issue follows this exact section order:

```
1. HEADER          — logo, date, issue number, per-section freshness manifest
2. TOP LINE        — Lee County market pulse (2–3 sentences, from master brain)
3. ZIP FOCUS       — 33908 + nearby ZIPs data table (33919, 33912, 33907, 33931, 33914)
4. LEE COUNTY      — county-wide snapshot (permits, economic activity, CRE)
5. CITY VOICES     — city-pulse signals (max 4 items, priority: breaking > transactions > development)
6. DELTA           — what changed since last_send_date (covers weekend/holiday gaps automatically)
7. HISTORICAL HOOK — one interesting past data point tied to something live today
8. FOOTER          — company info, unsubscribe, CAN-SPAM compliance
```

No section may be omitted except CITY VOICES (if no new signals) and DELTA (if first-ever send).

---

## Rule 3 — CITE EVERYTHING WITH PER-SECTION FRESHNESS

A single global `freshness_token` cannot source a multi-brain digest. Each brain runs on a
different cadence (`city-pulse` = daily; `housing-swfl` = weekly; `master` = daily rebuild;
`env-swfl` = monthly). Cite each section independently.

**Header freshness manifest** (replace the single-token approach):
```json
{
  "master":        { "token": "SWFL-7421-v{n}-{YYYYMMDD}", "as_of": "YYYY-MM-DD" },
  "housing_swfl":  { "token": "...", "as_of": "YYYY-MM-DD", "period_begin": "YYYY-MM-DD" },
  "city_pulse":    { "token": "...", "as_of": "YYYY-MM-DD" },
  "lee_cre":       { "token": "...", "as_of": "YYYY-MM-DD" }
}
```

**Dry-run / preview / fixture builds:** set `source_env: "preview"` in the manifest.
A preview build MUST NOT stamp live-lake provenance. Any hardcoded `"data_lake."` citation
string in the composition script is a bug — grep for it before every deploy:
```
grep -rn '"data_lake\.' scripts/email/
```

No source in the manifest → no claim for that section. A stale section is labeled `[STALE as of YYYY-MM-DD]`.

---

## Rule 4 — NO INVENTION

Never invent a number. If a ZIP has no data, say so — offer the next closest grain (county).
If a metric is stale beyond its tolerance window, label it `[STALE]` and state the last-updated date.

---

## Rule 5 — FLAG ESCALATION WITH FLOORS AND POLARITY

**Before flagging any day-over-day or week-over-week delta:**

1. **Transaction floor:** At ZIP grain, require `sale_count_period >= 10` before bolding a
   median price move. A 3-sale ZIP that goes $400k → $480k is a noise event, not news.
   For county-level medians, require `sale_count_period >= 50`. If below the floor, show the
   number but do NOT bold it and do NOT flag it in DELTA.

2. **Threshold:** Move exceeds its threshold (see SOURCED THRESHOLDS below).

3. **Directional framing is required with every bolded delta** — never a raw number alone:

| Metric | Higher = | Lower = |
|---|---|---|
| `median_sale_price` | bullish (sellers) | bearish (sellers) |
| `dom` (days on market) | bearish (slower market) | bullish (faster market) |
| `months_of_supply` | buyer-favoring | seller-favoring |
| `avg_sale_to_list` | bullish (list price holding) | bearish (discounting) |
| `sold_above_list_pct` | bullish (demand pressure) | bearish |
| `inventory` | context-dependent (note direction + compare to 6-mo avg) | same |

   Example: **33931 DOM: 87 days (↑3)** — _slower market, buyer-favoring_ ← required framing.

---

## Rule 6 — ONE CTA

Maximum one call-to-action per email. Default CTA: `View full report → swfldatagulf.com/r/housing-swfl`
Premium CTA (if relevant breaking news): `See the full picture → swfldatagulf.com/r/master`

---

## Rule 7 — CHARTS ARE TABLES; PNG CHARTS CARRY PROVENANCE

Email clients block JavaScript. Never embed Recharts/React charts.
Use HTML `<table>` for all data displays. Use Mapbox Static Images API for geography.

**If a PNG chart is server-built:** burn the `as_of` date and brain source into the image
(bottom-right watermark, 10px, #888) before uploading to Supabase Storage. This preserves
provenance when the image is forwarded or screenshotted outside the email thread.
Example watermark string: `housing-swfl · as of 2026-06-11 · swfldatagulf.com`

---

## Rule 8 — SAVE THE LOG WITH IDEMPOTENCY AND FULL METRIC COVERAGE

### Pre-send idempotency guard (BLOCKING)

Before sending, check if `email-logs/{today}.json` exists with `send_status: "sent"`.
If it does → **ABORT immediately**. Do not re-render, do not re-send, do not overwrite.
Log the abort to stdout: `[DIGEST ABORT] today's log already shows send_status=sent; skipping.`
The log must be written (or atomically renamed) **before** the Resend API call to prevent
double-sends if the process dies between send and log-write.

### Log schema

```json
{
  "date": "YYYY-MM-DD",
  "last_send_date": "YYYY-MM-DD",
  "issue": 1,
  "subject": "...",
  "freshness_manifest": {
    "master":       { "token": "...", "as_of": "YYYY-MM-DD" },
    "housing_swfl": { "token": "...", "as_of": "YYYY-MM-DD", "period_begin": "YYYY-MM-DD" },
    "city_pulse":   { "token": "...", "as_of": "YYYY-MM-DD" },
    "lee_cre":      { "token": "...", "as_of": "YYYY-MM-DD" }
  },
  "top_story": { "title": "...", "slug": "...", "topic": "breaking|development|..." },
  "zip_metrics": {
    "33908": {
      "median_sale_price": 0,
      "dom": 0,
      "months_of_supply": 0,
      "avg_sale_to_list": 0,
      "sold_above_list_pct": 0,
      "inventory": 0,
      "sale_count_period": 0
    }
  },
  "county_metrics": {
    "median_sale_price": 0,
    "dom": 0,
    "months_of_supply": 0,
    "inventory": 0,
    "sale_count_period": 0
  },
  "signals_surfaced": ["..."],
  "cta_url": "...",
  "send_status": "sent | skipped | error",
  "send_error": null,
  "recipients": 1
}
```

All metrics that any rule deltas against — including `inventory`, `months_of_supply`,
`avg_sale_to_list`, `sold_above_list_pct`, and `sale_count_period` — must be persisted.
Missing a field = inability to compute valid deltas on the next run.

---

## Rule 9 — CAN-SPAM + RFC 8058 COMPLIANCE (non-negotiable)

### Email headers (set at send time via Resend API)

```
List-Unsubscribe: <https://swfldatagulf.com/unsubscribe?token={token}>, <mailto:unsubscribe@swfldatagulf.com?subject=unsubscribe>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

RFC 8058 / Gmail + Yahoo bulk-sender requirement (enforced Feb 2024). One-click unsubscribe
must process within 2 business days. The unsubscribe token must be subscriber-scoped
(not a shared secret). Both headers are required; the HTTPS endpoint takes precedence.

### Footer content (CAN-SPAM §15 USC 7704)

Required by law:
- Physical postal address (real, USPS-deliverable; not a fiction placeholder, not a PO Box
  unless the sender actually uses one as a registered business address)
- Sender identification (must be non-deceptive; FROM name must match the entity that controls the list)
- One-click unsubscribe link (in the body, in addition to the header)
- "You received this because..." context line

**IDENTITY DECISION REQUIRED — DO NOT SHIP WITH PLACEHOLDER:**
```
[PLACEHOLDER — REPLACE BEFORE FIRST LIVE SEND]
Company: _________________________ (must be the actual controlling entity)
Address: _________________________ (must be USPS-valid physical address or registered CMRA)
Contact: _________________________ (real name or role)
Email: hello@swfldatagulf.com

Decision options:
  A) "SWFL Data Gulf" + your actual registered business address (cleanest)
  B) Register "Gulf Coast Intelligence Group, LLC" as a FL DBA → use its registered address
  C) Send from your personal name + address (CAN-SPAM allows this for sole proprietors)
Phone: omit unless you have a dialable number (CAN-SPAM does not require phone)
[END PLACEHOLDER]
```

Footer template (fill in identity above):
```
{COMPANY_NAME}
{PHYSICAL_ADDRESS}
{CITY}, FL {ZIP}
{CONTACT_NAME OR ROLE}  ·  hello@swfldatagulf.com

Data sourced from SWFL Data Gulf (swfldatagulf.com).
You received this because you subscribed at swfldatagulf.com.
[Unsubscribe] [Privacy Policy] [View on Web]
```

---

## Rule 10 — SEND WINDOW

Weekday sends: **6:00 AM ET** (GHA cron: `0 10 * * 1-5` UTC).
No sends on weekends — Saturday/Sunday data gaps are covered in Monday's DELTA section.
Holiday skips: log `send_status: "skipped"`; next run reads this as a valid prior log.

---

## Rule 11 — SUBJECT LINE

- **Derive from `top_story`** if a signal with `topic: "breaking"` or `topic: "transactions"` exists.
  Otherwise default to the primary ZIP metric movement (see formulas below).
- **Character cap: 50 characters** (Gmail mobile shows ~45; stay under 50 for safe truncation).
- **Prohibited:** all-caps words, excessive punctuation (`!!!`, `???`), emoji spam, and spam-trigger
  words: free, guarantee, winner, urgent, act now, limited time, exclusive offer, click here,
  buy now, no cost, risk-free.
- **Required:** at least one location signal — a ZIP code, "Lee County", "SWFL", or a named place.
- **A/B:** vary subject formula weekly; track open rate vs rolling 4-week average.

Subject line formulas (rotate):
```
[ZIP] [metric]: [short insight]          → "33908 DOM: 52 days and climbing"
[market A] vs [market B] this week       → "FMB vs. Cape Coral: gap is widening"
[metric] just crossed [threshold]        → "Lee County supply crossed 5 months"
[signal] + what it means for [ZIP]       → "Bonita permit surge: what it means for 33908"
Last time [ZIP] saw this…               → "Last time 33908 DOM hit 50: Q1 2022"
```

---

## SOURCED THRESHOLDS

Policy constants used in Rule 5. These are explicit decisions, not vibes.

| Threshold | Value | Rationale | Source / Basis |
|---|---|---|---|
| ZIP delta flag | >5% move | Common RE industry "notable move" bar; below 5% is within weekly Redfin sample variance | Industry convention; Redfin methodology docs |
| County delta flag | >3% move | Larger sample = tighter signal; 3% is meaningful at 50+ transactions | Same |
| DOM alert | >90 days | FGCU RERI defines 90+ days as a slow-market indicator for SW Florida; consistent with NABOR quarterly | FGCU RERI Housing Market Report |
| Inventory MoM alert | >20% change | Redfin / NAR define a 20% MoM inventory shift as a supply-structure change, not seasonal noise | NAR Housing Statistics methodology |
| ZIP transaction floor | ≥10 sales in period | Below 10, single outlier sale swings median >10%; not statistically meaningful | Applied statistics; mirrors housing-swfl LOW_SAMPLE_FLOOR design intent |
| County transaction floor | ≥50 sales in period | Same rationale at county grain | Same |

**Action:** any change to a threshold value requires updating this table with a new source
or an explicit "policy override" note. "Feels right" is not a valid rationale.
