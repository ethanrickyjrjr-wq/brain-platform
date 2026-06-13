# Welcome-Arrival Conversion Funnel — Phase 3 carry-forward notes

**Status: PRE-BRAINSTORM NOTES. NOT a spec, NOT a status board.** Raw decisions + ideas
captured 2026-06-12 to seed a future `superpowers:brainstorming` session. Do **not** build
directly from this — it exists so the good ideas from the Phase 2 design session survive to
the Phase 3 brainstorm. Open obligation tracked in the `checks` ledger
(`phase3_welcome_funnel`).

Built on top of Phase 2 (`docs/superpowers/specs/2026-06-12-welcome-arrival-phase2-design.md`):
`enrich-brand.ts` (hybrid), `build-arrival-url.ts`, un-grounded explainer `/api/welcome/chat`.

---

## The moment (the whole product demo in one screen)

Email signup → **20 chat turns + one free branded build per email**. User describes what they
want in chat ("show me flood risk for Cape Coral") → the **grounded deliverable engine** builds
a REAL, cited SWFL one-pager rendered with **their logo + brand colors** (Phase 2 enrichment
fires here) → "Want this delivered to your clients every week? → /pricing". No sales call —
they just saw exactly what their own clients would receive.

The free build is what makes enrichment *earn its keep* — it's not background hygiene, it's the
thing that makes the conversion moment feel personal.

## Locked corrections (from the 2026-06-12 design session — do not re-litigate)

1. **The free build routes through the GROUNDED engine, never the chat LLM.** The un-grounded
   chat must not generate SWFL numbers — that would invent flood/AAL figures and break the #1
   moat (the system structurally cannot invent a SWFL number below the grain we hold), and a
   made-up number on an agent's logo is a brand-killer on first check. Chat = explain + steer;
   `assembleDeliverable` / the template flywheel = the real cited deliverable. This makes the
   demo *more* impressive (real numbers), not less.
2. **Chat system-prompt seeds = illustrative capability ranges, NOT hardcoded current stats.**
   A hardcoded `33931 = $30,074/yr AAL` becomes a stale precise number quoted as current the
   day the lake updates — exactly what data-protocol v3 forbids. Precise cited figures come
   ONLY from the grounded build (which quotes a live freshness token).
3. **Two enrich-brand callers, named explicitly.** (a) cold-outreach caller — genuinely
   deferred until email is firing at prospects; (b) welcome free-build caller — THIS funnel,
   fires `enrichBrand(emailDomain)` at the conversion moment.

## Components to design in the Phase 3 brainstorm

- **`welcome_sessions` table (Supabase).** Identity: anon `sdg_cid` cookie pre-email → bound
  `email` post-gate. Fields (sketch): `id`, `cid`, `email`, `turn_count`, `free_build_used bool
  default false`, `brand jsonb` (cached enrichment: primary/secondary/logo/confidence),
  `created_at`, `updated_at`. Writes come from a service-role route (anonymous users — NOT an
  `auth.uid()` RLS table).
- **Turn-4 email gate.** Capture email at turn 4 of the chat before continuing.
- **20-turn cap** per session/email, **server-enforced**, tied to `cid` cookie + IP so clearing
  cookies can't reset the counter.
- **The one free branded build.** Gated by `free_build_used` via **transactional check-and-set**
  (`UPDATE welcome_sessions SET free_build_used=true WHERE email=? AND free_build_used=false
  RETURNING …`; 0 rows → already used) to kill the double-click race — same idempotency shape as
  the email cron's `FOR UPDATE SKIP LOCKED`. Routes through the grounded engine seeded with the
  user's ZIP/topic + their enriched brand tokens.
- **Abuse gate.** `free_build_used` keyed by email is farmable with throwaway gmails and each
  build costs real money (enrichment + engine + render). Layer email gate + `sdg_cid` cookie +
  IP rate-limit (reuse `lib/rate-limit.ts`) so one person can't farm free builds.
- **Enrich from the email domain** (zero friction — `jane@premiersothebysrealty.com` → their
  brand, no "what's your website" prompt).

## OPEN DECISION for the Phase 3 brainstorm (operator-flagged)

**Freemail signups (gmail/yahoo/aol — the majority of small agents) have no brandable domain.**
Decide: silent SWFL defaults **vs** a message — "we'll personalize this when you connect your
work domain." Operator leans the **latter**: it's a stronger conversion hook (advertises the
branding feature exists) **and** it saves a Firecrawl + Claude call on every freemail signup
(don't burn enrichment credits on `gmail.com`). Lock this in the brainstorm.

## Reuse / reconcile

- Existing conversion-funnel design `docs/superpowers/specs/2026-06-11-conversion-funnel-design.md`
  (Stripe checkout, preview, seeded project). **Vendor reconcile:** that spec named Brandfetch;
  we picked the **Firecrawl `branding` + Haiku hybrid** in the Phase 2 bake-off — carry the
  hybrid forward.
- Deliverable engine `lib/deliverable/*`, template flywheel `/api/templates/[id]/run`, grounded
  chat pattern `/api/converse`.
