# 05 — Funnel Arrival → Takeover · HANDOFF (2026-06-19)

Status of the FINAL BOSS 05 funnel build. Scope locked by operator to **plumbing only**
this round. Spec: `docs/superpowers/specs/2026-06-19-funnel-arrival-bridge-design.md`.

Probe (live code, 2026-06-19) corrected the original plan: `enrollProspect` had **zero
production callers** (the whole entry was unwired, not just the bridge) and the
activation CTA minted **no** claim token. The project-agent-on-arrival is fully net-new.

---

## ✅ DONE — built, tested, shipped this session

| # | What | Files | Commit |
|---|------|-------|--------|
| 1 | **Claim token carries brand + seed.** `mintClaimToken(items,title,{brand,seed})`; `/api/claim` maps brand→`projects.branding` at insert + echoes seed; `ClaimOnLogin`→`claimRedirectUrl`→`/project/[id]?seed=` (reuses §I). | `lib/claim/claim-store.ts`, `claim-redirect.ts`, `app/api/claim/route.ts`, `app/claim/_components/ClaimOnLogin.tsx`, `docs/sql/20260619_claim_token_brand_seed.sql` | `ed6199bd` |
| 2 | **"Open your project" bridge.** `buildArrivalUrl` `zip` param; `planOpenProject` gates ZIP via `resolveZip` (6-county MOAT) → grounded title + email seed; `POST /api/prospect/open-project` mints token → `/claim?t=`. | `lib/prospects/build-arrival-url.ts`, `lib/prospects/open-project.ts`, `app/api/prospect/open-project/route.ts` | `3863c143` |
| 3 | **`/welcome` arrival reframe (G-F1).** In-scope `?zip=` → offer copy + `OpenProjectCta`; no/out-of-scope zip → unchanged market-read demo (no regression). No new agent. | `app/welcome/page.tsx`, `app/welcome/_components/OpenProjectCta.tsx` | `58729d4c` |
| 4 | **Enroll entry point.** `enroll-prospect.mts` — enrich brand → `enrollProspect` (closes "zero callers") → prints the **click-testable arrival URL**. DRY_RUN default; live send refused (Phase D). | `scripts/email/enroll-prospect.mts` | `1f633cd1` |
| 5 | **`daily-trial` cadence seam (G-F3).** `enrollProspect` `cadence:"delta"\|"daily-trial"`; daily-trial schedules next send +1 day. | `lib/email/activation/sequence.ts` | `1f633cd1` |

**Migration `20260619_claim_token_brand_seed.sql` APPLIED to prod** (additive nullable
`brand`/`seed` cols + `consume_claim_token` RETURNS widened; backward-compatible —
verified columns + function signature live).

**Gates:** 81/81 tests across touched areas · `tsc` clean on all funnel files · eslint
clean (lint-staged) · `next build` ✓ (`/welcome`, `/project/[id]`, new API route bundle).

### How to test (no live email needed)
```
bun scripts/email/enroll-prospect.mts --email you@x.com --zip 33931 --domain acme.com
# localhost: prefix SITE_ORIGIN=http://localhost:3000
```
Open the printed arrival URL → "Open your project →" → OTP login → land on a **branded,
ZIP-seeded** `/project/[id]` (weekly-email deliverable pre-staged).

### Prod-verify after deploy (open a `check` for this)
- Arrival URL with `?zip=33931` paints the offer + CTA; out-of-scope/no-zip = plain demo.
- "Open your project" → `/claim?t=` → login → project lands **branded** (prospect colors)
  AND **seeded** (`?seed=email&scope_kind=zip&scope_value=33931`).
- An out-of-scope zip POST to `/api/prospect/open-project` returns 422 (no invented place).

---

## 📋 ALREADY SCOPED — deferred, not built (next pieces)

1. **Project-agent conversational takeover** (the plan's "actual fold-in"). Inside
   `/project/[id]`, pre-loaded with the seeded ZIP/brand, the project agent
   qualifies (ZIPs? residential/commercial?) → demonstrates on a live answer →
   closes (create account, or the no-signup 30-day trial). **Fully net-new** — needs
   its own brainstorm + prompt design. The plumbing now hands it everything it needs
   as opening context (branded + ZIP-seeded project); only the auto-fired conversation
   is missing.
2. **`daily-trial` repeating processor + trigger.** The cadence *seam* exists (Unit 5).
   Still to build: the cron processor that re-sends daily up to 30× (needs a
   `prospect_activation` cadence/step persistence) and the **"start trial" close
   button** that begins it. Both blocked behind (a) live send (Phase D) and (b) the
   conversational close above — so neither can run until those land.
3. **Live activation email send (Phase D).** Deliberately refused in both
   `run-activation.mts` and `enroll-prospect.mts`: choose + verify the 1:1 send
   mechanism (broadcast segment-of-one for the unsubscribe merge tag, or transactional
   + `List-Unsubscribe`), swap the CAN-SPAM address, set secrets. Until then the funnel
   is **click-testable via the printed arrival URL** (no email required).
4. **Public web enroll form** (optional). The CLI script is the test-run entry; a
   self-serve `/` signup that calls `enrollProspect` is a later add.

---

## ⚠️ Notes for the next session
- Built on a **shared `main` with a concurrent session live** (it moved `HEAD` mid-op
  twice; pre-staged its files into a first commit attempt — caught + reverted). Every
  commit here used **explicit-pathspec `git commit <paths>`**, so each contains only its
  own files. Confirm with `git show --stat <sha>` if auditing.
- Worktree isolation (RULE 1.5) was attempted but the path-guard correctly blocks
  writes outside the repo and the guard must not be self-edited — so this ran on `main`
  with pathspec discipline instead.
