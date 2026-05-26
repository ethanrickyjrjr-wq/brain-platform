# LittleBird Notes — SWFL Data Gulf

LittleBird (LB) is the strategy / research / plan-review / drift-catching voice for **SWFL Data Gulf**. He does **not** write code or modify files here. CT (Opus) ships changes; LB advises, audits, and remembers across sessions.

This directory is LB's session ledger — the answer to _"what did we actually do last night?"_ when neither party can remember the next morning.

## Scope (locked 2026-05-26)

- **SWFL Data Gulf only.** No cross-project framing (Premise has its own ledger).
- **LB is read-only on this repo.** These notes are written by CT at session end and by `npm run roadmap:sync` at any time. LB reads them; LB does not hand-edit them.
- **The Notion mirror is the canonical surface Ricky reads.** `roadmap:sync` pushes `latest-sync.md` to the "SWFL Data Gulf" Notion page (id `35135f3b7faf8151ba96c86fc8513e80`). When LB needs current state, he reads that page — not chat memory.

## How the sync works

```
git log + PACKS registry
        │
        ▼
npm run roadmap:sync
        │
        ├──► docs/roadmap-status.md           (prescriptive sidecar, committed)
        ├──► docs/littlebird-notes/latest-sync.md   (ground-truth snapshot, committed)
        └──► Notion "SWFL Data Gulf" page          (pushed if NOTION_API_KEY + NOTION_LITTLEBIRD_PAGE_ID are set)
```

Two failure modes are intentional:

- **No Notion creds → no push, no crash.** roadmap-sync logs the skip and finishes. Use `--no-notion` to suppress the push explicitly during local iteration.
- **Notion API key works but the integration is not connected to the target page.** roadmap-sync logs the 404 and finishes. Fix: notion.so/my-integrations → grant the integration access to the "SWFL Data Gulf" page.

## Rules for the dated session notes

CT writes one of these at the end of any non-trivial session.

- **One file per session.** Filename: `YYYY-MM-DD.md`. If a session crosses days, append to the day it started.
- **Three required sections, even if short:** `## Decided` (what got locked), `## Open` (still in the air — phrased so LB can answer it cold), `## Verify next time` (anything that needs a `git log` / code / Ricky check before being trusted).
- **Quote commits and file paths.** `commit abc1234`, `refinery/packs/foo.mts:42`. Slugs rot; SHAs and paths don't.
- **Convert relative dates to absolute.** "Thursday" → `2026-05-21`.
- **No invented detail.** If LB needs a fact, he asks CT or reads the code; CT does not synthesize plausible-sounding bullets to fill a section.

## What goes here vs MEMORY.md

| Here (session notes)                                         | MEMORY.md (auto-memory)                            |
| ------------------------------------------------------------ | -------------------------------------------------- |
| Session-scoped narrative — what happened, why, in what order | Durable facts that survive into future sessions    |
| Open questions phrased for LB to read cold                   | Locked decisions, shipped state, gotchas           |
| "Verify next time" punch list                                | User preferences and feedback rules                |
| Mid-session redirects worth recording                        | Pointer to external systems (Notion, Linear, etc.) |

Promote a note here to MEMORY after 2–3 sessions of it staying relevant. Otherwise let it age out.

## Why LB is read-only on this repo

LB has historically been a different agent (prior Sonnet sessions) and sometimes a dispatched general-purpose agent. Either way, when LB modifies files directly, two things go wrong:

1. **Brand and scope drift.** Pre-2026-05-26 LB notes carry Plumbline-era framing, Premise-context cross-talk, and stale plan references. Letting LB hand-edit propagates that drift into new sessions.
2. **No audit trail.** When LB writes prose into the repo, there's no clean diff between "this is what shipped" (commits) and "this is what LB thought about what shipped" (notes). Keeping LB out of the write path means the repo's session record stays trustworthy.

The right write path for LB: tell CT what to change, CT changes it, the change appears in the next `latest-sync.md` push.

## Index

Newest first.

- [2026-05-26](2026-05-26.md) — Brains MCP v1 LIVE in prod (Lane D verified, `86435b8`); freshness-first chain closed (PRs #19–#26); homepage move (#27); MCP basePath fix (#28); waitlist env-name fallback (`f738ed4`, #30); outside-eyes audit script (`54eab65`); permits-swfl v2 (PR #29) still open.
- [2026-05-25](2026-05-25.md) — MarketBeat Flow 3 shipped (PR #18, `f815c58`); `--target-only` CLI flag; singleton-reset backlog closed; SKOS `raw_slug_patterns` is the next follow-up.
- [2026-05-18](2026-05-18.md) — historical seed: LB scope-setting session (preserved as-is for context; brand framing in that note is pre-rebrand).
