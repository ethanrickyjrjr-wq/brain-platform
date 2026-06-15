# 06 — Ops Control Board (in the **swfldatagulf-ops** repo)

> Build file for the Daily Freshness System. **Read `README.md` §0 (two corrections matter here) + the memory `feedback_ops-page-belongs-in-ops-repo`.** The control board is the one place a human sees the whole machine green/red. It lives in the **separate** ops repo — building it in brain-platform is the documented catastrophic mistake.

**Model:** Sonnet · **Repo:** `C:\Users\ethan\dev\swfldatagulf-ops` (App Router, Next ^15.1.6, React ^19, **npm**, deploys `vercel --prod`) · **Wave:** 2 · **Depends:** 02.

**Goal:** Extend `swfldatagulf-ops/app/data-inventory/` with a **Daily Truth** section showing, per metric: cron · question(s) · sites asked · last value + source + retrieved-at · validation delta · status (red→yellow→green). And remove the duplicate wrong-repo page that's live in brain-platform.

---

## §0 corrections — these change the scope (read before building)

1. **The ops repo ALREADY has a Supabase service-role layer.** `@supabase/supabase-js ^2.45.4` is a dependency; `lib/supabase.ts`, `lib/checks.ts`, `lib/goals.ts`, … and `app/api/checks/route.ts`, `app/api/notes/route.ts` all use bare `createClient(URL, KEY)` reading `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`. **So the Daily Truth section can read `data_lake.daily_truth` LIVE from day one** — there is no "v1 localStorage, only later Supabase" constraint (that was based on a wrong premise). Only the `app/data-inventory` **page** is currently static `_data.ts` + localStorage; the surrounding repo is fully Supabase-backed. **Reuse `lib/checks.ts` as the template; do not port anything from brain-platform** (no `createServiceRoleClient` helper exists in the ops repo — the pattern is per-module `createClient`).
2. **There is a duplicate, wrong-repo page LIVE on brain-platform `origin/main`** (`app/ops/data-inventory/` — commits `0e2244b` + `7a89e39`). It was NOT reverted. The correct board is `swfldatagulf-ops/app/data-inventory/`. → Task 0 removes the brain-platform duplicate (operator-confirm the removal).

## §0 facts to reuse (ops repo)

- Theme tokens (`app/globals.css :root`): `--bg:#080e11`, `--bg-raised:#0d171d`, `--text:#e2eef2`, `--teal:#2dd4bf`, `--teal-dim:#14b8a6`, status `--green:#4ade80` / `--yellow:#fcd34d` / `--red:#f87171`. Fonts IBM Plex Sans/Mono.
- `app/data-inventory/`: `page.tsx` (`export const revalidate = 86400`, renders from static `PIPELINES`), `_data.ts` (pure catalog, no imports), `section-actions.tsx` (`"use client"`, localStorage key `zip-routing-v1-${cadence}`).
- Cross-page nav uses `Link` re-exported from `app/ui.tsx:414`; the page has a `<nav className="catnav">` of cadence anchor pills + `<Link href="/">← /ops</Link>`. Footer links `/coverage`, `/targets`.

---

## Files (ops repo unless noted)

