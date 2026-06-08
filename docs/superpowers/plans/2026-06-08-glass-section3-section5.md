# Glass §3 + §5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Pane 3 "The Scoreboard" (skill-over-time line + calibration scatter) and Pane 4 "Shopping List" + Pane 1 "The Flow" (lean-strip) into the `/glass` page in `swfldatagulf-ops`, replacing the Wave 2 placeholders.

**Architecture:** All work is in `C:\Users\ethan\dev\swfldatagulf-ops`. Data is fetched server-side via `lib/glass.ts` (shared module) + `lib/github.ts` (existing GitHub reader). Two new SQL views are created on the live Supabase project (`jtkdowmrjaxfvwmemxso`) and grant only `service_role` — never `anon`. Charts are hand-rolled SVG (no chart lib), mirroring `DonutChart` in `app/ui.tsx`. Toggle between hit-rate and lift uses a Client Component wrapper. CSS uses `.glass-scoreboard-*`, `.glass-flow-*`, `.glass-shop-*` namespaces.

**Tech Stack:** Next.js 15.1.6 / React 19, Supabase service-role client, GitHub Contents API (`lib/github.ts` → `rawText` / `listDir`), `yaml` npm package (already in `package.json`), SVG, plain CSS.

**Gate:** `npm run build` clean (no test runner in ops). `feedback_no-autonomous-push` applies — commit, show diff, wait for explicit OK before any `vercel --prod`.

---

## File map

| Action   | File                                | Responsibility                                                    |
|----------|-------------------------------------|-------------------------------------------------------------------|
| **SQL**  | `docs/sql/20260608_glass_views.sql` | Two read views (`glass_skill_over_time`, `glass_calibration`); vet with brain-platform/Opus before applying |
| **Edit** | `lib/glass.ts`                      | Add `SkillDataPoint`, `CalibrationPoint`, `DataTarget`, `FlowSignal` types + 4 new readers |
| **New**  | `app/glass/scoreboard.tsx`          | `ScoreboardPane` (server shell) → `SkillChartClient` (Client Component, toggle state) + `CalibrationChart` (SVG) |
| **New**  | `app/glass/flow.tsx`                | `FlowPane` (server) — three-column lean-strip: sources / brains / loads |
| **New**  | `app/glass/shopping.tsx`            | `ShoppingPane` (server) — data_targets table with pill status; graceful fallback if §4 not merged |
| **Edit** | `app/glass/page.tsx`                | Replace three `GlassPlaceholder` calls with `FlowPane`, `ScoreboardPane`, `ShoppingPane` |
| **Edit** | `app/globals.css`                   | Add `.glass-scoreboard-*`, `.glass-flow-*`, `.glass-shop-*` CSS classes |

---

## Task 1 — Draft + vet the two §3 SQL views

**Files:**
- Create: `docs/sql/20260608_glass_views.sql`

These views read `backtest_grades` (§2 corpus, 144 rows) and `outcomes` (0 rows, live path). They are **never blended** into one figure — each row carries a `source` column (`'retrodicted'` or `'live'`). `GRANT SELECT` to `service_role` only (internal page; no `anon` access).

### Persistence approximation note
True persistence (predict same direction as prior period) requires per-slug LAG ordering, which would need the harness context. For the view, persistence is approximated as the **modal-direction baseline**: the accuracy you'd get if you always predicted the most common direction in the corpus. This is honest, labeled in a SQL comment, and visible to any reader. Opus must vet this before the views are applied.

- [ ] **Step 1: Write the SQL file**

