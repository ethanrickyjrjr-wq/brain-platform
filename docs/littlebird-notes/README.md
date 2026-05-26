# LittleBird Notes

LB's session ledger. Lives in-repo because Notion access is currently scoped to the other project, not Plumbline.

## Rules

- **One file per session.** Filename: `YYYY-MM-DD.md`. If LB runs twice in a day, append to the existing file rather than creating `YYYY-MM-DD-2.md` — same day, same brain.
- **Append-only during a session.** Don't rewrite history. If a decision reverses, log the reversal as a new entry, not an edit.
- **End every session with three sections, even if short:**
  - `## Decided` — what got locked.
  - `## Open` — what's still in the air, with the question phrased so future-LB can answer it cold.
  - `## Verify next time` — anything that needs a `git log` / code / Big Bird check before being trusted.
- **Quote commits and file paths.** `commit abc1234`, `refinery/packs/foo.mts:42`. Slugs rot; SHAs and paths don't.
- **Convert relative dates to absolute.** "Thursday" → `2026-05-21`. Notes outlive the week they were written in.

## What goes here vs. what goes in MEMORY

- **Here:** session-scoped observations, plan reviews, follow-up questions, things to verify, raw thinking.
- **MEMORY (CT's auto-memory):** durable facts that should survive into future sessions — locked specs, shipped state, user preferences, gotchas.

If a note in here proves durable after 2–3 sessions, promote it to a CT memory entry. Otherwise let it stay session-local and age out.

## Index

Append newest-first.

- [2026-05-25](2026-05-25.md) — MarketBeat Flow 3 shipped (PR #18, `f815c58`); `--target-only` CLI flag added; singleton-reset backlog closed; SKOS `raw_slug_patterns` is the next follow-up.
- [2026-05-18](2026-05-18.md) — seed session: memory rewrite, notes directory established.
