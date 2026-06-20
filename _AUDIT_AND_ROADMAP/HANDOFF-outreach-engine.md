# HANDOFF — Operator Bulk Cold-Outreach Engine

**Paste this as your first message to a fresh Claude session in the `brain-platform` repo.**

---

You're picking up a new build. Before anything else: read `CLAUDE.md` (esp. RULE 0 session log,
RULE 0.5 probe-first, RULE 3 architecture discipline, RULE 3.5 brainstorm-before-build), then read
`_AUDIT_AND_ROADMAP/2026-06-20-convergence-audit.md` for the full inventory this handoff summarizes.
**Verify every file:line below against the actual code before you trust it — the inventory was accurate
as of commit `a3a7e27` on branch `claude/main-branch-merge-1e8e31`, but probe, don't assume.**

## The mission

Build an **operator-side bulk cold-outreach engine**. NOT user-facing — this is a tool for the operator
to run marketing/outreach campaigns. The flow:

1. Take a **list of target brokerages/brokers** (email + maybe name + their website domain).
2. For each target, **scrape their logo + brand colors** from their website.
3. **Compose a personalized branded email** — the email shows *that recipient's* logo + colors.
4. **Bulk-send** the campaign.
5. Each email carries a **click-back link to swfldatagulf.com** that, when clicked, lands the prospect
   on a page **already showing THEIR colors** (the "we already lined this up for you" wow / lead magnet).

The operator's own words: *"This is for us to send out multiple emails at a time. This is not user
facing... scrape logos, have colors filtered, find email list, maybe names, put together emails with
certain logos with correct email attached to colors and click backs to swfldatagulf so their colors
auto populate."*

## FIRST: resolve the open design decision with the operator

The operator explicitly asked and has NOT yet decided: **"Do we create a separate page for me for this,
or can I run this inside a project of mine?"** Use `superpowers:brainstorming` (RULE 3.5) and surface
this as the first decision. The three viable shapes:

- **(A) CLI campaign script** (recommended starting point) — mirrors the existing
  `scripts/email/enroll-prospect.mts`, which already does per-prospect `enrichBrand` + `buildArrivalUrl`.
  Runs with service-role creds locally, sidesteps the missing operator-auth persona entirely. Fastest to
  "actually works," easiest to verify, no new auth surface. Best fit for "not user-facing."
- **(B) Operator-only web page** — a real `/operator/outreach` surface. Needs an operator auth/role gate
  (does NOT exist today — see CAP5 gap). More work, more surface to secure.
- **(C) Inside a project of the operator's** — reuse the project/deliverable UI. Awkward: projects are
  single-tenant, single-brand; this campaign is many-recipients-many-brands. Likely the wrong primitive
  (see CAP4 gap). Flag this against RULE 3 before committing.

Do not start building until the operator picks. Recommend (A) unless they want a clickable UI.

## What ALREADY EXISTS (the reusable spine — verify each)

**Logo + color scrape — `enrichBrand(domain)`** at `lib/prospects/enrich-brand.ts:130`. Returns
`{ primary, secondary, logo_url, company_name, confidence, source }`. Direct HTML fetch + Haiku selection
(no screenshot, no palette quantization). Never throws → all-null fallback on failure. Already called by
`scripts/email/enroll-prospect.mts:76`. Tested in `enrich-brand.test.ts`.

**Click-back arrival read — LIVE.** `app/welcome/page.tsx:31-103` reads the URL contract
**`/welcome?name=&primary=&secondary=&logo=&zip=`**: validates `primary`/`secondary` against
`HEX_RE` and injects them as CSS vars `--brand-primary`/`--brand-secondary`; `zip` reframes to an
"Open your project" CTA when in 6-county scope. The URL is built by `buildArrivalUrl()` at
`lib/prospects/build-arrival-url.ts:11` (takes a `BrandEnrichment` + name + zip — **reuse this directly**).

**Pre-brand a real project on claim** — `app/welcome/_components/OpenProjectCta.tsx:14` →
`POST /api/prospect/open-project` mints a single-use claim token carrying brand + seed
(`mintClaimToken([], title, {brand, seed})`) → `/claim?t=` → `POST /api/claim` writes
`projects.branding` via `brandToBranding()`. Brand payload shape: `ClaimBrand { primary?, secondary?,
logo_url?, company_name? }` at `lib/claim/claim-store.ts:28`.

**Bulk send — two existing paths (Resend):**
- Broadcast→Segment: `app/api/email/broadcast/route.ts:30` — machine-auth (`DIGEST_BROADCAST_SECRET`),
  targets ONE Resend segment, requires `{{{RESEND_UNSUBSCRIBE_URL}}}` in the HTML or it 400s.
