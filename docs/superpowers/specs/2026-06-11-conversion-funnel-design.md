# Conversion Funnel — Email → Landing → Pay → Seeded Project (Design Spec)

**Date:** 2026-06-11 · **Status:** Approved framing + Phase-1 spec. Not built. PDF ingest + "ask-for-data" deferred to follow-ups.

> Scope note: this is the durable, in-repo copy of the approved brainstorm (the machine-local plan file is not on the cross-session git bus). It maps the full funnel against today's capabilities, flags every hole, records the resolved product forks, and specs the first shippable slice. Per RULE 3.5, each phase gets its own brainstorm/plan when built. Nothing here is "confirmed working" — that is the operator's job.

> **Scope boundary.** The `docs/email-marketing/` folder owns the **email** (compose, send, list, reply, white-label template, copy rules). **This spec owns everything after the click** — landing preview → brand → pay → seeded project. The email earns the click; this funnel earns the seat. Two separate build tracks on purpose.

## Context

The daily-digest email backend is mostly built (the "Email Digest — Finish to Live" plan covers Stage 0). The open question is everything *after the click*: where an email prompt lands, how a cold reader becomes a paying customer, and how they end up "with their first project already started." The spine for that already exists in this codebase — the net-new work is a conversion landing, a Stripe gate, a Brandfetch call, and three small fixes.

**External calls verified in-session (Rule 1):** Stripe Apple-Pay-on-web + recurring (`docs.stripe.com/apple-pay?platform=web`), Stripe Customer Portal cancel-anytime (`docs.stripe.com/customer-management`), Brandfetch Brand API `GET /v2/brands/domain/{domain}` (`docs.brandfetch.com/reference/brand-api`), NABOR 7,000+ members (nabor.com), SWFL CRE directory (swfloridabusinesstoday.com). **Brandfetch pricing/quota was NOT in the docs — verify the free/builder tier live before wiring.**

## The funnel, stage by stage

| # | Stage | What happens | Today |
|---|-------|--------------|-------|
| 0 | **Email** | Daily digest, white-label, prompt deep-links | `[~]` backend built; `DigestEmail.tsx` + `build-digest.mts` unbuilt |
| 1 | **Click lands** | Prompt → a great SWFL experience | `[x]` `/ask?q=` LIVE; `/r/zip-report/[zip]` LIVE |
| 2 | **Personalized preview** | Their ZIP report pre-rendered + prompts + chat + CTA | `[ ]` **NEW** (thin wrapper over existing zip-report data) |
| 3 | **Limit / abuse** | Stop infinite free use | `[x]` `sdg_cid` cookie + IP rate-limit exist; **paywall is the real gate** |
| 4 | **Brand it** | "Load their branded setup" → logo/colors | `[~]` branding blob exists (manual); auto-extract MISSING |
| 5 | **Pay** | Checkout → entitlement | `[ ]` **MISSING — zero payment integration today** |
| 6 | **Seeded project** | Land on /project with a deliverable already built | `[~]` flywheel `/api/templates/[id]/run` EXISTS; needs starter template + webhook wiring |
| 7 | **Ask for data** | Request what we don't hold | `[ ]` MISSING — **deferred to follow-up** |

**The spine already exists:** Projects (RLS by `auth.uid()`), the deliverable engine (`lib/deliverable/*`: freeze → bind live brain → narrative + lint → render `/p/[id]`), the templates flywheel (`/api/templates/[id]/run`), the branding blob (`lib/deliverable/brand-theme.ts`), grounded chat (`/api/converse`), and email→`/ask` deep-links.

## Resolved forks

