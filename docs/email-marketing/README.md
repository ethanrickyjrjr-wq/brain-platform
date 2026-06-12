# SWFL Data Gulf — Email Marketing System

**Status:** Phase 0 — spec + folder structure complete. Phase 1 (first send) unbuilt.
**Owner:** hello@swfldatagulf.com
**Rules file:** `EMAIL.md` (governs every email this system sends)
**Logs:** `email-logs/YYYY-MM-DD.json` (one per sent issue; cross-day memory)

---

## Built Samples — open these (2026-06-11)

Two clickable artifacts under `samples/`. Open in a browser:

- **`samples/agent-client-digest.html`** — the **white-label client digest**. One template, real lake data, numbers + "The Read" paragraph swapped per ZIP (33908 and 33931 shown). The agent brand block up top is the white-label slot. This is the V1 product an agent sends their sphere under their own name.
- **`samples/ai-hook-page.html`** — the **AI hook landing page**. Clickable starter prompts that answer from real lake data, an "Add to your own AI" MCP one-liner (live today), and "built by asking" capability cards (emails, documents, updates). Mockup note: chat answers are real lake data, the input box is not wired yet.

### Product shape (what these prove)
- **Free per-ZIP digest** = top of funnel. Same email, swapped numbers + narrative per ZIP.
- **AI hook** = the digest links to a page wrapping our live AI (cited, no invention). The brain (MCP + `speak` API) is **LIVE**; the consumer chat page is the build.
- **Self-select funnel:** pass-by / email-only (price-gated) / AI power-user — the page serves all three. High-value target = brokers/CRE paying thousands for the same data; the wow converts them, but only if the email gets opened (open-rate is the gate).

### Interaction model — "does it answer in email or take them to our page?"
Both, two distinct loops:
1. **Reply-to-ask (answers in email):** subscriber replies to the digest → Resend Inbound webhook → AI answers by email. Zero friction, no app. (Phase 3 reply loop — already speced.)
2. **Click-to-chat (takes them to our page):** the CTA/links open the AI hook page for the interactive experience (highlighter, ZIP drill, document generation).

### Highlighter — can it live in the email?
**No.** Email clients block JavaScript (same constraint as charts, EMAIL.md Rule 7). The highlighter is interactive → it lives on the **web version** of each issue (`/email/[date]`, Phase 5). Every email carries a "View on web" link to that page. Email stays static tables; the interactivity is one click away.

### MCP hookup friction (the part we hate)
Power users want their OWN AI. The hookup is one line today (`claude mcp add … swfl`) but still friction for non-technical brokers. Path of least resistance: lead everyone to the hosted chat page (no install); offer the MCP line as the "plug into your own stack" upsell for the technical ones.

### Decisions — 2026-06-11 (PM)
- **Thin / single-column responsive.** One 600px max-width single-column template renders on phone + desktop with no device-specific code; mobile clients fit-to-width. Keep it thin — never maintain two layouts.
- **AI prompts in EVERY email.** 1–2 tappable prompts deep-linking to the ask page (`/ask?q=…`) ride in every issue — the conversion bridge from a passive read to an AI session. Live in `samples/agent-client-digest.html` + `scripts/email/test-send-33908.html`.
- **Backgrounds need the `bgcolor` attribute, not just CSS.** Gmail/Outlook ignore `style="background"` on wrappers; set `bgcolor` on the outer table + td (this is why a send showed white). Fixed in the send file.
- **Site-matched theming = later.** Palette will align to the site; not a V1 blocker.
- **First real send: DONE** — 33908 white-label digest delivered to a live Gmail via Resend (id `c838152d…`), `from` the verified `hello@swfldatagulf.com`.

---

## What This Is

A branded daily email digest that surfaces SWFL Data Gulf lake data — focused on ZIP 33908
and the surrounding south Fort Myers corridor — to subscribers, real estate agents, and
eventually their clients. Starts as an internal proof at hello@swfldatagulf.com, grows to a
subscriber list, then becomes a white-label product agents buy to send their own clients.

This is the top-of-funnel. The email earns the click. The click earns the signup. The signup
earns the seat. The seat earns the revenue.

---

## Business Case

