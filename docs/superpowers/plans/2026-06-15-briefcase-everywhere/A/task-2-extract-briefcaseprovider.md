# A-2 — Extract root `BriefcaseProvider` — **OPUS**

## Goal
Lift draft state out of the highlighter context into a root-mountable `BriefcaseProvider` so the
briefcase can live globally — **without** changing behavior. Atomic, one commit.

## This is OPUS because the caller list was WRONG in the draft
**Drive the repoint off a grep of consumers** (`useBriefcase` / draft-field usage), not a hardcoded
list. Verified move set:
- `components/highlighter/Briefcase.tsx`
- `components/highlighter/HighlightPopup.tsx` (`fileItem` ~248, ~310)
- `components/highlighter/AskAiDock.tsx:234` (`ctx?.fileItem(...)` — **the missed consumer; include it**)

**Exclusions:** `AskAi.tsx` is a mount point (renders `<Briefcase/>`), not a draft consumer.
**`use-highlight.ts` does NOT touch draft state (pure selection snapping) — drop it from the move set.**

## What moves vs stays (`lib/highlighter/context.tsx`)
- **Move only:** `draftItems`, `fileItem`, `removeItem`, `draftNearCap`. Lazy-init is the 3-line
  `useState(() => loadDraftFrom(browserStorage()))` at `context.tsx:149-151` (write-through
  `fileItem/removeItem` is 152-165).
- **Keep in the highlighter context:** `chipFact`, `onActivate`, `thread`, `archiveExchange`,
  `clearThread`.
- Constants: `DRAFT_KEY = "swfl_project_draft_v1"`, `DRAFT_CAP = 50`.
- **Move the existing draft-reducer tests** from `lib/highlighter/context.test.tsx:72-109` to the new
  provider's test file.

## Acceptance test
- Grep shows every draft consumer now reads from `BriefcaseProvider`; the three components above
  behave **exactly** as before (file / remove / near-cap / dock "file this chart").
- Draft-reducer tests pass in their new home; `tsc`/`eslint` clean; one atomic commit.
- No behavior change — ownership moved only (exercise `AskAiDock` "file this chart" specifically,
  since it was the missed consumer).