1. **Landing = constrained preview → pay.** Their ZIP report rendered + 3–4 pre-generated prompts + one "make it mine" CTA. No open anonymous "build anything" engine.
2. **Landing chat = existing `/api/converse`.** It *talks about* the report (grounded, no-invention). On a build/change request it answers *"I can't build projects here — sign up and you can →"* (system-prompt line + CTA chip). "Produce it" stays the paid in-product experience (`AskAiDock` in `/project`).
3. **Branding = logo-first auto-extract (Brandfetch from domain); manual form as floor; PDF deferred.** "Logo in the first email" is the wow and the cheap path.
4. **Payment = Stripe** (single answer to the Apple question), subscription mode + cancel-anytime portal.

## Payment strategy (the Apple question, answered)

Stripe covers all of it with one integration — no native app, no Apple 15–30% cut:
- **Apple Pay on the web** via Stripe Checkout (verified): register the domain with Apple through Stripe, Safari 17+/iOS, recurring supported via Apple Pay merchant tokens. Delivers the Face-ID "Apple experience."
- **Cancel-anytime** = **Stripe Customer Portal** (verified): hosted self-serve cancel (immediate or end-of-period), update card, invoices — zero UI to build.
- **People without Apple** = same Checkout shows Google Pay, Link, and cards. One flow.
- **Apple App Store subscriptions (IAP) are a different thing** — native-app-only, take Apple's cut, unusable from a web app. Not needed. If native iOS ever ships, bridge with RevenueCat then.
- **MoR alternatives (Paddle, Lemon Squeezy)** auto-handle global tax but add cost; for a US-only SWFL audience, Stripe is simpler.

**Recommendation:** Stripe Checkout, subscription mode, Apple Pay + Google Pay + cards, Customer Portal for cancel. Price is the operator's call ($39–79/mo per the `smallest_paid_path` check); entitlement model stays simple enough to also support a one-time "first project" entry.

## Branding / PDF strategy

- **Market justifies it:** NABOR (Collier) 7,000+ Realtors; Lee/Charlotte/Sarasota boards add several thousand → **15,000+ SWFL agents**, plus a standing CRE-broker directory. Real TAM for a $39–79/mo branded tool.
- **Logo-first (Phase 2):** Brandfetch `GET /v2/brands/domain/{domain}` (bearer token) returns logo (SVG/PNG, dark/light), accent/dark/light/palette colors, and fonts from a domain → straight into the existing `branding` blob (`primary_color`/`accent_color`/`logo_url`). Verify free/builder tier + 429 quota live; Firecrawl branding-extraction is the fallback vendor.
- **PDF parsing (Phase 3, optional):** PDF-native extraction beats vision; vector logos need real tooling; multipage flyers hurt accuracy. Reserve for agents with a flyer but no website — Claude vision reads agent/contact/colors, logo pulled from the PDF's embedded images (not a re-rendered screenshot).
- **Floor:** polish the manual branding form (color pickers + logo upload to the existing private `project-uploads` bucket; half-exists in `ProjectDetail.tsx` `BRANDING_FIELDS`).

## Holes

**Blocks Phase 1 (fix in the slice):**
- No payment integration at all (Stage 5). Build.
- **`project_templates` migration missing** — `app/api/templates/*` reads/writes the table but no `docs/sql/*project_templates*.sql` exists; the flywheel 500s until it lands. Create + run directly (RULE 1).
- **Deliverable Build button disabled** — `ProjectDetail.tsx` ~line 325 `// TODO(S6)`; `/api/projects/[id]/build` route already exists, button has no onClick. Wire it.

**Investigate (may not block):**
- `PATCH /api/projects/[id]` save hang for auth'd users — handler looks correct; likely network/Supabase-connection layer. Reproduce + instrument before the paid path depends on saves.

**Deferred follow-ups:**
- PDF brand auto-extract (Phase 3). "Ask for data" capture (`data_requests` table + button + MCP `swfl_suggest_data` tool). Anonymous live-edit/build is intentionally not built (stays paid in-product).

## Build order