```sql
-- Glass §3 read views — GRANT service_role ONLY (never anon: internal accuracy page)
-- Apply via: python -c "import psycopg; ..." using creds from brain-platform/.dlt/secrets.toml
-- VET THIS FILE with brain-platform/Opus before applying (Opus owns backtest_grades schema).

-- ── View 1: Skill over time ────────────────────────────────────────────────
-- Monthly buckets of system accuracy + persistence baseline + lift.
-- PERSISTENCE NOTE: approximated as the modal-direction baseline (accuracy if you always
-- predict the most common direction in the corpus). True per-slug persistence requires
-- LAG() over vintage ordering in the harness; this is an honest labeled approximation.
-- Both retrodicted (§2 corpus) and live (outcomes) rows included, never blended.

CREATE OR REPLACE VIEW public.glass_skill_over_time AS
WITH
  retro AS (
    SELECT
      date_trunc('month', as_of_date)::date        AS month,
      CASE WHEN grade = 'hit' THEN 1.0 ELSE 0.0 END AS is_hit,
      predicted_direction,
      'retrodicted'::text                           AS source
    FROM public.backtest_grades
    WHERE grade IN ('hit', 'miss')
  ),
  live AS (
    SELECT
      date_trunc('month', o.graded_at)::date        AS month,
      CASE WHEN o.direction_correct THEN 1.0 ELSE 0.0 END AS is_hit,
      p.predicted_direction,
      'live'::text                                  AS source
    FROM public.outcomes o
    JOIN public.predictions p ON p.id = o.prediction_id
    WHERE o.direction_correct IS NOT NULL
  ),
  combined AS (SELECT * FROM retro UNION ALL SELECT * FROM live),
  -- Modal-direction baseline per source
  dir_dist AS (
    SELECT
      source,
      AVG(CASE WHEN predicted_direction = 'bullish' THEN 1.0 ELSE 0.0 END) AS p_bullish,
      AVG(CASE WHEN predicted_direction = 'bearish' THEN 1.0 ELSE 0.0 END) AS p_bearish
    FROM combined
    GROUP BY source
  ),
  modal_baseline AS (
    SELECT source, GREATEST(p_bullish, p_bearish) AS persistence_accuracy
    FROM dir_dist
  )
SELECT
  c.month,
  c.source,
  COUNT(*) AS n_grades,
  ROUND(AVG(c.is_hit)::numeric, 4)                              AS system_accuracy,
  ROUND(mb.persistence_accuracy::numeric, 4)                    AS persistence_accuracy,
  ROUND((AVG(c.is_hit) - mb.persistence_accuracy)::numeric, 4) AS lift
FROM combined c
JOIN modal_baseline mb ON mb.source = c.source
GROUP BY c.month, c.source, mb.persistence_accuracy
ORDER BY c.month, c.source;

GRANT SELECT ON public.glass_skill_over_time TO service_role;

-- ── View 2: Calibration ────────────────────────────────────────────────────
-- Stated confidence bucket vs actual hit-rate. 5 bands.
-- Perfect calibration = diagonal (stated == actual).
-- outcomes join: outcomes.prediction_id → predictions.id (existing FK).

CREATE OR REPLACE VIEW public.glass_calibration AS
WITH
  retro AS (
    SELECT
      confidence,
      CASE WHEN grade = 'hit' THEN 1.0 ELSE 0.0 END AS is_hit,
      'retrodicted'::text AS source
    FROM public.backtest_grades
    WHERE grade IN ('hit', 'miss')
  ),
  live AS (
    SELECT
      p.confidence,
      CASE WHEN o.direction_correct THEN 1.0 ELSE 0.0 END AS is_hit,
      'live'::text AS source
    FROM public.outcomes o
    JOIN public.predictions p ON p.id = o.prediction_id
    WHERE o.direction_correct IS NOT NULL
  ),
  combined AS (SELECT * FROM retro UNION ALL SELECT * FROM live)
SELECT
  source,
  CASE
    WHEN confidence < 0.2 THEN '0–20%'
    WHEN confidence < 0.4 THEN '20–40%'
    WHEN confidence < 0.6 THEN '40–60%'
    WHEN confidence < 0.8 THEN '60–80%'
    ELSE                       '80–100%'
  END AS confidence_bucket,
  CASE
    WHEN confidence < 0.2 THEN 0.10
    WHEN confidence < 0.4 THEN 0.30
    WHEN confidence < 0.6 THEN 0.50
    WHEN confidence < 0.8 THEN 0.70
    ELSE                        0.90
  END AS stated_confidence,
  COUNT(*) AS n_grades,
  ROUND(AVG(is_hit)::numeric, 4) AS hit_rate
FROM combined
GROUP BY source, confidence_bucket, stated_confidence
ORDER BY source, stated_confidence;

GRANT SELECT ON public.glass_calibration TO service_role;
```

- [ ] **Step 2: Send SQL to brain-platform/Opus session for review**

Post the content of `docs/sql/20260608_glass_views.sql` to the brain-platform Opus session. Ask it to verify:
1. The `backtest_grades` column names match (`as_of_date`, `grade`, `predicted_direction`, `confidence`) — §2 pinned contract.
2. The `outcomes` FK column is `prediction_id` → `predictions.id`.
3. The modal-direction persistence approximation is acceptable (or supply the correct formula).
4. `GRANT SELECT ON ... TO service_role` matches the pattern used in `docs/sql/20260601_grade_predictions.sql`.

**Do NOT apply the SQL until Opus confirms.**

- [ ] **Step 3: Apply the SQL after Opus confirmation**

Apply via psycopg3, credentials from `brain-platform/.dlt/secrets.toml`:
```python
import psycopg, pathlib
sql = pathlib.Path("docs/sql/20260608_glass_views.sql").read_text()
conn_str = "postgresql://postgres:{password}@{host}:5432/postgres"
with psycopg.connect(conn_str) as c:
    c.execute(sql)
    c.commit()
    print("views applied")
```
(Run from `brain-platform` directory; path to SQL is relative there.)

Verify: `SELECT source, COUNT(*) FROM glass_skill_over_time GROUP BY 1;` — expect 144 retrodicted rows distributed across months, 0 live rows.

---

## Task 2 — Add §3 types + readers to `lib/glass.ts`

**Files:**
- Modify: `lib/glass.ts` (swfldatagulf-ops)

- [ ] **Step 1: Add types at bottom of types section**

Append after the `GradedCall` interface:

```typescript
export interface SkillDataPoint {
  month: string;           // "2024-01-01" (date_trunc result)
  source: "retrodicted" | "live";
  n_grades: number;
  system_accuracy: number; // 0–1
  persistence_accuracy: number; // 0–1 modal baseline
  lift: number;            // system - persistence (can be negative)
}

export interface CalibrationPoint {
  source: "retrodicted" | "live";
  confidence_bucket: string; // "0–20%" etc.
  stated_confidence: number; // midpoint 0.10 / 0.30 / 0.50 / 0.70 / 0.90
  n_grades: number;
  hit_rate: number;          // 0–1 actual hit rate in this bucket
}

export interface DataTarget {
  slug: string;
  reason: string;           // 'low_n' | 'low_skill' | 'stale' | 'wanted'
  priority: number;
  label: string | null;
  detail: string | null;
  current_n: number | null;
  current_lift: number | null;
  updated_at: string;
}

export interface FlowSignal {
  live_pipelines: number;
  parked_pipelines: number;
  brain_count: number;
  recent_loads: number;     // successful loads in last 30 days from _dlt_loads
  available: boolean;
}
```

- [ ] **Step 2: Add four reader functions at bottom of Readers section**

