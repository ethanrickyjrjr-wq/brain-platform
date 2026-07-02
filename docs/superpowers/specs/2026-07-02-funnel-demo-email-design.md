# Funnel Demo Email — Two-Track Prospect Sequence + Cadence Engine (design)

- **Build slug:** `funnel-demo-email` · check: `funnel_demo_email_live_verify`
- **Date:** 07/02/2026 · operator-approved design (brainstorm this session)
- **Approach:** A-with-C-spirit — one engine, two tracks, riding the existing cold-outreach
  engine; cycle 1 runs at tiny volume with an operator-approved preview on every email.
- **Research basis (crawl4ai, fetched 07/02/2026):** Woodpecker cold-email statistics 2026
  (carrying Belkins' 16.5M-email analysis + Instantly benchmark report), Gmail bulk-sender
  guidelines (support.google.com/mail/answer/81126), Mailmodo subject-line guide, MoxiWorks
  product pages, Inside Real Estate BoldTrail, TheClose CRM comparison, Follow Up Boss
  public pricing, reso.org Web API + certification FAQs, bhhsfloridarealty.com,
  premiersothebysrealty.com. Re-verify vendor surfaces at build time per RULE 0.4.

---

## 0. Why this build

The funnel plumbing (enroll → branded arrival → claim → seeded project) shipped 06/19 but
has never sent an email — live send was deferred as Phase D and both entry scripts refuse
it. Meanwhile a full cold-outreach engine shipped 06/20 (Resend batch send, per-recipient
one-click unsubscribe, CAN-SPAM postal gate, drip runner, lifecycle states, engagement
suppression, `outreach_recipients`/`outreach_events` live in prod, GHA paused) and sits
unused. This build marries them: the outreach engine is the send spine; the demo email is
the payload; the arrival/claim/cockpit path is the landing.

Phase D is operator-approved (this session). Target prospects: agents and broker/office
managers at large SWFL brokerages (Berkshire Hathaway HomeServices Florida Realty,
Premier Sotheby's International Realty) — a generated list exists and is being completed
separately.

## 1. Scope

- One engine, two message tracks: **agent** and **broker**.
- Cycle 1: ~10–20 agents + ~5–10 broker/office contacts. Every email previewed and
  approved by the operator before send (C spirit). Cycle-1 volume doubles as domain warmup.
- NOT in scope: roster crawler to complete the agent list (follow-up build), MLS/RESO feed
  integration, cockpit changes, paid list vendors.

## 2. Sending infrastructure (Phase D wiring)

- **Separate outreach domain** (operator decision this session). Operator buys it; we
  verify it in Resend and set SPF + DKIM + DMARC. Cold outreach never rides
  swfldatagulf.com — the product's deliverability is the thing we sell; complaints must
  not touch it. Arrival links still point at swfldatagulf.com.
- One-click unsubscribe (List-Unsubscribe + List-Unsubscribe-Post) — the outreach engine
  already emits these; verify on the new domain.
- CAN-SPAM: working opt-out, accurate headers, truthful subject, postal address
  (`OUTREACH_POSTAL_ADDRESS` env exists). That is the whole requirement — no lecture.
- **Deliverability ceiling (Gmail published rules, fetched 07/02/2026):** spam complaint
  rate under 0.3% hard, target 0.0 in cycle 1. At 30 recipients ONE complaint ≈ 3% — this
  is why volume stays tiny and every email must be individually worth receiving.
- Sender identity: real person From name, reply-to monitored by the operator.

## 3. Agent demo email (the payload)

Concept: **proof-of-work demo in their own brand**, not a market report. The email IS the
product demo — "this is what your clients could get from you."

Anatomy, top to bottom:
1. Preheader + brokerage logo + one honest framing line ("We built this for you from live
   SWFL data — this is what your clients could get from you every week.").
2. **Branded market chart PNG** of their office's area — existing chart pipeline
   (brand-accent trend, MM/YYYY axis, hosted image). No inline SVG (Gmail/Outlook strip it).
3. **Three cited stats** at the grain we hold (active listings, median list price, days on
   market from the sole listings spine), sources in a collapsed list, as-of date MM/DD/YYYY
   stated once.
4. **AI prompt button row** — three tappable questions ("What changed in Park Shore this
   week?", "Which price band is moving?", "Draft my Tuesday client email"), each a deep
   link to the branded arrival page with the question pre-seeded so the assistant answers
   live on landing. Requires a new `prompt` param on the arrival URL → seeds the welcome
   chat. This is the click-to-AI moment.
5. Primary CTA: "See your whole week — already built" → arrival → claim → cockpit This
   Week queue pre-generated in their brand.
6. Footer: opt-out link, postal address, collapsed sources.

Sourcing: every figure four-lane (our data → prospect-supplied → named web source →
operator-stated). A gap fills from the next lane; an invented number is the only hard block.

**Brand assets verified 07/02/2026 (from the brokerages' own sites — never memory):**
- BHHS Florida Realty: cabernet `#670038` (in their site CSS; logo files named
  `FL301_primary_cab.svg` confirm cabernet is the brand color), logo at
  `bhhsfloridarealty.com/content/dam/bhhs/brand_identity/logos/franchisee/fl301/FL301_primary_cab.svg`
  — rasterize SVG → PNG for email. CAUTION: `#2E3192` purple is the Berkshire Hathaway
  PARENT conglomerate, not the realty brand — do not use.
- Premier Sotheby's: black/white wordmark (pixel-sampled from
  `cdn-cws.datafloat.com/PSB/images/company/PSB/logo.png`), site accents `#007dc1`/`#0061a7`
  blues + `#ab8f40` gold. Demo look: black wordmark, white space, gold accent.
- Per-prospect enrichment stays `enrichBrand(domain)` at build time; the pre-send gate
  (below) catches enrichment failures.

## 4. Broker email (track differences)

Same skeleton, fleet spine:
- Subject/hero speak fleet: "every agent in your office could have sent this at 9 AM."
- **Coexist line by name:** works alongside MoxiWorks / BoldTrail / Follow Up Boss — we
  are the data-and-content engine, not a CRM replacement; no rip-and-replace. (Landscape
  verified 07/02/2026: those suites are containers — CRM, triggers, templates; none writes
  a cited, chart-backed local market narrative automatically. Price anchors from TheClose +
  Follow Up Boss public pricing: agent tools ~$58–189/user/mo; brokerage platforms opaque
  enterprise pricing.)
- **Plug-in offer:** "send us any export of your data and it's in your agents' emails this
  week." A broker's own data is theirs to hand us (CRM export, listing inventory, sold
  pipeline) — lands as lane-2 upload, zero MLS involvement.
- **RESO/MLS position (verified on reso.org 07/02/2026):** RESO is a standards body — it
  certifies conformance and grants NO data access. Data access is licensed per-MLS
  (IDX/VOW/back-office), authorized by the broker, paperwork per MLS. It is a
  sales-cycle formalization AFTER a broker signs, never a demo blocker — our own spine
  already powers everything shown.
- CTA lands on an office-branded arrival.

## 5. Cadence state machine (evidence-pinned)

Cold phase — 4 touches over ~3 weeks, varied spacing, each touch a NEW data angle
(research: optimal 4–7 touches; first follow-up is the best-performing step at 8.4% reply;
42% of replies come from follow-ups; beyond 4 unanswered touches complaint risk triples;
identical daily intervals read as automation):
- **T1 day 0** — the demo email.
- **T2 day 3–4** — the delta email: "two of the numbers we showed you have moved"
  (computed vs the frozen T1 snapshot — the machinery exists in the activation sequence).
- **T3 ~day 10** — different lens: agents get the social-calendar angle; brokers get
  tracking/coexist angle.
- **T4 day 18–21** — breakup email: "last one from us — here's everything we built for
  you in one link." Hard stop.

Branches:
- **Any click → daily-trial track** (daily at 9 AM, capped 30 sends — the cadence seam
  exists; this build adds the repeating processor). Daily is EARNED by engagement, never
  sent cold.
- **No engagement after T4 → 30-day cooldown → exactly ONE re-engagement email** with
  fresh numbers ("what changed in your market since we last wrote") → still nothing →
  **retire the address permanently.** No second full cycle.
- Unsubscribe/complaint → immediate permanent suppression (engine already does this).

State lives in the existing outreach recipient lifecycle, extended with:
`cold_t1..t4`, `trial_active`, `cooldown`, `reengaged`, `retired`, `converted`.

## 6. Subject-line system

Rules (each from 07/02/2026 research): 6–10 words / ~36–50 chars; a REAL number in the
subject (+113% opens) pulled from the lake at build time; question form where natural
(+21%); recipient's name or place (+50%); subject always truthful about the body
(misleading subjects poison domain reputation and violate CAN-SPAM); banned: "quick
question", "just checking in", AI-cliché phrasing.

Shapes (numbers filled at send time, never invented):
- T1 agent: "[Name], the [Place] email your clients didn't get this morning"
- T1 broker: "[Brokerage]'s [Place] agents, powered by one data engine"
- T2: "[Place]'s median moved $[X]K since Tuesday" (only if it truly moved; else the
  re-verified variant)
- T4: "Last one from us, [Name] — your [Place] setup stays live"

Cycle 1 A/B: two T1 subject variants per track; build the sequence around the winner
(reply/click, not opens — Apple MPP inflates opens).

## 7. Tracking

- Arrival URLs carry `ref=<recipient>-<touch>`; the existing Resend webhook feeds
  opens/clicks/unsubs/complaints into `outreach_events`; the state machine consumes them.
- Cycle-1 scorecard is a SQL read: delivered → opened → clicked → arrived → claimed,
  complaint count. Scale-to-cycle-2 gate: ZERO complaints.

## 8. Safety gates (C spirit, mechanical)

- DRY_RUN default everywhere, unchanged.
- Every build writes rendered preview HTML per recipient to a local folder; operator opens
  in browser and approves BEFORE any send. No preview, no send.
- Pre-send gates abort mechanically: (1) brand primary+accent hex present in built HTML;
  (2) logo URL returns 200; (3) URL allowlist lint passes (deep-link params are platform
  links — allowed); (4) no-invention narrative gate passes.
- Live send ONLY via operator-run command with the approval env set. The agent never
  sends autonomously — standing rule.

## 9. Parallel-work guardrails (LOCKED — deliverable-factory waves own these surfaces)

This build CONSUMES and must NOT edit: the deliverable build spine (`lib/email/build-doc`),
`market-context`, the narrative/URL lints, the chart pipeline (`chart-image` incl.
`hostEmailMedia`), listing photo/link roots. Brand-token handling defers to the
`brand-tokens-one-root` wave when it lands; until then use existing brand seams as-is.
NO new email builder — the demo email extends the existing grounded render + the outreach
content builder only. Any seam conflict = STOP and surface to the operator, never work
around.

## 10. Success criteria

1. Two rendered demo emails (one per track) in real brokerage brands pass all gates and
   the operator's eyeball.
2. First live cycle sends from the separate domain with zero complaints.
3. At least one prospect clicks through to a branded arrival and the seeded prompt answers
   live.
4. Cadence state machine advances/suppresses correctly off real webhook events
   (verifiable in the event table).
5. `funnel_demo_email_live_verify` closed by the operator on prod evidence.

## 11. Open items for the implementation plan

- Operator: choose + buy the outreach domain; DNS records; Resend domain verify.
- Operator: confirm From identity (name + reply-to inbox) and postal address value.
- `prompt` param on arrival → seeds the welcome chat (new, small).
- Daily-trial repeating processor (new; reuses drip-runner pattern).
- Delta email reuses the activation snapshot/diff machinery against the outreach spine —
  pick the ONE render root at plan time (no parallel builder).
- Chart-into-demo-email wiring via the existing chart pipeline (no edits to it).
- Rasterize brokerage SVG logos → hosted PNGs.
- Re-verify Resend API surfaces (batch send, scheduledAt, webhooks) via crawl4ai at build
  time.
