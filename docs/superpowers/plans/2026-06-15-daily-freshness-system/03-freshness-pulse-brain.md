# 03 — Freshness-Pulse Brain **[brain-first gate]** + ZIP machine (Wave 2)

> Build file for the Daily Freshness System. **Read `README.md` §1.1 (gate), §3a (daily_truth), §3e (vocab slugs), and the §0 corrections — they re-point three reuse anchors this file depends on.** This brain is what makes the `daily_truth` table a *first-class Tier-2 citizen the brains reason over* (decision #1) rather than orphan substrate. It MUST ship in the **same PR** as file 01's table.

**Model:** Opus · **Repo:** brain-platform · **Wave:** 2 · **Depends:** 01, 02 · **Same PR as 01 + 02.**

**Goal:** A new Tier-1 reporter pack `refinery/packs/freshness-pulse.mts` that consumes `data_lake.daily_truth`, emits a cited "Today's Snapshot" (county-grain facts, no opinion), feeds Master a daily-sentiment input, and projects ZIP-grain `[INFERENCE]` pulse points via the Baseline-Delta machine — empty-tolerant so it ships before data accumulates.

---

## §0 corrections this file MUST honor (do not use the original draft's anchors)

- **Per-ZIP `detail_tables` exemplar = `refinery/packs/housing-swfl.mts:525-530`** (`id: "housing_by_zip"`, `grain: "zip"`), **NOT env-swfl** (env-swfl emits per-ZIP data as templated `key_metrics`, no zip `detail_table`).
- **Two registries:** add the pack to `PER_PACK_REGISTRY` in `refinery/packs/index.mts` **AND** `BRAIN_CATALOG` in `refinery/packs/catalog.mts` (lean `{ id, domain, scope, ttl_seconds }`). Gate-5 test = `refinery/packs/catalog.test.mts`.
- **Master upstream wiring is two arrays** in `refinery/packs/master.mts`: `sources` (`makeBrainInputSource("freshness-pulse")`) **and** `input_brains` (`{ id: "freshness-pulse", edge_type: "input" }`). A leaf must NOT name master (the DAG throws `DAG: cycle detected — {…}`).
- **Leaf output shape** = `BrainOutputProducerResult` (`refinery/types/brain-output.mts:429-452`): required `conclusion, key_metrics, caveats, direction, magnitude, overrides, contradicts, drivers`; optional `detail_tables`, `exogenous_signals: []`. **Leaves omit `confidence` and `conditional_claims`** — Stage 4 computes confidence.
- **Vocab:** `brain-vocabulary.json` has `concepts` (dict) + `slug_index` (dict); the resolver reads `slug_index`. County-grain slugs = individual `concepts` + `slug_index` entries; per-ZIP templated slugs use the **pattern** mechanism (`refinery/vocab/patterns.mts` `raw_slug_patterns` — the per-ZIP vocab hook, `4f4dde4`).
- **Service client:** `import { createServiceRoleClient } from "@/utils/supabase/service-role"` (not `lib/supabase`).

---

## Files

- **Create:** `refinery/sources/daily-truth-source.mts` — empty-tolerant reader of `data_lake.daily_truth` (latest row per `metric_key`+`area`).
- **Create:** `refinery/packs/freshness-pulse.mts` — the pack (`PackDefinition` + `outputProducer`).
- **Create:** `refinery/packs/freshness-pulse.test.mts` — `bun:test` (empty-tolerant + Baseline-Delta math + no-opinion).
- **Modify:** `refinery/packs/index.mts` (add to `PER_PACK_REGISTRY`), `refinery/packs/catalog.mts` (add to `BRAIN_CATALOG`), `refinery/packs/master.mts` (both upstream arrays), `refinery/vocab/brain-vocabulary.json` (concepts + slug_index), `refinery/vocab/patterns.mts` (per-ZIP pattern).
- **Reuse:** `housing-swfl.mts` (per-ZIP `detail_tables`), `zip-resolver.mts` (`resolveZip` for ZIP→county + in-scope), the ZIP-grain vendor parquet readers (`zhvi_swfl` / `redfin_swfl`) for ZIP baselines.

---

## Task 1 — Source connector (empty-tolerant)

- [ ] **Step 1.1: Write `refinery/sources/daily-truth-source.mts`.** Mirror the Tier-2 lake-source wiring an existing pack uses (e.g. how `housing-swfl` reads its `data_lake` tables). Return the latest verified row per `(metric_key, area)`:

```ts
import { createServiceRoleClient } from "@/utils/supabase/service-role";

export type DailyTruthRow = {
  metric_key: string; area: string; period: string; value: number | null; unit: string;
  source_url: string | null; source_title: string | null; source_tag: string;
  verified_on_page: boolean; agreement_n: number; anomaly_flag: boolean; retrieved_at: string;
};

export async function loadDailyTruth(): Promise<DailyTruthRow[]> {
  try {
    const sb = createServiceRoleClient();
    const { data, error } = await sb.schema("data_lake").from("daily_truth")
      .select("metric_key,area,period,value,unit,source_url,source_title,source_tag,verified_on_page,agreement_n,anomaly_flag,retrieved_at")
      .order("retrieved_at", { ascending: false });
    if (error) return [];                 // EMPTY-TOLERANT: table may not exist yet (ships before data)
    return latestPerKey(data ?? []);      // dedupe to newest row per metric_key+area
  } catch { return []; }
}
```

---

## Task 2 — The pack (TDD: empty-tolerant first, then Baseline-Delta)

- [ ] **Step 2.1: Write the failing tests** (`refinery/packs/freshness-pulse.test.mts`):

```ts
import { test, expect } from "bun:test";
import { freshnessPulse, projectZipPulse } from "./freshness-pulse.mts";

test("empty daily_truth → valid empty-tolerant output (ships before data)", async () => {
  const out = await freshnessPulse.outputProducer({ dailyTruth: [], zipBaselines: [] } as any);
  expect(out.conclusion).toMatch(/no fresh sourced snapshot/i);
  expect(out.key_metrics).toEqual([]);
  expect(out.direction).toBe("neutral");          // reporter = no opinion
  expect(out.caveats.length).toBeGreaterThan(0);
});

test("cited county facts become key_metrics with source", async () => {
  const out = await freshnessPulse.outputProducer({ dailyTruth: [
    { metric_key:"median_sale_price", area:"cape_coral", value:362000, unit:"usd",
      source_url:"https://www.redfin.com/x", verified_on_page:true, agreement_n:2, source_tag:"live_search", period:"2026-06-15" },
    { metric_key:"mortgage_30yr_fixed", area:"swfl", value:6.52, unit:"pct",
      source_url:"https://fred.stlouisfed.org/series/MORTGAGE30US", verified_on_page:true, agreement_n:1, source_tag:"live_search", period:"2026-06-11" },
  ], zipBaselines: [] } as any);
  const slugs = out.key_metrics.map(m => m.metric);
  expect(slugs).toContain("freshness_median_sale_price_cape_coral_usd");
  expect(slugs).toContain("freshness_mortgage_30yr_fixed_pct");
  // every cited metric carries a source (CITE rule)
  expect(out.key_metrics.every(m => m.source_url)).toBe(true);
});

test("Baseline-Delta projects a ZIP approx point, tagged + falsifiable", () => {
  // county today 362000 vs baseline-period county 350000 => +3.43% ; ZIP baseline 300000
  const p = projectZipPulse({ zip:"33904", zipBaseline:300000, countyToday:362000, countyBaseline:350000 });
  expect(p.value).toBeCloseTo(300000 * (362000/350000), -1);
  expect(p.source_tag).toBe("approx");
  expect(p.inference).toBe(true);
  expect(p.falsifier).toMatch(/superseded when the next ZIP-grain vendor file lands/i);
});

test("vendor row wins over approx for the same area", async () => {
  // if a real ZIP-grain vendor value exists, the approx for that ZIP is suppressed
  const out = await freshnessPulse.outputProducer({ dailyTruth: [], zipBaselines: [
    { zip:"33904", vendorValue:305000, countyToday:362000, countyBaseline:350000 }
  ] } as any);
  const zipTable = (out.detail_tables ?? []).find(t => t.id === "freshness_by_zip");
  const row = zipTable?.rows.find(r => r.key === "33904");
  expect(row?.cells.find((c:any)=>c.key==="source_tag")?.value).toBe("vendor"); // not approx
});
```

- [ ] **Step 2.2: Run — expect fail** (`bun test refinery/packs/freshness-pulse.test.mts`).

- [ ] **Step 2.3: Implement `freshness-pulse.mts`.** Pack metadata + the producer:

```ts
// id "freshness-pulse"; domain "market"; scope "SWFL daily sourced freshness snapshot";
// ttl_seconds 86400 (daily); trust_tier reporter. sources: [make... daily-truth-source, ZIP-baseline source].

export function projectZipPulse(a: { zip: string; zipBaseline: number; countyToday: number; countyBaseline: number }) {
  const countyDelta = a.countyBaseline > 0 ? a.countyToday / a.countyBaseline - 1 : 0;
  const value = Math.round(a.zipBaseline * (1 + countyDelta));
  return {
    zip: a.zip, value, source_tag: "approx" as const, inference: true,
    falsifier: "Superseded when the next ZIP-grain vendor file (ZHVI/Redfin) lands for this ZIP.",
    basis: `ZIP baseline ${a.zipBaseline} × (1 + county delta ${(countyDelta*100).toFixed(1)}%)`,
  };
}

export const freshnessPulse: PackDefinition = {
  id: "freshness-pulse", /* …domain/scope/ttl… */
  outputProducer: async ({ dailyTruth, zipBaselines }) => {
    if (!dailyTruth.length && !zipBaselines.length) {
      return { conclusion: "No fresh sourced snapshot available yet — the daily engine has not landed a verified value.",
               key_metrics: [], caveats: ["Sourced freshness layer is live but has no rows yet."],
               direction: "neutral", magnitude: 0, overrides: [], contradicts: [], drivers: [], exogenous_signals: [] };
    }
    // CONFIRM (a): only a SOURCED (real source_url), non-anomalous row may enter scoring. No memory numbers; held anomalies wait for review.
    const key_metrics = dailyTruth.filter(r => r.value != null && !!r.source_url && !r.anomaly_flag).map(r => ({
      metric: r.metric_key === "mortgage_30yr_fixed"
        ? "freshness_mortgage_30yr_fixed_pct"
        : `freshness_${r.metric_key}_${r.area}_${r.unit}`,
      value: r.value!, unit: r.unit, source_url: r.source_url,
      as_of: r.period, /* cited */ }));
    // Baseline-Delta: only project ZIPs without a same-period vendor value; vendor wins.
    const zipRows = zipBaselines.map(z => z.vendorValue != null
      ? { key: z.zip, source_tag: "vendor", value: z.vendorValue }
      : { key: z.zip, source_tag: "approx", ...projectZipPulse({ zip:z.zip, zipBaseline:z.baseline, countyToday:z.countyToday, countyBaseline:z.countyBaseline }) });
    const detail_tables = zipRows.length ? [{ id: "freshness_by_zip", title: "Today's ZIP pulse (approx = [INFERENCE])",
      grain: "zip", columns: [/* zip, value, source_tag, basis */], rows: toDetailRows(zipRows) }] : [];
    return { conclusion: snapshotSentence(key_metrics), key_metrics, detail_tables,
      caveats: ["approx ZIP points are projections (county delta on a vendor baseline), not cited ZIP facts.",
                ...staleUpstreamCaveats(dailyTruth)],
      direction: "neutral", magnitude: 0, overrides: [], contradicts: [], drivers: [], exogenous_signals: [] };
  },
};
```

**CONFIRM (a) — no memory number, and no unreviewed anomaly, enters the math path.** A `daily_truth` row only becomes a `key_metric` (and therefore only reaches Master's scoring / normalization / threshold / falsifiable call) if it has a real `source_url` (the cascade's grounded/scraped URL) **and** `anomaly_flag=false`. The brain's `direction`/`magnitude` are deterministic code over those cited numbers — **no LLM sits in the math path** (Brain Factory rule 2). A model-memory number is dropped at the engine (file 01 provenance gate) and again here (`!!r.source_url`); a **held anomaly** (a big day-over-day move the second source didn't confirm) waits for human review on the board and is excluded here (`!r.anomaly_flag`).