### Phase 1 — End-to-end funnel slice (build first; in our own brand, no Brandfetch yet)
1. **Conversion landing** `app/preview/[zip]/page.tsx` — reuse the zip-report data fetch (`fetchBrain` / zip-dossier) for housing + flood read; 3–4 pre-generated prompt buttons (→ `/ask?q=…&r=…`); inline grounded chat (`/api/converse`); one "Make this mine — sign up & build →" CTA; quote the freshness token.
2. **Chat upsell gating** — one converse system-prompt line + UI chip so build/change requests answer *"sign up to build →"*.
3. **`project_templates` migration** + seeded **"Starter — ZIP Market One-Pager"** template (recipes over `housing-swfl` + `env-swfl`, `scope_type: "zip"`).
4. **Stripe Checkout (subscription)** — Apple Pay + Google Pay + cards; register domain with Apple via Stripe; success/cancel URLs.
5. **Stripe webhook** `app/api/stripe/webhook/route.ts` → on `checkout.session.completed` / `customer.subscription.created`: write an entitlement row, then auto-run the flywheel (`instantiateTemplate` → create project → `assembleDeliverable`) seeded with their ZIP → store `/project/[id]`.
6. **Land** on `/project/[id]` with the deliverable already built (`/p/[id]`). Wire the disabled Build button while here.
7. **Customer Portal** link in `/project` for cancel-anytime.

### Phase 2 — Logo-first branding (fast-follow)
Brandfetch domain → branding blob. From there, two consumers, two paths — both off the same blob:
- **Preview landing + web deliverable charts:** `extractBrandTheme()` → `toChartTheme()` (existing path in `lib/deliverable/brand-theme.ts`).
- **The email:** `extractBrandTheme()` returns a `BrandTheme` (`{primary, accent, logoUrl}`) that drops straight into `DigestEmail`'s `theme` prop — built themeable in the email digest plan (`docs/superpowers/plans/2026-06-11-email-digest-phase1.md`, Task 4). The email defines its own structurally-identical `BrandTheme` in `scripts/email/types.ts` to stay free of the chart-registry deps; no adapter needed. **This `theme` injection is the only point where the funnel touches the email track.**

### Phase 3 — Follow-ups (deferred)
PDF upload auto-extract; "ask for data" capture.

## Critical files

**New (Phase 1):** `app/preview/[zip]/page.tsx` + client preview/chat component · `app/api/stripe/checkout/route.ts` · `app/api/stripe/webhook/route.ts` · `docs/sql/<date>_project_templates.sql` · seeded starter template row.
**Reuse (do not rewrite):** `lib/deliverable/*` · `app/api/templates/[id]/run/route.ts` · `app/api/converse/route.ts` · `app/r/zip-report/[zip]/page.tsx` · `lib/fetch-brain.ts` · `lib/rate-limit.ts` + `sdg_cid` cookie · `app/login/*`.
**Fix:** `app/project/[id]/ProjectDetail.tsx` (wire Build button) · `app/api/projects/[id]/route.ts` (PATCH hang).
**Config:** `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `BRANDFETCH_API_KEY` (Phase 2) via `gh secret set`; Apple Pay domain registration in the Stripe Dashboard.

## Verification (operator confirms — not the agent)

1. `bun test` green for any new pure logic (entitlement mapping, starter-template recipes).
2. `/preview/33908` renders the ZIP read + freshness token; prompts open grounded answers; chat refuses to build with the sign-up chip.
3. Stripe test mode: Checkout with Apple Pay (Safari) and a test card → webhook fires → entitlement written → project + deliverable created → redirect to `/project/[id]` with `/p/[id]` viewable.
4. Customer Portal cancels the test subscription.
5. (Phase 2) A real agent domain → Brandfetch logo/colors → preview + email re-theme.
6. RULE 0/2 on push: SESSION_LOG entry + build-queue `[~]→[x]` + reconcile `smallest_paid_path` / open a `data_requests` check.

## Trackers
- `smallest_paid_path` check (open) is exactly Phase 1's paid path — close on the first live paid → seeded-project round-trip.
- Build queue: add a "Conversion Funnel (Phase 1)" item when build starts.
