# 03 — PIECE 3: Signal Layer (the invisible reporter)  🟢 TRACK A BUILT (HELD for push, 2026-06-17) · data-change cron = PR2

> **Build status (2026-06-17):** Track A (the live MVP) is BUILT + audited + all gates green (tsc 0, bun test 2899/0,
> eslint clean, `next build` ✓), HELD for operator diff-review per RULE 1. Shipped: migration `project_feed` (applied to
> prod, RLS proven), `lib/project/{feed,project-scope}.ts` (+ `identity-key` reused), `outside-action` emit at
> claim/import birth, and the 3 additive P2 wires (digest `feedSignals` + capped prompt + `markFeedSeen` seam). The
> audit also fixed a **pre-existing** P2 build break (`corridor-display.mts` leaked `node:fs` into the `/project` client
> bundle). DEFERRED: data-change cron (= PR2), engagement/external-event/platform-feature, and the dismiss BUTTON
> (seam wired+tested; shared with cross-project — check `piece3_dismiss_ui`).

> ✅ BRAINSTORM DONE (2026-06-17). Scope locked with the operator + verified against the live
> code by an 8-agent ground-truth audit. **The authoritative build contract is the
> "AUDIT-VERIFIED BUILD CONTRACT" section at the bottom of this file** — it supersedes the
> draft below wherever they differ (7 corrections + 2 locked decisions). No separate spec file:
> per operator decree this doc IS the spec. Still re-read **THE BIBLE**
> (`docs/standards/data-and-build-bible.md`) + **PROBE FIRST** before the change-detection cron.

## Intent

An **agent no one sees** that reports daily happenings to the Project AIs: new data, new features, and engagement on
the user's own work — so Piece 2 can say **"your property got 7 clicks from your emails"**, **"Walmart is building
near your commercial property"**, and **"the new data shows X"**. This is the *fuel*; it has no UI of its own. Page
agents / the build report into one feed the AIs read.

## Contract

**Depends on (from P1/P2):** nothing structural — it's mostly backend + cron. It writes a feed; **P2 reads it.**
**Provides (consumed by P2):** `project_feed`/notifications rows · email click/open events · change-detection deltas
scoped to each project's ZIP/topic.

## Scope (proposed)

1. **Per-project feed table** — `project_feed` (or `notifications`): `{id,user_id,project_id,kind,title,detail,
   ref_url,created_at,read_at}`, RLS owner-all. The **durable half of the context bus** (`00-MASTER-PLAN.md`) — the one
   place situational signals land. `kind ∈ {data-change, engagement, external-event, platform-feature}`, where
   **platform-feature** is the site agent announcing new charts/features ("we just got new charts that fit this").
2. **Email click/open tracking** — wire a **Resend webhook** → write `usage_events.action='click'/'open'` (the
   `action` column already exists) **or** a dedicated `email_events` table; attribute to the user's send via
   `email_sends.reply_token`/`broadcast_id`. This is what makes "7 clicks" real.
3. **Change-detection cron** — daily job comparing each project's scope (ZIP/topic) against the latest lake read
   (freshness-token diff + new permits/listings/news from `city-pulse`-style signals); writes deltas to `project_feed`.
4. **"Near your property" / external-event matcher** — optional, harder: match new permits/large-project news to a
   project's geo. Likely a later sub-phase; the feed + click tracking + freshness deltas are the MVP.

## Reuse / what exists

`usage_events.action` column (ready, unused for clicks) · `email_sends` (reply_token/broadcast_id for attribution) ·
`buyer_intent_events` (reply sensor — the existing "someone warmed up" pattern to mirror) · freshness tokens on every
brain · `city-pulse-swfl` brain (live news facts) · `swfl_reconcile` (stale-metric verdicts) · the cron infra
(`docs/cron-rebuild-failures.md`, `ingest/cadence_registry.yaml`).

## Standards that bind this piece (non-negotiable)

PROBE FIRST before any multi-minute job · destructive writes need a non-null guard (prepush Gate 4) · cron wrapper +
`--dry-run` ship in the same PR · vendor cadence verified live · brain-first ingest gate for any Tier-2 write.
(All in CLAUDE.md + THE BIBLE.)