**No-opinion discipline (THE-GOAL Tier-1):** `direction: "neutral"`, `magnitude: 0`. The freshest numbers ride in `key_metrics`; **Master** (Tier-2) reads them and forms the direction call. The `conclusion` states facts only ("30-yr fixed = 6.52% as of Jun 11; Cape Coral median = $362,000 as of today, source Redfin") — no "bullish"/"headwind" framing. Every projected ZIP row is `source_tag:"approx"` and surfaced as `[INFERENCE]` with its falsifier; a real same-period vendor ZIP value **suppresses** the approx (a measured ZIP beats an approximated one — not a stale-vendor override). Validators (`spec-validator`, `facts-only-lint`, `inference-bait-lint`, `smoothing-lint`) gate the render.

- [ ] **Step 2.4: Run tests — expect pass** (`bun test refinery/packs/freshness-pulse.test.mts`).

---

## Task 3 — Register the pack everywhere (Gate 5 + vocab, SAME commit)

- [ ] **Step 3.1:** Add `[freshnessPulse.id]: freshnessPulse` to `PER_PACK_REGISTRY` in `refinery/packs/index.mts`.
- [ ] **Step 3.2:** Add `{ id: "freshness-pulse", domain: "market", scope: "SWFL daily sourced freshness snapshot", ttl_seconds: 86400 }` to `BRAIN_CATALOG` in `refinery/packs/catalog.mts`.
- [ ] **Step 3.3:** In `refinery/packs/master.mts`, add `makeBrainInputSource("freshness-pulse")` to `sources` **and** `{ id: "freshness-pulse", edge_type: "input" }` to `input_brains` (not `critical` — a missing daily pulse must not abort master).
- [ ] **Step 3.4:** Register slugs in `refinery/vocab/brain-vocabulary.json` — for each county-grain slug add a `concepts["<slug>"]` entry (with `prefLabel`, `scope_note`, `raw_slugs:["<slug>"]`, `domain:["market"]`, `value_type`, `unit`) **and** a `slug_index["<slug>"] = "<slug>"`. For the per-ZIP family, add a `raw_slug_patterns` entry in `refinery/vocab/patterns.mts` matching `^swfl_zip_\d{5}_pulse_median_price_approx_usd$`.
- [ ] **Step 3.5: Verify the Gate-5 + vocab gates pass.**

