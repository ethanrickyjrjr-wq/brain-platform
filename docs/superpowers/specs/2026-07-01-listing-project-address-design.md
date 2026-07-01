# Build 1 — New Listing project + saved address (HANDOFF SPEC)

**For:** a fresh Claude executing this build. **Slug:** `listing-project-address`.
**Check:** `listing_project_address_live_verify` (open). **Status:** designed, not built.
**Parent epic:** `docs/superpowers/specs/2026-07-01-new-listing-lifecycle-project-design.md` (Build 1 of 5).
**Research:** `_ASSISTANT/research/2026-07-01-listing-lifecycle-marketing-research.md`.
**Memory:** [[project_new-listing-lifecycle-project]], [[feedback_listing-citations-say-swfl-data-gulf]].

Read the parent epic first. This spec is the anchor build; it also finishes the earlier "F2" (project-aware
address + the AI confirm turn). Every `file:line` below was verified 07/01/2026 — re-open before editing.

---

## Goal

A project can be a **listing** anchored to a **saved subject address**, created from a **New Listing** entry.
Once saved, both the chat comp/value path and the email listing/comp build read that address, and when an
address is *inferred* rather than typed, the AI **confirms** ("Is this listing/comp for {address}? Reply yes,
or send a different one") instead of guessing or cold-asking. Operator decisions (locked):
- **Saved address field** on the project (optional). If absent, do NOT assume an address **unless the project
  title parses to one**. No other guessing.
- **Surface:** chat comp path AND the email listing build (operator: "chat + email listing build together").

Out of scope (later builds): the stage sequence (Build 3), the grounded sold email (Build 2), social per
stage (Build 4). Build 1 only adds the listing kind + saved address + address resolution/confirm.

---

## Current state (verified seams)

- **`projects` table** (`database-generated.types.ts:1953-1993`): `id, user_id, title, items, branding,
  mcp_key, ui_state, project_type, derived_project_type, created_at, updated_at`. **No address column.**
  `project_type` is CRE **asset-class** (`lib/project/infer-project-type.ts:18-42`) — do NOT reuse it for
  listing-kind; add a distinct field.
- **Create route** `app/api/projects/route.ts:34-40`: cookie/RLS client (never service-role — RLS
  `WITH CHECK auth.uid()=user_id` is the authz), inserts `{id, user_id, title, items}`, brands, logs
  activity, returns `{id}`.
- **Create button** `app/project/NewProjectButton.tsx`: POSTs `{title:"Untitled project"}` → routes to
  `/project/{id}`. No kind/address.
- **Chat comp seam** `lib/assistant/comp-helper.ts`: `compHelper(question, deps)` (`:158`); `extractAddress`
  (`:99`) pulls an address from the question; when null it returns a lane-4 needs-ask (`:170-176`).
  `CompDeps` (`:55-77`) has no project context. Wired via `compForConversation`
  (`lib/assistant/conversation-path.ts:115`, called at `:671` and `:760`).
- **Email listing build** `lib/email/build-doc.ts:355-396`: `isListingIntent(prompt)` + a **pasted URL** →
  `fetchListingFacts(url)` → `buildListingFlyer`. Today it needs a URL; it has no address→facts path.

---

## Design

### Part A — data model (the anchor)
Add two columns to `projects`:
- `kind text not null default 'general'` — values `'general' | 'listing'`. (Distinct from `project_type`.)
- `subject_address text` (nullable) — the saved listing address.

Migration: idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`. **psql is not installed on this box** —
run via `new Bun.SQL` with `.dlt/secrets.toml` creds + `sslmode=require` (see
[[reference_run-migrations-via-bun-sql]]). After: `bun run gen:types` to refresh `database-generated.types.ts`;
if `database.types.ts` narrows `projects`, extend it. Verify the two columns exist + a row-count sanity check.

### Part B — create flow + New Listing entry
- `app/api/projects/route.ts`: accept optional `kind` (`z.enum(['general','listing'])`, default `'general'`)
  and `subject_address` (`string`, trimmed, nullable) on the body; include them in the insert. Keep the
  cookie/RLS client. Return `{id}` unchanged.
- Add a **New Listing** entry beside New Project (extend `NewProjectButton.tsx` or a sibling
  `NewListingButton.tsx`): POST `{ title, kind:"listing", subject_address? }`, route to `/project/{id}`.
  Minimal UI: a New Listing button that optionally collects an address (a single input; may be left blank).
- **Title-parse fallback:** if `kind:"listing"` and `subject_address` is blank but the title parses to a
  street address (reuse `extractAddress` from comp-helper, exported), store that as `subject_address`. Never
  invent one otherwise.

### Part C — address resolution + confirm turn (chat comp seam)
- Add `projectAddress?: string` to `CompDeps` (`comp-helper.ts:55`).
- In `compHelper`: after `const address = extractAddress(question)`, if `!address && deps.projectAddress`,
  do NOT cold-ask — return a **confirm** needs-message: `Is this comp for ${deps.projectAddress}? Reply "yes"
  or send a different address.` (No geocode/fetch yet — the user's next turn, "yes" or a new address,
  resolves it; a "yes" reply re-enters with the projectAddress used as the address.) Keep today's cold-ask
  when there's neither a typed nor a project address.
- Thread it through: `compForConversation` (`conversation-path.ts:115`) must accept and pass
  `projectAddress` into `compHelper`/`pastedLinkComp` deps. The caller of `compForConversation` (the answer
  entry that assembles `CompDeps` — trace from `conversation-path.ts:671,760` up to the answer route) must
  supply the **current project's** `subject_address`. If the answer route has no project context, add it
  (pass `projectId` → load `subject_address`). This is the one wiring trace the executor must complete.

### Part D — email listing build address consumption
- In `build-doc.ts:355-396`, when building inside a listing project with a `subject_address` and no pasted
  URL, resolve facts from the address instead of requiring a URL: geocode the address (reuse `geocodeAddress`)
  + pull the listing/nearby data already available (`fetchNearbyValues` / the lake), then `buildListingFlyer`.
  If the address is inferred (from title, not user-typed), surface the same confirm before building. If
  address→facts can't be made clean in this build, ship Parts A–C and leave a `[Need: listing detail for
  {address}]` lane-4 line (four-lane safe) — never invent listing facts. Flag this as the sizing risk.

---

## Constraints
- **Four-lane / no-invention:** every listing number is real (lake / listing page / user figure), cited
  "SWFL Data Gulf" ([[feedback_listing-citations-say-swfl-data-gulf]]); as-of MM/DD/YYYY. A missing fact →
  lane-4 `[Need: …]`, never invented.
- **RLS:** create + any project read stay on the cookie client; never service-role in a user path.
- **Migration:** idempotent (`IF NOT EXISTS`); verify row count after; `gen:types` in the same PR.
- **Offline verification only:** `bunx next build` + `bun test`. No live/paid model or SteadyAPI call to
  "verify"; `listing_project_address_live_verify` is operator-run.
- **Isolation:** parallel sessions are active in email/social — work in a worktree
  (`node scripts/worktree.mjs new listing-addr`), stage explicit paths, never `git add -A`.
- **Push discipline:** commit + SESSION_LOG entry, then STOP and ask before push.
- Extend existing seams; no new mandatory gate (RULE 3 C2).

## Test plan (offline, TDD)
1. `app/api/projects` — POST `{kind:"listing", subject_address:"123 Main St, Naples"}` inserts both columns;
   default `kind` is `'general'` when omitted; title-parse fallback populates `subject_address` from a listing
   title when blank.
2. `comp-helper` — `compHelper("what are comps?", {projectAddress:"123 Main St"})` returns the **confirm**
   needs-message and makes **zero** fetch/geocode calls (assert via injected deps). `compHelper("comps near
   456 Oak St", {projectAddress:"123 Main St"})` uses the typed address (project address ignored when the
   question has one). No project address + no typed address → today's cold-ask unchanged (no regression).
3. `build-doc` listing branch (Part D) — with a listing project + `subject_address` and no URL, produces a
   flyer grounded in real data OR a lane-4 `[Need: …]` line; never invented facts.
4. `bunx next build` clean; full `bun test` for touched files green.

## Acceptance criteria
- A New Listing project can be created with a saved address (or none).
- Chat comps confirm an inferred address instead of guessing; typed addresses still win; no-address behavior
  unchanged.
- The email listing build can use the saved address (or degrades to a cited lane-4 need — never invention).
- All offline checks green; nothing pushed without operator confirmation.

## Files (create/modify)
- Migrate: `projects` (+`kind`, +`subject_address`) via a Bun.SQL runner ([[reference_run-migrations-via-bun-sql]]);
  `bun run gen:types`.
- Modify: `app/api/projects/route.ts` (accept + insert kind/subject_address).
- Create/modify: `app/project/NewProjectButton.tsx` (+ New Listing entry) and any listing-address input.
- Modify: `lib/assistant/comp-helper.ts` (`CompDeps.projectAddress` + confirm branch; export `extractAddress`
  if the title-parse fallback reuses it), `lib/assistant/conversation-path.ts` (thread `projectAddress`), and
  the answer route that assembles `CompDeps` (supply the project's `subject_address`).
- Modify: `lib/email/build-doc.ts` (Part D — address→facts in a listing project).
- Tests: the projects route test, `lib/assistant/comp-helper.test.ts`, `lib/email/build-doc*.test.ts`.

## Next after Build 1
Build 2 (grounded Just-Sold email) → Build 3 (stage gameplan) → Build 4 (social per stage) → Build 5
(lake→product read path). See the parent epic.