```typescript
/** Monthly skill-over-time from glass_skill_over_time view. */
export async function fetchSkillOverTime(): Promise<{
  available: boolean;
  points: SkillDataPoint[];
}> {
  const client = sb();
  if (!client) return { available: false, points: [] };
  const { data, error } = await client
    .from("glass_skill_over_time")
    .select("month, source, n_grades, system_accuracy, persistence_accuracy, lift")
    .order("month", { ascending: true });
  if (error || !data) return { available: false, points: [] };
  return { available: true, points: data as unknown as SkillDataPoint[] };
}

/** Confidence calibration from glass_calibration view. */
export async function fetchCalibration(): Promise<{
  available: boolean;
  points: CalibrationPoint[];
}> {
  const client = sb();
  if (!client) return { available: false, points: [] };
  const { data, error } = await client
    .from("glass_calibration")
    .select("source, confidence_bucket, stated_confidence, n_grades, hit_rate")
    .order("stated_confidence", { ascending: true });
  if (error || !data) return { available: false, points: [] };
  return { available: true, points: data as unknown as CalibrationPoint[] };
}

/**
 * data_targets table — written by §4 nightly generator.
 * Returns available:false (graceful fallback) if the table doesn't exist yet.
 */
export async function fetchDataTargets(): Promise<{
  available: boolean;
  targets: DataTarget[];
}> {
  const client = sb();
  if (!client) return { available: false, targets: [] };
  try {
    const { data, error } = await client
      .from("data_targets")
      .select("slug, reason, priority, label, detail, current_n, current_lift, updated_at")
      .order("priority", { ascending: true })
      .limit(50);
    if (error || !data) return { available: false, targets: [] };
    return { available: true, targets: data as unknown as DataTarget[] };
  } catch {
    return { available: false, targets: [] };
  }
}

/**
 * Flow lean-strip: pipeline counts from cadence_registry.yaml (GitHub raw),
 * brain count from brains/ dir listing, recent loads from _dlt_loads.
 * Imported lazily to avoid yaml import in the main bundle path.
 */
export async function fetchFlowSignal(): Promise<FlowSignal> {
  // Inline import so the yaml dep is only loaded for this function
  const [{ rawText, listDir }, { createClient: sbCreate }] = await Promise.all([
    import("@/lib/github"),
    import("@supabase/supabase-js"),
  ]);

  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  const client = SB_URL && SB_KEY
    ? sbCreate(SB_URL, SB_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;

  const [cadenceRaw, brainFiles, loadsResult] = await Promise.all([
    rawText("ingest/cadence_registry.yaml").catch(() => null),
    listDir("brains").catch(() => [] as string[]),
    client
      ? client
          .from("_dlt_loads")
          .select("load_id", { count: "exact", head: true })
          .gte("inserted_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
          .then(({ count }) => count ?? 0)
          .catch(() => 0)
      : Promise.resolve(0),
  ]);

  let live_pipelines = 0;
  let parked_pipelines = 0;

  if (cadenceRaw) {
    // Dynamic import to avoid bundling yaml unconditionally
    const { default: yaml } = await import("yaml");
    const parsed = yaml.parse(cadenceRaw) as Record<string, unknown>;
    live_pipelines = Object.keys((parsed.pipelines as Record<string, unknown>) ?? {}).length;
    parked_pipelines = Object.keys((parsed.not_yet_running as Record<string, unknown>) ?? {}).length;
  }

  const brain_count = (brainFiles as string[]).filter((f) => f.endsWith(".md")).length;

  return {
    available: cadenceRaw !== null || brain_count > 0,
    live_pipelines,
    parked_pipelines,
    brain_count,
    recent_loads: loadsResult as number,
  };
}
```

- [ ] **Step 3: Verify TypeScript compiles (touched-file check)**

```powershell
cd C:\Users\ethan\dev\swfldatagulf-ops
npx tsc --noEmit --skipLibCheck 2>&1 | Select-String "glass"
```
Expect: no errors involving `lib/glass.ts`.

---

## Task 3 — Create `app/glass/scoreboard.tsx`

**Files:**
- Create: `app/glass/scoreboard.tsx`

Pane 3 is split into two sub-sections stacked vertically:
1. **Skill over time** — SVG line chart (Client Component for toggle)
2. **Calibration** — SVG scatter chart (server-renderable, no state)

Labels everywhere: "retrodicted (seed)" vs "live". Every `%` carries its N.

- [ ] **Step 1: Write the file**

