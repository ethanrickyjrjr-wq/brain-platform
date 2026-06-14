# Step 03 — Render + subject (Sonnet) + wire buildContent (Opus)

**Check:** `email_scoped_content` · **Risk:** medium (live `/api/email/*`-adjacent body path)

> **Contract (async — corrected in step-02 impl, RULE 3 C1):** both `resolveScope(row)` and
> `assembleScopedContent(row, deps)` return `Promise<…>` — **`await` them.** `assembleScopedContent`
> → `Promise<ScopedContent | null>` (null = unresolvable → global fallback). 03a's `renderScopedBody`
> takes an already-assembled `ScopedContent` and is sync; only the 03b call site awaits (it already does).

## 03a — `renderScopedBody(content)` + subject (Sonnet; template-agnostic)

In `lib/email/scoped-content.ts`. Emit the `{ subject, body }` the existing
`renderHtml`→`ensureUnsubscribeToken`→broadcast path already expects — so any Fiverr skeleton renders the same
payload.
- **Body:** faithful plain lines from `content.cards` — mirror `buildBody`'s shape
  (`scripts/email/run-schedules.mts:81`). Each line = `label: value units` + the card's `source.domain` /
  `source.citation`. The freshness token (on `WelcomeAnswer`) is quoted once. No prose synthesis (cards-only v1).
- **Subject:** scope-aware — `"<Place> <topic|"market"> — this week"` from `scope_value`/`topic` (Title-case the
  place). Keep the global path's `buildSubjectLine(digest, [])` for `scope==null`.

## 03b — Wire `buildContent` (Opus; the branch + cache)

Rewrite `buildContent(row)` at `scripts/email/run-schedules.mts:225`:
```ts
async buildContent(row: ScheduleRow) {
  // Global path — UNCHANGED (regression contract).
  if (row.scope_kind == null && row.topic == null) {
    const digest = await getDigest();
    return { subject: buildSubjectLine(digest, []), body: buildBody(digest) };
  }
  // Scoped path — in-run cache keyed by the canonical scope (multiple tenants on
  // the same scope reuse one assembly, mirroring getDigest()).
  const key = `${row.scope_kind ?? ""}|${row.scope_value ?? ""}|${row.topic ?? ""}`;
  let content = scopeCache.get(key);
  if (content === undefined) {
    content = await assembleScopedContent(row, scopedDeps); // null = unresolvable
    scopeCache.set(key, content);
  }
  if (!content) {                       // unresolvable scope → fall back, never invent
    const digest = await getDigest();
    return { subject: buildSubjectLine(digest, []), body: buildBody(digest) };
  }
  return renderScopedBody(content);
}
```
- `scopedDeps` (real seams: dossier assembler, `identityForLocation`, `buildWelcomeAnswer`, `log`) built once in
  `main()` alongside the other deps. `scopeCache = new Map<string, ScopedContent | null>()` per run.
- `renderHtml` already resolves the template via `row.template_id` → the Fiverr skeletons slot in there with no
  change to this lane.

## Done when

- A scoped row renders cited cards; a `scope==null` row renders the **identical** global digest as today.
- Unresolvable scope falls back to the global digest (logged). `tsc`/eslint clean.
