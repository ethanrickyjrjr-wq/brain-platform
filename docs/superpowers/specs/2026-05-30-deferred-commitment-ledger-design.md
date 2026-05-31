# Deferred-Commitment Ledger (`/checks`) — design

**Date:** 2026-05-30
**Status:** design approved by operator 2026-05-30; build assigned to CT (in daylight, not against a clock).

> ## ⛔ BUILD LOCATION — READ BEFORE WRITING ANY CODE. DO NOT CROSS THE STREAMS.
>
> - **Page + API + CSS components go in `C:\Users\ethan\dev\swfldatagulf-ops\`** — the Next.js
>   ops dashboard. This is where `lib/checks.ts`, `lib/checks-signal.ts`,
>   `app/api/checks/route.ts`, `app/checks/*`, and the `globals.css` / `app/page.tsx` edits live.
> - **This spec and the SQL migration live in `brain-platform`** (shared-Supabase migrations
>   home). The `.sql` is a _record_ of the migration Claude runs via psycopg3 — it is **not**
>   built or applied from swfldatagulf-ops.
> - You are reading this spec _from_ brain-platform. **Do not build the page here.** `cd` to
>   `swfldatagulf-ops` for all component work. The full per-file repo mapping is in §10.
>
> **CT: start at §2 (Verified signal facts) — those landmines are the implementation plan for
> the tricky parts. There is no separate writing-plans doc by design.**
>
> No time pressure: auto-resolution is not window-bound. `table_fresh` (`MAX(run_at) >= due_at`)
> stays true forever once the first rows land, so the page auto-crosses-out on its first load
> after data exists — whether that is during the 09:00 UTC window or days later. If the page
> ships after the first cron, the operator just marks the two auto rows done by hand that once;
> the checks still exist in the DB and show `open` until then. Build it right, not fast.

---

## 1. What this is — and is not

`/checks` is a **deferred-commitment ledger**: the place the mid-build promises live so they
stop dying in session logs and never resurfacing. The existing `/ops` ledger
(`lib/ledger.ts`) already tracks _machine_ signals (cron health, GHA runs, brain freshness,
service pings). It structurally cannot see a verbal "we'll do X next" — because the signal
for that is **"a human did the thing and attested,"** not a table read.

**It IS for:**

- Project-level commitments ("ship v2 of story_key supersession", "wire conversation→flywheel").
- "Make sure this is working" verifications (often self-clear when a signal goes green).

**It is NOT for:**

- Mirroring cron/GHA health — the ledger owns that.
- Dev mechanics — **no `git push`, no `git pull`, no SQL chores**. Only substantive
  project changes and verifications.
- Auto-harvesting every line of every session-ending summary. **A check exists only because
  someone deliberately wrote it** (Claude writes a commitment, or the operator does).

---

## 2. Verified signal facts (read before touching the schema — these are landmines)

These were verified live on 2026-05-30, not assumed. Do not regress them.

1. **The `city_pulse` _pipeline_ row in the ledger is a false signal.** In
   `cadence_registry.yaml`, `city_pulse` is `lane: tier-1`, and `buildPipelines`
   (`ledger.ts:146`) does `else if (e.lane !== "tier-2") status = "green"` — **tier-1
   pipelines report green unconditionally**, before any run. Binding an auto-check to it
   would cross the check out instantly and always. **Do not bind to the pipeline row.**

2. **`data_lake.city_pulse` has no `inserted_at` column.** Live columns:
   `id, city, topic, fact, source_url, source_title, cited_text, captured_at (tz),
expires_at (tz), dedup_key, superseded_by, run_at (tz)`. The existing
   `directTableFreshness` helper (`lib/supabase.ts`) queries `inserted_at` and would error →
   `available:false` → the check would **silently never resolve**. The `table_fresh` probe
   below must read **`run_at`** via its own small query, not that helper.

3. **Workflow identifiers (verified):** file `.github/workflows/city-pulse-daily.yml`,
   `name: "City pulse daily"`, cron `0 9 * * *` (09:00 UTC). `buildWorkflows`
   (`ledger.ts:198`) keys runs by `path.replace(".github/workflows/", "")` →
   the ledger id is **`city-pulse-daily.yml`**; status is green iff
   `conclusion === "success"`. This IS a real signal.

4. `public.checks` did not exist as of 2026-05-30; the migration creates it.
   `data_lake.city_pulse` had **0 rows** (test rows cleaned), so "first live data" is
   genuinely pending.

---

## 3. Data model — `public.checks`

```sql
CREATE TABLE IF NOT EXISTS public.checks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project     text        NOT NULL,                 -- grouping key; new strings = new groups
  check_key   text        NOT NULL UNIQUE,          -- stable id, used by all writes
  label       text        NOT NULL,
  detail      text,
  resolution  text        NOT NULL DEFAULT 'manual'
              CHECK (resolution IN ('auto','manual','both')),
  signal      jsonb,                                -- non-null iff resolution IN ('auto','both')
  priority    smallint    NOT NULL DEFAULT 0,       -- >0 pins to the TODAY band
  due_at      timestamptz,                          -- drives the TODAY band
  state       text        NOT NULL DEFAULT 'open'
              CHECK (state IN ('open','done','dropped')),
  drop_reason text,                                 -- required-by-convention when state='dropped'
  resolved_at timestamptz,                          -- THE falloff anchor (see §5)
  resolved_by text,                                 -- 'auto:<key>' | 'operator' | 'claude'
  created_at  timestamptz NOT NULL DEFAULT now(),   -- drives the SITTING LONGEST band
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS checks_open_idx    ON public.checks (state) WHERE state = 'open';
CREATE INDEX IF NOT EXISTS checks_project_idx ON public.checks (project);
GRANT SELECT, INSERT, UPDATE ON public.checks TO service_role;
```

`signal` shapes:

```jsonc
// workflow succeeded (reuses latestWorkflowRuns)
{ "type": "workflow_success", "workflow": "city-pulse-daily.yml" }

// rows landed at/after the scheduled window (NEW query on run_at — NOT directTableFreshness)
{ "type": "table_fresh", "table": "data_lake.city_pulse", "column": "run_at", "since": "due_at" }
```

`since: "due_at"` means: green iff `MAX(run_at) >= checks.due_at`. (Robust against stray old
rows; for a strictly first-ever milestone `count(*) > 0` would also do, but `run_at >= due_at`
is the safe default.)

---

## 4. Resolution types & badges

Three badge **colors** (badges, not columns — columns would fracture the urgency-first sort,
letting a Jun 15 auto check outrank a Jun 4 manual one purely by type):

| `resolution` | meaning                                              | badge     | colour intent             |
| ------------ | ---------------------------------------------------- | --------- | ------------------------- |
| `auto`       | only a signal resolves it; no button                 | ⚙ AUTO    | cyan/blue (cf. `#06b6d4`) |
| `manual`     | only a human resolves it (operator or Claude)        | ✋ MANUAL | amber                     |
| `both`       | a signal _or_ a human can resolve it; first one wins | ⚙✋ BOTH  | violet/teal               |

`both` exists for checks that have a real signal but where the operator may also want to
close them early by hand. CT: add `.badge-auto`, `.badge-manual`, `.badge-both` to
`globals.css` (the only new CSS).

---

## 5. Falloff — one unified rule for auto and manual

`resolved_at` is the single source of truth for visibility, evaluated at render against the
**operator day = America/New_York** (not UTC):

- `resolved_at` **null** → **open** (live, sortable into a band).
- `resolved_at` **on the current operator-day** → **struck-through**, stays visible all day
  (the satisfying "it happened" state).
- `resolved_at` **on a past day** → **hidden** (it "fell off at end of day").

Both auto and manual converge here: marking done (any path) writes `resolved_at`. No falloff
cron is needed in v1 — falloff is derived at render when the ET date rolls.

**Auto rows are one-time milestone confirmations.** Once resolved, a later signal regression
does not re-open them — ongoing health is the ledger's job (this is why GHA-green is scoped to
"first post-ship run", per operator decision). No re-open logic in v1.

---

## 6. Auto-resolution mechanics + race guard (Flag 2)

On page load (server component, `revalidate = 0`), for every `open` row with
`resolution IN ('auto','both')`: evaluate its `signal`; if green, resolve it.

The resolving UPDATE **must be conditional at the DB layer**, not in app logic — two open
tabs (or a tab + a manual click + the cron in v2) race otherwise:

```sql
UPDATE public.checks
   SET state = 'done', resolved_at = now(), resolved_by = $by, updated_at = now()
 WHERE check_key = $key AND resolved_at IS NULL;
```

Postgres row locking makes the second concurrent write affect 0 rows — idempotent, no double
resolve. The same guarded UPDATE backs the manual "done" path and the `both` race.

**Signal evaluator** (`lib/checks-signal.ts`, server-only). Each probe returns a **tri-state**,
never a bare boolean: `"green" | "not_green" | "unavailable"`. `unavailable` means the signal
_source_ (PAT / Supabase / network) could not be read — distinct from "read it, not green yet."

```ts
type Probe =
  | { type: "workflow_success"; workflow: string }
  | { type: "table_fresh"; table: string; column: string; since: "due_at" };
type SignalState = "green" | "not_green" | "unavailable";

async function evaluate(
  probe: Probe,
  check: { due_at: string | null },
): Promise<SignalState> {
  try {
    if (probe.type === "workflow_success") {
      const { available, runs } = await latestWorkflowRuns(); // lib/github.ts — see auth note
      if (!available) return "unavailable"; // PAT unset / GH API error
      // WorkflowRun has NO `id` field — match on `path`, same transform buildWorkflows uses.
      // path = ".github/workflows/city-pulse-daily.yml"; probe.workflow = "city-pulse-daily.yml".
      const run = runs.find(
        (r) => r.path.replace(".github/workflows/", "") === probe.workflow,
      );
      if (!run) return "not_green"; // workflow hasn't run yet
      return run.conclusion === "success" ? "green" : "not_green";
    }
    // table_fresh — DO NOT call directTableFreshness (hardcoded to inserted_at; city_pulse has none).
    if (!check.due_at) return "not_green";
    const [schema, table] = probe.table.includes(".")
      ? probe.table.split(".", 2)
      : ["public", probe.table];
    const sb = createClient(URL, KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema },
    });
    const { data, error } = await sb
      .from(table)
      .select(probe.column)
      .order(probe.column, { ascending: false })
      .limit(1);
    if (error) return "unavailable"; // missing col / perms / network
    const latest = data?.[0]?.[probe.column] as string | undefined;
    if (!latest) return "not_green"; // table empty — no rows landed yet
    return new Date(latest) >= new Date(check.due_at) ? "green" : "not_green";
  } catch {
    return "unavailable";
  }
}
```

**Auth path (locked — Flag 1):** `workflow_success` reuses `latestWorkflowRuns()`, which reads
**`GITHUB_PAT`** (NOT a new `GITHUB_TOKEN`) and targets `GITHUB_REPO` (default
`ethanrickyjrjr-wq/brain-platform`, where `city-pulse-daily.yml` lives). **This var is already
set in the ops Vercel project** — the live "GitHub Actions" ledger category only renders
because this same call succeeds in prod; if `GITHUB_PAT` were missing, that whole category
would be empty and the home page's "Signal degraded" banner would show. So no new env var, and
CT does **not** invent an auth path — it calls the existing helper. (`.env.example:4–9`
documents the var + required scopes `repo (read), actions:read`.)

**Acting on the tri-state at render:**

- `green` → run the guarded UPDATE above (`resolved_by = 'auto:' + check_key`).
- `not_green` → leave `open`, render normally (no note — this is the expected pre-signal state).
- `unavailable` → leave `open` **but render a small `row-note`: "signal unavailable — confirm
  by hand."** Never sit silently. A `both` row is always still manually closable; an `auto` row
  whose source is unavailable should expose a one-off manual "mark done" affordance so a
  degraded signal can't strand it forever.

Evaluator never throws into the render (outer `try/catch` → `unavailable`).

---

## 7. Layout & placement (fully dynamic — nothing hand-placed)

Project groups derive from `DISTINCT project` over visible rows; a brand-new `project` string
makes a new group appear automatically. Three bands, each row in **exactly one** (dedup by
priority of placement, top wins):

1. **TODAY / DUE NOW** (top, cross-project, auto-populated): `overdue` OR `due_at` within
   **`TODAY_HORIZON_HOURS = 48`** OR `priority > 0`. Sort: overdue first, then `due_at` asc,
   then `priority` desc. (Both horizons — this and `SITTING_LONGEST_DAYS` — are single tweakable
   constants in the page module.)
2. **Project groups** (middle): everything else, grouped by `project`. Groups ordered by their
   most-urgent member's `due_at`. Within a group: `due_at` asc nulls-last, then `created_at` asc.
3. **SITTING LONGEST** (bottom, pinned, cross-project): `open` AND `created_at` older than
   **`SITTING_LONGEST_DAYS = 7`** (Flag 3 default; single tweakable constant) AND not already
   in TODAY. Oldest first. This band keeps getting pushed down as new project groups appear above.

Done-today (struck-through) rows render greyed at the bottom of whichever band/group they were
in. Empty bands hide entirely; when nothing is visible, show a full-width green banner
"All promises kept ✓" (mirrors the home page's auto-hiding `DailyTracker`).

ASCII reference:

```
CHECKS — open promises                         [2 today · 2 auto · 4 sitting]
Legend: ⚙ AUTO (self-clears)  ✋ MANUAL  ⚙✋ BOTH   strike = done today, drops at midnight ET

▾ TODAY / DUE NOW ───────────────────────────  (cross-project, urgent floats up)
  ⚙ city_pulse   Eyeball first 09:00 UTC rows landed     due 09:00Z
  ⚙ city_pulse   GHA green on first post-ship run        due 09:00Z

▾ flywheel ──────────────────────────────────
  ✋ conversation→flywheel write-back (the moat)          due Jun 6
  ✋ volume guard / cleaning agent                        due Jun 4

▾ city_pulse ────────────────────────────────
  ✋ story_key content-aware supersession                 due Jun 15
  ✋ weekly corridor trigger                              due Jun 15

▾ SITTING LONGEST ───────────────────────────  (open > 7d — the nag)
  (oldest open items float here, pushed down as projects come in)
```

---

## 8. API surface — `app/api/checks/route.ts`

`export const dynamic = "force-dynamic";` inline `createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)`
(service role, server-only — same pattern as `app/api/notes/route.ts`).

**Who runs the auto-resolution pass:** the **server component** (`app/checks/page.tsx`,
`revalidate = 0`) — it queries Supabase directly (like `/goals`) AND runs the §6 pass before
rendering. _A page load is what triggers auto-cross-out._ The API does not own initial render;
it owns mutations:

- **PATCH** `{ check_key, action: "done" | "drop", drop_reason? }`:
  - `done` → the guarded conditional UPDATE (§6), `resolved_by = 'operator'`.
  - `drop` → `state='dropped', resolved_at=now(), drop_reason=$reason`, same guard.
- **GET** (optional) → same visible-rows shape, for the client to refresh after a PATCH
  instead of relying solely on optimistic local state. Not used for initial render.

Claude can also write/resolve rows directly via psycopg3 + `.dlt/secrets.toml` (same as
`ops_notes`). When Claude finishes v2 of a tracked item, it marks that row `done`
(`resolved_by='claude'`).

---

## 9. Seed rows (exact)

Insert with `ON CONFLICT (check_key) DO NOTHING`. Run by **Claude via psycopg3, idempotent,
row count verified** — never handed to the operator (Rule 1).

| check_key                    | project    | label                                       | resolution | signal                                       | due_at (UTC)     |
| ---------------------------- | ---------- | ------------------------------------------- | ---------- | -------------------------------------------- | ---------------- |
| `city_pulse_first_rows`      | city_pulse | Eyeball first 09:00 UTC cron rows landed    | `auto`     | `table_fresh` city_pulse.run_at since due_at | 2026-05-30 09:00 |
| `city_pulse_first_gha`       | city_pulse | GHA green on first post-ship cron run       | `auto`     | `workflow_success` city-pulse-daily.yml      | 2026-05-30 09:00 |
| `flywheel_writeback`         | flywheel   | conversation→flywheel write-back (the moat) | `manual`   | —                                            | 2026-06-06       |
| `flywheel_volume_guard`      | flywheel   | volume guard / cleaning agent               | `manual`   | —                                            | 2026-06-04       |
| `city_pulse_story_key`       | city_pulse | story_key content-aware supersession        | `manual`   | —                                            | 2026-06-15       |
| `city_pulse_weekly_corridor` | city_pulse | weekly corridor trigger                     | `manual`   | —                                            | 2026-06-15       |

---

## 10. Files

| File                           | Repo             | Action                                                                    |
| ------------------------------ | ---------------- | ------------------------------------------------------------------------- |
| `docs/sql/20260530_checks.sql` | brain-platform   | Create — DDL + seed (record of the migration Claude runs)                 |
| `lib/checks.ts`                | swfldatagulf-ops | Create — SELECT reader (like `lib/goals.ts`)                              |
| `lib/checks-signal.ts`         | swfldatagulf-ops | Create — `workflow_success` + `table_fresh` evaluators (§6)               |
| `app/api/checks/route.ts`      | swfldatagulf-ops | Create — GET + PATCH (§8)                                                 |
| `app/checks/ChecksTable.tsx`   | swfldatagulf-ops | Create — client; bands, badges, optimistic done/drop                      |
| `app/checks/page.tsx`          | swfldatagulf-ops | Create — server; runs auto-pass, renders bands                            |
| `app/globals.css`              | swfldatagulf-ops | Edit — `.badge-auto/.badge-manual/.badge-both` only                       |
| `app/page.tsx`                 | swfldatagulf-ops | Edit — add `<Link href="/checks" className="catnav-pill">Checks ✓</Link>` |

> The original plan's `docs/sql/` in **swfldatagulf-ops** is dropped — the shared-Supabase
> migration belongs in brain-platform alongside the goals/flywheel migrations.

---

## 11. Parked for v2 (explicitly out of v1 scope)

- **Supporting-context render** — showing live machine detail ("14 rows landed 09:03 UTC")
  beside a manual check. Cut: it requires wiring ledger detail into the page; separate build.
- **Overdue → sticky issue #44 pipe** — a GHA cron that posts overdue commitments to an alert
  channel so they don't rot off-screen. Deferred until the page is proven for ~a week; #44 is
  for _machine_ cron failures and mixing human drift in would make it noise. v1 is page-only.
- **Recurring daily eyeball** — a check that re-opens each day to nudge a human to look at
  fresh rows even when green. Redundant with the ledger for now; revisit if data-quality
  (not just job-success) needs a human gate.

---

## 12. Acceptance

- `cd swfldatagulf-ops && npm run build` exits clean (types, server/client boundaries).
- Migration applied; `SELECT count(*) FROM public.checks` = 6.
- `/checks` renders the 6 seed rows in the right bands; the two auto rows show ⚙ and are
  still open (no green signal yet — table empty, no successful run).
- After the first successful 09:00 UTC run lands rows: both auto rows cross out on next page
  load, stay struck-through, and are hidden after midnight ET. Concurrent reloads do not
  double-resolve (guarded UPDATE).
- `/` shows the "Checks ✓" nav pill.
