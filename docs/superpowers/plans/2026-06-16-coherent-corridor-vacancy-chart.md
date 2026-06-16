# Coherent Per-Corridor Vacancy (chart + prose) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make per-corridor CRE vacancy a first-class, deterministic brain artifact so the in-app chart AND the analyst's prose draw from ONE source at ONE read-time — killing the "chart shows per-corridor bars while the prose denies having per-corridor data" contradiction.

**Architecture:** Three coupled changes, in strict order. (1) `cre-swfl` emits a new deterministic `corridor_vacancy` `detail_table` from `corridor_profiles` (mirrors the existing `corridor_seasonality` table; NO synth-agent math). (2) The vacancy chart re-points off the frozen `fixtures/corridor-rents.json` snapshot to that live `detail_table` (this also fixes the fabricated/future `asOf`). (3) The welcome/chat analyst surface routes CRE-vacancy questions to ground on `cre-swfl` (so the prose sees the same `detail_table`) and emits + renders a chart frame; the interim B prompt line is restored.

**Tech Stack:** TypeScript, Deno-style refinery packs (`refinery/packs/*.mts`), `bun:test`, Next.js App Router (welcome/chat SSE), Supabase `corridor_profiles`.

---

## Why this plan exists (findings — do not re-derive)

Pinned across the 2026-06-16 session (see SESSION_LOG):

- The failing surface was **`BriefcaseChat`** (standalone analyst chat) → `/api/welcome/chat` `{mode:"analyst"}`. It is **text-only**: no `routeChart`, no chart frame in its `ChatFrame` handling, no renderer. The chart path (`routeChart`/`buildChartForIntent` + `DockChart`) lives only in the **`/api/converse` + `AskAiDock`** (`/r/*`) surface.
- The analyst grounds via `buildAnalystSystem` → `fetchBrain("master", tier:2)` → `buildDossier`. **Master holds vacancy as a single median** (`vacancy_rate_median`, 27 corridors rolled to one value); it has **no `detail_tables`**. So "I don't have those four submarkets, only the median" was **TRUE and correctly grounded** — a real grounding gap, not a refusal bug.
- **`cre-swfl` also does not carry per-corridor vacancy.** Its key-metrics are medians (`vacancy_rate_median`), and its only corridor-grain `detail_table` is `corridor_seasonality`. Per-corridor `vacancy_rate_pct` exists ONLY in the raw `corridor_profiles` table and in `fixtures/corridor-rents.json` (a manual snapshot of it, read by the chart).
- Therefore "just route prose to cre-swfl" yields no per-corridor number to align with the chart's bars. Per-corridor vacancy must first become a consumable artifact — **Task 1 is the keystone; Tasks 2 and 3 depend on it landing first.**

## GUARDRAILS (locked by operator — bake into every task)

1. **DETERMINISTIC ONLY (LLM-in-math-path risk).** `cre-swfl` runs through synthesis (it does NOT set `skipSynthesisAgent`). The `corridor_vacancy` detail_table MUST be emitted by `creSwflOutputProducer` deterministic code from `corridor_profiles`, exactly like `corridor_seasonality` (`refinery/packs/cre-swfl.mts:1714-1750`). If per-corridor vacancy numbers pass through the synth agent at any point → **REJECT**. The agent prompt already says "Do NOT compute numeric cross-fragment aggregates" (`cre-swfl.mts:1805`); keep it that way.
2. **MARKETBEAT CAVEAT AT CORRIDOR GRAIN.** Fort Myers Beach + Lehigh Acres have incomplete MarketBeat submarket coverage. The caveat must ride on **those corridors' rows** (so chart + prose flag them), NOT as a blanket deliverable footnote. Drive this **from data** via each corridor's `vacancy_rate_source_url` / null `vacancy_rate_pct` — do not hardcode a corridor list blind (verify in Task 1, Step 0).
3. **CITE EVERY CONSTANT.** Direct pass-through of `corridor_profiles.vacancy_rate_pct` introduces no constant → fine. Any normalization/threshold added → inline source comment or `SOURCED.md` entry. CLAUDE.md data-provenance.

