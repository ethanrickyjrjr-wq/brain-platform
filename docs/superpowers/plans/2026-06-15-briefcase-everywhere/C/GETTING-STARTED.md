# Plan C — Reconciliation Engine — GETTING STARTED (kickoff, NOT a plan)

**This is a brief, not a plan.** C is intentionally un-planned here. When someone picks it up, they
start C's **own** brainstorm cycle (RULE 3.5) and write its plan into a `C/` sibling of A's and B's
task files. This file exists to hand the next session everything the audit already learned so it
doesn't re-discover it.

## What C is

The **Reconciliation Engine**: safely compare the numbers a *user's own AI* asserts against the
numbers *we* hold in the lake, and surface conflicts honestly ("X verified, Y needs review" — the
discrepancy-reporting rule), without ever letting the system assert a stale or invented figure.

## Before you plan anything (non-negotiable)

- **Brainstorm first** (`superpowers:brainstorming`) — C is net-new and wide; do not skip to code.
- **Audit before you bless** (RULE 3 C1): every surface named below is a *hypothesis*. Open the files
  and verify in-session before building on them. A plan/README can be hallucinated.
- **Extend the enforced artifact; don't erect a new mandatory gate** (RULE 3 C2). See the facts-gate
  note below.

## Audit flags to resolve (carried from the master audit — start here)

1. **C is bigger than the draft implied — the prime directive has NO substrate yet.**
   The "forbidden to assert past TTL" rule has nothing enforcing it: `refinery/lib/confidence.mts`
   only *multiplies* by a freshness ratio (cosmetic decay) — **it never rejects.** So C's real first
   sub-project is **building the hard TTL gate**, and that is foundational OPUS work, not a thin
   reconcile layer.
   - **Open design question:** where does per-metric / per-brain TTL live — `ingest/cadence_registry.yaml`,
     the brain output, or a new field? Settle this in C's brainstorm before any reconcile logic.

2. **The facts-gate precedent is real and reusable.** `lintDeliverableNarrative`
   (`lib/deliverable/narrative-lint.ts`) is wired into `lib/deliverable/build.ts` — the no-invention
   guarantee genuinely holds at build time. **Model C's gate on it** (extend the enforced lint/validator
   artifact), per RULE 3 C2 — do **not** add a new mandatory pre-materialization gate.

3. **No reconciliation/conflict machinery exists anywhere** (confirmed). C is fully net-new. Upside:
   its core logic is **unit-testable now** against a lane-tagged fixture, **before B lands** — write
   the conflict/verify logic + tests against fixtures first, integrate later.

4. **Per-account paid MCP** (only if it ever becomes a tier) needs **per-account bearer keys**; today
   `MCP_BEARER_TOKEN` is a single shared token (`app/api/mcp/auth.ts`). Note for whoever scopes
   paid-MCP; not C's core, but C is where the question surfaces.

5. **Identity:** reuse the ONE identity (`auth.uid`) locked by A and B. Do not invent a parallel
   scheme. ("MCP-connected" is derivable — see B's `lib/identity/mcp-connected.ts`.)

## The three lanes (why C is the third)

The "three-lane contract" is: **(1) our cited lake facts**, **(2) the user's-AI assertions**, **(3)
the reconciliation verdict** that compares 1 vs 2 under the TTL gate. A and B build lanes 1–2's
plumbing (cited payloads out; carry-back in). C builds lane 3 — and lane 3 can't exist without the
TTL gate from flag #1.

## First concrete step for the next session

1. `superpowers:brainstorming` on **the freshness-TTL substrate sub-project** (flag #1) — that's the
   foundation; reconcile logic is downstream of it.
2. Then `superpowers:writing-plans` → write `C/` task files (mirror A's and B's structure).
3. Keep C's core logic fixture-driven so it can be built and tested before B is live.

## Pointers

- TTL today (cosmetic only): `refinery/lib/confidence.mts`
- Facts-gate to extend: `lib/deliverable/build.ts` + `lib/deliverable/narrative-lint.ts`
- Cadence/TTL candidate home: `ingest/cadence_registry.yaml`
- Shared identity: `lib/identity/mcp-connected.ts` (built in B-4)
- Discrepancy-reporting rule + rules-of-engagement: `docs/THE-GOAL.md`, `THE-CONTRACT.md`