```bash
bun test refinery/packs/catalog.test.mts          # catalog <-> PER_PACK_REGISTRY parity (Gate 5)
bun refinery/tools/check-vocab-coverage.mts --all # no orphan slugs in any rendered brain
```

- [ ] **Step 3.6: Build the brain locally (empty-tolerant render).**

```bash
npm run refinery -- freshness-pulse --target-only
# Expected: brains/freshness-pulse.md renders (empty-tolerant if daily_truth has no rows), validators pass.
```

- [ ] **Step 3.7: Commit the WHOLE brain-first PR together** (01 + 02 + 03):

```bash
git add ingest/scripts/migrate_daily_truth.py ingest/pipelines/live_search/ \
        ingest/cadence_registry.yaml ingest/tests/test_cadence_registry_live_search.py \
        refinery/sources/daily-truth-source.mts refinery/packs/freshness-pulse.mts \
        refinery/packs/freshness-pulse.test.mts refinery/packs/index.mts refinery/packs/catalog.mts \
        refinery/packs/master.mts refinery/vocab/brain-vocabulary.json refinery/vocab/patterns.mts \
        CLAUDE.md SESSION_LOG.md
node scripts/safe-push.mjs
```

---

## Definition of Done

- `freshness-pulse.mts` renders a valid `BrainOutput` even with an empty `daily_truth` (brain-first gate satisfied — table + brain ship together).
- With data: `key_metrics` carry cited county-grain facts (each with `source_url` + `as_of`); the ZIP `detail_table` shows `approx` rows as `[INFERENCE]` with falsifiers, and any same-period vendor ZIP value **wins** over approx.
- Master lists `freshness-pulse` in both upstream arrays; `bun test refinery/packs/catalog.test.mts` and `bun refinery/tools/check-vocab-coverage.mts --all` are green; no leaf→master cycle.
- `direction` is `neutral` (reporter, no opinion); Master's daily sentiment moves with the fresh metrics.
- **Board row:** `03-freshness-pulse` GREEN — brain renders, registered, Master reads it.
