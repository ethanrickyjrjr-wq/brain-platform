# HANDOFF BRIEF — Roots 4 + 5: Visuals, Discoverability, Visible failures

> Standalone brief. Hand this whole file to a fresh Claude. Companion roots:
> Root 1 (AI/project unify) → `2026-06-15-root-R1-unify-ai-project.md`;
> Root 3 (data truth) → `2026-06-15-root-R3-data-truth.md`.
> Source inventory: `2026-06-15-MASTER-PROBLEM-INVENTORY.md`.

**Goal:** the good surfaces exist but are orphaned, the brand visuals are never
shown, and failures look like dead pages. *"You can't get to anything easily."*
Mostly frontend/IA + error-boundary work.

## Why this is a root (findings)
Charts, templates, the briefcase, and the AI each shipped as an **island** — no
information architecture ties the front door to the data/visuals (WHY #6). And
the site **looks more broken than it is** because there are **zero App Router
error boundaries** and the only existing boundaries (charts) render `null` on
failure — a throwing page is indistinguishable from a dead one (WHY #3).

## B1 — Discoverability / nav (NAV-1..5, VIZ-1/2)
- `/charts` is not in primary in-app nav (NAV-2); templates are only reachable via
  `/showcase` "Preview →" → raw `/api/templates/render` in a new tab (NAV-4), no
  gallery. **Build a real template gallery** + surface `/charts` in nav + embed
  charts where the user works. Audit `components/.../Header.tsx`, `ProjectNav.tsx`,
  `/showcase`, `/charts`.

## B2 — Brand visual examples (the operator's explicit ask)
Thumbnails of brand examples (data + graphs) shown as: in-email, on-website,
as-PDF; click to view; **choose "build this style or that style"** as branding
for email / PDF / website. Today the 6 templates (hero/table/compare/ranked/
hbar/report) exist (`lib/deliverable/templates*`) but are never surfaced as
selectable styles. Build the style-picker gallery feeding the project branding +
build template. (Ties to Root-1's Build button, which now takes a template id —
this brief makes those templates *browsable as styled thumbnails*.)

## B3 — Metric card redesign (VIZ-4, DAT-4)
`/p/[id]` cards bury the value under verbatim `source.citation` ("800-char
wall"), no accent, no source collapse, no per-card "add to briefcase." All 7
redesign reqs are greenfield. Value-first hierarchy, `--card-accent`, collapsible
source, per-card file button. (Citation *length* root is shared with Root-3 A5.)

## B4 — Visible failures (ERR-1/2/3, VIZ-3)
- Add App Router `error.tsx` boundaries so a throw renders a readable state, not
  a blank "Data unavailable" (ERR-1).
- The chart boundaries that render `null` on failure (ERR-2 — `ReportChart.tsx`,
  `FrameRenderer.tsx`, `CREMarketBeatChart.tsx`) should show a small "chart
  unavailable" instead of vanishing.
- Stale ISR (`revalidate=3600`) can serve a dead page for an hour after a
  migration (ERR-3, root of the "charts page blank" VIZ-3) — revisit revalidate /
  on-demand revalidation for data/view migrations.

## B5 — Buttons that lie (BTN-2/3/4/5/6/7/8/9/10)
- **BTN-4**: mobile hamburger has no `onClick` (`Header.tsx:147-156`) — mobile
  nav can never open. Quick, high-value.
- **BTN-2**: "Open in mail" uses `mailto:` (`DeliveryButtons.tsx:82-88`) → fires
  every registered mail handler (operator saw ~4 tabs incl. Gmail+Outlook).
  `mailto:` is the wrong mechanism for "send" — replace with a copy-to-clipboard
  + explicit provider choice, or a server send (email is out of scope per
  operator, so prefer copy/preview).
- **BTN-3/10/MIS-11**: "Save as PDF" is `window.print()` (server PDF path returns
  501), AND the AI pill panel is **not `.print-hide`-excluded** so the chat
  prints OVER the deliverable. Two fixes: (a) exclude the pill/panel overlay from
  print; (b) decide real server-side PDF vs. a print-clean stylesheet. There is
  **no clean client PDF today**.
- **BTN-5**: TemplateSwitcher chips no-op for non-owners on `/p/[id]` (401/403) —
  hide or disable for recipients.
- **BTN-6/8/9**: "Upload your data · soon" (`AskAiDock.tsx:508`), non-`bar-table`
  "File this chart" stubs, Cursor/Windsurf MCP "Coming soon" tabs — either build
  or stop presenting as live controls.
- **BTN-7**: "Request this data" records nothing (`HighlightPopup.tsx:576-582`) —
  wire it to a real data-request log or remove.

**Caveat (DEP-1):** prod may be running pre-fix code (Plan A/B/C PROD HELD).
Before treating any `DISPUTED`/blank-page item as a live code bug, confirm the
deployed commit.

**Suggested order:** B4 (visible failures — cheap, stops "looks dead") + BTN-4 →
B1/B2 (IA + brand gallery — the operator's headline want) → B3 (card redesign) →
B5 remainder.