| Metric | Benchmark (2025) | Our Target |
|---|---|---|
| Email ROI | $36 per $1 spent | — |
| Avg real estate open rate | 15–25% | 25–35% (local + fresh) |
| Target CTR | 2–5% | 4–6% (data is scarce locally) |
| Conversion (email → signup) | 1–3% | 3–5% |
| Unsubscribe threshold | <0.5% | <0.3% |

Source: Amitree 2025 Real Estate Email Marketing Guide; Forbes Email Statistics.

**Why this wins:** Every other real estate email is generic national data repackaged. We have
ZIP-level, daily, structurally-cited SWFL data that no one else publishes. The scarcity is the
hook. The freshness token is the proof. The historical curiosity section is the brag.

---

## Audience Segments (V1 → V3)

| Phase | Audience | Customization |
|---|---|---|
| V1 | hello@swfldatagulf.com (internal) | Standard template, fixed ZIPs |
| V2 | Public subscriber list (opt-in from landing page) | Standard template, user picks tier |
| V3 | Agent white-label | Agent's logo + branding, their client list, their ZIP focus |

The V3 play: agents pay $39–$79/month to send a data-backed digest to their sphere under
their own name. We handle data, delivery, and compliance. They handle relationships.
This positions us as CoStar-for-the-consumer at a price point anyone can afford.

---

## Data Sources (What Feeds the Email)

| Section | Brain / Source | Cadence | Notes |
|---|---|---|---|
| Top Line | `master` | Daily rebuild | 2–3 sentence synthesis |
| ZIP Focus | `housing-swfl` | Weekly (Redfin-sourced) | Per-ZIP median price, DOM, MoS, sale-to-list |
| Lee County Snapshot | `housing-swfl` + `permits-swfl` | Weekly | County medians + permit velocity |
| City Voices | `city-pulse-swfl` | Daily | Up to 4 signals, **market-relevant first** (human-interest demoted, dupes collapsed) — EMAIL.md Rule 2.5 |
| CRE / Corridors | `corridor-pulse-swfl` | Weekly | For weeks with corridor news |
| Economic Activity | `econ-dev-swfl` | Weekly | Business openings, SWFL Inc announcements |
| Environment/Flood | `env-swfl` | Monthly | Surfaced when relevant (storm season, new AAL data) |
| Historical Curiosity | any brain | Historical rows | One fact from 12–36 months ago tied to today's signal |

**ZIP focus cluster:**
- `33908` — San Carlos Park / south Fort Myers (primary focus)
- `33919` — South Fort Myers / Cape Coral border
- `33912` — South Fort Myers / Estero Road corridor
- `33907` — Fort Myers / Bell Tower / US-41
- `33931` — Fort Myers Beach (post-Ian recovery benchmark)
- `33914` — Cape Coral south

---

## Email Sections (Fixed Structure)

```
╔══════════════════════════════════════════════════════╗
║  [LOGO]   SWFL DATA GULF INTEL          Issue #XXX  ║
║           Thursday, June 12 · 33908 + Lee County    ║
╚══════════════════════════════════════════════════════╝

── TOP LINE ──────────────────────────────────────────
2–3 sentence market pulse. From master brain. No raw numbers
unless they're extraordinary. Sets the tone.

── ZIP FOCUS: 33908 + NEARBY ─────────────────────────
Data table:
  ZIP    | Med Price   | DOM | MoS | vs Last Week
  33908  | $412,000    | 52  | 4.1 | ↑ $8k
  33919  | $389,000    | 48  | 3.8 | →
  33912  | $425,000    | 61  | 5.2 | ↓ $12k
  33907  | $370,000    | 44  | 3.3 | ↑ $5k
  33931  | $680,000    | 87  | 8.4 | ↓ $25k (FMB)
  33914  | $445,000    | 55  | 4.6 | →

── LEE COUNTY SNAPSHOT ───────────────────────────────
County median. Permits this week. Any notable economic signals.
One or two lines max — this is context, not the star.

── CITY VOICES ───────────────────────────────────────
Up to 4 cited signals from city-pulse-swfl.
Priority: breaking > transactions > development > business.
Each signal = one line + source link.
  🔴 BREAKING: ...
  📋 TRANSACTION: ...
  🏗 DEVELOPMENT: ...
  💼 BUSINESS: ...

── WHAT CHANGED SINCE YESTERDAY ─────────────────────
Delta vs previous email log.
  → 33908 median sale price up $8,000 week-over-week
  → City Voices: 2 new development signals (was 0 yesterday)
  → Fort Myers Beach DOM ticked up 3 days (watching)
If weekend gap: covers Friday → Monday delta.

── HISTORICAL HOOK ───────────────────────────────────
One interesting past data point tied to something live today.
Examples:
  "In June 2023, 33931 DOM was 14 days. Today it's 87. That's
   Ian's insurance repricing fully showing up in market velocity."
  "The last time 33908 had MoS > 5 was Q3 2022 — pre-rate spike.
   We're back there now."

── FOOTER ────────────────────────────────────────────
Gulf Coast Intelligence Group, LLC
2201 McGregor Blvd, Suite 300 · Fort Myers, FL 33901
(239) 555-0147 · hello@swfldatagulf.com
Research Director: Marcus Reid

Data sourced from SWFL Data Gulf (swfldatagulf.com).
[Unsubscribe] [Privacy Policy] [View on Web]
```

