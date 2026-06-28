# B0 — Orphan guard (the permanent diagnosis) · **Sonnet** · WAVE 1 · independent

**Goal:** make orphan pages a build-time error, so the site can never silently disconnect again. Port the
working python analyzer to a node script + a push hook. **Owns only `scripts/` + `.claude/hooks/` + `package.json`.**
Zero overlap with B1/B3 → run in parallel.

## What exists (reuse, don't reinvent — RULE 0.5)
- `runs/connectivity-map.py` — already classifies all 37 routes `IN-CHROME / body-link-only / ORPHAN` with source files. **This is your spec.** Re-run it (`python runs/connectivity-map.py`) and match its output exactly.
- Hook style to mirror: `.claude/hooks/check-no-branch-create.mjs` (PreToolUse Bash, fail-open, `block()` with exit 2) and `.claude/hooks/check-prepush-gate.mjs` (the multi-gate push guard).

## Build
1. **`scripts/check-orphans.mjs`** (node, no python dep):
   - Enumerate routes from `app/**/page.tsx` (strip `(groups)`, keep `[dyn]`).
   - Grep internal links across `app/`,`components/`,`lib/` (`href`/`to`, `router.push|replace`, `redirect(`, `location.assign|href`, template literals `` `/p/${ `` ). Mirror the regex in `connectivity-map.py`.
   - Classify each route IN-CHROME (linked from a persistent-chrome file — the `CHROME_FILES` set, **update to the new `SiteShell`/`SiteFooter` once B1 lands**) / body-link-only / ORPHAN.
   - **`ALLOWLIST`** of by-design URL-entry routes (see README "By-design URL-entry routes"). Treat dynamic provenance links (`/r/method/[metric]` via `methodHref`) as reachable.
   - Exit **1** if any route is ORPHAN and NOT in `ALLOWLIST`; print the offenders + "add an inbound link or allowlist it." Exit 0 otherwise. Add `--json` for machine output and `--all` to print the full table.
2. **`package.json`** — add `"orphans": "node scripts/check-orphans.mjs"`. (No new dependency → no lockfile change.)
3. **`.claude/hooks/check-orphan-pages.mjs`** — PreToolUse(Bash), fail-open. When the command is a `git push`/`safe-push` AND a commit ahead of upstream touched `app/**/page.tsx`, run `check-orphans.mjs`; block (exit 2) on a new non-allowlisted orphan. Mirror `check-no-branch-create.mjs` structure + an `ALLOW_ORPHAN_PAGE=1` escape hatch. Register it in `.claude/settings.json` alongside the other hooks.

## Acceptance
- `node scripts/check-orphans.mjs --all` reproduces `16 ORPHAN / 10 body / 11 in-chrome` against current `main`.
- Temporarily add `app/__probe/page.tsx` → script exits 1 naming `/​__probe`; delete it → exits 0.
- An allowlisted route (`/claim`) never trips it.
- After B1 lands and orphans get linked, the script's ORPHAN count drops to just the allowlist — wire that as the regression check B1/B2 run before push.

## Gates
`real-tsc` n/a (no TS app change) · script runs clean on `main` · `SESSION_LOG.md` entry · explicit-path staging · **no autonomous push**.
