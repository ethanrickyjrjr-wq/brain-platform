# Briefcase Everywhere — Master Plan

**Status:** A planned (audited, correct) · **B planned** (this folder) · C = kickoff brief only.
**Created:** 2026-06-15. **Scope of this folder:** planning docs only — zero app/MCP/lake code.

## What this is

"Briefcase Everywhere" closes three gaps in the already-working Briefcase + Assembly engine:

1. **It's invisible** — the briefcase only exists on `/r/*`. → **Plan A (Front Door).**
2. **The MCP conversation evaporates** — work in the user's own Claude has no path back to the web.
   → **Plan B (Carry-Back Bridge).**
3. **We can't safely reconcile** a user's-AI numbers against ours. → **Plan C (Reconciliation Engine).**

Built in order: **A → B → C.** A is audited and correct (its files here are a faithful
decomposition). **B is fully planned here** from an in-session codebase audit (3 Explore passes + 1
adversarial Plan pass). **C gets a getting-started brief only** — it starts its own brainstorm cycle.

The funnel the three plans serve: **use it free in Claude → want to save/share → handoff → claim →
account → eventually pay for the send/deliver side.**

## The DECIDED paywall ladder (operator-confirmed)

Every free rung is cheap to us; every paid rung is where value crystallizes.

| Rung | Surface | Cost to us | Gate |
|---|---|---|---|
| **0 — Try (anon)** | Browse `/r/*`, `/charts`, highlighter ask, welcome chat, example deliverables | ~0 (already public) | none |
| **0 — MCP (free forever)** | `claude mcp add` → cited data inside their own Claude | storage + tiny LLM (runs on *their* plan) | none (bearer stays OFF for free tier) |
| **1 — Build here (free, 30-day trial)** | `/project/*` build → `/p/[id]` deliverable | LLM build run + storage | auth wall (sign up) + trial window from first build |
| **1 — Builds after trial** | same, but **watermarked** (brand + `/p/` URL + freshness token ride along) | LLM build run | auth wall only |
| **2 — Branded send (PAID)** | email / clean unwatermarked / branded PDF | send + brand | money wall, MCP-connected discount |

**Rationale (don't fight screenshots):** a screenshot is a dead, un-refreshable, un-cited snapshot,
so we watermark all free builds and leaked screenshots become marketing. **Meter builds and sends,
never views.** The 1-month trial is a single per-account timestamp (first build), so v1 needs no
per-count metering — only uid-attribution (A Task 8.5). **MCP-connected = discount, detected
automatically** because the MCP identity already keys to the account uid (see "Shared identity lock").

## Audit verdict (corrections that shaped these plans)

The drafted plan was ~90% accurate; the architecture (dependency order, three-lane contract,
free/paid wedge) all held. Load-bearing corrections, verified against live code:

1. **A's refactor caller list was wrong** → grep-driven, move set = `Briefcase.tsx`,
   `HighlightPopup.tsx`, **`AskAiDock.tsx`** (the missed consumer); **drop `use-highlight.ts`**.
2. Line numbers drift — lazy-init is `lib/highlighter/context.tsx:149-151`; move only
   `draftItems/fileItem/removeItem/draftNearCap`.
3. Template ids correct ✅ (`market-overview, bov-lite, client-email, one-pager`).
4. Metering claim stale — welcome-chat weekly cap is already wired; Task 6 step 3 = flip
   `WELCOME_CHAT_FREE_WEEKLY_CAP`, not write code.
5. Seed blocker milder — `deliverables.user_id` is `uuid NOT NULL`, **no FK** to `auth.users`; a
   reserved sentinel UUID via service_role is safe (add `is_example` for analytics hygiene).
6. No-invention guarantee holds ✅ — `lintDeliverableNarrative` is in `lib/deliverable/build.ts`.
7. MCP/auth surfaces verified ✅ — and B's central premise was **inverted** (see below).

## Plan B — the inversion finding + locked decisions

**The audit assumed B must *bind* an MCP identity to a web account. It does not.** Verified:
`X-Project-Key` → `projects.mcp_key` → `projects.user_id`, and `projects.user_id` **is a real
`auth.uid`** (RLS `FOR ALL USING (auth.uid() = user_id)`). So a project-key MCP user is **already a
logged-in account**; the genuinely-evaporating case is the **anonymous `swfl_fetch` user**. No
binding table is needed.

Five locked decisions (full detail in `B/README.md`):

1. **Capture = explicit handoff** (new keyless `swfl_project_handoff` tool); `swfl_fetch` stays
   read-only and **untouched**.
2. **Account at CLAIM time** (existing OTP login + `next=`), never a credential-less account at
   handoff.
3. **Transport = short-TTL `claim_tokens` table** (opaque single-use token; atomic UPDATE-guarded
   consume), not signed-payload-in-URL.
4. **Identity = derive, no binding table** (`isMcpConnected` = `mcp_key` + an `mcp:<uid>` meter row).
5. **One identity** (`auth.uid`) shared with A's Task 8.5.

## Model-assignment verdict

- **Plan A:** SONNET overall; **OPUS on Task 2** (the refactor — blast-radius judgment, caller list
  was wrong) and **Task 8.5** (meter spine + migration). Task-5 create-gate downgraded to SONNET.
- **Plan B:** OPUS on the security-critical path (claim token store, handoff tool, consume+insert
  route); SONNET on the `/claim` UI, the RESPONSE_CONTRACT nudge, the derive helper, and tests.
- **Plan C:** OPUS (anti-hallucination correctness + blast radius); SONNET on the resolve UI. C is
  bigger than scoped — it must build the freshness-TTL substrate first.

## Shared identity lock (spans A + B + C)

There is **ONE** identity: `auth.uid`. The MCP already writes `mcp:<uid>` to `usage_events`
(`mcp:<uid>` == `projects.user_id` == `auth.uid`). A's Task 8.5 makes web build/deliver events
uid-keyed off the same value. B's claim flow creates the project under the same `auth.uid`. **No plan
invents a parallel identity scheme.** "MCP-connected" (for the rung-2 discount) is derivable, not a
new table.

## Out of scope for A (named Tier-2 follow-ons)

Watermark render on `/p/[id]` + PDF; trial-expiry enforcement block; checkout vendor pick; the
MCP-discount price. A lays the funnel + substrate so these are **config/feature flips, not refactors.**

## Index

- **`A/`** — Plan A (Front Door): `A/README.md` + tasks 1–9 (incl. 8.5).
- **`B/`** — Plan B (Carry-Back Bridge): `B/README.md` + tasks 1, 2, 3a, 3b, 4, 5, 6.
- **`C/`** — `C/GETTING-STARTED.md` (kickoff brief — start C's own brainstorm here).