## Open decisions for brainstorm
- `usage_events.action` vs. a dedicated `email_events` table for clicks (telemetry depth vs. simplicity).
- Resend webhook surface (which events; signature verification; idempotency via the existing send ledger pattern).
- Change-detection grain + cadence (per-ZIP daily? only on master rebuild?) and how to avoid noisy feeds.
- Feed retention + read/unread semantics; how P2 ranks feed items into the 3 situational prompts.

## Likely key files
new `docs/sql/<date>_project_feed.sql` (+ maybe `_email_events.sql`) · new `app/api/webhooks/resend/route.ts` ·
new ingest/cron under `ingest/` + `ingest/cadence_registry.yaml` · `app/api/.../meter` & `usage_events` writers ·
`lib/email/agent-alert.ts` (mirror the reply-sensor pattern). P2 reads `project_feed` via its digest/prompt engine.

---

# OUTSIDE ↔ PROJECTS — how they work together while apart (framing + MVP)

> Added 2026-06-17. Design for the part of P3 that makes the two AI contexts collaborate — verified against the
> code. This is the brainstorm/design output; the spec still gets written under
> `docs/superpowers/specs/2026-06-17-piece3-signal-layer-design.md` before building (RULE 3.5). MVP scope locked
> with the operator: **own-work (`outside-action`) + `data-change` only**; engagement / external-event /
> platform-feature designed-and-deferred.

## The problem this solves

The north star is **one persistent assistant in two contexts** — **OUTSIDE mode** (whole site: `/r/*`, `/charts`,
`/welcome`, the pill/briefcase; saves to a localStorage draft; project-agnostic) and **PROJECTS mode** (inside
`/project/[id]`; all-project-aware, current-project focused). The operator's requirement: they **"work together
while apart"** — work done Outside flows toward Projects so *by the time the user opens a project, the pieces are
already lined up.* The mechanism is the **context bus + `project_id`**, in two halves: the **in-session half**
(`setAiContext`, P1, ephemeral) and the **durable half** (`project_feed`, **P3**).

Two facts (both code-verified) make this non-trivial:

1. **P3 as drafted above only reports the *external* world.** It has no concept of the user's *own* Outside
   footprints reaching a project — so as written it cannot deliver "the pieces are already lined up" for the work
   the user actually did.
2. **Today the Outside→Project handoff is a one-shot, items-only, lossy transfer.** Anon work rides
   `localStorage swfl_project_draft_v1` → `ImportDraftOnLogin.tsx` → `POST /api/projects/import`, or MCP
   `swfl_project_handoff` → `mintClaimToken()` → `/api/claim`. It copies `items`; it carries **no durable memory of
   what the user was doing** and dies when the draft is consumed. No `setAiContext`, no `projectId` on the pill, no
   per-project signal store (`project_feed`/`notifications` do **not** exist).

**Outcome:** one durable substrate — `project_feed` — that is the shared asynchronous memory between the two modes,
so Project mode arrives already knowing (a) what the user did Outside and (b) what changed in the world for this
project's scope — **no AI re-fetch, no live "two bots talking."**

## The mental model

> **APART** = different routes, different sessions, **different clocks** (author Outside Tuesday; open the project
> Friday; data refreshed Wednesday; an email got clicked Thursday).
> **TOGETHER** = one table (`project_feed`), one key (`project_id`). The two modes **never talk directly** — they
> collaborate **asynchronously through the feed.** Outside mode + the invisible reporter *write*; Project mode (via
> P2) *reads* and arrives prepared.

P3 is the **durable half** of the context bus; P1's `setAiContext` is the *right-now* half. **P2 reads both** and
ranks them into the 3+1 prompts. This MVP builds **only the durable write side + one read seam** — not P2.

### The reframe (vs. the external-only draft above)

`project_feed` carries **the world AND the user's own Outside footprints** — but it is a **signal/notification log,
not a work store.** Get this distinction right:

- **The *work* stays where it already lives** — the briefcase draft + `projects.items`, which already have a
  claim/import flow. Do **not** melt the work into the feed (duplicates a flow; overloads one row shape for two jobs).
- **The feed carries a *pointer-class* signal** that work happened — a **5th kind `outside-action`** ("you saved a
  33931 flood chart Outside") with `ref_url` to the real item and a `payload` identity key the convergence engine
  matches on. **Not** folded into `data-change` (different verb: *"the data moved"* vs *"you did something"* — P2
  phrases them oppositely).

## The two-clock problem → 3 binding tiers

Signals aren't natively keyed to a project (data-change → ZIP/topic; engagement → send token; authoring may precede
the project). Route by **late binding**:

