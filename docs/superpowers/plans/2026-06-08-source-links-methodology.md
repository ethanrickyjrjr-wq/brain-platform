# Source Links + Methodology Surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public, allowlist-gated `/r/method/[metric]` page (formula + provenance only) reached by a small `ƒ` affordance on metric rows, and fix the one real citation leak ("Brains Supabase").

**Architecture:** A hand-authored registry (`methodology-registry.mts`, mirroring `SOURCE_PROVENANCE_TABLES`) is the single source of truth. The speaker layer resolves a metric's slug to a finished `/r/method/<slug>` URL **at projection time** (the raw slug never enters the customer-facing `DisplayMetric` — preserving the existing display-leak invariant). The route and the row affordance both read that registry. Formula only — never a retrodicted skill number (Glass guardrail 3).

**Tech Stack:** TypeScript / `.mts`, Bun test runner (`bun test`), Next 16 App Router (React 19 server components), Tailwind. No DB, no pipeline, no new deps.

---

## Constraints & gotchas (read before any task)

- **Test runner is `bun test`** (`import { describe, test } from "bun:test"` + `node:assert/strict`). Run **targeted files**, not the whole suite (some suites touch network/DB): e.g. `bun test refinery/lib/methodology-registry.test.mts`.
- **No React/page test harness exists.** App-side tests cover API routes only. So Tasks 4 (route) and 5 (UI) are verified by **typecheck (`npm run build`) + the commit's own `eslint --max-warnings=0` pre-commit hook + a documented manual dev check** — not snapshot tests. All *testable logic* lives in Task 1's resolver.
- **The display-leak canary:** `refinery/render/display-leak.test.mts` forbids the slug `cap_rate_median` from appearing in any customer surface. **Never register `cap_rate_median`** in the methodology registry — leaving it undocumented is what proves an internal slug never becomes a `/r/method` URL.
- **No JSX contractions.** The repo runs `eslint --fix --max-warnings=0` on staged files in a pre-commit hook; `react/no-unescaped-entities` blocks a raw `'` in JSX *text*. Write "how it is computed", not "how it's computed". (Apostrophes inside `{expression}` values and string props are fine — only literal JSX text is checked.)
- **A commit that succeeds is the eslint gate.** The pre-commit hook (`lint-staged` → prettier + `eslint --fix --max-warnings=0`) runs on every commit. If a commit step succeeds, the staged files are formatting- and lint-clean.
- **Branch:** all work lands on `claude/source-links-methodology` (already checked out, carries the spec commit `b253526`). Stage only the files each task names. Do **not** stage `.claude/settings.json` or `.gitignore` (operator's uncommitted changes) or the `_tmp_*.py` probes.
- **Do not push** until Task 6 — and Task 6 stops for operator confirmation first.

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `refinery/lib/methodology-registry.mts` | **New.** Registry type, literal + pattern entries, `resolveMethod`, `methodHrefForSlug`. The contract. | 1 |
| `refinery/lib/methodology-registry.test.mts` | **New.** Unit tests for resolution + the allowlist gate. | 1 |
| `refinery/render/speaker.mts` | **Modify.** `scrubCaveatTechnical` host rule (Task 2); `DisplayMetric.methodHref` + `toDisplayBrain` wiring (Task 3). | 2, 3 |
| `refinery/render/scrub-host.test.mts` | **New.** Scrub host-phrase + pass-through battery. | 2 |
| `refinery/render/display-leak.test.mts` | **Modify.** Add the methodHref-gating assertion. | 3 |
| `app/r/method/[metric]/page.tsx` | **New.** The public methodology page. | 4 |
| `app/r/_components/metrics-table.tsx` | **Modify.** `MetricRow.methodHref` + `MethodBadge`. | 5 |
| `app/r/[slug]/page.tsx` | **Modify.** Pass `methodHref` into the metrics map (line ~152). | 5 |

**Dispatch (model · wave · depends on):**

| Task | Unit | Model | Wave | Deps |
|------|------|-------|------|------|
| 1 | registry + resolver | **Opus** | A | — |
| 2 | hygiene scrub | **Sonnet** | A | — |
| 3 | speaker wiring | **Opus** | B | Task 1 |
| 4 | `/r/method` route | **Sonnet** | B | Task 1 |
| 5 | badge UI | **Sonnet** | C | Tasks 3, 4 |
| 6 | integration + push prep | (either) | — | all |

Tasks 1 ‖ 2 run in parallel. After Task 1: Tasks 3 ‖ 4 run in parallel. Task 5 last. Each task is an independent commit; nothing leaves the tree half-broken.

---

### Task 1: Methodology registry + resolver  ·  **Opus · Wave A**

**Files:**
- Create: `refinery/lib/methodology-registry.mts`
- Test: `refinery/lib/methodology-registry.test.mts`

- [ ] **Step 1: Write the failing test**

Create `refinery/lib/methodology-registry.test.mts`:

```ts
import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import {
  resolveMethod,
  methodHrefForSlug,
  METHODOLOGY_LITERALS,
} from "./methodology-registry.mts";

describe("methodology-registry", () => {
  test("a registered literal slug resolves to its entry", () => {
    const e = resolveMethod("trailing_12mo_collections_usd");
    assert.ok(e, "expected an entry");
    assert.equal(e.sourceTable, "fl_dor_tdt_collections");
    assert.equal(e.brain, "tourism-tdt");
    assert.ok(e.formula.length > 0);
  });

  test("a per-county pattern slug resolves and is county-specific", () => {
    const lee = resolveMethod("lee_trailing_12mo_collections_usd");
    assert.ok(lee);
    assert.match(lee.label, /Lee County/);
    const collier = resolveMethod("collier_latest_monthly_collections_usd");
    assert.ok(collier);
    assert.match(collier.label, /Collier County/);
  });

  test("literals take precedence over patterns (returned verbatim)", () => {
    const e = resolveMethod("latest_monthly_collections_usd");
    assert.equal(e, METHODOLOGY_LITERALS["latest_monthly_collections_usd"]);
  });

  test("an unregistered slug resolves to null (incl. the leak canary)", () => {
    assert.equal(resolveMethod("cap_rate_median"), null);
    assert.equal(resolveMethod("totally_made_up_slug"), null);
  });

  test("methodHrefForSlug gates: URL for documented, undefined otherwise", () => {
    assert.equal(
      methodHrefForSlug("post_ian_recovery_ratio"),
      "/r/method/post_ian_recovery_ratio",
    );
    assert.equal(methodHrefForSlug("cap_rate_median"), undefined);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test refinery/lib/methodology-registry.test.mts`
Expected: FAIL — `Cannot find module './methodology-registry.mts'`.

- [ ] **Step 3: Write the registry**

Create `refinery/lib/methodology-registry.mts`:

```ts
/**
 * Curated methodology registry — the allowlist + content for the public
 * `/r/method/[metric]` surface. Mirrors `app/r/source/_tables.ts`
 * (SOURCE_PROVENANCE_TABLES): a hand-authored map, small on purpose, that
 * decides which metric slugs get a public "how it is computed" page.
 *
 * FORMULA + PROVENANCE ONLY. Never a skill/lift/accuracy number — a
 * retrodicted figure is not a public accuracy claim (Glass guardrail 3,
 * docs/sql/20260608_data_targets.sql). Forward outcomes get their own surface
 * later; this page explains the math, not the track record.
 *
 * Imported by BOTH the refinery (refinery/render/speaker.mts, to gate the
 * per-metric methodHref) and the Next app (the route). Keep it free of React
 * and DB access so both sides can import it cheaply.
 *
 * DO NOT register `cap_rate_median` — it is the display-leak.test.mts canary.
 * An UNregistered slug must yield no methodHref; registering it would defeat
 * the guard that proves internal slugs never leak onto a customer surface.
 */

export interface MethodologyEntry {
  /** Human metric name shown as the page title. */
  label: string;
  /** 1-2 sentences: what the number means. */
  measures: string;
  /** Plain-language recipe — the formula/method, no exact constants. */
  formula: string;
  /** Grain / denominator, e.g. "per ZIP", "Lee County", "over resolved loans". */
  denominator?: string;
  /** Source table; links to /r/source/<table> ONLY when on the source allowlist. */
  sourceTable?: string;
  /** Consuming brain id; links to /r/<brain>. */
  brain?: string;
  /** Optional external methodology doc/PDF. */
  doc?: string;
}

/** Literal slug -> entry. Add the headline metrics you want explained. */
export const METHODOLOGY_LITERALS: Record<string, MethodologyEntry> = {
  latest_monthly_collections_usd: {
    label: "Latest monthly TDT collections (SWFL)",
    measures:
      "Tourist Development Tax (the county 'bed tax' on short-term lodging) collected across Lee + Collier in the most recent reported month.",
    formula:
      "Sum of the two counties' Florida DOR TDT remittances for the latest month both have reported.",
    denominator: "Lee + Collier combined, single month",
    sourceTable: "fl_dor_tdt_collections",
    brain: "tourism-tdt",
  },
  trailing_12mo_collections_usd: {
    label: "Trailing 12-month TDT collections (SWFL)",
    measures:
      "Total Tourist Development Tax collected across Lee + Collier over the most recent 12 reported months — a seasonally-complete view of tourism revenue.",
    formula:
      "Rolling sum of the latest 12 monthly DOR TDT remittances, Lee + Collier combined.",
    denominator: "Lee + Collier combined, trailing 12 months",
    sourceTable: "fl_dor_tdt_collections",
    brain: "tourism-tdt",
  },
  post_ian_recovery_ratio: {
    label: "Post-Hurricane-Ian recovery ratio",
    measures:
      "How current tourism revenue compares to its strongest pre-Ian run — 1.0 means fully recovered, below 1.0 means still under the prior peak.",
    formula:
      "Trailing-12-month TDT collections divided by the best pre-Ian trailing-12-month total.",
    denominator: "ratio (unitless), Lee + Collier combined",
    sourceTable: "fl_dor_tdt_collections",
    brain: "tourism-tdt",
  },
  seasonal_position_vs_history: {
    label: "Seasonal position vs history",
    measures:
      "Whether the latest month ran above or below what that same calendar month has historically averaged — strips out seasonality to show the real trend.",
    formula:
      "Latest month's collections divided by the historical mean for that same calendar month, Lee + Collier combined.",
    denominator: "ratio (unitless) vs same-month historical mean",
    sourceTable: "fl_dor_tdt_collections",
    brain: "tourism-tdt",
  },
};

/**
 * Pattern slugs — families that share one recipe (per-county, per-ZIP). The
 * first matching pattern wins; literals always take precedence over patterns.
 */
export const METHODOLOGY_PATTERNS: Array<{
  test: RegExp;
  build: (slug: string) => MethodologyEntry;
}> = [
  {
    // Per-county TDT collections, e.g. lee_trailing_12mo_collections_usd.
    test: /^(lee|collier)_(latest_monthly|trailing_12mo)_collections_usd$/,
    build: (slug) => {
      const county = slug.startsWith("lee") ? "Lee" : "Collier";
      const monthly = slug.includes("latest_monthly");
      const window = monthly ? "the latest reported month" : "the trailing 12 months";
      return {
        label: `${county} County TDT collections (${monthly ? "monthly" : "12-month"})`,
        measures: `Tourist Development Tax collected in ${county} County over ${window}.`,
        formula: `Sum of ${county} County's Florida DOR TDT remittances over ${window}.`,
        denominator: `${county} County`,
        sourceTable: "fl_dor_tdt_collections",
        brain: "tourism-tdt",
      };
    },
  },
];

