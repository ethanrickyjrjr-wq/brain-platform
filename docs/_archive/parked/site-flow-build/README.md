# SITE FLOW BUILD — make the site actually connect

One file = one Claude's complete job. Hand each file to a separate session. This folder fixes the
**connectivity** problem: pages exist and buttons work, but most pages are unreachable by clicking.

**Diagnosis source of truth (already produced, read-only, in repo):**
- `runs/connectivity-map.py` → `runs/connectivity-map.json` — every route classified `IN-CHROME / body-link-only / ORPHAN` with the exact source file. **Re-run anytime:** `python runs/connectivity-map.py`.
- `runs/crawl-site-flow.py` (crawl4ai) → live logged-out reachability; `runs/crawl-keepkill.py` → rendered content of retire candidates.
- graphify app-plane (refreshed) — `graphify query "page routes"` for ongoing page↔component↔route diagnosis.

## The problem in one screen (code-derived, all 37 routes)

`ROUTES: 37 | in-chrome: 11 | body-link-only: 10 | ORPHAN: 16` — and even the 11 "in-chrome" lie:
`/privacy`+`/terms` are linked only from a footer that renders on **home alone**, and `/p/[id]` only from the floating pill.

**5 roots (fix these, not the 16 leaves):**
1. **R1 — two top bars that share zero destinations.** `Header` (home only, all `#`anchors) vs `GlobalNav` (everywhere else, app tabs). `GlobalNav` self-hides on `/` → **home is a sealed island** (links out only to `/privacy`,`/terms`,`#waitlist`).
2. **R2 — primary nav under-exposes.** 3 tabs for ~15 public surfaces; no grouping; the long tail (`/map`,`/showcase`,`/ask`,`/alerts`,`/demo`) is invisible.
3. **R3 — footer is home-only and isn't a sitemap.** No footer off home → no orphan safety-net + **no legal/privacy link on any app page** (compliance gap).
4. **R4 — no orphan guard.** Nothing stops a new `page.tsx` shipping with no inbound link — the mechanism that made 16 orphans.
5. **R5 — journey terminals dead-end.** `/p/[id]` has no "back to project"; `ProjectActionBar` prints a non-clickable `/p/{id}`; `/demo` + bare `/welcome` have zero forward CTA.

Two non-nav journey gaps (handled in B5): **social posting is backend-only/invisible** (U1–U4 unbuilt) and the **per-user email send cron is paused**.

## Who builds what

**Opus** = cross-cutting + auth/white-label judgment + new component design. **Sonnet** = contained, file-isolated, mechanical edits + a node port of an existing python script.

| File | Build | Model | Brainstorm (RULE 3.5)? |
|---|---|---|---|
| `B0-orphan-guard.md` | Port `connectivity-map.py` → `scripts/check-orphans.mjs` + push hook + allowlist | **Sonnet** | tooling — optional |
| `B1-unified-site-shell-and-footer.md` | ONE `SiteShell` on every page (incl. home) + global `SiteFooter` sitemap | **Opus** | **REQUIRED** — design the shell |
| `B2-grouped-nav-and-breadcrumbs.md` | Grouped `Explore ▾` nav + breadcrumbs on `/r/*`,`/project/*` + active state | **Sonnet** | light — optional |
| `B3-close-the-loops.md` | `/p` back-link · `ProjectActionBar` navigates · `/demo`+`/welcome` CTAs | **Sonnet** | light — optional |
| `B4-signed-in-home-base.md` | Logo/home base for signed-in users (minimal or `/home` dashboard) | **Opus** | **REQUIRED** if full dashboard |
| `B5-post-and-email-surfacing.md` | Mount Social lane (after U4) · email-cron go-live · surface Send/Contacts | **Opus** | per-piece |
| `B6-cleanup-and-retire.md` | Keep/kill `/ask`·`/demo`·`/data-intel`; relocate `/ops/*`; document by-design orphans | **Sonnet** | decisions — operator |

## What can run together — concurrency waves

Only real conflicts are same-file edits or a hard dependency. **B1 owns all nav/layout/footer files; everything that touches nav waits on it.**