---

## Technical Stack

| Layer | Tool | Status |
|---|---|---|
| Email composition | React Email | Need: `npm i @react-email/components` |
| Email delivery | Resend | ✅ Installed (`^6.12.3`), used in `/api/waitlist` |
| Scheduling | GitHub Actions Cron | Build — `0 10 * * 1-5` (6am ET weekdays) |
| Data fetch | `/api/b/[slug]?view=speak` | ✅ Live |
| Log storage | `email-logs/YYYY-MM-DD.json` | Structure ready |
| Chart rendering | Data tables + Mapbox static PNG | No JS charts in email (email clients block them) |
| Subscriber management | Resend Audiences (built-in) | Phase 2 |
| Reply/feedback | Resend Inbound webhook | Phase 3 |
| Subscriber prefs | Supabase `public.email_subscribers` | Phase 3 schema needed |

**Important chart constraint:** React/Recharts use JavaScript. Email clients block JS.
Options for data viz in email:
1. HTML `<table>` — works everywhere, looks sharp with good CSS
2. Pre-rendered PNG via server-side Chart.js + canvas → saved to Supabase Storage → hosted URL
3. Mapbox Static Images API — already available via our MCP server

---

## Phase Plan

> **Scope boundary (locked 2026-06-11).** This folder owns the **email itself** — composing, sending, the subscriber list, the reply loop, white-label email *templates*, and copy rules. Everything **after the click** — the personalized landing preview, brand auto-extraction, the paid checkout, and the seeded first project — is the **conversion funnel**, speced separately in `docs/superpowers/specs/2026-06-11-conversion-funnel-design.md`. The email earns the click; the funnel earns the seat. Keep the two build tracks separate so they don't collide. Phases 4–5 below point to that spec for the paywall / landing / billing pieces instead of re-describing them.

### Phase 0 — Spec + Structure (DONE)
- [x] `docs/email-marketing/README.md`
- [x] `docs/email-marketing/EMAIL.md`
- [x] `docs/email-marketing/email-logs/.gitkeep`

### Phase 1 — First Internal Send
Build the GHA script + React Email template that:
1. Fetches brain data (master + housing-swfl + city-pulse-swfl)
2. Renders the React Email template
3. Sends to hello@swfldatagulf.com via Resend
4. Writes the email-logs JSON

Files to create:
- `scripts/email/build-digest.mts` — fetches data, builds payload
- `scripts/email/DigestEmail.tsx` — React Email component
- `.github/workflows/daily-email-digest.yml` — GHA cron (Mon–Fri 10:00 UTC)

Secrets needed: `RESEND_API_KEY` (already in GH secrets per feedback memory), `NEXT_PUBLIC_SITE_URL`

