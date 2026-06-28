# B3 — Close the journey loops · **Sonnet** · WAVE 1 · file-isolated (parallel with B1)

**Goal:** every terminal page gets a forward or back path so create→view→repeat actually loops. Kills **R5**.
**Touches none of B1's nav files** → safe to run alongside B1. Four small, independent edits.

## Anchors captured 2026-06-20 — **re-verify each before editing** (RULE 0.5; lines may have drifted)
1. **`/p/[id]` has no way back** — `app/p/[id]/page.tsx`. The deliverable carries `project_id` (~:44, used ~:462/:548); the owner-only action strip is the `isOwner` branch (~:459/:526). Build flow forward-navigates here via `app/project/[id]/workspace/ProjectWorkspace.tsx:274` (`window.location.assign('/p/'+id)`). Pill + nav both suppress on `/p/*`.
   → **Add a "← Back to project" link** to `/project/{project_id}` **inside the `isOwner` branch only** (so a white-labeled client view stays chrome-free). No new query — `project_id` is already on the row.
2. **`ProjectActionBar` build-success is dead text** — `app/project/[id]/workspace/ProjectActionBar.tsx:94-99` prints `` `Deliverable ready → /p/${id}` `` as a plain string.
   → Render it as a **link**, or navigate to `/p/{id}` (match `ProjectWorkspace.tsx:274`). Don't leave a URL the user must copy.
3. **`/demo` has zero links** — `app/demo/page.tsx:31-128` is pure fixture sections, no `Link`/`<a>`/button.
   → Add **one forward CTA** ("Start a project →" → `/welcome` or `/project`, or open the briefcase pill). One affordance is enough; this is a proof page.
4. **Bare `/welcome` dead-ends** — `app/welcome/page.tsx:46-87` renders the create CTA (`OpenProjectCta`) **only** when an in-scope `?zip=` is present; organic arrivals get only a `/billing` link.
   → Add a **generic "Start a project" affordance** for the no-zip case so organic visitors have a path beyond the floating pill. (Keep the zip-seeded `OpenProjectCta` exactly as-is for funnel arrivals.)

## Optional (low)
- A "you have N filed items → open a project" nudge in the shell, reading the briefcase draft count already tracked in `AiBriefcasePill` (badge ~:62). Skip if it touches B1's shell mid-flight.

## Acceptance
- From `/p/[id]` as owner: one click back to the project. As a non-owner (white-label) view: NO back-link, no chrome (unchanged).
- Building from the assistant bar lands the user on `/p/[id]` (or a click away), not a copy-paste string.
- `/demo` and bare `/welcome` each have a working forward CTA.
- `real-tsc` 0 · eslint · `next build` ✓ · `bun test`.

## Gates
Standard done-bar (README). Stage only these 4 files (explicit paths) · `SESSION_LOG.md` entry · no autonomous push.