/** Resolve a metric slug to its methodology entry, or null if undocumented. */
export function resolveMethod(slug: string): MethodologyEntry | null {
  const literal = METHODOLOGY_LITERALS[slug];
  if (literal) return literal;
  for (const p of METHODOLOGY_PATTERNS) {
    if (p.test.test(slug)) return p.build(slug);
  }
  return null;
}

/**
 * The allowlist gate. Returns the public `/r/method/<slug>` URL ONLY for a
 * documented slug, else undefined. This is the single point that decides
 * whether a metric is "explained" — and the only way a slug becomes a URL on
 * the customer surface.
 */
export function methodHrefForSlug(slug: string): string | undefined {
  return resolveMethod(slug) ? `/r/method/${slug}` : undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test refinery/lib/methodology-registry.test.mts`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add refinery/lib/methodology-registry.mts refinery/lib/methodology-registry.test.mts
git commit -m "feat(method): curated methodology registry + resolver (allowlist gate)"
```

---

### Task 2: Hygiene scrub — kill the "Brains Supabase" leak  ·  **Sonnet · Wave A**

**Files:**
- Modify: `refinery/render/speaker.mts:315-354` (`scrubCaveatTechnical`)
- Test: `refinery/render/scrub-host.test.mts` (new)

- [ ] **Step 1: Write the failing test**

Create `refinery/render/scrub-host.test.mts`:

```ts
import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { scrubCaveatTechnical } from "./speaker.mts";

describe("scrubCaveatTechnical — host-phrase hygiene", () => {
  test("maps 'Brains Supabase' to the public lake name", () => {
    const out = scrubCaveatTechnical(
      "Florida DOR Tourist Development Tax via Brains Supabase fl_dor_tdt_collections (666 rows)",
    );
    assert.ok(!/Supabase/i.test(out), `"Supabase" survived: ${out}`);
    assert.match(out, /SWFL Data Gulf/);
  });

  test("pass-through battery: never eats domain acronyms, numbers, or dates", () => {
    for (const safe of [
      "SOFR", "NFIP", "FEMA", "FDOT", "NAICS", "AAL", "WGS84",
      "2026-04", "20260530", "Lee + Collier",
    ]) {
      assert.equal(
        scrubCaveatTechnical(safe),
        safe,
        `scrub altered a safe token: ${safe}`,
      );
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test refinery/render/scrub-host.test.mts`
Expected: FAIL — first test fails: "Supabase" survived (no rule maps it yet).

- [ ] **Step 3: Add the scrub rule**

In `refinery/render/speaker.mts`, inside `scrubCaveatTechnical`, insert the new rule as the FIRST `.replace` in the chain. Change:

```ts
  return (
    text
      // Schema-qualified DB identifiers (data_lake.city_pulse_corridors,
```

to:

```ts
  return (
    text
      // Internal data-host phrase: "Brains Supabase" names our storage vendor,
      // not a customer-facing source. Map it to the public lake name. Maximally
      // specific (two literal words) so it can never eat domain prose.
      .replace(/\bBrains\s+Supabase\b/gi, "SWFL Data Gulf")
      // Schema-qualified DB identifiers (data_lake.city_pulse_corridors,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test refinery/render/scrub-host.test.mts`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Verify no regression in the existing leak guard**

Run: `bun test refinery/render/display-leak.test.mts`
Expected: PASS (unchanged — the new rule only adds a mapping).

- [ ] **Step 6: Commit**

```bash
git add refinery/render/speaker.mts refinery/render/scrub-host.test.mts
git commit -m "fix(speaker): scrub internal 'Brains Supabase' host phrase from citations"
```

---

### Task 3: Speaker wiring — leak-gated `methodHref`  ·  **Opus · Wave B (needs Task 1)**

**Files:**
- Modify: `refinery/render/speaker.mts` (import; `DisplayMetric` ~588-599; `toDisplayBrain` ~684-692)
- Test: `refinery/render/display-leak.test.mts` (add one test)

- [ ] **Step 1: Write the failing test**

In `refinery/render/display-leak.test.mts`, add this test inside the `describe("display-leak guard", ...)` block (after the existing tests, before the closing `});`):

```ts
  test("methodHref is gated on the registry: registered slug -> public URL, unregistered -> undefined", () => {
    // DIRTY's metric slug (cap_rate_median) is intentionally UNregistered — it
    // is the canary proving an internal slug never becomes a /r/method URL.
    const plain = toDisplayBrain(DIRTY);
    assert.equal(plain.metrics[0].methodHref, undefined);

    // A registered slug yields exactly its public /r/method URL.
    const reg = structuredClone(DIRTY);
    reg.output.key_metrics[0].metric = "latest_monthly_collections_usd";
    const d = toDisplayBrain(reg);
    assert.equal(
      d.metrics[0].methodHref,
      "/r/method/latest_monthly_collections_usd",
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test refinery/render/display-leak.test.mts`
Expected: FAIL — `plain.metrics[0].methodHref` is `undefined` already (passes that line) but the registered assertion fails: `methodHref` is `undefined` because `toDisplayBrain` does not set it yet. (If both lines read undefined, the second `assert.equal(... , "/r/method/...")` fails.)

- [ ] **Step 3: Add the import**

In `refinery/render/speaker.mts`, add near the other imports at the top of the file:

```ts
import { methodHrefForSlug } from "../lib/methodology-registry.mts";
```

- [ ] **Step 4: Add the field to `DisplayMetric`**

In `refinery/render/speaker.mts`, change the `DisplayMetric` interface end. Change:

```ts
  /** ISO fetch date, for the detail block only. */
  fetchedAt: string;
}
```

to:

```ts
  /** ISO fetch date, for the detail block only. */
  fetchedAt: string;
  /**
   * Public `/r/method/<slug>` URL when this metric's slug is documented in the
   * methodology registry, else absent. The raw slug NEVER enters this type — only
   * a finished, allowlist-vetted URL (same shape as `sourceUrl`), so the
   * display-leak invariant holds.
   */
  methodHref?: string;
}
```

- [ ] **Step 5: Populate it in `toDisplayBrain`**

In `refinery/render/speaker.mts`, in the `metrics:` map inside `toDisplayBrain`, change:

```ts
      sourceFull: scrubCaveatTechnical(sanitizeProse(m.source.citation)),
      fetchedAt: m.source.fetched_at,
    })),
```

to:

```ts
      sourceFull: scrubCaveatTechnical(sanitizeProse(m.source.citation)),
      fetchedAt: m.source.fetched_at,
      methodHref: methodHrefForSlug(m.metric),
    })),
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test refinery/render/display-leak.test.mts`
Expected: PASS — including the existing `assertClean` tests (DIRTY's `cap_rate_median` stays unregistered, so no slug leaks).

- [ ] **Step 7: Commit**

```bash
git add refinery/render/speaker.mts refinery/render/display-leak.test.mts
git commit -m "feat(speaker): emit leak-gated methodHref on display metrics"
```

---

### Task 4: The `/r/method/[metric]` route  ·  **Sonnet · Wave B (needs Task 1)**

**Files:**
- Create: `app/r/method/[metric]/page.tsx`

No automated test (no page-render harness — see Constraints). Verified by typecheck + manual dev check below. All logic it relies on (`resolveMethod`) is covered by Task 1.

- [ ] **Step 1: Create the route**

Create `app/r/method/[metric]/page.tsx`:

```tsx
import type { Metadata } from "next";
import {
  resolveMethod,
  type MethodologyEntry,
} from "../../../../refinery/lib/methodology-registry.mts";
import { isPublishedSourceTable } from "../../source/_tables";
import {
  ReportShell,
  ReportHeader,
  ReportFooter,
  Meta,
} from "../../_components/report-shell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_SLUG = /^[a-z0-9_]+$/;

interface PageProps {
  params: Promise<{ metric: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { metric } = await params;
  const entry = VALID_SLUG.test(metric) ? resolveMethod(metric) : null;
  if (!entry) return { title: "Methodology — SWFL Data Gulf" };
  return {
    title: `${entry.label} — how it is computed — SWFL Data Gulf`,
    description: entry.measures,
  };
}

export default async function MethodPage({ params }: PageProps) {
  const { metric } = await params;
  const entry = VALID_SLUG.test(metric) ? resolveMethod(metric) : null;
  if (!entry) return <NotDocumentedPanel metric={metric} />;
  return <Method metric={metric} entry={entry} />;
}

function Method({
  metric,
  entry,
}: {
  metric: string;
  entry: MethodologyEntry;
}) {
  const showSourceLink = entry.sourceTable
    ? isPublishedSourceTable(entry.sourceTable)
    : false;
  return (
    <ReportShell>
      <ReportHeader title={entry.label}>
        <p className="mt-3 font-mono text-sm text-gray-400">{metric}</p>
        <p className="mt-4 max-w-3xl text-base leading-7 text-gray-300">
          {entry.measures}
        </p>
      </ReportHeader>

      <section className="mt-8">
        <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wider text-gray-500">
              How it is computed
            </dt>
            <dd className="mt-1 text-sm leading-7 text-gray-200">
              {entry.formula}
            </dd>
          </div>
          {entry.denominator && (
            <div>
              <dt className="text-xs uppercase tracking-wider text-gray-500">
                Grain / denominator
              </dt>
              <dd className="mt-1 text-sm leading-7 text-gray-200">
                {entry.denominator}
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section className="mt-8">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Meta
            label="Source data"
            value={
              showSourceLink ? (
                <a
                  href={`/r/source/${entry.sourceTable}`}
                  className="text-[#00d4aa] underline underline-offset-2 hover:text-[#00d4aa]/80"
                >
                  view the rows ↗
                </a>
              ) : (
                "—"
              )
            }
          />
          <Meta
            label="Brain"
            value={
              entry.brain ? (
                <a
                  href={`/r/${entry.brain}`}
                  className="text-[#00d4aa] underline underline-offset-2 hover:text-[#00d4aa]/80"
                >
                  {entry.brain}
                </a>
              ) : (
                "—"
              )
            }
          />
          {entry.doc && (
            <Meta
              label="Reference"
              value={
                <a
                  href={entry.doc}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#00d4aa] underline underline-offset-2 hover:text-[#00d4aa]/80"
                >
                  methodology doc ↗
                </a>
              }
            />
          )}
        </dl>
      </section>

      <ReportFooter note="Methodology page — what this metric measures and how it is derived. Values are audited against the linked source rows; this page explains the formula, not a track record." />
    </ReportShell>
  );
}

function NotDocumentedPanel({ metric }: { metric: string }) {
  return (
    <ReportShell>
      <ReportHeader title="Not a documented metric">
        <p className="mt-3 font-mono text-sm text-gray-400">{metric}</p>
      </ReportHeader>
      <section className="mt-8">
        <p className="text-base leading-7 text-gray-300">
          This metric does not have a published methodology page yet. If you
          arrived from a report link, the metric may have been renamed or is not
          documented.
        </p>
      </section>
    </ReportShell>
  );
}
```

- [ ] **Step 2: Typecheck via build**

Run: `npm run build`
Expected: build completes without a type error in `app/r/method/[metric]/page.tsx`. (Pre-existing unrelated warnings elsewhere are fine; a type error in this file is not.)

- [ ] **Step 3: Manual render check**

Run: `npm run dev`, then in a browser:
- `http://localhost:3000/r/method/trailing_12mo_collections_usd` → renders title, "How it is computed", "Grain / denominator", a "view the rows ↗" link to `/r/source/fl_dor_tdt_collections`, and a `tourism-tdt` brain link.
- `http://localhost:3000/r/method/lee_latest_monthly_collections_usd` → renders the per-county (pattern) entry, "Lee County".
- `http://localhost:3000/r/method/bogus_slug` → renders the "Not a documented metric" panel.
Stop the dev server when done.

- [ ] **Step 4: Commit**

```bash
git add "app/r/method/[metric]/page.tsx"
git commit -m "feat(method): public /r/method/[metric] formula + provenance page"
```

---

### Task 5: Method affordance on metric rows  ·  **Sonnet · Wave C (needs Tasks 3, 4)**

**Files:**
- Modify: `app/r/_components/metrics-table.tsx` (`MetricRow` interface ~40-48; add `MethodBadge`; render in the Metric cell ~115-117)
- Modify: `app/r/[slug]/page.tsx:152-158` (pass `methodHref` through the map)

No automated test (UI). Verified by typecheck + manual dev check.

- [ ] **Step 1: Add `methodHref` to `MetricRow`**

In `app/r/_components/metrics-table.tsx`, change the `MetricRow` interface. Change:

```ts
  /** Source the figure is verified against. */
  sourceUrl?: string | null;
  /** Link text (defaults to "Source"). */
  sourceLabel?: ReactNode;
}
```

to:

```ts
  /** Source the figure is verified against. */
  sourceUrl?: string | null;
  /** Link text (defaults to "Source"). */
  sourceLabel?: ReactNode;
  /** Public `/r/method/<slug>` URL when this metric has a documented method. */
  methodHref?: string | null;
}
```

- [ ] **Step 2: Add the `MethodBadge` component**

In `app/r/_components/metrics-table.tsx`, add this component just above `export function MetricsTable`:

```tsx
/** A tiny "how computed" affordance next to a metric label — links to the
 *  metric's /r/method page. Teal, because the methodology page is our own
 *  surface. Absent when the metric has no documented method (most rows today). */
function MethodBadge({ href }: { href?: string | null }) {
  if (!href) return null;
  return (
    <a
      href={href}
      title="How this is computed"
      className="ml-1.5 align-super text-[10px] font-semibold text-[#00d4aa] no-underline hover:underline"
    >
      ƒ
    </a>
  );
}
```

- [ ] **Step 3: Render it in the Metric cell**

In `app/r/_components/metrics-table.tsx`, inside `MetricsTable`, change the metric-label cell. Change:

```tsx
              <td className="px-4 py-3 align-top font-medium text-white">
                {m.label}
              </td>
```

to:

```tsx
              <td className="px-4 py-3 align-top font-medium text-white">
                {m.label}
                <MethodBadge href={m.methodHref} />
              </td>
```

- [ ] **Step 4: Pass `methodHref` from the report page**

In `app/r/[slug]/page.tsx`, change the metrics map. Change:

```tsx
            metrics={display.metrics.map((m) => ({
              label: m.label,
              value: m.value,
              direction: m.direction,
              sourceUrl: m.sourceUrl,
              sourceLabel: m.sourceLabel,
            }))}
```

to:

```tsx
            metrics={display.metrics.map((m) => ({
              label: m.label,
              value: m.value,
              direction: m.direction,
              sourceUrl: m.sourceUrl,
              sourceLabel: m.sourceLabel,
              methodHref: m.methodHref,
            }))}
```

- [ ] **Step 5: Typecheck via build**

Run: `npm run build`
Expected: build completes; no type error in `metrics-table.tsx` or `app/r/[slug]/page.tsx`.

- [ ] **Step 6: Manual render check**

Run: `npm run dev`, then open `http://localhost:3000/r/tourism-tdt`. In the Key metrics table, rows whose slug is registered (e.g. the trailing-12-month and monthly TDT metrics) show a small teal `ƒ` after the label; clicking it opens the `/r/method/<slug>` page. Rows with no documented method show no badge (identical to today). Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add app/r/_components/metrics-table.tsx "app/r/[slug]/page.tsx"
git commit -m "feat(report): method affordance on documented metric rows"
```

---

### Task 6: Integration verification + push prep  ·  (either model)

**Files:**
- Modify: `SESSION_LOG.md` (new top-of-file entry — required before push, RULE 0)

- [ ] **Step 1: Run all touched test files together**

Run: `bun test refinery/lib/methodology-registry.test.mts refinery/render/display-leak.test.mts refinery/render/scrub-host.test.mts`
Expected: PASS — all suites green.

- [ ] **Step 2: Full app typecheck/build**

Run: `npm run build`
Expected: build succeeds (no type errors in any file this plan touched).

- [ ] **Step 3: Add the SESSION_LOG entry**

Prepend a new entry at the TOP of `SESSION_LOG.md` (newest-first; do not edit existing entries):

```markdown
## 2026-06-08 (<model> · claude/source-links-methodology) — feat(method): public methodology surface + citation hygiene

- **Registry + gate:** `refinery/lib/methodology-registry.mts` — curated metric-slug -> {measures, formula, denominator, source} (mirrors SOURCE_PROVENANCE_TABLES); `resolveMethod` + `methodHrefForSlug` (allowlist gate). Seeded with tourism-tdt SWFL + per-county slugs. FORMULA ONLY — no retrodicted skill (Glass guardrail 3).
- **Leak-gated wiring:** `DisplayMetric.methodHref` set in `toDisplayBrain` via the gate — raw slug never enters the display type; `display-leak.test.mts` extended (cap_rate_median stays the unregistered canary).
- **Route + UI:** `app/r/method/[metric]/page.tsx` (formula + provenance, mirrors /r/source); teal `ƒ` affordance on documented metric rows.
- **Hygiene:** `scrubCaveatTechnical` maps "Brains Supabase" -> "SWFL Data Gulf" (full citation / tier-3 / MCP). Pass-through battery added.
- Spec: `docs/superpowers/specs/2026-06-08-source-links-methodology-design.md`. Plan: `docs/superpowers/plans/2026-06-08-source-links-methodology.md`. No pack/vocab/lockfile/secret triggers.
```

```bash
git add SESSION_LOG.md
git commit -m "log: source-links + methodology surface"
```

- [ ] **Step 4: STOP — get operator confirmation, then push**

Do NOT push autonomously (operator standing rule). Show the operator `git log --oneline origin/main..HEAD` and ask for the go-ahead. On confirmation:

```bash
node scripts/safe-push.mjs
```

Then open a PR (`gh pr create`) targeting `main`. No `checks` ledger row maps to this work — none to open/close.

---

## Self-Review

**1. Spec coverage** (every spec §4 unit → a task):
- U1 registry/resolver → Task 1 ✓
- U2 speaker wiring (methodHref, leak test) → Task 3 ✓
- U3 `/r/method` route → Task 4 ✓
- U4 badge UI → Task 5 ✓
- U5 hygiene scrub → Task 2 ✓
- Spec §3 "no retrodicted skill" → enforced by registry doc-comment + the formula-only entries (no skill field exists) ✓
- Spec §7 dispatch (Opus/Sonnet, waves) → File Structure dispatch table + per-task headers ✓

**2. Placeholder scan:** No "TBD/TODO". Registry seeded with real, verified slugs (`latest_monthly_collections_usd`, etc. — confirmed in `brains/tourism-tdt.md`). Every code step shows complete code. Manual-check steps give exact URLs. ✓

**3. Type consistency:** `MethodologyEntry` fields (`label/measures/formula/denominator?/sourceTable?/brain?/doc?`) are identical across Task 1 (definition), Task 4 (consumption). `methodHref` is `string | undefined` on `DisplayMetric` (Task 3) and `string | null | undefined` on `MetricRow` (Task 5) — compatible (the report map passes `m.methodHref`, an optional string, into an optional-nullable field; assignable). `methodHrefForSlug` returns `string | undefined`, matching `DisplayMetric.methodHref?`. `resolveMethod` returns `MethodologyEntry | null`, handled by truthy checks in both the gate and the route. ✓

**4. Ambiguity:** Import paths spelled out exactly (`../../../../refinery/lib/...`, `../../source/_tables`, `../../_components/report-shell`) and match the sibling source page's depth. Test-vs-manual split stated per task. Push gate explicit. ✓