- **Create:** `lib/daily-truth.ts` — live reader of `data_lake.daily_truth` + validation status (mirror `lib/checks.ts`'s `createClient`).
- **Create:** `app/data-inventory/daily-truth-section.tsx` — the section (server component; status pills).
- **Modify:** `app/data-inventory/page.tsx` — render `<DailyTruthSection/>` above the cadence sections; drop `revalidate` to e.g. `300` for this section (or make the section its own dynamic fetch).
- **Modify (brain-platform, Task 0 — operator-confirm):** delete `app/ops/data-inventory/` + its nav link (the wrong-repo duplicate).

---

## Task 0 — Remove the wrong-repo duplicate (brain-platform, operator-confirm)

- [ ] **Step 0.1:** Confirm the duplicate exists on `origin/main`: `git -C ../brain-platform show origin/main:app/ops/data-inventory/page.tsx | head`. It does (per §0). The correct board is this ops repo.
- [ ] **Step 0.2 (operator-confirm before doing):** In brain-platform, remove `app/ops/data-inventory/` and the nav link added by `7a89e39`, with a `revert/cleanup` commit. Cite memory `feedback_ops-page-belongs-in-ops-repo`. **This is a brain-platform change — do it in a brain-platform session, not here.** Tracked as the only cross-repo coupling.

---

## Task 1 — Live reader (ops repo)

- [ ] **Step 1.1: Write `lib/daily-truth.ts`** (mirror `lib/checks.ts`):

```ts
import { createClient } from "@supabase/supabase-js";

const sb = () => createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } });

export type DailyTruthStatus = {
  metricKey: string; area: string; period: string; value: number | null; unit: string;
  sourceUrl: string | null; agreementN: number; retrievedAt: string;
  anomalyFlag: boolean; anomalyDeltaPct: number | null;   // anomaly = vs OUR OWN prior value (NOT the vendor)
  board: "green" | "yellow" | "red";
};

export async function loadDailyTruthStatus(): Promise<DailyTruthStatus[]> {
  const { data, error } = await sb().schema("data_lake").from("daily_truth")
    .select("*").order("retrieved_at", { ascending: false });
  if (error) return [];
  return latestPerKey(data).map(toStatus);   // board: green=sourced & no anomaly; yellow=stale/null-but-recent; red=held anomaly or no source
}
```

`board` rule: **green** = `value != null && source_url && !anomaly_flag` (sourced + within its own band); **yellow** = no fresh value today but a recent attempt exists (degrade gracefully); **red** = `anomaly_flag` (a big day-over-day move the second source didn't confirm — **held for human review**) OR `value IS NULL` (all cascade legs failed). **Red here is NOT "off the vendor" — it's "our own history says this jumped and nobody's looked yet."**

---

## Task 2 — The section (ops repo)

- [ ] **Step 2.1: Write `app/data-inventory/daily-truth-section.tsx`** — a server component that `await`s `loadDailyTruthStatus()` and renders an Excel-style table matching the theme: columns **metric · area · cron · question(s) · sites asked · last value + source + retrieved-at · anomaly Δ% · status pill**. Put an **"⚠ Anomalies needing review"** callout at the top listing every `anomaly_flag` row (the big day-over-day moves the second source didn't confirm) — this is the human-review queue the operator decreed. Reuse the existing status-color tokens (`--green/--yellow/--red`) and the pill styling already in the repo. Pull the per-metric `question(s)` / `sites asked` / `cron` from the registry-derived catalog (extend `_data.ts` with a `DAILY_TRUTH_METRICS` array sourced from `cadence_registry.yaml`'s `live_search_config`, OR fetch it). Keep the existing `section-actions.tsx` localStorage "mark done" panel unchanged.

- [ ] **Step 2.2: Render it in `page.tsx`** above the cadence sections, add a `#daily-truth` anchor pill to `<nav className="catnav">`.

- [ ] **Step 2.3: Build + eyeball.**

```bash
cd ../swfldatagulf-ops && npm run build      # /data-inventory prerenders; section degrades to empty if daily_truth absent
# watch react-hooks/set-state-in-effect (hard error) in the client action panel
```
Expected: green build; the Daily Truth section renders live rows (or an empty-state note), each with a status pill; dark teal theme; nav anchor works.

- [ ] **Step 2.4: Commit + deploy** (ops repo): explicit paths only; `git add lib/daily-truth.ts app/data-inventory/daily-truth-section.tsx app/data-inventory/page.tsx app/data-inventory/_data.ts SESSION_LOG.md`; push; **operator runs `vercel --prod`** (interactive login — never auto-deploy).

---

## v1.5 (deferred — see 99): operator-editable shared annotations

A live read (Task 1/2) already gives shared truth. A *separate* `live_search_status` table for operator-typed annotations/overrides (beyond the live engine status) is **deferred** (`99-deferred.md`) — it's only needed if the operator wants to pin notes the board persists across sessions, and it reuses the same `createClient` + an `app/api/...` route (mirror `app/api/notes/route.ts`). Do not build it unless asked.

---

## Definition of Done

- `swfldatagulf-ops/app/data-inventory` shows a Daily Truth section with live per-metric status (value + source + retrieved-at + anomaly Δ + green/yellow/red pill) **plus an "⚠ Anomalies needing review" queue** for `anomaly_flag` rows, reading `data_lake.daily_truth` via the repo's existing Supabase pattern.
- Build green, theme-matched, nav anchor added; no `react-hooks/set-state-in-effect`.
- The brain-platform wrong-repo duplicate is flagged for removal (Task 0, operator-confirm).
- **Board row:** `06-board` is itself the board — GREEN when it renders the live statuses correctly.