### WAVE 1 — start now (up to 3 Claudes, disjoint file sets)
- **B0** (Sonnet, `scripts/` + `.claude/hooks/` only) ‖ **B1** (Opus, nav+layout+footer) ‖ **B3** (Sonnet, `app/p`,`ProjectActionBar`,`app/demo`,`app/welcome` — none of B1's files).
- If run as **concurrent live sessions**, isolate each in a `node scripts/worktree.mjs new <label>` worktree (RULE 1.5) — or run B1 alone on `main` and do B0/B3 sequentially. Single session → just do them in order, explicit-path staging.

### WAVE 2 — after B1 lands (2 Claudes)
- **B2** (Sonnet) then **B4** (Opus). Both touch the `SiteShell`/`NAV_GROUPS` B1 created → **sequence B2 → B4** (or B4 only edits the `homeHref` seam B1 exposes). Don't run them on the shell file simultaneously.

### WAVE 3 — gated/deferred
- **B5** — blocked on SOCIAL BUILD `U4` + payments/app-review + operator email go-live.
- **B6** — after operator confirms keep/kill; re-crawl each candidate before any deletion.

| Cannot run together | Why | Fix |
|---|---|---|
| B2/B4/B5 ✕ B1 | all edit `SiteShell` / `NAV_GROUPS` | B1 merges the shell + seams first |
| B2 ✕ B4 | both edit the shell | sequence B2 → B4 |
| B5 ✕ SOCIAL BUILD `U4` | both edit `app/project/[id]/page.tsx` + `DeliverableLanes` | U4 first; B5 re-probes |
| B3 ✕ B1 | **none** — disjoint files | safe to parallelize |

## Cross-build seams (the named contracts — rename → update this README same commit)
- **B1 exposes:** `<SiteShell>` (auth-aware, one nav), `<SiteFooter>` (sitemap), `NAV_GROUPS` (nav data), `homeHref(user)` helper, `SHELL_HIDDEN_PREFIXES` (= `/p/`, `/embed/`, `/login`, `/auth` — must match `lib/briefcase/pill-mount.ts:37` + the old `GlobalNav.isHiddenPath`).
- **B2** extends `NAV_GROUPS` (Explore group) + adds `<Breadcrumbs>`. **B4** repoints `homeHref`. **B5** adds a "Social/Send" entry to `NAV_GROUPS`. **B0**'s allowlist must equal the by-design orphan set below.

## By-design URL-entry routes (NOT bugs — B0 allowlists these)
`/embed/*` (iframe fragments) · `/welcome` + `/claim` (email/funnel arrival) · `/login` + `/auth/auth-code-error` (auth) · `/c/[id]` + `/d/[...slug]` (share/print-only) · `/m/contacts/[token]` (tokenized manage) · `/ops/data-inventory` (operator — but B6 relocates it).

## Every file's done-bar (house rules)
- Gates before push: **`real-tsc` 0** (run alone), **eslint clean**, **`next build` ✓**, relevant **`bun test` green**. New dep → `bun install` + commit `bun.lock` same push (lockfile gate).
- `SESSION_LOG.md` top-of-file entry on push. Stage only your own files (**explicit paths, never `git add -A`** — RULE 1.5). **No autonomous push** — show the diff, the operator pushes.
- **Probe first (RULE 0.5):** re-read the file:line anchors in your brief before editing — they were captured 2026-06-20 and may have drifted. graphify/grep, don't assume.
- **Preserve the white-label rule:** `/p/*` and `/embed/*` stay chrome-free (no nav, no footer, no pill). Breaking this leaks SWFL branding into a broker's client-facing deliverable.

## Decisions — operator calls (2026-06-20)
1. `/data-intel` — **OPEN.** 21KB **internal** coverage doc currently public. Rec: `noindex` + keep out of customer nav (or move under the ops repo like `data-inventory` was).
2. `/demo` — **RESOLVED: keep STANDALONE, do NOT put it in the top nav** (revisit later). It may be **footer-listed** so it stays connected (not an orphan), but never a primary tab. B1/B2/B6 reflect this.
3. `/ops/data-inventory` — **RESOLVED + DONE.** Removed from brain-platform. The canonical, more-evolved copy already lives in the `swfldatagulf-ops` repo (`app/data-inventory/`, with `section-actions.tsx` + a newer `_data.ts`); brain-platform's was a stale orphan dup.