```tsx
// app/glass/scoreboard.tsx
"use client";

import { type SkillDataPoint, type CalibrationPoint } from "@/lib/glass";
import { useState } from "react";

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtMonth(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function fmtPct(v: number, n: number): string {
  return `${Math.round(v * 100)}% (N=${n})`;
}

// ── SkillLineChart (needs toggle state → Client Component) ────────────────

function SkillLineChart({ points }: { points: SkillDataPoint[] }) {
  const [showLift, setShowLift] = useState(false);

  const retro = points.filter((p) => p.source === "retrodicted");
  const live = points.filter((p) => p.source === "live");

  if (retro.length === 0 && live.length === 0) {
    return (
      <div className="glass-chart-empty">not enough data yet (N=0)</div>
    );
  }

  // SVG geometry
  const W = 520, H = 200;
  const PAD = { top: 24, right: 20, bottom: 36, left: 48 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  // Combine all points for X scale
  const allPoints = [...retro, ...live];
  const months = [...new Set(allPoints.map((p) => p.month))].sort();
  const xScale = (month: string) => {
    const i = months.indexOf(month);
    return PAD.left + (months.length < 2 ? cW / 2 : (i / (months.length - 1)) * cW);
  };
  const yScale = (v: number) => {
    // Clip lift to [-0.5, 0.5] so negative lift doesn't blow the chart
    const lo = showLift ? -0.5 : 0;
    const hi = showLift ? 0.5 : 1.0;
    return PAD.top + (1 - (v - lo) / (hi - lo)) * cH;
  };

  const toPath = (pts: SkillDataPoint[]) => {
    if (pts.length === 0) return "";
    return pts
      .map((p, i) => {
        const val = showLift ? p.lift : p.system_accuracy;
        return `${i === 0 ? "M" : "L"} ${xScale(p.month).toFixed(1)} ${yScale(val).toFixed(1)}`;
      })
      .join(" ");
  };

  // Persistence reference line (horizontal, corpus-level scalar)
  const persistenceBaseline =
    retro.length > 0 ? retro[0].persistence_accuracy : null;
  const persistenceY =
    persistenceBaseline !== null && !showLift
      ? yScale(persistenceBaseline)
      : null;

  // Y-axis ticks
  const yTicks = showLift
    ? [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3]
    : [0, 0.25, 0.5, 0.75, 1.0];

  return (
    <div className="glass-scoreboard-chart-wrap">
      <div className="glass-scoreboard-toggle-row">
        <button
          className={`glass-scoreboard-toggle ${!showLift ? "active" : ""}`}
          onClick={() => setShowLift(false)}
        >
          Hit Rate
        </button>
        <button
          className={`glass-scoreboard-toggle ${showLift ? "active" : ""}`}
          onClick={() => setShowLift(true)}
        >
          Lift above baseline
        </button>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="glass-scoreboard-svg"
        aria-label={showLift ? "Lift over time" : "Hit rate over time"}
      >
        {/* Y-axis ticks */}
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={yScale(t)}
              y2={yScale(t)}
              stroke="var(--border)"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 6}
              y={yScale(t) + 4}
              textAnchor="end"
              fontSize="9"
              fill="var(--muted)"
            >
              {showLift ? `${t > 0 ? "+" : ""}${Math.round(t * 100)}pp` : `${Math.round(t * 100)}%`}
            </text>
          </g>
        ))}

        {/* Zero line for lift view */}
        {showLift && (
          <line
            x1={PAD.left} x2={W - PAD.right}
            y1={yScale(0)} y2={yScale(0)}
            stroke="var(--muted)" strokeWidth="1" strokeDasharray="4 3"
          />
        )}

        {/* Persistence reference line (hit-rate view only) */}
        {persistenceY !== null && (
          <g>
            <line
              x1={PAD.left} x2={W - PAD.right}
              y1={persistenceY} y2={persistenceY}
              stroke="var(--yellow)" strokeWidth="1" strokeDasharray="5 3" opacity="0.6"
            />
            <text x={W - PAD.right + 4} y={persistenceY + 4} fontSize="9" fill="var(--yellow)" opacity="0.8">
              baseline
            </text>
          </g>
        )}

        {/* X-axis month labels (every 3rd month to avoid crowding) */}
        {months
          .filter((_, i) => i % 3 === 0 || i === months.length - 1)
          .map((m) => (
            <text
              key={m}
              x={xScale(m)}
              y={H - PAD.bottom + 14}
              textAnchor="middle"
              fontSize="9"
              fill="var(--muted)"
            >
              {fmtMonth(m)}
            </text>
          ))}

        {/* Retrodicted line — teal dim */}
        {retro.length > 1 && (
          <path
            d={toPath(retro)}
            fill="none"
            stroke="var(--teal-dim)"
            strokeWidth="1.5"
          />
        )}
        {/* Live line — green */}
        {live.length > 1 && (
          <path
            d={toPath(live)}
            fill="none"
            stroke="var(--green)"
            strokeWidth="1.5"
          />
        )}

        {/* Data points with N label on hover (title tooltip) */}
        {[...retro, ...live].map((p, i) => {
          const val = showLift ? p.lift : p.system_accuracy;
          return (
            <circle
              key={i}
              cx={xScale(p.month)}
              cy={yScale(val)}
              r="3"
              fill={p.source === "retrodicted" ? "var(--teal-dim)" : "var(--green)"}
            >
              <title>{`${fmtMonth(p.month)}: ${fmtPct(val, p.n_grades)} [${p.source}]`}</title>
            </circle>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="glass-scoreboard-legend">
        <span className="glass-scoreboard-legend-item glass-scoreboard-legend--retro">
          retrodicted (seed)
        </span>
        {live.length > 0 && (
          <span className="glass-scoreboard-legend-item glass-scoreboard-legend--live">
            live
          </span>
        )}
        {!showLift && persistenceBaseline !== null && (
          <span className="glass-scoreboard-legend-item glass-scoreboard-legend--baseline">
            modal baseline {Math.round(persistenceBaseline * 100)}%
          </span>
        )}
      </div>
    </div>
  );
}

// ── CalibrationChart (no state, can be SSR but nested in Client Component) ──

function CalibrationChart({ points }: { points: CalibrationPoint[] }) {
  const retro = points.filter((p) => p.source === "retrodicted");
  const live = points.filter((p) => p.source === "live");
  const allPoints = [...retro, ...live];

  if (allPoints.length === 0) {
    return <div className="glass-chart-empty">not enough data yet (N=0)</div>;
  }

  const SIZE = 240;
  const PAD = 36;
  const inner = SIZE - PAD * 2;

  const toX = (stated: number) => PAD + stated * inner;
  const toY = (hitRate: number) => PAD + (1 - hitRate) * inner;

  return (
    <div className="glass-scoreboard-calib-wrap">
      <div className="glass-scoreboard-calib-label">
        Calibration — stated vs actual
      </div>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="glass-scoreboard-calib-svg"
        aria-label="Calibration scatter: stated confidence vs hit rate"
      >
        {/* Axes */}
        <line x1={PAD} y1={PAD} x2={PAD} y2={SIZE - PAD} stroke="var(--border)" strokeWidth="1" />
        <line x1={PAD} y1={SIZE - PAD} x2={SIZE - PAD} y2={SIZE - PAD} stroke="var(--border)" strokeWidth="1" />

        {/* Perfect calibration diagonal */}
        <line
          x1={toX(0)} y1={toY(0)}
          x2={toX(1)} y2={toY(1)}
          stroke="var(--muted)" strokeWidth="1" strokeDasharray="4 3" opacity="0.5"
        />

        {/* Axis labels */}
        <text x={SIZE / 2} y={SIZE - 4} textAnchor="middle" fontSize="9" fill="var(--muted)">
          stated confidence →
        </text>
        <text
          x={10} y={SIZE / 2}
          textAnchor="middle" fontSize="9" fill="var(--muted)"
          transform={`rotate(-90, 10, ${SIZE / 2})`}
        >
          hit rate →
        </text>

        {/* Tick marks */}
        {[0.25, 0.5, 0.75, 1.0].map((t) => (
          <g key={t}>
            <text x={toX(t)} y={SIZE - PAD + 12} textAnchor="middle" fontSize="8" fill="var(--muted)">
              {Math.round(t * 100)}%
            </text>
            <text x={PAD - 4} y={toY(t) + 3} textAnchor="end" fontSize="8" fill="var(--muted)">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}

        {/* Retrodicted points */}
        {retro.map((p) => (
          <circle
            key={`r-${p.confidence_bucket}`}
            cx={toX(p.stated_confidence)}
            cy={toY(p.hit_rate)}
            r="5"
            fill="var(--teal-dim)"
            opacity="0.85"
          >
            <title>{p.confidence_bucket}: {fmtPct(p.hit_rate, p.n_grades)} [retrodicted]</title>
          </circle>
        ))}

        {/* Live points */}
        {live.map((p) => (
          <circle
            key={`l-${p.confidence_bucket}`}
            cx={toX(p.stated_confidence)}
            cy={toY(p.hit_rate)}
            r="5"
            fill="var(--green)"
            opacity="0.85"
          >
            <title>{p.confidence_bucket}: {fmtPct(p.hit_rate, p.n_grades)} [live]</title>
          </circle>
        ))}

        {/* N labels next to each point */}
        {allPoints.map((p, i) => (
          <text
            key={i}
            x={toX(p.stated_confidence) + 7}
            y={toY(p.hit_rate) + 3}
            fontSize="8"
            fill="var(--muted)"
          >
            N={p.n_grades}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ── ScoreboardPane (exported shell — takes pre-fetched data as props) ──────

export function ScoreboardPane({
  skillPoints,
  calibPoints,
  skillAvailable,
  calibAvailable,
}: {
  skillPoints: SkillDataPoint[];
  calibPoints: CalibrationPoint[];
  skillAvailable: boolean;
  calibAvailable: boolean;
}) {
  const retroCount = skillPoints.filter((p) => p.source === "retrodicted").reduce((s, p) => s + p.n_grades, 0);
  const liveCount = skillPoints.filter((p) => p.source === "live").reduce((s, p) => s + p.n_grades, 0);

  return (
    <section className="glass-section">
      <div className="glass-section-label">THE SCOREBOARD</div>

      {(!skillAvailable && !calibAvailable) ? (
        <div className="glass-unavailable">signal unavailable</div>
      ) : (
        <div className="glass-scoreboard-layout">
          {/* Skill chart (left / top) */}
          <div className="glass-scoreboard-skill">
            <div className="glass-scoreboard-sub-label">
              Skill over time
              <span className="glass-scoreboard-ns">
                · retrodicted N={retroCount}
                {liveCount > 0 && ` · live N=${liveCount}`}
              </span>
            </div>
            {skillAvailable ? (
              <SkillLineChart points={skillPoints} />
            ) : (
              <div className="glass-chart-empty">not enough data yet (N=0)</div>
            )}
          </div>

          {/* Calibration chart (right / bottom) */}
          <div className="glass-scoreboard-calib">
            <div className="glass-scoreboard-sub-label">Calibration</div>
            {calibAvailable ? (
              <CalibrationChart points={calibPoints} />
            ) : (
              <div className="glass-chart-empty">not enough data yet (N=0)</div>
            )}
          </div>

          {/* Honesty footnote */}
          <div className="glass-scoreboard-footnote">
            retrodicted = backtest-seed (grade_method=&apos;retrodicted&apos;, never live); live = outcomes resolved by grader.
            Never blended.
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Confirm TypeScript compiles**

```powershell
cd C:\Users\ethan\dev\swfldatagulf-ops
npx tsc --noEmit --skipLibCheck 2>&1 | Select-String "scoreboard"
```
Expect: no errors.

---

## Task 4 — Create `app/glass/flow.tsx`

**Files:**
- Create: `app/glass/flow.tsx`

Pane 1 is a three-column lean-strip: Sources / Brains / Loads. Uses live counts (22 brains today). Server component — no state needed. Uses `<details>/<summary>` for click-to-expand (pure HTML, zero JS).

- [ ] **Step 1: Write the file**

```tsx
// app/glass/flow.tsx
import type { FlowSignal } from "@/lib/glass";

