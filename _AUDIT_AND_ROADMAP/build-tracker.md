# SWFL Data Gulf — Build Tracker (retired → see /ops/goals)

> **This 3-Section tracker is retired. Sections 1 & 2 shipped; Section 3 ("plan the real work") became the Goal 0–8 ladder.** Do not plan from this file.

## Where the real status lives now

- **Strategic ladder + live status — `https://swfldatagulf-ops.vercel.app/goals`.** The Goal 0–8 ladder, backed by the Supabase `goals` table. Hand-owned by the operator (edited in Studio). The carry contract is **Goal 2** and it is live; everything 3→8 stands on it.
- **Granular "what's next" queue — `https://swfldatagulf-ops.vercel.app/queue`,** fed by `_AUDIT_AND_ROADMAP/build-queue.md` (pipeline/brain priority overlay — a finer grain than the strategic ladder).
- **Derived signal status (pipelines, GHA, brains, services) — `https://swfldatagulf-ops.vercel.app`.** Computed live from GitHub + Supabase. Never hand-typed.
- **Roadmap rationale — `docs/ontology-and-roadmap.md` §6** (the why/how behind each goal).

## What the 3 Sections were (history)

- **Section 1 — Stamp the goal.** DONE. `docs/THE-GOAL.md` + lean rules-of-engagement block in CLAUDE.md + consumption contract. → Goal 0.
- **Section 2 — Build the /ops ledger.** DONE. Now the standalone `swfldatagulf-ops` repo (live). → Goal 1.
- **Section 3 — Plan the real work.** Superseded by the Goal 0–8 ladder. Plan the next move from `/ops/goals` + `/ops`, confirming done-ness against GitHub — not from this file or from memory.

## Guardrails (still in force)

- Goal/aspiration docs carry no status; status lives only in /ops (now: the `goals` table + the ledger).
- The `goals` seed is **insert-only** — operator edits in Studio are never overwritten by a re-run.
- Stage only files you create/modify; SESSION_LOG entry on every push; never `--no-verify`.
