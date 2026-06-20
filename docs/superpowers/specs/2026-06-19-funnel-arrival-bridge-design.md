# 2026-06-19 — Funnel test-run: enroll → branded arrival → claim bridge → seeded project

**Status:** approved (operator, 2026-06-19). Scope locked to **plumbing only** — no conversational
takeover arc this round.

**Source plan:** `FINAL BOSS/05-funnel-arrival-and-takeover.md` (gaps G-F1 / G-F2 / G-F3).
**Probe done 2026-06-19** (Explore agent, file-anchored). Corrections to the plan, verified in code:

- `lib/email/activation/sequence.ts` `enrollProspect` has **zero production callers** — the funnel
  entry point is unwired, not just the bridge.
- The activation email CTA is a **plain `ctaUrl`** (default `/pricing`, `lib/email/grounded-report.ts:70`);
  it mints **no** claim token.
- `mintClaimToken(items, title?)` (`lib/claim/claim-store.ts:40`) carries **items + title only** — no
  brand, no scope. Only caller today: `swfl_project_handoff` (`app/api/mcp/project-tools.ts:530`).
- `?seed=<template>&scope_kind=&scope_value=` on `/project/[id]` is **fully built** (§I,
  `app/project/[id]/page.tsx:215`) and pre-stages a one-click build (no auto-fire LLM). We reuse it.
- The "project agent on arrival" (qualify→demonstrate→close) is **fully net-new** — `/project/[id]`
  loads data but injects no AI persona. **Deferred** (out of scope this round).

## The spine

The claim token is the **durable carrier** across the unauthed→authed boundary — it already survives
the OTP login round-trip (that is why `claim_tokens` exists). We extend it to carry the prospect's
**brand + seed** so nothing fragile threads through `/login?next=`.

End-to-end test path:

```
enroll-prospect.mts (email, zip, domain)
  → enrichBrand(domain) → enrollProspect(...) → Resend email #1
  → CTA = buildArrivalUrl({name, brand, zip})   [/welcome?name=&primary=&secondary=&logo=&zip=]
      → /welcome (G-F1 reframe): offer copy + "Open your project →"
          → POST /api/prospect/open-project {zip,name,brand}  (reads arrival params)
              → mintClaimToken([], title, {brand, seed:{template:"email",scopeKind:"zip",scopeValue:zip}})
              → /claim?t=<token>
                  → OTP login → POST /api/claim
                      → insert project (brand written into branding) → return {id, seed}
                      → ClaimOnLogin redirects /project/{id}?seed=email&scope_kind=zip&scope_value=<zip>
                          → branded, ZIP-seeded project, weekly-email deliverable pre-staged
```

## Build units

### Unit 1 — G-F2a: claim token carries brand + seed *(load-bearing; touches live claim path)*

- **Migration** (idempotent): `claim_tokens` add `brand jsonb null`, `seed jsonb null`.
- `mintClaimToken(items, title?, opts?: { brand?: ClaimBrand; seed?: ClaimSeed })` — persist `brand`/`seed`.
- `consumeClaimToken` / `peekClaimToken` / `fetchRawClaimItems` return `brand` + `seed`.
- `app/api/claim/route.ts`: on the **winner** insert, if `token.brand` write it into the project's
  branding columns directly (the prospect has no `auth.uid` brand for `applyUserBrandToProject` to
  read — that call stays for direct creates). Return `{ id, seed }` (winner and loser both return the
  same `seed` so a concurrent loser also lands seeded).
- **Types:** `ClaimBrand = { primary?; secondary?; logo_url?; company_name? }`,
  `ClaimSeed = { template: string; scopeKind: string | null; scopeValue: string | null }`.

### Unit 2 — G-F2b: the "open your project" bridge action *(net-new, small)*

- `lib/prospects/build-arrival-url.ts`: add a `zip` param (validated 5-digit) so the arrival URL
  carries scope. Update `build-arrival-url.test.ts`.
- `POST /api/prospect/open-project` (Node runtime): body `{ zip, name?, brand? }` (the brand object
  reconstructed from arrival params). Validates zip is in-scope (reuse the SWFL zip fixture / resolver).
  Builds the seed (`template:"email"`, `scopeKind:"zip"`, `scopeValue:zip`) and a starter title via
  `deriveProjectName`. `mintClaimToken([], title, { brand, seed })`. Returns `{ url: "/claim?t=..." }`.
  Pure logic (seed/title/token assembly) extracted to a tested helper `lib/prospects/open-project.ts`.

### Unit 3 — G-F1: arrival reframe *(copy + CTA)*

- `app/welcome/page.tsx`: read `?zip=`. When present, render the **offer** above the chat:
  *"Your {place} read is ready{, {name}}. Send it to your clients weekly, or make changes?"* +
  a primary **"Open your project →"** button (client component) that POSTs unit 2 and navigates to the
  returned `/claim` URL. `{place}` from the zip→place crosswalk already used by `deriveProjectName`.
- No `?zip=` (or no prospect params) → unchanged market-read demo. No new agent; the data agent serves
  the page.

### Unit 4 — enroll entry point *(fixes "enrollProspect has zero callers")*

- `scripts/email/enroll-prospect.mts`: flags `--email --zip --domain [--dry-run] [--cadence delta|daily-trial]`.
  `enrichBrand(domain)` → `enrollProspect({ email, scope:{zip}, brand }, deps)` with the real Resend
  send and `ctaUrl = buildArrivalUrl({ name: brand.company_name, brand, zip, base: SITE_ORIGIN })`.
  Mirrors the existing `scripts/email/run-activation.mts` wiring (Resend client, env, `--dry-run`).

### Unit 5 — G-F3: 30-day daily cadence *(config / mechanism)*

- `lib/email/activation/sequence.ts`: add `cadence?: "delta" | "daily-trial"` to `ActivationDeps`
  (default `"delta"` — current behavior). `daily-trial` schedules `next_send_at` at +1 day and repeats
  the send up to 30 times (track `step`/count), then `status:"done"`. Mechanism only — its product
  trigger (the "start trial" close button) belongs to the deferred conversational arc; exercised this
  round via the enroll script's `--cadence` flag.

## Testing

- **Unit:** claim-token brand/seed round-trip (`claim-store.test.ts`); `buildArrivalUrl` zip param;
  `open-project.ts` helper (seed/title/token-input shape, in-scope/out-of-scope zip); `daily-trial`
  scheduler (next_send_at progression, 30-cap, terminal status).
- **Gate 5 / pack tests:** none touched (no `refinery/packs/**`).
- **E2E smoke (manual, post-deploy):** enroll script to operator's email → click → branded `/welcome`
  → "Open your project" → OTP login → land on branded, ZIP-seeded `/project/[id]` with a pre-staged
  weekly-email deliverable.

## Out of scope (deferred)

- Conversational qualify → demonstrate → close inside `/project/[id]` (net-new agent design).
- A public web signup form for enrollment (the CLI script is the test-run entry).
- Wiring `daily-trial`'s trigger button (lives in the deferred arc).

## Push discipline

Units 1 + 4-via-`/api/claim` touch the **live claim/auth path** → RULE 1 diff-review before push.
Build + test locally, show the diff, operator pushes. Spec + script-only commits may land normally.
