# 05 — The Funnel: Email → Branded Arrival → Project Takeover

> Grounded in the **existing** prospects/activation code (read 2026-06-17), not a new design. The acquisition funnel
> is already built; FINAL BOSS's job is to connect its arrival to the project workspace. This corrects two blind
> spots in my own `EDITS`/`IMPROVEMENTS` punch lists (noted at the bottom).

## What already exists (file-anchored — stop re-designing it)

- **Brand scrape** — `lib/prospects/enrich-brand.ts`: Firecrawl v2 `branding` + Haiku → `{primary, secondary, logo_url, company_name, confidence}` from a prospect's domain. Never throws; `fallback` on failure. **Built + tested.**
- **Branded arrival, no signup** — `lib/prospects/build-arrival-url.ts` → **`/welcome?name=&primary=&secondary=&logo=`**. The click lands the prospect on `/welcome` already showing **their** name, colors, and logo — purely via URL params, zero auth. Page: `app/welcome/page.tsx` (+ `WelcomeChat`, `ZipHeroInput`, `GroundedAnswer`, …).
- **The funnel email + nurture ("It's Alive")** — `lib/email/activation/sequence.ts`: enroll → assemble the prospect's ZIP report → send branded email #1 → freeze snapshot → days later re-assemble, **diff vs. the frozen snapshot** ("what we showed you vs. now") → email #2 + CTA to the gate. Table `prospect_activation` (`docs/sql/20260613_activation_sequence.sql`); runner `scripts/email/run-activation.mts`; spec `docs/superpowers/specs/2026-06-13-activation-delta-sequence-design.md`.
- **Engagement is already tracked** — the reply sensor is **live**: `app/api/webhooks/resend/route.ts` (`email.received`, Svix-verified) → `processInboundReply` → `buyer_intent_events` + grounded auto-reply + agent alert. Link clicks are trackable via the arrival URL (a hit on `/welcome?…` = a click on our own site). This is **not** greenfield.
- **Email build + recurring send** — `lib/email/grounded-report.ts` + templates + `resolve-brand.ts`; `scheduler.ts` / `recurring-report.ts` / `schedule-command.ts`; `SendWeeklyHandle` on `/p/[id]`.

## Identity model — already decided in code (no new substrate, no persona)

**Email IS the ID.** `prospect_activation` is keyed by **`email`**, not `auth.uid` — so a prospect "has a project and an
ID before signing up" exactly as intended. The branded arrival needs **no** auth. Conversion to a real `auth.uid`
account happens **at the gate** (the activation CTA), reusing the existing claim path (`mintClaimToken` → `/api/claim`).
There is **no** "pre-auth lead vs. RLS hole" decision to make — the code already chose email-keyed prospect rows that
convert at the gate. (My earlier AskUserQuestion on this was redundant.)

**The "30-day daily 9 AM" trial is a *cadence config* on the activation runner**, not new architecture — today it's a
2-step sequence (`intervalDays` default 3); a daily-for-30-days trial is a parameter/loop change to the same runner.

## The initial experience (the actual fold-in — what's NOT built yet)

Today `/welcome` is a branded **market-read demo**. The vision reframes that same surface as **"your project, ready to act on,"** action-first, no fluff:

1. **Arrival copy** — instead of a generic welcome, lead with the offer:
   *"Your {place} read is ready, {company}. Send it to your clients weekly, or make changes?"* + a **Projects** link.
   (The data + brand are already on the page; this is copy + a CTA, not new data plumbing.)
2. **Click → Project takeover** — the Projects link carries the prospect's known scope + brand into `/project/[id]`,
   where the **authed** Project AI takes over: qualifies (*"Which ZIPs do you focus on? Residential or commercial?"*),
   demonstrates on the answer, then closes — **"Create an account,"** or **"no signup yet — we already have your email
   → daily 9 AM trial for 30 days."**

### The three gaps between "built funnel" and "this experience"

- **G-F1 — Arrival framing.** `/welcome` shows a read, not "your saved project you can send/edit." Copy + a send/edit/Projects CTA. *(small)*
- **G-F2 — Prospect → project bridge.** The prospect is an **email-keyed `prospect_activation` row**; the Projects takeover needs it to become (or seed) a real **`projects` row** claimable to an `auth.uid`. Verify whether activation already mints a claim token into the arrival/CTA, or whether that bridge is the net-new wire. *(the load-bearing gap)*
- **G-F3 — Trial cadence.** Add the daily-9 AM-for-30-days option to the activation runner (param/loop), distinct from the 2-step delta sequence. *(config)*

## The two agents (LOCKED by operator 2026-06-17 — supersedes "one assistant, two contexts")

There are exactly **TWO agents**. The **welcome agent is removed.**

1. **Data agent** — attached to the **SWFL data** (lake/brains) **+ some project knowledge.** Serves the whole site, including the `/welcome` branded arrival. This **replaces the killed welcome agent** — whatever the welcome chat (`app/api/welcome/chat/route.ts`) did on arrival folds into this one. Action-first on arrival: one offer + the handoff to Projects, not a conversation.
2. **Project agent** — lives **inside projects** (`/project/[id]`), deeply project-aware (current project + cross-project). Arrives **pre-loaded** with the prospect's known ZIP/brand; qualifies (ZIPs? residential/commercial?) → demonstrates → closes (account, or the no-signup 30-day daily trial).

No separate "welcome AI," no third persona. This **overrides** the "ONE persistent assistant in two contexts — not two bots" language in `00-MASTER-PLAN.md` / `HANDOFF.md`: it is **two agents** — one on data (+ some project knowledge), one inside projects. The earlier "/welcome needs a persona" thread was **mine, and wrong** — dead.

## Corrections this makes to my own punch lists (`EDITS` / `IMPROVEMENTS`)

1. **Click/engagement tracking is not "deferred."** The reply sensor is live and arrival-URL clicks are trackable; Piece-3's "engagement deferred" and my echo of it understate what exists. Reframe as "extend the live reply/arrival signals," not "build from scratch."
2. **The identity-before-signup question is closed.** `prospect_activation` (email-keyed) is the answer; no lead-substrate/RLS decision needed.
3. **Drop the "/welcome persona" thread entirely.**
