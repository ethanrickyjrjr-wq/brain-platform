# Step 01 — Verify substrate + fix the contract (Opus)

**Check:** `email_scoped_content` (shared) · **Owner:** Opus · **Risk:** low (read-only verify + a type def)

## Goal

Confirm the columns the build depends on are live in prod, audit the real dossier-assembler signature (RULE 3
C1 — don't trust the plan as the contract), and pin the two contracts the rest of the lane builds against:
`ScopedContent` (inline) and `resolveScope()`.

## A. Verify substrate (read-only)

1. Scope columns live in prod? One read-only query via psycopg (creds `.dlt/secrets.toml`):
   ```sql
   SELECT column_name FROM information_schema.columns
   WHERE table_schema='public' AND table_name='email_schedules'
     AND column_name IN ('scope_kind','scope_value','topic');
   ```
   - 3 rows → good. <3 → apply `docs/sql/20260613_email_schedule_scope.sql` directly (idempotent), then re-check
     (RULE 1: run SQL yourself, never hand to the operator).
2. Confirm `claim_due_email_schedules` returns `s.*` (it does — `20260612_email_schedule_claim_fn.sql:54`), so
   no RPC change is needed.

## B. Audit the dossier assembler (RULE 3 C1)

Open the grounded welcome path and record the EXACT signatures Phase 02 will call:
- `app/api/welcome/chat/route.ts` (grounded branch) → how it builds the `LocationDossier` from a ZIP.
- `lib/welcome/grounded.ts` + `lib/zip-dossier` → the dossier-assembler export name + params.
- The `PlaceEcho` / `identityForLocation` helper `buildWelcomeAnswer` expects as `place`.
- `lib/place-context.ts` `buildPlaceContext` → the place→ZIP resolver for `scope_kind='place'`.

Write the confirmed signatures into step-02 before wiring (do not guess).

## C. Pin the contracts

New file **`lib/email/scoped-content.ts`** (one file: inline type + pure DI assembly, mirroring the
`scheduler.ts` / `run-schedules.mts` core/adapter split).

```ts
import type { WelcomeMetric } from "@/lib/welcome/frames";

/** Cited cards for one scope, plus the scope identity. Prose-ready (a narrative
 *  layer can later read `cards`), but v1 emits cards only — no LLM. */
export interface ScopedContent {
  cards: WelcomeMetric[]; // from buildWelcomeAnswer — do NOT redefine
  scope_kind: string;
  scope_value: string;
  topic: string | null;
}
```
(≤30 lines — the wrapper stands. If it grows past 30, drop it and ship cards-only per the operator rule.)

`resolveScope(row)` signature (impl in step-02) — **CORRECTED in step-02 (RULE 3 C1):** it is **async**
(`resolveLocation` returns a Promise) and returns the richer `ResolvedScope` (carries the full
`LocationInput` + a NULLABLE zip), NOT the sync `{ zip }` draft once sketched here:
```ts
type ResolveScope = (row: ScheduleRow) => Promise<ResolvedScope | null>;
// ResolvedScope = { loc: LocationInput; zip: string | null; explicitZip: boolean; topic: string | null }
```

## Done when

- 3 scope columns confirmed live (or migration applied).
- Dossier-assembler + place-context signatures recorded in step-02.
- `lib/email/scoped-content.ts` exists with the `ScopedContent` type; `tsc` clean.