1. **Bound** — project exists and the signal is about it → write `project_feed(project_id=…)` directly.
2. **Scope-keyed (read-time match)** — no project yet but the signal has a ZIP/topic → store with
   `scope_kind/scope_value`, **`project_id` NULL**; bind at **read time** in the digest query
   (`WHERE project_id=$id OR (project_id IS NULL AND scope overlaps the project's scope)`). **The only design that
   survives late binding** — write-time fan-out can't reach a project created *tomorrow* without re-running fan-out
   on every create (= read-time match with extra writes + a consistency bug).
3. **Claim-time emit (replaces "anon staging")** — pre-project authoring needs **no staging table.** The *work*
   rides the existing draft; the *signal* is **emitted at project birth** — inside `/api/claim` and
   `/api/projects/import`, where a `project_id` and `items` both exist. Anon-staged collapses into a deferred Bound emit.

### Load-bearing: reuse the existing scope contract; `projects` has no scope column

`scope_kind/scope_value` is **already a binding contract** (`docs/sql/20260613_email_schedule_scope.sql` +
`docs/sql/20260616_deliverables_scope.sql`, latter unapplied): enum `{NULL,'zip','place','county'}`; `scope_value` =
canonical **lowercase+trimmed** ("canonical form IS the contract"); `topic` free-text; **"for 'place', ZIP expansion
is DEFERRED to read/build time — a place may span many ZIPs; collapsing to one ZIP is lossy."** P3 reuses this
**verbatim** or it forks the contract (no-invention violation).

**The real gap:** `projects` (`docs/sql/20260612_projects.sql`) has **no scope column** — a project's scope is
derivable from its `items`. MVP: **derive the project's scope set on the fly inside the read seam** (no migration),
reusing the place→ZIP expander the `deliverables` build path already needs.

## `project_feed` schema (MVP)

```sql
-- docs/sql/20260617_project_feed.sql  (run directly per RULE 1; idempotent)
CREATE TABLE IF NOT EXISTS public.project_feed (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      uuid NOT NULL,                        -- RLS anchor
  project_id   text REFERENCES public.projects(id),  -- NULLABLE (Tier-2 scope-keyed); text to match projects.id PK
  kind         text NOT NULL,                        -- outside-action | data-change | engagement | external-event | platform-feature (free-text, NO enum; mirror email_schedules.topic)
  scope_kind   text,                                 -- {NULL,'zip','place','county'}   VERBATIM email_schedules contract
  scope_value  text,                                 -- canonical lowercase+trimmed     VERBATIM contract
  title        text NOT NULL,                        -- one-line; deterministic or lint-passing (no-invention)
  detail       text,                                 -- optional body; same lint gate
  ref_url      text,                                 -- deep link to the item/chart/send/feature
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- convergence fuel: identity key, recipe ref, counts, broadcast_id
  dedup_key    text NOT NULL,                        -- idempotency; UNIQUE — mirrors email_send_ledger
  created_at   timestamptz NOT NULL DEFAULT now(),
  read_at      timestamptz,                          -- P2/UI sets when a derived prompt is shown-and-dismissed
  void_at      timestamptz                           -- soft-invalidate when source item is deleted (REAL-tier guard)
);
CREATE UNIQUE INDEX IF NOT EXISTS project_feed_dedup_uidx ON public.project_feed (dedup_key);
CREATE INDEX IF NOT EXISTS project_feed_project_created_idx ON public.project_feed (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_feed_scope_idx ON public.project_feed (user_id, scope_kind, scope_value, created_at DESC) WHERE project_id IS NULL;
ALTER TABLE public.project_feed ENABLE ROW LEVEL SECURITY;
-- owner-all policy copied VERBATIM from buyer_intent_events (service_role writes, owner reads)
REVOKE ALL ON public.project_feed FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_feed TO authenticated;
GRANT ALL ON public.project_feed TO service_role;
NOTIFY pgrst, 'reload schema';
```

