# Saved charts, composed boards & PDF export — design

**Date:** 2026-06-07
**Status:** Design — ready for an Opus build. Final piece of the three-spec set: `2026-06-07-highlighter-in-page-ask-chart-design.md` (ask + trigger), `2026-06-07-chart-generation-three-tier-design.md` (produce a chart), **this** (save it, compose it, export it).
**Grounded by:** the 2026-06-07 `charts-boards-spec-audit` (7 agents). Every file:line was read in-session.

---

## Why this spec exists — the operator's north-star

The literal goal: _"type what I want → get a chart → combine it with an /r/ I already read → **save it as one PDF/doc**."_ The Highlighter + Charts specs deliver "type/point → get a chart/answer." They do **not** deliver **save · combine · export**. This spec does, and it's the piece a fresh Opus would otherwise guess at — so the audit grounding matters most here.

**This already a promised feature, not a new idea:** the audit found the marketing copy _"Ask Claude for a sourced PDF or doc, get one"_ live in `app/waitlist-form.tsx:31`, and `app/privacy/page.tsx:28` lists _"document export"_ among things we may ship. This spec is the implementation of that promise — name it consistently.

---

## Verified ground truth (what exists vs. greenfield)

| Thing                                                                                          | Reality (audited)                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/c/`, `/board`, `/boards` routes                                                              | ❌ **none** — fully greenfield, nothing to duplicate (`app/c/**`, `app/board*/**` = no files)                                                                                                                                                                                                   |
| PDF/print library (`@react-pdf`, `puppeteer`, `playwright`, `jspdf`, `html2canvas`, `pdf-lib`) | ❌ **none installed** (`package.json` grep = 0)                                                                                                                                                                                                                                                 |
| `@media print` reaching the app                                                                | ❌ only in two standalone non-routed HTML files; `app/globals.css` has no print rules                                                                                                                                                                                                           |
| Image/screenshot export (`ImageResponse`, `toDataURL`)                                         | ❌ none in routed code                                                                                                                                                                                                                                                                          |
| Supabase clients                                                                               | ✅ in **`utils/supabase/`** (NOT `lib/`): browser/server/middleware use the **anon publishable** key; **`service-role.ts`** uses `SUPABASE_SERVICE_KEY` (bypasses RLS, server-only)                                                                                                             |
| Magic-link auth                                                                                | ✅ **real & working** — `/login` `signInWithOtp` (`login-form.tsx:20`) → `/auth/callback` `exchangeCodeForSession` → middleware refreshes the cookie. **BUT unenforced**: no route is gated, the matcher even excludes `/api/*`, and **zero `auth.uid()` RLS policies exist in the whole repo** |
| `personal_vault` SQL                                                                           | ⚠️ single-tenant template (`docs/sql/20260517_personal_vault.sql`): **no `user_id`, no RLS, no policy**, service-role-only; its own header makes `user_id UUID NOT NULL` a hard prereq for any non-Ricky user                                                                                   |
| `usage_events`                                                                                 | ❌ does not exist — only prose in the Highlighter spec; build from scratch                                                                                                                                                                                                                      |
| Supabase Storage                                                                               | ❌ no `.storage.from` usage; existing S3 creds are the Tier-1 Parquet lane, **not** user content → boards persist in **Postgres**, not Storage                                                                                                                                                  |
| Money path (`$39/$79`, Stripe)                                                                 | ❌ **no payment processor anywhere**. The "$39/$79 zip-report gate" is **marketing copy + a `mailto:`** (`app/r/zip-report/[zip]/page.tsx:205-228`), page fully public. Real wall = new processor (deliberately deferred WTP test)                                                              |
| `/#waitlist`                                                                                   | ✅ real soft wall — anchor → `POST /api/waitlist` → Supabase `waitlist` table + Resend email (`app/api/waitlist/route.ts:34-76`)                                                                                                                                                                |
| `assertAuthorized` (MCP bearer)                                                                | ✅ real but **all-or-nothing** single shared `MCP_BEARER_TOKEN` (unset = open), gates only `/api/mcp`                                                                                                                                                                                           |
| Reusable shell/viz                                                                             | ✅ `app/r/_components/report-shell.tsx` (`ReportShell/Header/Footer/SectionTitle/Chip/Stat`), `components/charts` (`ChartBlockView`/`HBarChart`), `components/viz/*`                                                                                                                            |

**The single biggest implication:** a user-owned board needs the **first real `auth.uid() = user_id` RLS policy in the codebase** — there is no precedent to copy. Identity _exists_ (magic-link) but has never been used for authorization. That makes this spec the place where multi-tenancy actually begins, so it must be deliberate (and it touches the parked tenancy tripwire — `checks: row_tier_t2_tenancy_seam`).

---

## Architecture — three components, built in order

### 1. `/c/[id]` — a saved, shareable single chart (the substrate)

The atom boards compose and the artifact a "save/share this chart" button produces.

- **New table `public.saved_charts`** (service-role write, public read-by-id — a shared chart is meant to be linkable):
  `id text pk` (short slug, generated server-side — **not** `Math.random` in a workflow; a route handler may use `crypto.randomUUID()` sliced), `chart_block jsonb` (a validated `ChartBlock`), `source_meta jsonb` (report slug, the fact/question that produced it, tier), `freshness_token text`, `created_at timestamptz default now()`. RLS enabled; a `SELECT` policy `USING (true)` (public read) + writes only via service-role (the `waitlist`/`docs/sql/20260523_waitlist.sql` GRANT pattern). No `user_id` needed — a saved chart is anonymous + shareable.
- **New route `app/api/charts/save/route.ts`** (`POST {chart_block, source_meta}`) — re-runs `lintChartBlock` structurally (never persist a malformed block), inserts via `createServiceRoleClient()`, returns `{ id }`. Optionally counts 0 uses (saving is free) or 1 (align with the cap talk).
- **New page `app/c/[id]/page.tsx`** — server component, reads `saved_charts` by id, renders `<ChartBlockView block={…}/>` inside a minimal `ReportShell`, shows `source_meta` provenance + the `freshness_token` (CLAUDE.md provenance rule), and an "Add to board" affordance.

### 2. `/board/[id]` — the composed board (the "combine" surface)

An ordered list a signed-in user assembles from charts they generated and reports they read, plus notes.

- **New table `public.boards`** — `id text pk`, **`user_id uuid not null`**, `title text`, `items jsonb` (ordered array; each item is a discriminated union: `{type:'chart', chart_id}` → a `saved_charts` ref; `{type:'report', slug}` → an `/r/` ref; `{type:'note', text}`), `created_at`, `updated_at`. **RLS ON with the codebase's first identity policy:** `CREATE POLICY board_owner ON public.boards USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)` — reads/writes go through the **anon publishable cookie client** (`utils/supabase/server.ts`), so RLS actually applies (do NOT write boards via service-role, or RLS is bypassed).
- **Gate `/board/*` behind the existing magic-link auth** (which exists but is currently unenforced) — the first genuinely gated route. Anonymous users get a **local (localStorage) draft board** that renders fully and prompts `/login` to persist (no dead-end). This keeps the "use the damn thing first" posture from the Highlighter monetization note.
- **New page `app/board/[id]/page.tsx`** — renders each item inline: charts via `ChartBlockView`, report-refs as a compact card (reuse `Stat`/`SectionTitle` from `report-shell.tsx`), notes as prose. Reuse the locked metric hexes.
- **New route `app/api/boards/route.ts`** (`POST`/`PATCH`) — create/update a board for `auth.uid()`; reorder items; add the chart the user just generated (`{type:'chart', chart_id}` from step 1).

### 3. PDF / doc export (delivering the promise)

- **v1 = client `window.print()` + a print stylesheet — NO new dependency** (respects RULE 1's lockfile gate; nothing to `bun install`). A "Save as PDF" button on `/board/[id]` (and on `/c/[id]` and `/r/[slug]`) calls `window.print()`; the browser's native "Save as PDF" produces the file.
- **New print CSS** — a scoped `@media print` block (in `app/globals.css` or a dedicated `print.css` imported by the board layout): hide nav/footer/buttons/upsell chrome, force white background, expand charts to full width, page-break between items, keep source citations + the freshness token visible (provenance must survive export). `report-shell.tsx` currently has **no** print styles — this is net-new here.
- **`HBarChart` print caveat:** it animates via `gsap`/`useLayoutEffect` and is fixed-px — verify it paints a stable final frame for print (no mid-animation capture) and fits the print column; the responsive fix from the Charts spec helps here.
- **Future (out of scope): server-side PDF** (`@react-pdf` or headless `puppeteer`) for pixel-stable, no-browser-needed exports (e.g. an MCP/email-delivered PDF). That **adds a dependency** ⇒ triggers the RULE-1 lockfile gate (`bun install` + `git add bun.lock` same push). Defer until a real demand (e.g. "email me the PDF") exists.

---

## Data flow (end to end)

```
Highlighter "Chart this"  ──(Charts spec, Tier B/C)──►  ChartBlock
        │ user hits "Save / Share"
        ▼
POST /api/charts/save  ──►  saved_charts row  ──►  /c/[id]   (shareable, anonymous)
        │ user hits "Add to board"  (login if anonymous)
        ▼
POST/PATCH /api/boards  ──►  boards.items += {type:'chart', chart_id}   (RLS: auth.uid()=user_id)
        │ + add {type:'report', slug} for an /r/ they read, + {type:'note', text}
        ▼
/board/[id]  renders all items inline  ──►  "Save as PDF"  ──►  window.print()  ──►  user's PDF
```

---

## Monetization hook (mechanism only — numbers are the deferred talk)

- Saving a chart, creating a board, and exporting can each be a **metered unit** in the same `usage_events` table the Highlighter spec defines — counting from day one, **enforcement off**.
- The wall, when it lands, reuses **`/#waitlist`** (real) as the soft wall. **There is no real charge path** — collecting money is a _separate_, deliberately-deferred decision (no Stripe in the repo; the "$39/$79" is a `mailto` WTP test, `checks: paid_path_wtp`). A spec that says "charge here" would be wrong; it says "wall here, route to the existing access surface."

---

## Build sequencing & dependencies

```
Charts spec Tier A/B  ──►  there's a chart worth saving
        └─►  1. /c/[id] + saved_charts        (anonymous, public read — smallest, ship first)
                  └─►  2. /board/[id] + boards (needs auth + the first auth.uid() RLS policy)
                            └─►  3. PDF export (window.print() + print CSS — no dependency)
```

Auth already exists, so step 2 is "enforce the existing magic-link on one route + add the first RLS policy," not "build auth." Each step: `SESSION_LOG.md` entry + `safe-push` + `checks` reconcile. The RLS migration runs **directly** (psycopg, idempotent, `IF NOT EXISTS` / `CREATE POLICY` guarded), verified by row count — never handed to the operator (CLAUDE.md RULE 1).

---

## Verification

- **`/c/`:** save a generated chart → `saved_charts` row → `/c/<id>` renders it with source + freshness token; a malformed block is rejected by `lintChartBlock` at the save route, not persisted.
- **`/board/`:** signed-in user creates a board, adds a chart + a report-ref + a note, reorders; a **different** signed-in user cannot read it (RLS `auth.uid() = user_id` actually denies — the first real test of identity authz); anonymous user gets a local draft + login prompt, never a dead-end.
- **PDF:** "Save as PDF" on a board produces a clean doc — nav/buttons/upsell hidden, charts full-width, **citations + freshness token present**, page-breaks between items, no mid-animation chart capture.
- **Meter:** save/board/export increment `usage_events`; with a test cap set, the (N+1)th is walled to `/#waitlist`, not executed.
- `bun test` + `npm run refinery:typecheck` (no new strictness errors); if any dependency was added, `bun.lock` is staged in the same push.

---

## Reused seams (audited) + corrections to honor

| Surface                                                   | Status                                      | Builder note                                                                              |
| --------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `utils/supabase/service-role.ts`                          | ✅                                          | service-role writes for `saved_charts` (public artifact)                                  |
| `utils/supabase/server.ts` (cookie/anon)                  | ✅                                          | board reads/writes go through THIS so RLS applies — never service-role for boards         |
| Magic-link auth (`/login`, `/auth/callback`, middleware)  | ✅ exists, **unenforced**                   | gate `/board/*`; this is the first gated route                                            |
| `personal_vault` SQL                                      | ⚠️ single-tenant, no `user_id`/RLS          | reuse column/trigger _shape_; `boards` MUST add `user_id` + the first `auth.uid()` policy |
| `waitlist` SQL + route                                    | ✅ RLS-on-no-policy + service-role + Resend | the GRANT pattern to copy for `saved_charts`; Resend client lazily constructed            |
| `/#waitlist`                                              | ✅ real email-capture anchor                | the soft wall to reuse                                                                    |
| `$39/$79 zip-report`                                      | ❌ copy + `mailto`, not a gate              | do NOT treat as a charge path                                                             |
| `report-shell.tsx` (`ReportShell/Chip/Stat/SectionTitle`) | ✅ Tailwind, **no print styles**            | reuse for board/`/c/` chrome; print CSS is net-new                                        |
| `ChartBlockView` / `HBarChart`                            | ✅ / ⚠️ fixed-px + gsap                     | render saved charts; verify stable print frame; responsive fix shared w/ Charts spec      |
| `usage_events`                                            | ❌ build from scratch                       | shared with the Highlighter spec — build once                                             |
| `assertAuthorized` (MCP bearer)                           | ✅ all-or-nothing                           | not per-user; not the boards identity mechanism                                           |
| PDF/print/headless libs                                   | ❌ none installed                           | v1 uses `window.print()` (no dep); server PDF = future + lockfile gate                    |

---

## Out of scope

- **Real payment collection** (Stripe/checkout) — no processor exists; deliberately a separate willingness-to-pay decision (`checks: paid_path_wtp`).
- **Server-side / headless PDF** rendering — adds a dependency; defer to a concrete "deliver a file without a browser" demand.
- **Board sharing / collaboration / permissions** beyond single-owner.
- The **cross-feature pricing matrix** (which caps, what each costs) — the deferred pricing talk (`checks: highlighter_pricing_matrix`).

---

## Amendments 2026-06-10 (Projects + Assembly Engine — operator-approved)

- **A1 — Rename.** `boards` → `projects`; `/board/[id]` → `/project/[id]`; `/api/boards` → `/api/projects`. `saved_charts` + `/c/[id]` keep their names.
- **A2 — Item union widened** (additive): the discriminated union gains `qa | metric | source | file | table_slice` (full shape in `docs/superpowers/plans/2026-06-10-projects-briefcase-assembly/shared/data-model.md`); `projects` gains `branding jsonb` and `mcp_key text UNIQUE` columns.
- **A3 — Assembly engine added** (net-new, the spec never covered it): `deliverables` table + `POST /api/projects/[id]/build` (forced-tool LLM assembly) + hosted `/p/[id]`. Print-the-page PDF is kept.
- **A4 — Meter every action day one, enforcement OFF.** Resolves the spec's open "0 or 1 usage" question: count `ask, chart_save, project_create, item_add, build, export_print, deliver_email, upload`; no hard wall.
- **A5 — Free/paid line preserved as FUTURE wall placement** ("free = answer in the moment; paid = keep/combine/take with you"), not flipped on.
- **A6 — Persistence:** `projects`/`deliverables` in Postgres; `project-uploads` bucket is solely user attachments; the Tier-1 Parquet/S3 lane is untouched.
- **A7 — MCP "read-only" promise narrowed to `swfl_fetch`;** three capability-keyed write tools added (`swfl_project_list/add/build`).
- **A8 — Chart Tier C (NL charts) + vitals chart scope stay deferred.**
