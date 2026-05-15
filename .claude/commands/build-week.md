---
description: Baseline the v3 synthesis engine — load the spec, run typecheck and tests, and report what's still unimplemented.
---

# /build-week

You are starting a build-week working session on the v3 synthesis engine. Your job in this command is **not** to implement anything yet — it is to load the spec, baseline the project against it, and tell the operator exactly what remains.

## Step 1 — Load the spec

Read `docs/v3-synthesis-spec.md` in full. If the file is missing, stop and report it as the first gap; do not proceed.

Extract from the spec:

- The list of required modules / files (paths under `refinery/`).
- The required exports (types, functions, packs, constitutions).
- The required behaviors (deterministic math, output contract fields, validators, hooks).
- Any acceptance criteria explicitly called out.

## Step 2 — Baseline the project

Run both of the following and capture their full output:

1. `npx tsc --noEmit`
2. `npx vitest run`

Run them in parallel where possible. If either command is not yet configured (e.g. `vitest` not installed), record that as a baseline finding and continue.

## Step 3 — Cross-reference the repo against the spec

For each requirement extracted in Step 1:

- Use `Glob` and `Grep` to check whether the corresponding file / export / behavior exists in the repo.
- Classify each requirement as:
  - **Done** — present, typechecks, and has at least one passing test if the spec named a test.
  - **Partial** — present but typecheck fails, tests fail, or implementation is a stub.
  - **Missing** — file or export does not exist.

Do not fix anything in this command. Observe only.

## Step 4 — Report

Produce a single report in this order:

1. **Spec version** — the title and any version line from `docs/v3-synthesis-spec.md`.
2. **Baseline** — verbatim summary of `tsc` and `vitest` results (counts + first 20 lines of any failure).
3. **Status table** — three columns: `Requirement | Status | Evidence`. One row per spec requirement. Evidence is a file path (or "—" if missing).
4. **What's left** — bulleted list of every **Missing** and **Partial** requirement, ordered by the build order implied by the spec (atomic groups first, dependents after).
5. **Suggested next move** — one paragraph naming the single smallest atomic change that unblocks the most downstream work. Do not start it; just name it.

## Rules

- Read-mostly. The only writes allowed in this command are scratch notes you keep in memory while assembling the report — do not modify source files.
- If the spec contradicts the current `CLAUDE.md` Brain Factory section, flag the contradiction and trust the spec for the report; surface it to the operator for resolution.
- If `tsc` or `vitest` errors reference a file outside `refinery/`, still include them — they affect whether v3 can ship.
