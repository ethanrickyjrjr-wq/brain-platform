# B4 — Signed-in home base · **Opus** · WAVE 2 (after B1) · OPTIONAL / deferrable

**Goal:** a logged-in user's logo/home click should land on a surface that ties their tools together — not the
marketing island. Today the logo always → `/` (the funnel), and `/project` is only a bare project list that
surfaces neither Charts, Alerts, Search, nor Contacts. **Depends on B1's `homeHref(user)` seam. Sequence after B2**
(both touch the shell). **Brainstorm required only if you build the full dashboard.**

## Two scopes — pick with the operator
- **Minimal (cheap, ~½ day):** repoint `homeHref(user)` → `/project` for signed-in users, and enrich the `/project` list header (`app/project/page.tsx`) with quick links to Charts / Search / Alerts / Contacts. No new route.
- **Full (`/home` dashboard, ~1–2 days):** new `app/home/page.tsx` (auth-gated like `/project` in `middleware.ts`) surfacing: recent projects, latest charts, open alerts, contacts count, and a "new project" CTA. `homeHref(user)` → `/home`. Promote `/home` into `NAV_GROUPS`.

## What exists
- B1's `homeHref(user)` + `NAV_GROUPS` (re-read). `app/project/page.tsx` (the current de-facto home base — bare list + `NewProjectButton` + a buried Alerts text link ~:44). `middleware.ts:121-132` gating pattern to copy for a new auth route.

## Preserve
- Logged-OUT logo still → `/` (marketing). Only signed-in users get the home base. Don't break the funnel.

## Acceptance
- Signed-in logo/Home lands on a surface linking Projects + Charts + Search + Alerts + Contacts.
- Logged-out unchanged. `middleware` gates `/home` (full scope). `real-tsc` 0 · eslint · `next build` ✓ · `bun test`.

## Gates
Standard done-bar. `SESSION_LOG.md` · explicit-path staging · no autonomous push. If full dashboard → `superpowers:brainstorming` first.
