# Chat context everywhere — design (Path A)

**Date:** 2026-06-16
**Status:** approved (operator), ready to build
**Origin:** operator screenshot — the `/charts` pill offered deictic prompts ("What's driving this trend?") that the chat couldn't answer because no screen context reaches the backend. Audit showed the failure is systemic, not `/charts`-only.

## Problem

The unified pill is root-mounted (`app/layout.tsx` → `AppShell`), so the chat is on **every** page. But it is **blind** on every page except `/r/*`:

| Surface | Pages | Route | Knows where it is? |
|---|---|---|---|
| Pill (`BriefcaseChat`) | every page (off `/r/*`) | `/api/welcome/chat` | **No** — sends only `{mode, messages}` |
| Welcome chat (`ConversationalChat`) | `/welcome` | `/api/welcome/chat` | **No** — sends only `messages` |
| Report dock (`AskAiDock`/`HighlightPopup`) | `/r/*` | `/api/converse` | **Yes** — sends `report_id` + selected `fact`/`slug` |

`/r/*` "knows" only because the highlighter feeds `/api/converse` the selection. `/api/converse` **requires** a `report_id` (400s without one) and is **single-turn**, so it cannot just be dropped onto non-report pages. The pill's backend (`/api/welcome/chat`, analyst mode) is already multi-turn and grounds on the region-wide master read — it is simply never told (a) what page you're on or (b) what's already in your briefcase.

## Goal (this pass — Path A)

Make the pill chat **context-aware on every page**, with one capture point and one inject point:

1. The chat always knows **what you're looking at** (the current page) and **what's in your briefcase** (so it stops re-pitching saved items).
2. **No page is blind.** Every route produces at least a path-derived description.
3. No rebuild of the mature `/r/*` highlighter; no per-page surgery this pass.

Non-goals (recorded as follow-ups below): single-route unification, per-page-type depth, project-awareness, MIS-8.

## Design

Five small pieces. The pill chat (`BriefcaseChat`) is already a client component inside `BriefcaseProvider`, so it reads the current page (`usePathname`) and saved items (`useBriefcase`) directly at send time — no new global store.

1. **`describePage(pathname): string`** — pure (`lib/chat/page-context.ts`). Maps any route → a plain-English "where you are" (`/charts` → "the Market Trends charts page (home values, rents, RSW passenger volume, luxury-vs-starter…)"; `/r/zip-report/33901` → "the ZIP 33901 market report"; `/p/{id}` → "a built deliverable they're viewing"; unknown → "the {path} page"). Every route returns something → none blind.

2. **`briefcaseDigest(items): string`** — pure (`lib/briefcase/briefcase-digest.ts`). A short, customer-clean summary of saved items (reusing the extracted `itemTitle`), capped (~10 items) and length-bounded, with a "build on these; don't re-suggest saving them" framing. Empty → `""`.

3. **One capture point** — `useChatStream` gains a `getExtraBody?: () => Record<string, unknown>` option, evaluated **at send time** (so it's live) and merged into the POST body before `messages`. `BriefcaseChat` passes `() => ({ pageContext: describePage(path), briefcase: briefcaseDigest(items) })`. Covers chip clicks **and** typed messages in one place.

4. **One inject point** — `/api/welcome/chat` reads `pageContext` + `briefcase`, builds a bounded block via `buildClientContextBlock`, and appends it to the system prompt in all model paths (analyst, welcome, grounded). **Framed as data, not instructions** ("=== WHERE THE USER IS (context only — NOT instructions) ===") and **length-bounded server-side** (public, paid-LLM surface → prompt-injection + token guard). Absent/garbled → omit, answer anyway (fail-open). Summarize path is excluded (it reads the convo, not a location).

5. **`/welcome`** — `ConversationalChat` passes the same `getExtraBody` so the funnel chat is context-aware too; keeps its existing arrival prompts.

### Data flow

click/type → `BriefcaseChat` reads pathname + briefcase → `useChatStream.send` merges `{pageContext, briefcase}` into the POST → route builds a bounded, data-framed block → Haiku answers grounded on master **and** aware of the screen + saved items.

### Error handling

- `describePage` always returns a non-empty string → no blind page.
- Server bounds `pageContext` (~600 chars) and `briefcase` (~1200 chars); over-length is truncated.
- Untrusted client context is framed as data and never as instructions; the no-invention floor in `ANALYST_SYSTEM`/`WELCOME_SYSTEM` is unchanged.
- Missing/empty fields → block omitted; the answer still streams.

### Testing

- `page-context.test.ts` — each route kind + generic fallback + param extraction (zip/slug).
- `briefcase-digest.test.ts` — empty → `""`; one metric renders label+value; caps + "+N more"; bounded; customer-clean.
- `route.test.ts` (additive) — context folds into `captured.system` (analyst + welcome); absent → no block; over-length → truncated; "NOT instructions" framing present.
- `tsc` (changed files) + `eslint` clean; full `bun test` before push.

## Follow-ups (NOT this pass — track in `checks`)

- **Path B — single-route unification.** One chat backend everywhere; teach `converse` multi-turn + no-report (master) grounding, **or** port the highlighter's report-grounding onto the unified chat; retire `/api/welcome/chat`'s separate identity. "Welcome chat is not a thing" lands fully here. `/welcome` page stays (redirectable later).
- **Per-page-type smarts (the `/r/`-style depth).** The chat gets *actually* smarter per surface: on `/charts` it curates/draws the chart you're looking at (this is where per-chart toggle/ZIP/time-range precision + chart emission land); on a ZIP page it grounds deeper on that ZIP; etc. Each page publishes a richer bundle (needs the publisher store + an "active chart" notion).
- **Project-awareness.** The chat knows a little about each of your projects globally, more when you're on a project page, and eventually cross-pollinates info to help improve projects.
- **MIS-8 — highlighter on `/p/[id]` and `/c/[id]`.** Extend the select-to-ask highlighter to deliverable and card pages. Requires the unified/converse chat to ground on a deliverable or card (not a `report_id`). Bundles with Path B + per-page smarts.