Non-obvious columns: **`project_id` NULLABLE** is the entire Tier-2 mechanism. **`dedup_key` UNIQUE**
(INSERT … ON CONFLICT DO NOTHING) is mandatory — cron re-runs + webhook retries would double-post otherwise.
**`payload`** carries the convergence identity key so P2's REAL-tier cross-project index ("you already have this
33931 flood metric in *Luxury Clients*") matches without re-deriving. **`void_at`** self-heals on source-item delete.

## The two seams (the whole P3 surface for now)

`lib/project/feed.ts` — one writer, one reader, both mirroring `recordUse`'s **never-throws** discipline
(`lib/highlighter/meter.ts:43-82`):

- **`writeFeed(row)`** — dedup-enforcing durable write. `dedup_key` per kind: `outside-action:<item_id>` ·
  `datachange:<scope|project>:<brain_slug>:<freshness_token>` · (later) `engagement:<broadcast_id>:<day>`.
- **`readProjectFeed(projectId, scopeSet, {window})`** — Bound rows + Tier-2 scope-matched rows within a recency
  window (e.g. 14d), unread/un-void first. The single read seam **P2's `lib/project/digest.ts` consumes.** P3 does
  not rank; P2 does not bind.

## Emit → carry → read, per kind

| Kind | Emit (writer + seam) | Carry | P2 prompt it enables | Journey | MVP? |
|---|---|---|---|---|---|
| **outside-action** | `writeFeed()` at item-file/build (project open) **and deferred at project birth** in `/api/claim` + `/api/projects/import` | Bound (incl. claim-time) | "pick up the flood chart you saved"; cross-project "you already have this" | **J1** (create-from-anywhere) + **J2** (AI already knows) | **YES — ships before or in parallel with P1** |
| **data-change** | daily change-detection cron under `ingest/`; per-scope `freshness_token` diff (`refinery/lib/freshness.mts`) + new `city-pulse`/permit rows vs last-seen; **material-delta gate via `swfl_reconcile`** | Scope-keyed (project_id NULL) | "the new data shows X — add it to your report?" | **J2** | **YES** |
| engagement | new branch on existing `app/api/webhooks/resend/route.ts` (Svix verify against live Resend shapes before building) | Bound | "your property got 7 clicks from your emails" | **J2** | Deferred |
| external-event | "near your property" geo-matcher cron | Scope-keyed | "Walmart is building near your commercial listing" | **J2** | Deferred |
| platform-feature | release-triggered writer | Scope-keyed / broadcast | "we just got new charts that fit this — want to see?" | **J2** | Deferred |

## MVP build sequence (ship + verify each)

1. **Migration** — `docs/sql/20260617_project_feed.sql`. Run directly (RULE 1), idempotent, `NOTIFY pgrst`. Verify
   table + indexes + RLS; non-owner `select` → 0 rows.
2. **`lib/project/feed.ts`** — `writeFeed()` (dedup ON CONFLICT DO NOTHING, never-throws) + `readProjectFeed()`
   (Bound ∪ Tier-2 scope-match, recency-windowed). Tests: dedup + scope-match + place→ZIP. `bun test lib/project/`.
3. **`lib/project/project-scope.ts`** — pure `projectScopeSet(items)` (reuse the ZIP/place scan in
   `lib/project/derive-name.ts` + the deliverables place→ZIP expander). Feeds `readProjectFeed`. Tests per kind.
4. **outside-action emit** — call `writeFeed()` from `app/api/claim/route.ts` + `app/api/projects/import/route.ts`
   (one row per claimed/imported item, `payload` = identity key) and from the open-project file/build call sites
   (wrap alongside the existing `recordUse`/`fileItem`/build calls). Verify: claim a draft → bound feed rows appear.
5. **data-change cron** — new `ingest/` job + GHA wrapper + `--dry-run` in the **same PR** (pipeline-freshness rule).
   **PROBE FIRST.** Per-scope freshness-token diff; emit only on a material delta per `swfl_reconcile` verdict (the
   verdict text is the deterministic `title`). Tier-2 rows. Verify: `--dry-run` prints; real run after a token bump
   writes one row per (scope, brain, token); re-run writes nothing (dedup).
6. **Seam test (falsifiability)** — a ~20-line read calling `readProjectFeed` proving Bound outside-action rows +
   Tier-2 data-change rows surface together. Otherwise P3 ships *dark* (a feed no one reads).

## Noise control (the draft above warns about spammy feeds)

