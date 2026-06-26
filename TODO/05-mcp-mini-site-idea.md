# 05 — MCP mini-site (PARKED — not sure what it is yet)

**Status:** idea only. Parked 2026-06-25. Do NOT build without operator go-ahead.

## What prompted it
Operator asked "do we have an mcp website?" — answer: we have the MCP **server**
(`app/api/mcp/route.ts`, live at `https://www.swfldatagulf.com/api/mcp`), but **no
public page** tells anyone it exists or how to connect it.

## The idea (one line)
A single landing page — a web ad + install instructions for the AI connector we
already shipped — so we have a URL to point people at.

## What already exists (don't rebuild)
- **MCP server:** `app/api/mcp/route.ts` — live.
- **Install UI, built but unused:**
  - `app/install-tabs.tsx` (`InstallTabs`) — 4 tabs (Claude CLI / Desktop / Cursor /
    Windsurf) with copy buttons, gulf-teal styled. **Orphaned** (imported nowhere).
  - `components/landing/MCPInstall.tsx` — "Install MCP Server" section. **Parked**
    (commented out of `app/page.tsx:18`).
- **Possible proof widget:** `mcp-widget/src/widget.ts`.

## Decisions the operator already made (before parking)
1. **Layout:** sell-then-convert, one scroll — HERO (pitch) → PROOF (real cited
   sample answers) → INSTALL (the existing tabs) → footer link back to main site.
2. **Where it lives:** a **bare route in this app** — `/mcp` with its own minimal
   layout (no global SiteShell nav/footer). Same repo, same Vercel deploy. Can be
   mapped to `mcp.swfldatagulf.com` later via a rewrite. (NOT a separate project.)

## Open question (unresolved — where we stopped)
PROOF section data source — pick one when this is revived:
- **Live server-fetch (ISR):** server-render the real `freshness_token` + a real
  cited metric from `/api/b/master?view=speak&tier=2`, revalidated hourly, static
  fallback if down. (On-brand "prove it's live.")
- **Curated static snapshot:** 2–3 hand-picked REAL cited answers baked in (source +
  as-of date), refreshed manually.
- **Interactive demo widget:** embed `mcp-widget/` so visitors type a ZIP question
  and get a live cited answer. Most convincing, most to break.

Moat constraint either way: **every number cited to a real source, none invented**
(four-lane sourcing).

## Effort estimate
Wiring the existing `InstallTabs` into a `/mcp` route ≈ ~10 min. The PROOF section
is the only real work, and its size depends on which data option above is chosen.

## Next step when revived
Resume the brainstorming → design-doc → plan flow (it was aborted mid-brainstorm at
the PROOF-data question). Confirm the page sketch is still wanted before building.