**Scope fence:** bounded to vacancy / the existing 4 chart scopes. Do **NOT** expand toward `generic_chart_capability` (backlog, plan `docs/superpowers/plans/charts-dynamic-capability.md`).

**Status:** FEATURE build, not a fix. B already made the surface honest/non-broken — no urgency.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `refinery/packs/cre-swfl.mts` | `creSwflOutputProducer` emits `corridor_vacancy` detail_table | Modify (~1714-1750 region) |
| `refinery/packs/cre-swfl.test.mts` | Deterministic assertion on the new table + at-grain coverage marker | Modify |
| `brains/cre-swfl.md` | Rendered brain output now carries `corridor_vacancy` | Regenerated (egress; see Task 1 Step 6) |
| `lib/build-chart-for-intent.mts` | `buildVacancyChart` reads cre-swfl detail_table (live), real `asOf` | Modify (105-128) |
| `lib/build-chart-for-intent.test.mts` | Vacancy chart sources from brain, no `FIXTURE_ASOF` | Modify |
| `app/api/welcome/chat/route.ts` | Analyst routes CRE-vacancy → cre-swfl grounding; restore B claim | Modify (`buildAnalystSystem` 191-215; B line ~96) |
| `components/briefcase/BriefcaseChat.tsx` | Consume + render a `chart` frame | Modify |
| `lib/chat/use-chat-stream.ts` | (only if a typed `chart` frame variant is needed) | Possibly modify |

---

## Task 1 (KEYSTONE): `cre-swfl` emits a deterministic `corridor_vacancy` detail_table

**Files:**
- Modify: `refinery/packs/cre-swfl.mts` (inside `creSwflOutputProducer`, alongside the `corridor_seasonality` block at `:1714-1750`)
- Test: `refinery/packs/cre-swfl.test.mts`

- [ ] **Step 0: Verify the at-grain coverage signal (guardrail 2) BEFORE coding.**

Run a read-only query against `corridor_profiles` to learn, for Fort Myers Beach + Lehigh Acres corridors, whether `vacancy_rate_pct` is null and what `vacancy_rate_source_url` holds:

```bash
python -c "import psycopg, tomllib; \
s=tomllib.load(open('.dlt/secrets.toml','rb')); \
import re; print('inspect corridor_profiles vacancy provenance manually')"
```

Preferred: use the lake MCP / Supabase MCP to run:
`select corridor_name, city, vacancy_rate_pct, vacancy_rate_source_url from corridor_profiles where verification_status='verified' and deleted_at is null order by city;`

Record the finding in the task notes: which corridors have null vacancy (→ naturally excluded from the table = honest at-grain signal) vs. populated-but-from-an-incomplete-source (→ need an explicit coverage marker). This decides Step 3's marker logic — do not skip.

- [ ] **Step 1: Write the failing test for the new table.**

Add to `refinery/packs/cre-swfl.test.mts` (the harness already imports `{ creSwfl }`, sets `REFINERY_SOURCE=fixture`, and builds `CorridorNormalized` fixtures with `seasonal_index` at lines 236/568 — extend those fixtures with `vacancy_rate_pct` / `vacancy_rate_source_url`). Assert against the `BrainOutput` the pack produces:

```ts
test("cre-swfl emits a deterministic corridor_vacancy detail_table", async () => {
  const out = await runCreSwfl(/* same harness call the seasonality path uses */);
  const t = out.detail_tables?.find((d) => d.id === "corridor_vacancy");
  assert.ok(t, "corridor_vacancy detail_table must be present");
  assert.equal(t!.grain, "corridor");
  assert.equal(t!.columns[0].id, "vacancy_rate_pct");
  // one row per corridor with non-null vacancy; null-vacancy corridors are excluded
  assert.ok(t!.rows.every((r) => typeof r.cells.vacancy_rate_pct === "number"));
  // at-grain coverage marker rides on the affected rows, not as a blanket caveat
  const flagged = t!.rows.filter((r) => r.cells.coverage_note);
  assert.ok(flagged.every((r) => typeof r.cells.coverage_note === "string"));
});
```

> If `runCreSwfl` isn't the existing helper name, reuse whatever invocation the current seasonality/median tests use in this file — read the file first; do not invent a new harness.