All deterministic: **`dedup_key` UNIQUE** kills replays; **rollup at emit** (data-change = one row per
scope/brain/token, naturally capped to the daily-rebuild cadence); **material-delta gate** via `swfl_reconcile` (no
row unless a number the user cares about moved — also the no-invention guard); **recency window** on read (14d);
**`read_at` dampener** so P2 doesn't re-surface acted-on signals; **`void_at`** on source-item delete. A
per-project/day cap is a backstop only — don't build speculatively.

## Sequencing note — `outside-action` is early-shippable (don't defer it to W3)

`outside-action` emit depends only on the **existing** `/api/claim` + `/api/projects/import` seams — no P1 shell, no P2 prompt engine, no new UI. It can ship **before or in parallel with Piece 1**, unlike engagement/external-event/platform-feature which all need P1 or P2 to be useful.

The W3 framing in `06-convergence-and-journeys.md` lumps all of P3 into the final wave. This is a planning default; the `outside-action` kind is **pullable to W1 or even W0** if the operator wants "together while apart" to work immediately on claim/import. Flag this before sequencing so the wave plan doesn't accidentally defer the one P3 slice with no P1 dependency.

## Composition with the rest of the program

- **P1 `setAiContext`** (in-session) and **P3 `project_feed`** (durable) are orthogonal halves of the one bus; P3
  never touches `setAiContext`.
- **P2 is the only reader** of `project_feed`, via `readProjectFeed` inside `lib/project/digest.ts`. The `payload`
  jsonb is the P3→P2 convergence handoff. **Do not build P2 here.**
- **Sequencing win:** outside-action emit depends on the **existing** claim/import seams, not on P1 — so this MVP
  can ship **before or in parallel with Piece 1**. Add the `outside-action` kind + `writeFeed`/`readProjectFeed`
  seams to the `00-MASTER-PLAN.md` cross-build contract matrix in the **same commit** (FINAL BOSS rename rule).

## Standards that bind

PROBE FIRST before the change-detection cron · cron wrapper + `--dry-run` same PR · `swfl_reconcile`/freshness
cadence verified live · destructive writes need a non-null guard (none here — append + soft-void only) · brain-first
gate if the cron touches any Tier-2 write · no-invention: every `title`/`detail` deterministic or passes the lints ·
monetization: this is authoring-side fuel — **never gate it; SEND stays the only paywall** · vendor-first (verify
Resend `email.opened`/`email.clicked` shapes in-session) when the engagement branch later lands.

## Open decisions for the operator (defaults chosen; flag to override)

1. **`projects.scope` store vs. derive** — default **derive from items at read time** (no migration); store only if
   projects routinely span many disjoint ZIPs and the query gets hot.
