# Convergence Plan (06) — Code Audit, 2026-06-20

**Method:** 6 parallel Opus auditors + direct file reads, every claim grounded in committed code on
`main` (`02a9bac`). This reconciles `06-convergenceandjourneys.md` (whose ⬜/OPEN markers had rotted)
against what is actually shipped. **Trust this file over the plan's own status flags.**

## TL;DR

The plan is **~90% built**. Waves 0 and 1 are fully shipped; Wave 3 is mostly shipped (P4 complete).
**Two genuine gaps remain**, plus one one-line asymmetry (now fixed in this commit).

| Item | Plan said | Code says |
|---|---|---|
| W0 engine (G2/G3/G4) | mixed ✅ | **DONE** |
| W1 Piece-1 shell (incl. G5/G6) | OPEN | **DONE** |
| W2 auth spine (`/api/projects/[id]/action`) | OPEN | **DONE** |
| W2 "Ready to send?" closer | OPEN | **NOT DONE — dead-wired** |
| W3 P2 digest + prompt engine | — | **DONE** (cross-project overlap prompt tested-but-unfed) |
| W3 P4 live refresh / guided edit / trash | — | **DONE** |
| W3 P3 feed + change-detection cron | — | **DONE** |
| W3 P3 email click/open tracking ("7 clicks") | — | **NOT DONE — unbuilt** |
| G2 template-run brands project row | — | **was missing; FIXED this commit** |

---

## Wave 0 — engine (DONE)

- **G2 branding on create** — `lib/project/apply-brand.ts` wired on 4 paths: `app/api/projects/route.ts:45`,
  `import/route.ts:57`, `claim/route.ts:119`, `assemble/route.ts:58`. **Asymmetry found + fixed:**
  `app/api/templates/[id]/run/route.ts` inserted the project row with no `branding` and never called
  `applyUserBrandToProject` (it branded only the deliverable). Fixed in this commit — parity restored.
- **G3 scope columns** — written unconditionally: `lib/deliverable/assemble.ts:90-91`; read at
  `email-deliverable.ts:63`; migration `docs/sql/20260616_deliverables_scope.sql`. (File header still says
  UNAPPLIED — stale; builds would 500 if the cols were missing.)
- **G4 build route + MCP thread scope** — web `build/route.ts:58,73`; MCP `project-tools.ts:199` enum
  includes `"email"`, threads scope at `:421,431`. Shared parser `lib/deliverable/parse-scope.ts`.

## Wave 1 — Piece-1 shell (DONE)

- `ProjectDetail.tsx` deleted → `ProjectWorkspace.tsx` + 13 `workspace/*` components.
- Persistent AI: pill mounted root-level (`app/layout.tsx:53`), `app/project/layout.tsx` has **no**
  `key={pathname}` (only a HARD-GUARD comment); per-project `key={project.id}` is on the Workspace, below
  the persistent layer — correct.
- `ui_state`: migration `docs/sql/20260617_projects_ui_state.sql`; PATCH `route.ts:71-77`; read
  `page.tsx:106-107`.
- Card seams `summarize-item` / `group-items` / `reorder` exist, tested (21✓), used by ItemCard/ItemsBoard/Workspace.
- `components/ui/Modal.tsx` → used by `DeliverableModal`. Built + Emailing lanes render; thumbnails mini-render;
  modal opens big in an iframe.
- **G5 seed-on-load** — wired: `page.tsx:215-226` parses `?seed=`, banner+build at `ProjectWorkspace.tsx:368-393`.
- **G6 page load** — loads `email_schedules` (`page.tsx:166-174`) + `ui_state` (`:106-107`).

## Wave 2 — auth spine + J4 closer (PARTIAL)

- **Auth action surface — DONE.** `app/api/projects/[id]/action/route.ts` (PROPOSE→CONFIRM, signed nonce,
  single-use claim, RLS ownership) handles `schedule_send` → `createOrTouchSchedule` and
  `build_deliverable` → `assembleDeliverable`. UI: `workspace/ProjectActionBar.tsx` (authed-gated), mounted
  `ProjectWorkspace.tsx:545`.
- **GAP #1 — "Ready to send?" is dead-wired.** `lib/project/prompt-engine.ts:123` emits the prompt only when
  `signals.sendReady` is true. **No production caller ever sets it** — `BriefcasePanel.tsx:67` calls
  `projectPrompts({ digest, visits })` with no `signals`. The field's own comment says it was gated "until the
  G1 authed action surface exists." That surface now exists; the gate was never opened. Even if surfaced, the
  prompt is a starter string for the **anonymous** `/api/welcome/chat`, which cannot fire a send → would
  dead-end. **The J4 monetizing beat cannot fire today.**
  - *Note (2026-06-20):* the operator redirected this beat — the desired feature is now an **operator-side
    bulk cold-outreach engine**, not the consumer send-flow. See the outreach inventory below. The consumer
    "Ready to send?" wiring is still a real gap but may be deprioritized in favor of the outreach build.

## Wave 3 — widen (mostly DONE)