### Phase 2 — Subscriber List
- **Wire Resend Audiences** for subscriber management. **Requires a `full_access` API key** — the
  send-only key 401s on contacts/audiences (verified Resend model: `sending_access` = "can only send
  emails", `full_access` = "create, delete, get, and update any resource"). Use a SEPARATE full-access
  key, **server-side only** (the Vercel app) — NEVER in the GHA cron.
- Add `/api/email/subscribe` endpoint (writes the Audience contact + `public.email_subscribers`).
- Add subscribe CTA to the landing page + `/r/` pages.
- Email landing page at `/email/[date]` (web version of each issue).
- **Swap the residential CAN-SPAM address** (`DIGEST_SENDER_ADDRESS`) for a PO Box / registered-agent
  address before the list goes public — a home address otherwise ships in every email to strangers.

#### Resend API keys — 3-key model (locked 2026-06-12)

Verified Resend model: `permission` ∈ {`sending_access`, `full_access`}, plus an optional `domain_id`
that locks a sending key to one domain.

| Resend key | Permission | Used by | Env var |
|---|---|---|---|
| `digest-cron` | `sending_access` | GHA digest cron (`scripts/email/build-digest.mts`) | `RESEND_API_KEY` (GH secret + `.env.local`) |
| `waitlist-web` | `sending_access` | `/api/waitlist` (Vercel runtime) | Vercel env |
| `full_access` | `full_access` | **Phase 2** Audiences / contacts, server-side only | `full_access` in `.env.local` — **rename to `RESEND_AUDIENCES_KEY` when wiring prod** (a bare `full_access` var is ambiguous) |

Hardening: in the Resend dashboard set each sending key's **Domain = `swfldatagulf.com`** (`domain_id`) so
a leaked key can't send from another domain. One key per (permission × surface), created on demand —
never upgrade the cron key to full access.

### Phase 3 — Reply Feedback Loop
**The subscriber tells us what to track more or less of — zero UI needed.**
- Configure Resend Inbound: replies to `digest@swfldatagulf.com` → webhook `/api/email/reply`
- Webhook parses reply text with Claude (Haiku 4.5 — cheap) for preference signals:
  - "I don't care about CRE" → tag `pref:no_cre`
  - "More Fort Myers Beach data" → tag `pref:zip_33931_primary`
  - "Add Bonita Springs" → tag `pref:zip_34135`
- Preferences stored in `public.email_subscribers` table
- Digest builder reads prefs → adjusts section weights and ZIP focus
- This is fully conversational — subscriber never touches a settings page

### Phase 4 — Agent White-Label (email template only)
- Supabase `public.email_clients` table: agent_name, logo_url, brand_color, zip_focus[], client_emails[]
- Dynamic React Email template: swaps logo, color, contact info from client record
- Separate GHA per client (or parameterized workflow with client_id)
- **Billing + onboarding (signup → pay → branded account) are the conversion funnel's job**, not this phase — see the funnel spec (Stripe checkout + Brandfetch logo-first branding). This phase only *consumes* the agent's branding record the funnel produces and renders it into the email; it builds no checkout of its own.

### Phase 5 — Email web archive (`/email/[date]`)
- `/email/[date]` — the web version of each issue (highlighter, ZIP drill, share/forward). This is email-owned: the rendered archive of a sent issue, the "View on web" target, and the viral/share surface.
- **The paywall, the "create your own" custom-digest builder, and the $39–79 tier are NOT here** — they are the conversion funnel (landing → brand → pay → seeded project), speced in `docs/superpowers/specs/2026-06-11-conversion-funnel-design.md`. A subscriber who wants their own branded product is handed off to that funnel; this phase just renders the public archive page.
- Fiverr for initial HTML design skin of the web archive (we own the data + composition engine; they do the visual polish).

---

## Subject Line Strategy

Research shows subject lines are 80% of open rate. Formulas that work for real estate:

| Type | Formula | Example |
|---|---|---|
| Data hook | `[ZIP] [metric]: [short insight]` | `33908 median DOM: 52 days and climbing` |
| Comparison | `[market A] vs [market B] this week` | `Fort Myers Beach vs. Cape Coral: the gap is widening` |
| Trend alert | `[metric] just crossed [threshold]` | `Lee County inventory crossed 5 months of supply` |
| News hook | `[city voice signal] + what it means` | `Bonita Springs hotel permit + what it means for 33908` |
| Historical | `Last time this happened in 33908…` | `Last time 33908 DOM hit 50: Q1 2022. We're back.` |

A/B test every week: issue to subscribers, track open rate vs rolling 4-week average.

---

## Design Notes (for Fiverr / in-house polish)

**Brand identity:**
- Primary: SWFL Data Gulf logo (existing asset)
- Palette: deep navy (#0F2035), Gulf teal (#1BB8C9), white, warm sand (#F5E6C8)
- Font: system-safe stack — `Inter, -apple-system, Helvetica Neue, Arial, sans-serif`

**Email client targets:** Gmail (web + mobile), Apple Mail, Outlook 2019+, Samsung Mail
- Gmail clips at 102kb — keep HTML under 90kb
- Outlook doesn't support many CSS properties — tables for layout, not flexbox
- Dark mode: add `@media (prefers-color-scheme: dark)` overrides

**Visual elements that work in email:**
- Colored header band with logo + issue number (2px bottom border in brand teal)
- Metric callout boxes: `background: #F0F9FA; border-left: 4px solid #1BB8C9; padding: 12px`
- Simple data tables (alternating row shading, no heavy borders)
- Mapbox static map as a geographic header for the ZIP Focus section
- Emoji directional indicators: ↑ ↓ → for metric changes (renders everywhere)
- Single button CTA: rounded, brand navy, white text

**What NOT to do:**
- No images as content (blocked by default in many clients; alt text is your fallback)
- No background images on full sections
- No custom web fonts (use system fonts)
- No multi-column layouts that break on mobile
- No JavaScript / interactive elements

---

## Research Findings (Firecrawl, June 2025)

### ROI and Benchmarks (Amitree, Forbes, Brevitas)
- Email ROI: $36 per $1 spent — outperforms all other channels
- Real estate open rates: 15–25% average; **30%+ achievable** with optimal timing + local relevance
- Best send time: Tuesday/Thursday, 10am–2pm local time
- Subject line is 80% of open rate — test weekly
- CTR target: 2–5%; conversion to action: 1–3%
- Keep bounce rate under 2%; unsubscribe rate under 0.5%

### Technical (Resend, React Email)
- React Email v6 is current — open-source, TypeScript, Tailwind support, local preview server
- Stack: `@react-email/components` + Resend SDK (already installed)
- Charts: **JavaScript does not execute in email clients** — use static tables or pre-rendered PNG
- Resend Inbound: forward replies to a webhook → enables the feedback loop in Phase 3
- Resend Audiences: built-in subscriber management; no need for Mailchimp for Phase 2

### Segmentation and Personalization (MoxiWorks, Placester)
- Segment by: buyer vs. seller, ZIP code focus, active vs. past client
- Personalize subject line with ZIP or neighborhood name = +15–20% open rate
- Separate "new leads" from "existing clients" — different cadence, different tone
- Automate: welcome sequence (3 emails over 7 days) before rolling into digest

### Conversion Architecture (Curaytor, RealScout)
- Every email should have exactly ONE action you want taken
- The digest builds authority; the landing page earns the conversion
- A web version of each digest (the `/email/[date]` page) extends reach via share/forward
- Agents sharing the digest to their sphere = the viral loop; make it easy to forward

---

## Open Questions / Ideas for Later

1. **SMS companion**: Resend doesn't do SMS, but Twilio + a 2-line text when DOM in 33908 spikes could be a premium add-on
2. **Webhook for MLS data**: If we ever get MLS access, new listing alerts per ZIP go in a second daily email (not this digest — separate product)
3. **Podcast companion**: The historical curiosity section is literally a podcast episode. "Last time 33931 DOM was 14 days…" — 3 minutes of audio per week = brand-builder
4. **Interactive web digest**: The `/email/[date]` page becomes a full product when we add the chart explorer and highlighter — this is the lead capture page, not just an archive
5. **Fiverr for V1 HTML skin**: Commission the visual design once data flow is working. Brief: dark navy header, Gulf teal accents, clean data tables, mobile-responsive. $150–$400 for a template. We own the data engine; they give us the polish.
6. **Audience intelligence**: As the subscriber list grows, Resend Analytics tells us which ZIPs get the most clicks → feeds back into what we build in the lake
7. **Reply agent (Phase 3)**: The inbound webhook + Claude Haiku is 50 lines of code. The preference data it generates is worth more than the cost. Build it in the same PR as subscriber list.