2. **outside-action granularity** — default **one row per filed item** + a per-day cap (vs. a rolled-up "you staged
   4 things").
3. **Self-heal on delete** — default **yes** (`void_at` when the source item is removed).
4. **`kind` free-text vs. enum** — default **free-text** + a lint warning on unknown kinds (mirrors
   `email_schedules.topic`; avoids an ALTER per new kind).

## Verification (end to end)

`bun test lib/project/` green (feed dedup, scope-match, place→ZIP, scope-derivation). Run the migration; non-owner
select → 0. Claim/import a draft → `outside-action` rows land **bound** to the new project. Bump a brain's freshness
token, run the cron `--dry-run` then for real → one `data-change` row per (scope, brain, token); re-run → zero.
`readProjectFeed(projectId, projectScopeSet(items))` for a project whose scope overlaps → **both** the bound
outside-action rows and the scope-keyed data-change row return in one read. Full suite + `next build` + lint green.

## Critical files

- **New:** `docs/sql/20260617_project_feed.sql` · `lib/project/feed.ts` (`writeFeed`/`readProjectFeed`) ·
  `lib/project/project-scope.ts` (`projectScopeSet`) + tests · `ingest/<change-detection>/` job + GHA wrapper.
- **Wire emit into:** `app/api/claim/route.ts` · `app/api/projects/import/route.ts` · open-project file/build call
  sites (near existing `recordUse`).
- **Reuse (don't rebuild):** `lib/highlighter/meter.ts:43-82` (never-throws writer) ·
  `docs/sql/20260613_buyer_intent_events.sql` (owner-RLS shape) · `docs/sql/20260613_email_send_ledger.sql`
  (dedup_key idempotency) · `docs/sql/20260613_email_schedule_scope.sql` (scope contract verbatim) ·
  `refinery/lib/freshness.mts` (token diff) · `swfl_reconcile` (material-delta gate) · `lib/project/derive-name.ts`
  (place/ZIP scan).
- **Update same commit:** `00-MASTER-PLAN.md` cross-build contracts (add `outside-action` + the two seams) · this
  file's header status when built.
- **Defer (named, not built):** engagement branch on `app/api/webhooks/resend/route.ts` · external-event matcher ·
  platform-feature writer.

---

# AUDIT-VERIFIED BUILD CONTRACT (2026-06-17) — LOCKED · supersedes the draft above on conflict

> Brainstorm output. Scope locked with the operator; every load-bearing claim below was verified
> against the live code by an 8-agent ground-truth audit (P1 + P2 are built on `main`). This is
> what gets built. Held for operator diff-review per RULE 1 (live surfaces) — operator pushes.

## Locked scope (2 operator decisions)
1. **Wire it through — P3 ships LIVE, not dark.** This piece wires `readProjectFeed` into P2's
   `digest.ts` + adds ONE capped feed-fueled prompt, so the broker actually sees the signals.
   (`lib/project/digest.ts` is therefore IN scope, not deferred — corrects the draft's defer line.)
2. **Both kinds this piece** — `outside-action` (birth emit) **and** the `data-change` cron.
   Deferred (designed, not built): engagement · external-event · platform-feature.

## 7 ground-truth corrections to the draft above
1. **Emit surfaces = birth (claim/import) + build — NOT "item-file."** `briefcase.fileItem` is
   localStorage-only; the item-add PATCH is silent (no `recordUse`). The draft's "near
   `recordUse`/`fileItem`" is a red herring. MVP `outside-action` emits at the **birth** seams:
   `app/api/claim/route.ts` (after the insert/`23505` check) + `app/api/projects/import/route.ts`
   (after the insert) — one row per claimed/imported item.
2. **`writeFeed` opens its OWN service-role client.** claim/import run on the cookie client; the
   feed is owner-reads / service_role-writes. Mirror `lib/highlighter/meter.ts:63-82`
   (`createServiceRoleClient`, never-throws).
3. **The draft SQL omits the RLS policy → DENY-ALL.** It `ENABLE`s RLS but defines no policy. Add
   the `buyer_intent_events_owner_all` block verbatim (idempotent `DO $$ … EXCEPTION WHEN
   duplicate_object`): `FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id)`.
4. **IDENTITY PK confirmed safe** — `id bigint GENERATED ALWAYS AS IDENTITY` sidesteps the
   bigserial `42501` sequence-grant trap that bit the email tables (no `GRANT USAGE` needed).
5. **`projectScopeSet` WRAPS the existing `inferScopeFromItems`** (`lib/project/derive-name.ts` —
   P2's one scope root, returns `{zip?,place?,topic?}`), NOT a re-derive. Returns a **set** of
   `{scope_kind,scope_value}` so a place-scoped project matches ZIP-keyed rows.
6. **The "place→ZIP expander" the draft says to reuse does NOT exist** (the deliverables build path
   stores scope verbatim, defers to render). The DATA does: `PLACE_ZIP_CROSSWALK`
   (`refinery/lib/geography-gazetteer.mts`, entries `{place,zip,alt_zips[]}`). Add one small
   `zipsForPlace(place): string[]` = `[entry.zip, ...entry.alt_zips]`.
7. **data-change cron wrinkle: freshness tokens are PER-BRAIN (lake-wide), no geo dimension; there
   is NO last-seen store.** Resolution below (the feed row IS the snapshot).

## Schema — `docs/sql/20260617_project_feed.sql`
The draft schema (§ above) **with correction #3 applied** (the missing `CREATE POLICY` block) and
correction #4 (IDENTITY PK). Run directly per RULE 1, idempotent, `NOTIFY pgrst`. Verify: table +
3 indexes + RLS policy present; non-owner `select` → 0 rows.

## Seams — `lib/project/feed.ts` (one writer, one reader, both never-throw, mirror `meter.ts:63-82`)
- `writeFeed(rows)` — own service-role client; `upsert(rows,{onConflict:'dedup_key',
  ignoreDuplicates:true})` (= ON CONFLICT DO NOTHING); `try/catch → count|0`.
- `readProjectFeed(projectId, scopeSet, {windowDays=14})` — Bound (`project_id=$id`) ∪ Tier-2
  scope-matched (`project_id IS NULL AND (scope_kind,scope_value) ∈ scopeSet`); unread + un-void
  first; recency-windowed; owner-scoped (cookie client / RLS).
- `markFeedSeen(feedIds)` — sets `read_at` so acted-on signals stop surfacing (mirror
  `buyer_intent_events.read_at`).

## `lib/project/project-scope.ts`
`projectScopeSet(items): {scope_kind,scope_value}[]` = `inferScopeFromItems(items)` → expand
`place` via `zipsForPlace`. Pure; fully `bun:test`'d (zip / place→ZIPs / topic-only / empty).

## `outside-action` emit (birth)
One `writeFeed` row per item at the two birth seams. `project_id=new id`,
`dedup_key=outside-action:<item.id>`, `payload.identityKey = identityKeyForItem(item)`
(`lib/project/identity-key.ts` — kind-prefixed; lets P2's cross-project index match without
re-deriving). claim is idempotent (deterministic id + `23505` absorb); import uses a random id.

## `data-change` cron — `ingest/project-feed-change-detection/` + GHA wrapper
Honest design around correction #7:
- **Live scope set** = union of `projectScopeSet` over all projects; **read-deduped by scope**
  (read each unique live ZIP once), **write-fanned-out per user** (rows need `user_id`; owner-RLS
  forces per-user, `project_id` NULL → late-bind at read time in `readProjectFeed`).
- **Material gate, no new table — the feed row IS the snapshot.** Each `data-change` row's
  `payload` carries the observed headline value(s) + token for its (scope, brain). The cron
  compares current vs the **last `data-change` row's `payload`** for that (user, scope, brain);
  emits ONLY when the number actually moved (not on a bare daily token bump → that's noise).
  `title` = the deterministic `swfl_reconcile` `reason` string (`lib/reconcile/reconcile.ts`).
- **Cold-start mute:** no prior (user, scope, brain) row → insert the baseline with `read_at=now()`
  (recorded, not surfaced); a real move later → unread (live) row.
- `dedup_key=datachange:<scope>:<brain>:<token>` kills replays. **Append-only to an app table (not
  `data_lake.*`)** → brain-first / destructive-write gates DON'T apply; **PROBE FIRST DOES** (time
  the per-scope reads). Runs daily AFTER the rebuild. GHA wrapper + `--dry-run` in the **same PR**
  (mirror `.github/workflows/bls-laus-monthly.yml`); `ingest/cadence_registry.yaml` entry.

## P2 wiring (the "ships live" fix — 3 additive wires, P2 is built so additive-only)
1. `app/project/[id]/page.tsx` (server) loads `readProjectFeed(projectId, projectScopeSet(items))`
   → passes `feedRows` prop (alongside the `ui_state`/`schedules` it already loads).
2. `lib/project/digest.ts`: add optional `feedRows` to `ProjectDigestInput`; fold top signals into
   a new `feedSignals` field on `ProjectDigest` (pure; bumps `rev` via existing `computeRev` basis).
3. `lib/project/prompt-engine.ts`: extend `ProjectSignals`; add ONE feed candidate in
   `openProjectCandidates`, ranked (between `freshData` and `staleMetric`), capped to top-1,
   respecting `read_at` / `ui_state.dismissed_overlap_keys`. Dismiss → `markFeedSeen`.

## Build order (TDD; ship + verify each)
Schema → `feed.ts` → `project-scope.ts` → `outside-action` emit → **P2 wire** → `data-change` cron
→ seam test. (P2 wire before the cron so `outside-action` is live end-to-end first.) Seam test:
`readProjectFeed(projectId, projectScopeSet(items))` returns bound `outside-action` AND scope-keyed
`data-change` rows together (else P3 ships dark). Gate each step: `bunx tsc --noEmit && bunx eslint
. && bun test`; full `next build` before the hold. Update `00-MASTER-PLAN.md` cross-build contracts
(add `outside-action` kind + the `writeFeed`/`readProjectFeed` seams) in the same commit.