// ── StatBlock — a single column in the lean-strip ─────────────────────────

function StatBlock({
  label,
  primary,
  secondary,
  expandContent,
}: {
  label: string;
  primary: string;
  secondary?: string;
  expandContent?: React.ReactNode;
}) {
  return (
    <div className="glass-flow-col">
      <div className="glass-flow-col-label">{label}</div>
      <div className="glass-flow-col-primary">{primary}</div>
      {secondary && <div className="glass-flow-col-secondary">{secondary}</div>}
      {expandContent && (
        <details className="glass-flow-details">
          <summary className="glass-flow-summary">details ↓</summary>
          <div className="glass-flow-expand">{expandContent}</div>
        </details>
      )}
    </div>
  );
}

// ── FlowPane (exported) ───────────────────────────────────────────────────

export function FlowPane({ signal }: { signal: FlowSignal }) {
  if (!signal.available) {
    return (
      <section className="glass-section">
        <div className="glass-section-label">THE FLOW</div>
        <div className="glass-unavailable">signal unavailable (GitHub PAT or Supabase not configured)</div>
      </section>
    );
  }

  return (
    <section className="glass-section">
      <div className="glass-section-label">THE FLOW</div>
      <div className="glass-flow-strip">
        <StatBlock
          label="Sources"
          primary={`${signal.live_pipelines} live`}
          secondary={signal.parked_pipelines > 0 ? `${signal.parked_pipelines} parked` : undefined}
          expandContent={
            <p className="glass-flow-expand-note">
              From <code>ingest/cadence_registry.yaml</code> —{" "}
              <code>pipelines:</code> (active) and <code>not_yet_running:</code> (ODD scaffold).
            </p>
          }
        />

        <StatBlock
          label="Brains"
          primary={`${signal.brain_count} brains`}
          secondary={undefined}
          expandContent={
            <p className="glass-flow-expand-note">
              Count of <code>.md</code> files in <code>brains/</code> on <code>main</code>. Live today: 22.
            </p>
          }
        />

        <StatBlock
          label="Loads (30d)"
          primary={`${signal.recent_loads} runs`}
          secondary="dlt pipeline executions"
          expandContent={
            <p className="glass-flow-expand-note">
              Rows in <code>public._dlt_loads</code> inserted in the last 30 days.
            </p>
          }
        />
      </div>
    </section>
  );
}
```

---

## Task 5 — Create `app/glass/shopping.tsx`

**Files:**
- Create: `app/glass/shopping.tsx`

Pane 4 renders `data_targets` from §4 (brain-platform nightly generator). Graceful fallback if the table doesn't exist yet (§4 not merged). Reuses `/targets` pill styling.

- [ ] **Step 1: Write the file**

```tsx
// app/glass/shopping.tsx
import type { DataTarget } from "@/lib/glass";