- Batch→addresses: `app/api/deliverables/[id]/blast/route.ts:53` — user-session/RLS, sends to the user's
  own `contacts` (cap 500, chunks of 100, `resend.batch.send`).
- Cron worker: `scripts/email/run-schedules.mts:364`. Audience sync: `lib/email/audience-sync.ts`.
  Marketing Resend client (full-access key `RESEND_AUDIENCES_KEY`): `lib/email/marketing-client.ts`.

**Branded email compose (sender-brand) — `lib/email/grounded-report.ts:200`
`renderGroundedReport(model, {skin:"email", brand})`**; theme tokens via
`lib/email/templates/render-template.ts:16` (`brandThemeToTokens` → `PRIMARY`/`ACCENT`/`LOGO_URL`);
HTML shell `templates/html/email/email-report.html`. `BrandTheme` = `{primary, accent, logoUrl}`
(`lib/deliverable/brand-theme.ts:13`).

## What's MISSING (what you'll build)

1. **Per-recipient DIFFERENT brand** — *the core gap.* Today branding is always the **sender's**, resolved
   once and reused for the whole send (`run-schedules.mts:264`; the blast route renders the body once and
   only swaps the unsubscribe footer per recipient — `blast/route.ts:114,159`). You need to re-render the
   email HTML **per recipient** with that recipient's scraped `{primary, accent, logoUrl}`. The compose
   primitives (`renderGroundedReport`/`brandThemeToTokens`) already accept an arbitrary `brand` — the gap
   is the per-recipient *loop*, not the renderer.

2. **A target/campaign data model** — there is no campaigns or prospect-list table for outreach. Decide:
   a new table, a CSV the CLI reads, or reuse `email_contacts`. (Note the existing split: `contacts` (blast
   lane) vs `email_contacts` (segment lane) are two unmerged tables — don't add a third without reason.)

3. **An operator trigger surface** — per the design decision above (CLI is the low-friction default).

4. **External-logo re-hosting** — `lib/welcome/logo-allowlist.ts:29` allowlists host `swfldatagulf.com`
   ONLY, so a prospect's externally-hosted logo is **dropped** on `/welcome` (SSRF/tracking-pixel close).
   Two options: (a) colors-only click-back (works today, no logo on arrival); or (b) re-host scraped logos
   into our Supabase storage and pass the re-hosted URL. Decide with the operator — (a) ships now, (b) is the
   full vision. The logo in the *email body* is separate and not allowlist-gated.

5. **(Optional, recommended) click/open tracking** — measuring who engaged is core to outreach. This is the
   un-built P3 "7 clicks" feature: extend `app/api/webhooks/resend/route.ts` (handles only `email.received`
   today) to handle `email.opened`/`email.clicked` → write `usage_events.action='open'/'click'`, and enable
   Resend open/click tracking on the send. The `usage_events.action` column already exists.

## Suggested build order (after the design decision + brainstorm)

1. Per-recipient compose loop (reuse `renderGroundedReport({skin:"email", brand})` with each recipient's
   scraped brand) — unit-test the fan-out with 2-3 fixture recipients first.
2. Wire `enrichBrand(domain)` → per-recipient `brand` + `buildArrivalUrl()` for the click-back link.
3. The trigger surface (CLI campaign script is the recommended MVP — model it on `enroll-prospect.mts`).
4. Decide colors-only vs. logo re-hosting for the `/welcome` arrival.
5. (Optional) click/open tracking via the Resend webhook.

## Constraints / gotchas

- **Compliance:** any bulk HTML send needs an unsubscribe token (`{{{RESEND_UNSUBSCRIBE_URL}}}`) — the
  broadcast route enforces it. Honor CAN-SPAM for cold outreach.
- **No operator auth persona exists** — the CLI path sidesteps this; a web page does not.
- **`enrichBrand` confidence can be 0** (scrape failed) — fall back to SWFL house colors or skip, never
  send a broken-brand email.
- **SCOPE moat (CLAUDE.md):** `zip` in the click-back must be in the 6-county set or `/welcome` ignores it.
- **RULE 1:** the Resend webhook + any `/api/*` route are live surfaces → build, then hand the operator a
  diff to push; don't push live-surface changes to `main` autonomously.
- Append a `SESSION_LOG.md` entry before any push (RULE 0, hook-enforced).

## State as of handoff

Branch `claude/main-branch-merge-1e8e31` (commit `a3a7e27`) carries the audit doc + a G2 branding fix.
`main` is clean. Nothing of the outreach engine is built yet — this is greenfield on top of the spine above.