- **P2 digest + 3+1 prompt engine — DONE.** `digest.ts` built live in `ProjectWorkspace.tsx:329` →
  `ProjectAiContextBridge` → AI context bus; `prompt-engine.ts` (3 situational + 1 offer) surfaced via
  `BriefcasePanel.tsx:67`. It **augments**, not replaces, `lib/briefcase/visits.ts` (still the fallback floor).
  Caveat: cross-project **overlap** prompts (`findOverlap`) are tested but never fed a live `signals`/`overlap`
  argument — same dead call site as GAP #1.
- **P4 live refresh / guided edit / trash — DONE.** `build.ts`, `edit-plan.ts`, `resolve-refresh-items.ts`,
  `version-split.ts` all wired (edit/refresh routes, `page.tsx:163`). `DeliverableEditPanel` mounted in the
  modal. Soft-delete: migration `20260617_deliverables_soft_delete.sql`, `trash/route.ts`, retention-sweep GHA.
  Rebuild keeps the no-invention guarantee (`build.ts:458/469` gateNarrative → lint → strip).
- **P3 feed + change-detection — DONE.** `feed.ts` (writeFeed/readProjectFeed/markFeedSeen) wired into
  import/claim/page/route; migration `20260617_project_feed.sql`. Change-detection cron
  `scripts/project-feed/change-detection.mts` + GHA + `cadence_registry.yaml:858`.
- **GAP #2 — email click/open tracking ("7 clicks") — NOT BUILT.** Spec (`FINAL BOSS/03-piece-3-signal-layer.md:58`)
  requires a Resend webhook → `usage_events.action='click'/'open'`. Reality: `app/api/webhooks/resend/route.ts`
  handles only `email.received` (inbound replies → `buyer_intent_events`); `email.opened`/`email.clicked` are
  ignored; the blast route enables no Resend tracking. `usage_events.action` column exists and is ready.

---

## Operator bulk cold-outreach engine — capability inventory

(The operator's redirected ask: scrape a target brokerage's logo+colors → compose a per-recipient branded
email → bulk-send → click-back lands them on swfldatagulf already showing *their* colors.)

| Capability | Status | Evidence / gap |
|---|---|---|
| **Logo + color scrape from URL** | **EXISTS** | `lib/prospects/enrich-brand.ts:130` `enrichBrand(domain)` → `{primary, secondary, logo_url, company_name, confidence}` (direct HTML fetch + Haiku select). One caller: the `enroll-prospect.mts` CLI. No screenshot/palette; logo is a meta-tag URL, not re-hosted. |
| **Click-back auto-populates colors** | **EXISTS** | `app/welcome/page.tsx:31-103` reads `/welcome?name=&primary=&secondary=&logo=&zip=`; injects `--brand-primary/secondary` CSS vars; pre-brands a project via `/api/prospect/open-project` → `mintClaimToken` → `/claim`. **Caveat:** external logo hosts are dropped by `lib/welcome/logo-allowlist.ts:29` (only `swfldatagulf.com`) → prospect logos won't render until re-hosted to our storage. |
| **Bulk send (Resend)** | **EXISTS (2 paths)** | Broadcast→Segment `app/api/email/broadcast/route.ts` (machine-auth `DIGEST_BROADCAST_SECRET`); batch→addresses `app/api/deliverables/[id]/blast/route.ts` (self-serve, own `contacts`, cap 500). Neither is an operator/ad-hoc-list path. |
| **Per-recipient DIFFERENT brand** | **ABSENT** | Branding is always the *sender's* brand, resolved once per run/blast. No recipient→brand map; blast renders body once, swaps only the unsubscribe link. |
| **Operator outreach surface** | **ABSENT** | No `app/{operator,admin,campaign,outreach}/**`, no campaign/prospect data model, no composer UI (ops dashboard is the separate `swfldatagulf-ops` repo). |

**Reusable spine already present:** `enrichBrand` (scrape) + `buildArrivalUrl` (`lib/prospects/build-arrival-url.ts`)
+ the `/welcome` arrival read + the claim-token brand carry. The net-new work is the **outreach side**: a target
list, per-recipient scrape→brand fan-out, per-recipient branded compose (CAP4 gap), an operator trigger (CAP5 gap),
and logo re-hosting so external logos survive the allowlist.

---

## Recommended next moves (not yet built)

1. **Operator outreach engine** — needs a design decision (operator page vs. a project of the operator's vs. a CLI
   campaign). The scrape + arrival-brand-carry spine exists; the gaps are per-recipient branded compose, an
   operator trigger, and logo re-hosting. Brainstorm before building (RULE 3.5).
2. **GAP #2 email click/open tracking** — mechanical: extend `webhooks/resend/route.ts` for `email.opened`/
   `email.clicked` → `usage_events.action`, enable Resend tracking on the send. Directly useful to outreach
   (who-clicked).
3. **GAP #1 consumer "Ready to send?"** — open the `sendReady` gate + route to the authed action surface; only
   if the consumer send-flow stays in scope after the outreach redirect.