function reasonLabel(r: string): string {
  switch (r) {
    case "low_n":    return "low N";
    case "low_skill": return "low skill";
    case "stale":    return "stale";
    case "wanted":   return "wanted";
    default:         return r;
  }
}

function reasonClass(r: string): string {
  switch (r) {
    case "low_n":    return "glass-shop-chip--n";
    case "low_skill": return "glass-shop-chip--skill";
    case "stale":    return "glass-shop-chip--stale";
    case "wanted":   return "glass-shop-chip--want";
    default:         return "";
  }
}

export function ShoppingPane({
  available,
  targets,
}: {
  available: boolean;
  targets: DataTarget[];
}) {
  return (
    <section className="glass-section">
      <div className="glass-section-label">SHOPPING LIST</div>

      {!available ? (
        <div className="glass-placeholder glass-shop-pending">
          data_targets pipeline not yet deployed — ships with §4 (brain-platform nightly generator)
        </div>
      ) : targets.length === 0 ? (
        <div className="glass-empty">no active targets — all slugs meeting quality thresholds</div>
      ) : (
        <>
          <div className="glass-shop-grid">
            {targets.map((t) => (
              <div key={t.slug} className="glass-shop-item">
                <div className="glass-shop-item-header">
                  <span className={`glass-shop-chip ${reasonClass(t.reason)}`}>
                    {reasonLabel(t.reason)}
                  </span>
                  <span className="chip">{t.slug}</span>
                </div>
                {t.label && <div className="glass-shop-label">{t.label}</div>}
                {t.detail && <div className="glass-shop-detail">{t.detail}</div>}
                <div className="glass-shop-meta">
                  {t.current_n !== null && <span>N={t.current_n}</span>}
                  {t.current_lift !== null && (
                    <span>lift {t.current_lift >= 0 ? "+" : ""}{(t.current_lift * 100).toFixed(1)}pp</span>
                  )}
                  <span className="glass-shop-priority">#{t.priority}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="glass-call-count">{targets.length} active target{targets.length !== 1 ? "s" : ""}</div>
        </>
      )}
    </section>
  );
}
```

---

## Task 6 — Add CSS for new panes to `app/globals.css`

**Files:**
- Modify: `app/globals.css`

Append at the end of the file, after the existing glass receipt styles (after line 2242).

- [ ] **Step 1: Append CSS**

```css
/* ── §3 Scoreboard ────────────────────────────────────────────────────────── */

.glass-scoreboard-layout {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.glass-scoreboard-skill,
.glass-scoreboard-calib {
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
}

.glass-scoreboard-sub-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--muted);
  text-transform: uppercase;
  margin-bottom: 10px;
}

.glass-scoreboard-ns {
  font-weight: 400;
  font-family: "IBM Plex Mono", monospace;
  font-size: 10px;
  text-transform: none;
  letter-spacing: 0;
  color: var(--muted);
  opacity: 0.7;
}

.glass-scoreboard-toggle-row {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}

.glass-scoreboard-toggle {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-family: inherit;
}

.glass-scoreboard-toggle.active {
  background: rgba(45, 212, 191, 0.1);
  border-color: var(--teal);
  color: var(--teal);
}

.glass-scoreboard-svg {
  width: 100%;
  max-width: 520px;
  display: block;
}

.glass-scoreboard-legend {
  display: flex;
  gap: 14px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.glass-scoreboard-legend-item {
  font-size: 10px;
  font-family: "IBM Plex Mono", monospace;
}

.glass-scoreboard-legend--retro { color: var(--teal-dim); }
.glass-scoreboard-legend--live  { color: var(--green); }
.glass-scoreboard-legend--baseline { color: var(--yellow); }

.glass-scoreboard-calib-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.glass-scoreboard-calib-label {
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 6px;
  text-align: center;
}

.glass-scoreboard-calib-svg {
  width: 100%;
  max-width: 240px;
}

.glass-scoreboard-footnote {
  font-size: 10px;
  color: var(--muted);
  font-style: italic;
  opacity: 0.7;
  padding: 4px 0;
}

.glass-chart-empty {
  font-size: 12px;
  font-style: italic;
  color: var(--muted);
  padding: 20px 0;
  text-align: center;
}

/* ── §5 Flow lean-strip ───────────────────────────────────────────────────── */

.glass-flow-strip {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

@media (max-width: 600px) {
  .glass-flow-strip {
    grid-template-columns: 1fr;
  }
}

.glass-flow-col {
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
}

.glass-flow-col-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 6px;
}

.glass-flow-col-primary {
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
  font-family: "IBM Plex Mono", monospace;
  line-height: 1.2;
}

.glass-flow-col-secondary {
  font-size: 11px;
  color: var(--muted);
  margin-top: 3px;
}

.glass-flow-details {
  margin-top: 10px;
}

.glass-flow-summary {
  font-size: 10px;
  color: var(--teal);
  cursor: pointer;
  list-style: none;
  user-select: none;
}

.glass-flow-summary::-webkit-details-marker { display: none; }

.glass-flow-expand {
  margin-top: 8px;
  padding: 8px;
  background: var(--bg-deep);
  border-radius: 4px;
}

.glass-flow-expand-note {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.5;
  margin: 0;
}

.glass-flow-expand-note code {
  font-family: "IBM Plex Mono", monospace;
  font-size: 10px;
  background: var(--bg);
  padding: 0 3px;
  border-radius: 2px;
}

/* ── §5 Shopping List ─────────────────────────────────────────────────────── */

.glass-shop-pending {
  opacity: 0.6;
  font-style: italic;
}

.glass-shop-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.glass-shop-item {
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
}

.glass-shop-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.glass-shop-chip {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  border-radius: 10px;
  padding: 2px 8px;
  text-transform: uppercase;
  font-family: "IBM Plex Mono", monospace;
}

.glass-shop-chip--n     { background: rgba(107,135,148,0.15); color: var(--muted); }
.glass-shop-chip--skill { background: rgba(248,113,113,0.12); color: var(--red); }
.glass-shop-chip--stale { background: rgba(252,211,77,0.12);  color: var(--yellow); }
.glass-shop-chip--want  { background: rgba(45,212,191,0.10);  color: var(--teal); }

.glass-shop-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 3px;
}

.glass-shop-detail {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.4;
  margin-bottom: 6px;
}

.glass-shop-meta {
  display: flex;
  gap: 10px;
  font-size: 10px;
  font-family: "IBM Plex Mono", monospace;
  color: var(--muted);
  flex-wrap: wrap;
}

.glass-shop-priority {
  margin-left: auto;
  color: var(--muted);
  opacity: 0.6;
}
```

---

## Task 7 — Update `app/glass/page.tsx`

**Files:**
- Modify: `app/glass/page.tsx`

Replace the three `GlassPlaceholder` calls with the real pane components. Fetch data in the existing `Promise.all`.

- [ ] **Step 1: Rewrite the file**

```tsx
import { getMasterHealth } from "@/lib/master-health";
import {
  fetchOpenCalls,
  fetchGradedCalls,
  fetchPendingHuskCount,
  fetchSkillOverTime,
  fetchCalibration,
  fetchDataTargets,
  fetchFlowSignal,
} from "@/lib/glass";
import { CallCard, ReceiptGrid } from "./calls";
import { ScoreboardPane } from "./scoreboard";
import { FlowPane } from "./flow";
import { ShoppingPane } from "./shopping";

export const revalidate = 300;

export default async function GlassPage() {
  const [
    masterHealth,
    callsResult,
    gradedResult,
    pendingCount,
    skillResult,
    calibResult,
    targetsResult,
    flowSignal,
  ] = await Promise.all([
    getMasterHealth(),
    fetchOpenCalls(),
    fetchGradedCalls(),
    fetchPendingHuskCount(),
    fetchSkillOverTime(),
    fetchCalibration(),
    fetchDataTargets(),
    fetchFlowSignal(),
  ]);

  const token =
    masterHealth.freshnessToken ??
    "freshness unavailable — could not read master health";

  const { available: callsAvailable, calls } = callsResult;
  const { available: gradedAvailable, graded } = gradedResult;

  return (
    <div className="glass-wrap">
      {/* ── Topbar ── */}
      <div className="glass-topbar">
        <span className="glass-title">The Glass ◊</span>
        <span className="glass-token">{token}</span>
      </div>

      {/* ── Pane 2: The Calls ── */}
      <section className="glass-section">
        <div className="glass-section-label">THE CALLS</div>
        {!callsAvailable ? (
          <div className="glass-unavailable">signal unavailable</div>
        ) : calls.length === 0 ? (
          <div className="glass-empty">no calls logged yet</div>
        ) : (
          <>
            <div className="glass-call-grid">
              {calls.map((call) => (
                <CallCard key={call.id} call={call} />
              ))}
            </div>
            <div className="glass-call-count">
              {calls.length} open call{calls.length !== 1 ? "s" : ""}
              {pendingCount > 0 && (
                <span className="glass-husk-note">
                  {" · "}
                  {pendingCount} earlier refine
                  {pendingCount !== 1 ? "s" : ""} predate claim-logging
                </span>
              )}
            </div>
          </>
        )}
      </section>

      {/* ── Graded receipts (empty today; renders when outcomes > 0) ── */}
      {gradedAvailable && graded.length > 0 && (
        <section className="glass-section">
          <div className="glass-section-label">
            RECEIPTS ({graded.length})
          </div>
          <ReceiptGrid graded={graded} />
        </section>
      )}

      {/* ── Pane 1: The Flow ── */}
      <FlowPane signal={flowSignal} />

      {/* ── Pane 3: The Scoreboard ── */}
      <ScoreboardPane
        skillPoints={skillResult.points}
        calibPoints={calibResult.points}
        skillAvailable={skillResult.available}
        calibAvailable={calibResult.available}
      />

      {/* ── Pane 4: Shopping List ── */}
      <ShoppingPane
        available={targetsResult.available}
        targets={targetsResult.targets}
      />
    </div>
  );
}
```

---

## Task 8 — `npm run build` clean + fix any type errors

**Files:** whatever TSC complains about.

- [ ] **Step 1: Run build**

```powershell
cd C:\Users\ethan\dev\swfldatagulf-ops
npm run build 2>&1
```

- [ ] **Step 2: Fix any type errors**

Common issues to watch for:
- `yaml` import: if `yaml` isn't in `package.json`, install it: `npm install yaml`. If it is, verify `"yaml"` appears in `package.json` dependencies.
- Dynamic `import("yaml")` in `fetchFlowSignal` — if the op causes a bundle issue, switch to `import yaml from "yaml"` at top of `lib/glass.ts` (the yaml dependency is already in the repo per the Explore agent report).
- `React` import in `flow.tsx` for `React.ReactNode` — add `import type React from "react"` if TSC complains.
- PostgREST `glass_skill_over_time` view: the Supabase generated types won't know about it, so `data as unknown as SkillDataPoint[]` is the correct cast (matches existing pattern in `fetchOpenCalls`).

- [ ] **Step 3: Verify build is clean**

Expected: `✓ Compiled successfully` with zero type errors. The build output should include `app/glass/page` in the route list.

---

## Task 9 — Commit, show diff, await OK

- [ ] **Step 1: Stage and commit**

```powershell
cd C:\Users\ethan\dev\swfldatagulf-ops
git add lib/glass.ts app/glass/scoreboard.tsx app/glass/flow.tsx app/glass/shopping.tsx app/glass/page.tsx app/globals.css
git status
```

Confirm only the 6 files above are staged. Do NOT include `docs/sql/20260608_glass_views.sql` (that lives in `brain-platform`).

```powershell
git commit -m "feat(glass): §3 Scoreboard + §5 Flow lean-strip + §5 Shopping List"
```

- [ ] **Step 2: Show the diff to the operator**

```powershell
git show --stat HEAD
git diff HEAD~1 HEAD -- lib/glass.ts app/glass/
```

- [ ] **Step 3: Wait for explicit OK before pushing**

Per `feedback_no-autonomous-push`: do NOT run `git push` or `vercel --prod` until the operator reviews the diff and gives explicit approval. State: "Build clean. Diff above. Ready to push when you give the OK."

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|---|---|
| Two service_role-only read views (skill-over-time, calibration) | Task 1 SQL + Task 2 readers |
| Label retrodicted-seed vs live everywhere, never blend | `source` column in every query + ScoreboardPane honesty footnote |
| Every % carries N | `fmtPct(v, n)` used in chart tooltips; N shown in sub-label |
| Toggle between hit-rate and lift | `SkillChartClient` toggle buttons + `showLift` state |
| SVG line + reliability scatter (no chart lib, mirror DonutChart) | Task 3 SVG components |
| GRANT service_role only, never anon | Task 1 SQL GRANT statements |
| Pane 4 renders data_targets, reuse /targets pill styling | Task 5 `ShoppingPane` + Task 6 CSS `.glass-shop-chip--*` |
| Pane 1 lean-strip: cadence_registry + brains/*.md + _dlt_loads | Task 4 `FlowPane` + Task 2 `fetchFlowSignal` |
| Live counts (22 brains), never spec's illustrative numbers | `fetchFlowSignal` → `listDir("brains")` at render time |
| async Server Component, `revalidate = 300`, parallel `Promise.all` | Task 7 page.tsx |
| Graceful degradation on missing env vars / missing §4 table | `fetchDataTargets` try/catch; all readers return `{ available: false }` |
| `npm run build` clean gate | Task 8 |
| `feedback_no-autonomous-push` — commit then wait | Task 9 step 3 |

**Placeholder scan:** No TBDs, TODOs, or "handle edge cases" left — all code is complete.

**Type consistency:** `SkillDataPoint`, `CalibrationPoint`, `DataTarget`, `FlowSignal` defined once in `lib/glass.ts` and imported by name everywhere they're used. `ScoreboardPane` props match what `page.tsx` passes. `fetchFlowSignal` returns `FlowSignal`, `FlowPane` takes `{ signal: FlowSignal }`. ✓