- [ ] **Step 2: Run it to confirm it fails.**

Run: `bun test refinery/packs/cre-swfl.test.mts -t corridor_vacancy`
Expected: FAIL — no `corridor_vacancy` table exists yet.

- [ ] **Step 3: Implement the deterministic emission (mirror the seasonality block).**

In `creSwflOutputProducer`, immediately after the `corridor_seasonality` push (`cre-swfl.mts:~1749`), add — using the confirmed `CorridorNormalized` fields (`vacancy_rate_pct`, `vacancy_rate_source_url`, `name`) and the Step-0 finding for the coverage marker:

```ts
// --- corridor_vacancy detail_table ---
// One row per verified corridor with a non-null vacancy_rate_pct (0–100).
// Row key = raw corridor name; label = display name. DETERMINISTIC — never synth.
// Guardrail 2: corridors whose vacancy provenance is the incomplete MarketBeat
// submarket survey (Fort Myers Beach + Lehigh Acres per Step 0) carry an at-grain
// coverage_note cell so the chart/prose flag THAT corridor, not a blanket footnote.
const vacancyRows = corridors
  .filter((c) => c.vacancy_rate_pct != null)
  .map((c) => {
    const cells: Record<string, number | string> = {
      vacancy_rate_pct: c.vacancy_rate_pct as number,
    };
    const note = coverageNoteFor(c); // returns "" unless Step-0 flags this corridor
    if (note) cells.coverage_note = note;
    return { key: c.name, label: displayNameFor(c.name), cells };
  });
if (vacancyRows.length > 0) {
  const vacancyUrl =
    env.source === "live" && env.supabaseUrl
      ? `${env.supabaseUrl}/rest/v1/corridor_profiles?select=name,vacancy_rate_pct,vacancy_rate_source_url&verification_status=eq.verified&deleted_at=is.null&vacancy_rate_pct=not.is.null`
      : "fixture://refinery/__fixtures__/corridor-profiles.sample.json";
  detail_tables.push({
    id: "corridor_vacancy",
    title: "SWFL CRE corridor vacancy rate",
    grain: "corridor",
    columns: [
      { id: "vacancy_rate_pct", label: "Vacancy", display_format: "percent", units: "%" },
    ],
    rows: vacancyRows,
    source: {
      url: vacancyUrl,
      fetched_at,
      tier: 2,
      citation:
        `Brains Supabase corridor_profiles (verified, non-deleted) — vacancy_rate_pct per corridor. ` +
        `${vacancyRows.length} of ${corridors.length} corridors reporting. ` +
        `Corridors flagged coverage_note draw on the incomplete MarketBeat submarket survey.`,
    },
  });
}
```

Define `coverageNoteFor` deterministically from the Step-0 finding (e.g. flag corridors whose `vacancy_rate_source_url` matches the MarketBeat survey, or a verified constant set with an inline source comment per guardrail 3). If Step 0 shows FMB/Lehigh vacancy is simply null in `corridor_profiles`, they are excluded by the filter and NO marker is needed — record that decision and drop `coverage_note` entirely (simpler + honest).

- [ ] **Step 4: Run the test to confirm it passes.**

Run: `bun test refinery/packs/cre-swfl.test.mts -t corridor_vacancy`
Expected: PASS.

- [ ] **Step 5: Run the pre-push pack gates (these block on `refinery/packs/**`).**

Run: `bun test refinery/packs/cre-swfl.test.mts` (full file) — Expected: PASS.
Run: `bun test refinery/packs/catalog.test.mts` — Expected: PASS (catalog ⇆ registry mirror; a detail_table adds no metric slug, so no vocab registration is required — confirm no new double-quoted `metric:` literal was introduced).

- [ ] **Step 6: Regenerate the brain (needs LLM egress — cre-swfl runs synthesis).**

Run: `npm run refinery -- cre-swfl --target-only`
Expected: `brains/cre-swfl.md` now contains a `"id": "corridor_vacancy"` block. If egress is unavailable locally, the deterministic unit test (Step 4) is the gate; the `.md` regenerates on the nightly rebuild. Do NOT `--force` the daily-rebuild GHA.

