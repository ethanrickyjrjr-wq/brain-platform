# Shared Email Lab panel + tier capability flags

**Date:** 2026-06-29

**FINAL MODEL (supersedes the per-tier details below):** the tier line is a routing DIAL in
`lib/email/lab/capabilities.ts` — every feature and font is routed `free-only` / `both` / `paid-only`,
the free/paid sets are derived, and `capabilities.test.ts` enforces it. Current routing: **paid-only**
= author engine, grid canvas, photo editor, **social calendar**; **free-only** = classic templates;
**both** = the shared panel (brand, seeds, blocks, photos, Fill-AI). Fonts: the 6 basic = `both`, the
premium fonts = `paid-only`. Any "social calendar = both" note below is superseded — socials is paid-only.

## Problem

There are two Email Lab routes that already use **the same panel design** but ship it as
**copy-pasted JSX in two files**:

- `/email-lab` → `EmailLabShell` (free)
- `/email-lab/grid` → `EmailLabGridShell` (paid "north star")

Both panels render the same sections (Brand via `BrandingBlock`, seed list, `BLOCK_MENU` block
grid, Photos upload + thumbnails, `BlockInspector`, AI textarea + chart pills) with the same
Tailwind. Because the markup is duplicated, a change to a shared section has to be made twice and
the two drift apart. Worse, the free/paid boundary is **implicit** — it lives in which buttons each
file happens to render — so nothing stops a future edit from (a) leaking a paid-only feature into
free or (b) quietly downgrading paid.

## Goal

1. **One panel, driven by capabilities.** Extract the shared sections into a single
   `EmailLabPanel` component. Both shells render it. A shared change is made once.
2. **An enforced tier boundary.** A single typed source of truth defines what each tier gets, and a
   test makes "paid is never weaker than free" and "paid-only never leaks into free" a CI gate — so
   a careless edit goes **red**, not unnoticed. (Operator's explicit ask: breadcrumbs/flags so no
   one builds a paid feature into free or downgrades paid "because they fuck up".)

## What we're building

### 1. Source of truth — `lib/email/lab/capabilities.ts`

```
export type EmailLabTier = "free" | "paid";

export interface EmailLabCapabilities {
  ai: "fill" | "build+fill";          // free = content-patch only; paid = author engine + fill
  socialCalendar: "basic" | "schedule"; // both tiers; paid adds create-in-canvas + Schedule
  classicTemplates: boolean;          // free-only preview rail
  pasteImageUrl: boolean;             // PAID-ONLY
  photoEditor: boolean;               // PAID-ONLY (Filerobot)
  nowEditingFraming: boolean;         // PAID-ONLY ("Now editing" re-target panel)
}
```

- `FREE` and `PAID` are `Object.freeze`d so runtime code can't mutate a tier down.
- `EMAIL_LAB_CAPABILITIES: Record<EmailLabTier, Readonly<EmailLabCapabilities>>`.
- `PAID_ONLY` lists the keys that must be ON in paid / OFF in free, plus the graded ranks
  (`build+fill > fill`, `schedule > basic`) the test compares.
- **Breadcrumbs:** a header comment stating the contract, and `// PAID-ONLY — never enable in free`
  on each gated flag.

### 2. Enforcement test — `lib/email/lab/capabilities.test.ts`

- `paid` is never weaker than `free`: `rank(PAID.ai) >= rank(FREE.ai)`,
  `rank(PAID.socialCalendar) >= rank(FREE.socialCalendar)`.
- Every paid-only boolean is `true` in paid and `false` in free.
- Free's known values are pinned (`ai: "fill"`, `socialCalendar: "basic"`, paid-only flags false).
- Flip any flag the wrong way → test reds before it can ship.

### 3. Shared panel — `components/email-lab/EmailLabPanel.tsx`

Stateless presentation. Owns no state; takes the doc/handlers/brand state from the shell plus a
`capabilities` prop and a `panelHeader` slot. Renders the sections, each gated by `capabilities`:

- AI section — `Fill` always; `Build the email` + status line only when `ai === "build+fill"`.
- Brand — always (already one root: `BrandingBlock`, `/api/user/brand`).
- Start from — seed list passed in by the shell (free: all seeds; paid: grid seeds).
- Blocks — `BLOCK_MENU`; the shell supplies the add handler (end vs grid).
- Photos — upload + thumbnails always; paste-URL only when `pasteImageUrl`.
- Social calendar — when present; `schedule` unlocks create-in-canvas + Schedule (wires to the
  existing `lib/social` scheduler — `scripts/social/run-schedules.mts`, `social-scheduler.yml`).
- Classic templates — only when `classicTemplates`.
- Inspector — `BlockInspector`; wrapped in the "Now editing" framing only when `nowEditingFraming`.

### 4. Wiring

- `EmailLabShell` renders `<EmailLabPanel capabilities={EMAIL_LAB_CAPABILITIES.free} … />`.
- `EmailLabGridShell` renders `<EmailLabPanel capabilities={EMAIL_LAB_CAPABILITIES.paid} … />`.
- Canvas and overall layout stay per-tier (free linear `BlockCanvas`, paid 2D `GridCanvas`) — that
  is the "components will be different" part and is **not** unified here.

## Guardrail summary (the breadcrumb trail)

- One file owns the tier matrix; a test enforces the invariant; inline comments mark each paid-only
  flag; `lib/email/CLAUDE.md` gets a pointer to the contract.
- **To add a feature to BOTH tiers:** add the field to the interface and set it in both `FREE` and
  `PAID`. **To add a PAID-ONLY feature:** add it to `PAID_ONLY` and set it `false` in `FREE` — the
  test then guarantees it never ships enabled in free and never gets disabled in paid.

## Out of scope / context

- **Monetization is unchanged.** Per `lib/email/CLAUDE.md`, "send is the paywall, builds are free":
  this adds **no** build gate, no Stripe, no watermark logic. Capabilities only decide which
  controls a tier renders; how a tier is *assigned* (entitlement) is a separate concern, untouched.
- The two routes stay where they are.

## Verify

- `bunx next build` clean (TS + Vercel parity).
- `bun test lib/email/lab/capabilities.test.ts` green.
- Live-verify `/email-lab` (free) and `/email-lab/grid` (paid) both render exactly as before →
  closes `email_lab_shared_panel_live_verify`.