- [ ] **Step 7: Commit.**

```bash
git add refinery/packs/cre-swfl.mts refinery/packs/cre-swfl.test.mts brains/cre-swfl.md
git commit -m "feat(cre-swfl): deterministic corridor_vacancy detail_table (per-corridor vacancy as a consumable artifact)"
```

---

## Task 2: Re-point `buildVacancyChart` to the live cre-swfl detail_table

**Depends on Task 1.** Kills the fabricated `asOf` (`charts_vacancy_asof_fabricated` check) as a side effect.

**Files:**
- Modify: `lib/build-chart-for-intent.mts` (`buildVacancyChart`, 105-128; `FIXTURE_ASOF`, 22)
- Test: `lib/build-chart-for-intent.test.mts`

- [ ] **Step 1: Write the failing test.**

```ts
test("buildVacancyChart sources from cre-swfl detail_table with a real asOf", async () => {
  const spec = await buildChartForIntent({ chart_type: "bar", scope: "vacancy" });
  assert.ok(spec, "vacancy chart should build");
  assert.equal(spec!.value_format, "percent");
  // asOf must derive from the brain's freshness, never the hardcoded future constant
  assert.notEqual(spec!.asOf, "2026-06-30");
  // citation cites corridor_profiles, not "SWFL fixture sample"
  assert.match(spec!.source.citation, /corridor_profiles/);
});
```

- [ ] **Step 2: Run it to confirm it fails.**
Run: `bun test lib/build-chart-for-intent.test.mts -t "real asOf"` — Expected: FAIL (still reads fixture + `FIXTURE_ASOF`).

- [ ] **Step 3: Implement.**

Replace `buildVacancyChart`'s `loadFixture("corridor-rents.json")` with a read of cre-swfl's `corridor_vacancy` detail_table via the existing `fetchBrain` path:

```ts
async function buildVacancyChart(): Promise<ChartSpec | null> {
  const { output } = await fetchBrain("cre-swfl", { tier: 2 });
  const table = output.detail_tables?.find((t) => t.id === "corridor_vacancy");
  if (!table) return null;
  const rows = table.rows
    .map((r): [string, number] => [r.label, r.cells.vacancy_rate_pct as number])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  if (rows.length < 3) return null;
  const block: ChartBlock = {
    title: "SWFL Corridor Vacancy Rates",
    columns: ["Corridor", "Vacancy (%)"],
    rows,
    chart_type: "bar",
    value_format: "percent",
    asOf: table.source.fetched_at.slice(0, 10), // REAL vintage, not FIXTURE_ASOF
    source: { citation: table.source.citation },
  };
  if (!lintChartBlock(block).ok) return null;
  return { ...block, frameId: "bar-table" };
}
```

> Leave `buildRentChart` on the fixture for now (out of scope — but note `FIXTURE_ASOF` is still wrong there; the `charts_vacancy_asof_fabricated` check covers it). If `fetchBrain` is server-only and this module is imported client-side, keep this on the server path (`/api/converse` + welcome/chat both run server-side).

- [ ] **Step 4: Run the test to confirm it passes.**
Run: `bun test lib/build-chart-for-intent.test.mts` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/build-chart-for-intent.mts lib/build-chart-for-intent.test.mts
git commit -m "feat(charts): vacancy chart reads live cre-swfl corridor_vacancy table (real asOf, corridor_profiles citation)"
```

---

## Task 3: Wire the chart + cre-swfl grounding into the welcome/chat analyst surface

**Depends on Tasks 1 & 2.** Three sub-parts: (3a) emit + render a chart frame on `BriefcaseChat`; (3b) ground CRE-vacancy questions on cre-swfl so the prose carries the per-corridor numbers; (3c) restore the interim B prompt claim.

**Files:**
- Modify: `app/api/welcome/chat/route.ts` (`buildAnalystSystem` 191-215; the B INTERIM line ~96)
- Modify: `components/briefcase/BriefcaseChat.tsx` (handle a `chart` frame)
- Test: `app/api/welcome/chat/route.test.ts`

- [ ] **Step 1 (3b): Failing test — analyst grounding includes per-corridor vacancy for a CRE question.**

```ts
test("analyst grounds a CRE-vacancy question on cre-swfl per-corridor data", async () => {
  // a vacancy question must surface the corridor_vacancy detail_table in the system prompt
  const { system } = await buildAnalystSystem("commercial real estate vacancy by corridor", origin);
  assert.match(system, /corridor_vacancy|per-corridor vacancy|Vacancy/);
});
```

- [ ] **Step 2: Run it — Expected: FAIL** (today grounds only on master).

- [ ] **Step 3 (3b): Implement CRE routing in `buildAnalystSystem`.**

When the question routes to a CRE/vacancy intent (reuse `routeChart(lastUser)` → scope `vacancy`/`asking-rent`, or a small keyword check consistent with `lib/route-chart.ts:60-67`), `fetchBrain("cre-swfl", tier:2)` and include its dossier (`buildDossier` already forwards `detail_tables`) in the grounding block — in addition to or instead of master. Keep master for the region-wide bottom line; add cre-swfl for the corridor grain. Do not invent numbers; the detail_table is the only per-corridor source.

- [ ] **Step 4 (3a): Emit a chart frame from the route + render it in `BriefcaseChat`.**

Server: when `routeChart(lastUser)` matches, build the spec with `buildChartForIntent` and enqueue a typed frame `{ type: "chart", spec }` in the prelude (same SSE channel as the `place`/`data` frames at `route.ts:147-148`). Client: in `BriefcaseChat.tsx` `onFrame`, branch on `f.type === "chart"` and render via the existing `DockChart` component (already used by `AskAiDock`); `ChatFrame` is open-ended (`[key:string]: unknown`) so no protocol change is strictly required, but add a typed `chart?` field to `ChatFrame` if it improves clarity.

- [ ] **Step 5 (3c): Restore the interim B claim now that charts are real here.**

In `route.ts` `ANALYST_SYSTEM`, revert the INTERIM edit: restore "You CAN file answers, figures, and charts into their project" and delete the INTERIM comment block (the capability is now true on this surface).

- [ ] **Step 6: Run tests + manual verify.**
Run: `bun test app/api/welcome/chat/route.test.ts` — Expected: PASS.
Manual: ask the BriefcaseChat "commercial real estate vacancy for Estero, Fort Myers, Naples, East Naples" → a vacancy bar chart renders AND the prose cites per-corridor numbers with the FMB/Lehigh coverage note at grain. No contradiction.

- [ ] **Step 7: Commit.**

```bash
git add app/api/welcome/chat/route.ts components/briefcase/BriefcaseChat.tsx lib/chat/use-chat-stream.ts app/api/welcome/chat/route.test.ts
git commit -m "feat(analyst): per-corridor vacancy chart + cre-swfl grounding in welcome/chat; restore charts capability claim"
```

---

## Self-Review (run before handoff)

1. **Spec coverage:** Task 1 = deterministic artifact (guardrail 1). Coverage note at grain = guardrail 2 (Task 1 Step 0/3). Constants cited = guardrail 3. Chart re-point + real asOf = Task 2 (+ closes the vintage check). Coherent chart+prose = Task 3. ✅
2. **Sequencing:** Task 2 and Task 3 both hard-depend on Task 1's deterministic table. Do not start them until Task 1's `.md`/test is green. ✅
3. **Placeholder scan:** `runCreSwfl` / `coverageNoteFor` are flagged to confirm against the real harness/Step-0 finding — not silent TODOs. Resolve them while implementing.
4. **Type consistency:** detail_table id `corridor_vacancy`, column id `vacancy_rate_pct`, optional cell `coverage_note` — used identically in Tasks 1, 2, 3.
5. **Scope fence:** nothing here touches `generic_chart_capability`. ✅

## Open question to resolve during execution (Task 1, Step 0)

Does the FMB/Lehigh coverage gap actually apply to `corridor_profiles.vacancy_rate_pct` (what we surface), or only to the separate `vacancy_rate_marketbeat_swfl` submarket metric? If the per-corridor `corridor_profiles` vacancy for those corridors is null, they are excluded honestly and `coverage_note` may be unnecessary. Settle from data, not assumption.
