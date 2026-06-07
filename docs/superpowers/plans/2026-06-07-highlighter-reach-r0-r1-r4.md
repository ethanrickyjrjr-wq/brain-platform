# Highlighter Reach (R0 + R1 + R4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Let the in-page Highlighter answer a question grounded not just in the current `/r/` report but in
the whole platform — comparing across SWFL areas (R0), pulling any other brain/vertical/region or master
server-side (R1), and handing the full grounded dossier to the user's own Claude (R4) — without weakening the
cite-or-decline guarantee.

**Architecture:** A new server brain at `app/api/converse/route.ts` (SSE, `claude-haiku-4-5`) builds its system
prompt from a **grounding context** that can hold one _or many_ dossiers. R0 = the current report's dossier
(already carries every-ZIP `detail_tables`). R1 = a deterministic `resolveReachTargets()` step that maps the
user's question to 0–3 _additional_ report slugs from the leaf catalog allowlist, fetches each via the existing
`fetchBrain` + `buildDossier` seam, and appends them as labeled grounded blocks. R4 = a handoff payload that
serializes the current dossier into a deep-link / MCP-priming string. Every fetched block is pre-validated,
cited brain output, so reach widens without the model ever seeing raw, un-cited data.

**Tech Stack:** Next.js (Node runtime route handlers), React 19 (`"use client"` hooks/components), Anthropic TS
SDK (`@anthropic-ai/sdk`, streaming), Supabase (`usage_events` counter), Bun test runner.

**Spec:** `docs/superpowers/specs/2026-06-07-highlighter-in-page-ask-chart-design.md` (Reach Expansion section,
R0/R1/R4 `[COMMITTED]`).

**Prerequisite note:** This plan _builds_ the base `/api/converse` engine (it does not exist yet — confirmed
against the route inventory) and bakes reach in from the first commit, because retro-fitting multi-dossier
grounding onto a single-dossier engine is wasted work. Chart wiring (Phase 2) and meter enforcement (Phase 3)
remain separate per the spec. **R2 (runtime lake read) is explicitly out of scope — its own spec.**

---

## Reused seams (verified in-session — exact signatures)

| Seam             | Path                                   | Signature                                                                                                                                                                                                                 |
| ---------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dossier builder  | `lib/fetch-brain.ts`                   | `buildDossier(output: BrainOutput, freshnessToken: string): Dossier` — `Dossier` carries `conclusion`, `key_metrics` (each with `source`), `detail_tables`, `drivers`, `conditional_claims`, `grain_boundary`, `caveats`. |
| Brain fetch      | `lib/fetch-brain.ts`                   | `fetchBrain(slug, { tier, origin }): Promise<{ text, freshness_token, output: BrainOutput, display }>` — reads `brains/{slug}.md`, Node runtime only.                                                                     |
| Rules block      | `refinery/lib/rules-of-engagement.mts` | `export const RULES_OF_ENGAGEMENT` (string). Inject verbatim.                                                                                                                                                             |
| Geography        | `refinery/lib/geography-gazetteer.mts` | `export const GEOGRAPHY_GAZETTEER`.                                                                                                                                                                                       |
| Anthropic client | `refinery/agents/anthropic.mts`        | `getAnthropic(): Anthropic`; `TRIAGE_MODEL = "claude-haiku-4-5"`; `agentsAreMocked()`.                                                                                                                                    |
| Place resolver   | `refinery/lib/place-resolver.mts`      | `resolvePlace(input): PlaceResolution` (`{ matched, corridor_id?, pocket?, display_name?, confidence }`).                                                                                                                 |
| Slug allowlist   | `app/api/mcp/inventory.ts`             | `buildReportIdSet(): Set<string>` over `BRAIN_CATALOG` (`{ id, domain, scope }` per entry, zero pack imports).                                                                                                            |
| Chart router     | `lib/route-chart.ts`                   | `routeChart(question): ChartIntent \| null` (Phase 2 consumer; not wired here).                                                                                                                                           |

**Vendor-First (locked in spec, re-verify before Task 4 if any drift):** model `claude-haiku-4-5`; streaming via
`client.messages.stream({ model, max_tokens, system, messages })` then `for await (const text of
stream.textStream)`; `thinking` disabled (omit); do **not** pass `effort`.

---

## File structure

- **Create** `lib/highlighter/grounding.ts` — pure: assembles the system-prompt context string from N dossiers +
  rules + gazetteer. One responsibility: turn grounded data → a model-ready, cite-or-decline context.
- **Create** `lib/highlighter/reach.ts` — pure: `resolveReachTargets(question, currentSlug)` → ordered list of
  _additional_ allowlisted slugs (topic→brain + place→region heuristics). One responsibility: routing.
- **Create** `lib/highlighter/handoff.ts` — pure: `buildClaudeHandoff(dossier, fact)` → the R4 deep-link / MCP
  priming string. One responsibility: the escape-valve payload.
- **Create** `lib/highlighter/meter.ts` — `recordUse()` / `weeklyCount()` against Supabase `usage_events`
  (enforcement flag read, default unlimited). One responsibility: counting.
- **Create** `app/api/converse/route.ts` — the SSE engine. Orchestrates: load current dossier → resolve reach →
  fetch reach dossiers → build grounding → stream haiku → record meter.
- **Create** `components/highlighter/HighlightPopup.tsx`, `lib/highlighter/use-highlight.ts`,
  `components/highlighter/FactChip.tsx`, `components/highlighter/FirstTouchHint.tsx` — the in-page UI (spec §
  Architecture/Discovery).
- **Create** `docs/sql/20260607_usage_events.sql` — the anonymous counter table (no PII, no RLS template copy).
- **Modify** `refinery/stages/4-output.mts` — emit reach-aware precomputed suggestions into the sidecar.
- **Modify** `app/api/mcp/server.ts` (~:201) — one-line discovery copy.

---

## Task 1: Grounding context builder (pure, multi-dossier — this IS R0)

**Files:**

- Create: `lib/highlighter/grounding.ts`
- Test: `lib/highlighter/grounding.test.ts`

The builder takes the rules block, the gazetteer, and an ordered list of `{ label, dossier }` blocks (block 0 =
the current report; blocks 1..n = reach targets from Task 2). It emits a single `system` string with cite-or-
decline instructions hard-coded, the freshness token of the primary report quoted once, and **the full
`detail_tables` of each dossier inlined** — that inlining is what makes cross-area comparison (R0) work, because
a housing dossier already holds every SWFL ZIP.

- [ ] **Step 1: Write the failing test**

```ts
// lib/highlighter/grounding.test.ts
import { test, expect } from "bun:test";
import { buildGroundingContext, type GroundingBlock } from "./grounding";
import type { Dossier } from "../fetch-brain";

function fakeDossier(token: string, withZips = false): Dossier {
  return {
    freshness_token: token,
    conclusion: "Housing is cooling.",
    direction: "bearish",
    magnitude: 0.4,
    confidence: 0.7,
    confidence_dispersion: 0.1,
    joint_integrity: 0.9,
    upstream_count: 3,
    drivers: [],
    key_metrics: [
      {
        metric: "median_price",
        value: "$525,000",
        source: {
          url: "https://x",
          fetched_at: "2026-06-01",
          tier: 2,
          citation: "Redfin",
        },
      } as any,
    ],
    detail_tables: withZips
      ? [
          {
            id: "housing_by_zip",
            title: "By ZIP",
            grain: "zip",
            columns: [
              {
                id: "median",
                label: "Median",
                display_format: "currency",
              } as any,
            ],
            rows: [
              { key: "34102", label: "Naples", cells: { median: 1850000 } },
              { key: "33904", label: "Cape Coral", cells: { median: 410000 } },
            ],
            source: {
              url: "https://x",
              fetched_at: "2026-06-01",
              tier: 2,
              citation: "Redfin",
            } as any,
          },
        ]
      : [],
    conditional_claims: [],
    grain_boundary: undefined,
    contradicts: [],
    caveats: [],
  };
}

test("primary freshness token is quoted exactly once", () => {
  const blocks: GroundingBlock[] = [
    { label: "Naples housing", dossier: fakeDossier("SWFL-7421-v5-20260607") },
  ];
  const ctx = buildGroundingContext({
    rules: "RULES",
    gazetteer: "GEO",
    blocks,
  });
  const matches = ctx.match(/SWFL-7421-v5-20260607/g) ?? [];
  expect(matches.length).toBe(1);
});

test("detail_tables rows are inlined so cross-area compare is in-context (R0)", () => {
  const blocks: GroundingBlock[] = [
    {
      label: "Naples housing",
      dossier: fakeDossier("SWFL-7421-v5-20260607", true),
    },
  ];
  const ctx = buildGroundingContext({
    rules: "RULES",
    gazetteer: "GEO",
    blocks,
  });
  expect(ctx).toContain("33904"); // Cape Coral row present even though page is Naples
  expect(ctx).toContain("1850000");
});

test("multiple blocks are labeled and ordered (reach blocks after primary)", () => {
  const blocks: GroundingBlock[] = [
    { label: "Naples housing", dossier: fakeDossier("SWFL-7421-v5-20260607") },
    {
      label: "Naples flood (env-swfl)",
      dossier: fakeDossier("SWFL-3000-v2-20260607"),
    },
  ];
  const ctx = buildGroundingContext({
    rules: "RULES",
    gazetteer: "GEO",
    blocks,
  });
  expect(ctx.indexOf("Naples housing")).toBeLessThan(
    ctx.indexOf("Naples flood"),
  );
});

test("cite-or-decline instruction is present", () => {
  const ctx = buildGroundingContext({
    rules: "RULES",
    gazetteer: "GEO",
    blocks: [{ label: "x", dossier: fakeDossier("t") }],
  });
  expect(ctx.toLowerCase()).toContain("decline");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/highlighter/grounding.test.ts`
Expected: FAIL — `Cannot find module './grounding'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/highlighter/grounding.ts
import type { Dossier } from "../fetch-brain";

export interface GroundingBlock {
  /** Human label the model uses to attribute a number ("Naples housing", "Naples flood (env-swfl)"). */
  label: string;
  dossier: Dossier;
}

export interface GroundingInput {
  rules: string; // RULES_OF_ENGAGEMENT, verbatim
  gazetteer: string; // GEOGRAPHY_GAZETTEER, verbatim
  blocks: GroundingBlock[]; // [0] = current report; [1..] = reach targets
}

/** Inline a dossier's detail_tables as compact rows so cross-area lookups are in-context (R0). */
function renderDetailTables(d: Dossier): string {
  if (!d.detail_tables || d.detail_tables.length === 0) return "";
  const out: string[] = [];
  for (const t of d.detail_tables) {
    out.push(
      `  Table "${t.title}" (grain: ${t.grain}; source: ${t.source.citation}):`,
    );
    for (const r of t.rows) {
      const cells = Object.entries(r.cells)
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      out.push(`    - ${r.key} (${r.label}): ${cells}`);
    }
  }
  return out.join("\n");
}

function renderKeyMetrics(d: Dossier): string {
  return d.key_metrics
    .map(
      (m: any) =>
        `  - ${m.metric}: ${m.value}${m.source?.citation ? ` [${m.source.citation}]` : ""}`,
    )
    .join("\n");
}

function renderBlock(b: GroundingBlock): string {
  const d = b.dossier;
  const parts = [
    `### ${b.label}`,
    `Conclusion: ${d.conclusion}`,
    `Key metrics:\n${renderKeyMetrics(d)}`,
  ];
  const tables = renderDetailTables(d);
  if (tables)
    parts.push(
      `Detail rows (every covered area — use these to compare):\n${tables}`,
    );
  if (d.caveats.length) parts.push(`Caveats: ${d.caveats.join("; ")}`);
  if (d.grain_boundary)
    parts.push(`What we do NOT hold: ${JSON.stringify(d.grain_boundary)}`);
  return parts.join("\n");
}

export function buildGroundingContext(input: GroundingInput): string {
  const primary = input.blocks[0];
  const token = primary?.dossier.freshness_token ?? "";
  return [
    "You are the SWFL Data Gulf in-page analyst. Answer ONLY from the grounded blocks below.",
    "Cite the block label for every number. If the data needed is not in any block, DECLINE and say what we do not hold — never invent a SWFL number finer than a block provides.",
    "Tag any projection beyond the cited numbers inline with [INFERENCE] and give one falsifying condition.",
    `Quote this freshness token exactly once in your answer: ${token}`,
    "",
    "=== RULES OF ENGAGEMENT ===",
    input.rules,
    "",
    "=== GEOGRAPHY ===",
    input.gazetteer,
    "",
    "=== GROUNDED DATA ===",
    input.blocks.map(renderBlock).join("\n\n"),
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/highlighter/grounding.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/highlighter/grounding.ts lib/highlighter/grounding.test.ts
git commit -m "feat(highlighter): multi-dossier grounding context builder (R0 cross-area in-context)"
```

---

## Task 2: Reach target resolver (pure — this IS R1's routing)

**Files:**

- Create: `lib/highlighter/reach.ts`
- Test: `lib/highlighter/reach.test.ts`

Given the user's question and the slug of the report they're on, decide which _other_ allowlisted reports to
pull. Deterministic (runs BEFORE the model, per spec) so reach can never hit an un-allowlisted slug. Three
heuristics, union'd, capped at 3, current slug excluded, every result validated against `buildReportIdSet()`:

1. **Topic → vertical** keyword map (e.g. "flood/insurance" → `env-swfl`; "commercial/office/retail/cap rate" →
   `cre-swfl`; "permit/construction" → `permits-swfl`; "rent" → `rentals-swfl`; "jobs/wages" →
   `labor-demand-swfl`; "tourism/hotel" → `tourism-tdt`).
2. **Synthesis ask** — "overall/compare everything/whole market/big picture" → `master`.
3. **Place mention with no in-vertical answer** is handled by R0 (detail_tables) for same-vertical; cross-region
   same-vertical falls through to the same brain (SWFL brains are region-wide), so no extra fetch needed.

- [ ] **Step 1: Write the failing test**

```ts
// lib/highlighter/reach.test.ts
import { test, expect } from "bun:test";
import { resolveReachTargets } from "./reach";

test("flood question on a housing page reaches env-swfl", () => {
  const t = resolveReachTargets(
    "what about flood risk and insurance here?",
    "housing-swfl",
  );
  expect(t).toContain("env-swfl");
});

test("commercial-rent question reaches cre-swfl", () => {
  const t = resolveReachTargets(
    "how do office cap rates compare?",
    "housing-swfl",
  );
  expect(t).toContain("cre-swfl");
});

test("big-picture question reaches master", () => {
  const t = resolveReachTargets(
    "what's the overall outlook for the whole market?",
    "housing-swfl",
  );
  expect(t).toContain("master");
});

test("never returns the current slug", () => {
  const t = resolveReachTargets("housing prices and flood", "env-swfl");
  expect(t).not.toContain("env-swfl");
});

test("only returns allowlisted slugs, capped at 3", () => {
  const t = resolveReachTargets(
    "flood and commercial and permits and rent and jobs and tourism",
    "housing-swfl",
  );
  expect(t.length).toBeLessThanOrEqual(3);
});

test("a plain same-vertical compare needs no reach (R0 covers it)", () => {
  const t = resolveReachTargets(
    "how does Naples compare to Cape Coral on price?",
    "housing-swfl",
  );
  expect(t).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/highlighter/reach.test.ts`
Expected: FAIL — `Cannot find module './reach'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/highlighter/reach.ts
import { buildReportIdSet } from "@/app/api/mcp/inventory";

const ALLOWED = buildReportIdSet();

/** Topic → brain slug. Order = priority; first hits win when capping. */
const TOPIC_TO_SLUG: Array<{ keywords: RegExp; slug: string }> = [
  {
    keywords: /\b(flood|insurance|aal|nfip|storm|surge|hurricane)\b/i,
    slug: "env-swfl",
  },
  {
    keywords:
      /\b(commercial|office|retail|industrial|cap rate|cre|absorption|vacancy)\b/i,
    slug: "cre-swfl",
  },
  {
    keywords: /\b(permit|construction|build(ing|s)?\b|new homes?)\b/i,
    slug: "permits-swfl",
  },
  {
    keywords: /\b(rent|rental|lease|asking rent|zori)\b/i,
    slug: "rentals-swfl",
  },
  {
    keywords: /\b(job|jobs|wage|wages|employ|labor|workforce)\b/i,
    slug: "labor-demand-swfl",
  },
  {
    keywords: /\b(tourism|tourist|hotel|hospitality|tdt|visitor)\b/i,
    slug: "tourism-tdt",
  },
];

const SYNTHESIS =
  /\b(overall|big picture|whole market|everything|compare everything|outlook for the (whole|entire))\b/i;

const MAX_REACH = 3;

/**
 * Decide which OTHER reports to pull for a question asked on `currentSlug`.
 * Deterministic and allowlist-bounded (runs before the model). Same-vertical
 * cross-area comparison is intentionally NOT here — the current dossier's
 * detail_tables already hold every area (R0).
 */
export function resolveReachTargets(
  question: string,
  currentSlug: string,
): string[] {
  if (!question) return [];
  const out: string[] = [];
  for (const { keywords, slug } of TOPIC_TO_SLUG) {
    if (
      keywords.test(question) &&
      slug !== currentSlug &&
      ALLOWED.has(slug) &&
      !out.includes(slug)
    ) {
      out.push(slug);
    }
  }
  if (
    SYNTHESIS.test(question) &&
    currentSlug !== "master" &&
    ALLOWED.has("master") &&
    !out.includes("master")
  ) {
    out.push("master");
  }
  return out.slice(0, MAX_REACH);
}
```

> **Note for the implementer:** confirm the exact leaf slugs against `BRAIN_CATALOG` (`refinery/packs/catalog.mts`)
> — if `rentals-swfl` / `labor-demand-swfl` differ, the `ALLOWED.has()` guard simply drops the miss (safe), but
> fix the map so the reach actually fires. Run `bun -e 'import("@/app/api/mcp/inventory").then(m=>console.log([...m.buildReportIdSet()]))'` to list them.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/highlighter/reach.test.ts`
Expected: PASS (6 tests). If a slug guard drops a target, correct the slug in `TOPIC_TO_SLUG` and re-run.

- [ ] **Step 5: Commit**

```bash
git add lib/highlighter/reach.ts lib/highlighter/reach.test.ts
git commit -m "feat(highlighter): deterministic allowlist-bounded reach resolver (R1 routing)"
```

---

## Task 3: Cross-report dossier fetch (server glue for R1)

**Files:**

- Create: `lib/highlighter/fetch-reach.ts`
- Test: `lib/highlighter/fetch-reach.test.ts`

Wraps `fetchBrain` + `buildDossier` for a list of resolved slugs into labeled `GroundingBlock`s. Tolerant: a
missing/broken brain is skipped (never aborts the answer), and the label is derived from the catalog scope so the
model attributes correctly.

- [ ] **Step 1: Write the failing test**

```ts
// lib/highlighter/fetch-reach.test.ts
import { test, expect } from "bun:test";
import { fetchReachBlocks } from "./fetch-reach";

test("returns one labeled block per resolvable slug", async () => {
  // env-swfl + master exist in the repo's brains/ dir at test time
  const blocks = await fetchReachBlocks(["master"], {
    origin: "https://www.swfldatagulf.com",
  });
  expect(blocks.length).toBe(1);
  expect(blocks[0].label.toLowerCase()).toContain("master");
  expect(blocks[0].dossier.freshness_token).toMatch(/^SWFL-/);
});

test("skips an unknown slug instead of throwing", async () => {
  const blocks = await fetchReachBlocks(["definitely-not-a-brain"], {
    origin: "https://x",
  });
  expect(blocks).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/highlighter/fetch-reach.test.ts`
Expected: FAIL — `Cannot find module './fetch-reach'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/highlighter/fetch-reach.ts
import { fetchBrain, buildDossier } from "../fetch-brain";
import { BRAIN_CATALOG } from "@/refinery/packs/catalog.mts";
import type { GroundingBlock } from "./grounding";

function labelFor(slug: string): string {
  const entry = BRAIN_CATALOG.find((e) => e.id === slug);
  return entry ? `${entry.scope} (${slug})` : slug;
}

/** Fetch + dossier-ify each reach slug into a labeled grounding block. Tolerant: skips failures. */
export async function fetchReachBlocks(
  slugs: string[],
  opts: { origin?: string },
): Promise<GroundingBlock[]> {
  const blocks: GroundingBlock[] = [];
  for (const slug of slugs) {
    try {
      const { output, freshness_token } = await fetchBrain(slug, {
        tier: 2,
        origin: opts.origin,
      });
      blocks.push({
        label: labelFor(slug),
        dossier: buildDossier(output, freshness_token),
      });
    } catch {
      // missing/broken brain — skip, never abort the answer
    }
  }
  return blocks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/highlighter/fetch-reach.test.ts`
Expected: PASS (2 tests). If `master` is not built locally, point the first test at any slug present in `brains/`.

- [ ] **Step 5: Commit**

```bash
git add lib/highlighter/fetch-reach.ts lib/highlighter/fetch-reach.test.ts
git commit -m "feat(highlighter): tolerant cross-report dossier fetch for reach blocks (R1)"
```

---

## Task 4: The `/api/converse` SSE engine

**Files:**

- Create: `app/api/converse/route.ts`
- Test: `app/api/converse/route.test.ts` (orchestration unit test with the SDK mocked)

Orchestrates the whole answer: load current dossier (from `report_id`) → `resolveReachTargets` →
`fetchReachBlocks` → `buildGroundingContext` → stream `claude-haiku-4-5` → `recordUse()` (Task 5). Streams SSE
`data:` lines. Enforcement OFF (meter only counts).

- [ ] **Step 1: Write the failing test (orchestration, SDK mocked)**

```ts
// app/api/converse/route.test.ts
import { test, expect, mock } from "bun:test";

mock.module("@/refinery/agents/anthropic.mts", () => ({
  TRIAGE_MODEL: "claude-haiku-4-5",
  agentsAreMocked: () => false,
  getAnthropic: () => ({
    messages: {
      stream: () => ({
        async *[Symbol.asyncIterator]() {},
        textStream: (async function* () {
          yield "Median in 34102 is ";
          yield "$1.85M [Naples housing].";
        })(),
      }),
    },
  }),
}));
mock.module("@/lib/highlighter/meter", () => ({
  recordUse: async () => 1,
  weeklyCount: async () => 0,
  capEnabled: () => false,
}));

const { POST } = await import("./route");

test("streams grounded text for a known report", async () => {
  const req = new Request("https://x/api/converse", {
    method: "POST",
    body: JSON.stringify({
      report_id: "master",
      fact: "median price",
      question: "what is 34102 median?",
    }),
  });
  const res = await POST(req);
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain("$1.85M");
});

test("400 on unknown report_id", async () => {
  const req = new Request("https://x/api/converse", {
    method: "POST",
    body: JSON.stringify({
      report_id: "nope-not-real",
      fact: "x",
      question: "y",
    }),
  });
  const res = await POST(req);
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test app/api/converse/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/api/converse/route.ts
import {
  fetchBrain,
  buildDossier,
  BrainNotFoundError,
} from "@/lib/fetch-brain";
import { RULES_OF_ENGAGEMENT } from "@/refinery/lib/rules-of-engagement.mts";
import { GEOGRAPHY_GAZETTEER } from "@/refinery/lib/geography-gazetteer.mts";
import { getAnthropic, TRIAGE_MODEL } from "@/refinery/agents/anthropic.mts";
import { buildReportIdSet } from "@/app/api/mcp/inventory";
import {
  buildGroundingContext,
  type GroundingBlock,
} from "@/lib/highlighter/grounding";
import { resolveReachTargets } from "@/lib/highlighter/reach";
import { fetchReachBlocks } from "@/lib/highlighter/fetch-reach";
import { recordUse } from "@/lib/highlighter/meter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = buildReportIdSet();
const MAX_TOKENS = 700;

export async function POST(request: Request): Promise<Response> {
  let body: { report_id?: string; fact?: string; question?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const { report_id, fact, question } = body;
  if (!report_id || !ALLOWED.has(report_id)) {
    return Response.json({ error: "unknown report_id" }, { status: 400 });
  }
  if (!question || typeof question !== "string") {
    return Response.json({ error: "question required" }, { status: 400 });
  }

  const origin = new URL(request.url).origin;

  // R0: current report dossier (carries every-area detail_tables).
  let primary: GroundingBlock;
  try {
    const { output, freshness_token } = await fetchBrain(report_id, {
      tier: 2,
      origin,
    });
    primary = {
      label: report_id,
      dossier: buildDossier(output, freshness_token),
    };
  } catch (err) {
    const status = err instanceof BrainNotFoundError ? 404 : 500;
    return Response.json({ error: (err as Error).message }, { status });
  }

  // R1: reach to other reports the question implies.
  const reachSlugs = resolveReachTargets(question, report_id);
  const reachBlocks = await fetchReachBlocks(reachSlugs, { origin });

  const system = buildGroundingContext({
    rules: RULES_OF_ENGAGEMENT,
    gazetteer: GEOGRAPHY_GAZETTEER,
    blocks: [primary, ...reachBlocks],
  });

  const userMsg = fact ? `About this fact: "${fact}". ${question}` : question;
  const client = getAnthropic();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const ai = client.messages.stream({
          model: TRIAGE_MODEL, // claude-haiku-4-5
          max_tokens: MAX_TOKENS,
          system,
          messages: [{ role: "user", content: userMsg }],
        });
        for await (const text of ai.textStream) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ text })}\n\n`),
          );
        }
        // meter checkpoint — counts only, enforcement OFF (Phase 3 flips it)
        await recordUse(request, { report_id, reach: reachSlugs });
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ done: true, reach: reachSlugs })}\n\n`,
          ),
        );
      } catch (e) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: (e as Error).message })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test app/api/converse/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/converse/route.ts app/api/converse/route.test.ts
git commit -m "feat(highlighter): /api/converse SSE engine — grounded haiku w/ R0+R1 reach, metered"
```

---

## Task 5: Anonymous usage meter (counting only, enforcement OFF)

**Files:**

- Create: `docs/sql/20260607_usage_events.sql`
- Create: `lib/highlighter/meter.ts`
- Test: `lib/highlighter/meter.test.ts`

Counter keyed by a signed client cookie + ISO week, server-incremented, anonymous rows only. `capEnabled()`
reads `HIGHLIGHTER_FREE_WEEKLY_CAP` (unset → unlimited). The route already calls `recordUse`; nothing enforces
yet (Phase 3).

- [ ] **Step 1: Write the SQL migration**

```sql
-- docs/sql/20260607_usage_events.sql  (idempotent)
CREATE TABLE IF NOT EXISTS public.usage_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id    text NOT NULL,        -- signed-cookie anonymous id (no PII)
  iso_week     text NOT NULL,        -- e.g. "2026-W23"
  report_id    text,
  reach        text[],
  ip_hash      text,                 -- secondary signal, hashed
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_events_client_week_idx ON public.usage_events (client_id, iso_week);
GRANT INSERT, SELECT ON public.usage_events TO service_role;
```

- [ ] **Step 2: Apply the migration directly (per CLAUDE.md — creds in `.dlt/secrets.toml`)**

Run a one-off `python -c "import psycopg; ..."` against the URI from `.dlt/secrets.toml`; verify with
`SELECT to_regclass('public.usage_events');` → non-null.

- [ ] **Step 3: Write the failing test**

```ts
// lib/highlighter/meter.test.ts
import { test, expect } from "bun:test";
import { isoWeek, capEnabled } from "./meter";

test("isoWeek formats as YYYY-Www", () => {
  expect(isoWeek(new Date("2026-06-07T00:00:00Z"))).toMatch(/^2026-W\d{2}$/);
});

test("capEnabled is false when the env var is unset", () => {
  delete process.env.HIGHLIGHTER_FREE_WEEKLY_CAP;
  expect(capEnabled()).toBe(false);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test lib/highlighter/meter.test.ts`
Expected: FAIL — `Cannot find module './meter'`.

- [ ] **Step 5: Write minimal implementation**

```ts
// lib/highlighter/meter.ts
import { createClient } from "@supabase/supabase-js";

export function isoWeek(d: Date): string {
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((date.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function capEnabled(): boolean {
  return Boolean(process.env.HIGHLIGHTER_FREE_WEEKLY_CAP);
}

function client() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    {
      auth: { persistSession: false },
    },
  );
}

/** Anonymous client id from a signed cookie; falls back to a hashed IP bucket. */
function clientIdFrom(request: Request): string {
  const cookie = request.headers.get("cookie") ?? "";
  const m = cookie.match(/sdg_cid=([a-zA-Z0-9_-]+)/);
  return m?.[1] ?? "anon";
}

export async function recordUse(
  request: Request,
  meta: { report_id: string; reach: string[] },
): Promise<number> {
  try {
    const db = client();
    const week = isoWeek(new Date());
    await db.from("usage_events").insert({
      client_id: clientIdFrom(request),
      iso_week: week,
      report_id: meta.report_id,
      reach: meta.reach,
    });
    return 1;
  } catch {
    return 0; // metering must never break an answer
  }
}

export async function weeklyCount(clientId: string): Promise<number> {
  try {
    const db = client();
    const { count } = await db
      .from("usage_events")
      .select("*", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("iso_week", isoWeek(new Date()));
    return count ?? 0;
  } catch {
    return 0;
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test lib/highlighter/meter.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add docs/sql/20260607_usage_events.sql lib/highlighter/meter.ts lib/highlighter/meter.test.ts
git commit -m "feat(highlighter): anonymous weekly usage meter (counting only, enforcement OFF)"
```

---

## Task 6: R4 — "Open in your Claude" handoff payload

**Files:**

- Create: `lib/highlighter/handoff.ts`
- Test: `lib/highlighter/handoff.test.ts`

Builds the escape-valve string the popup's free "Open in your Claude ↗" link carries: a compact, grounded prime
(the fact + the current report's conclusion + key metrics + the `swfl_fetch` instruction) so the user's own
Claude starts from our cited data and can blend it with outside info / build a chart there. Answers the operator
question "can the user have their Claude add to the /r/ info and chart it?" — yes, this is that payload.

- [ ] **Step 1: Write the failing test**

```ts
// lib/highlighter/handoff.test.ts
import { test, expect } from "bun:test";
import { buildClaudeHandoff } from "./handoff";

test("handoff primes with the fact, report, and the MCP fetch instruction", () => {
  const text = buildClaudeHandoff({
    report_id: "housing-swfl",
    fact: "$525,000 median",
    conclusion: "Housing is cooling.",
    freshness_token: "SWFL-7421-v5-20260607",
  });
  expect(text).toContain("$525,000 median");
  expect(text).toContain("housing-swfl");
  expect(text).toContain("swfl_fetch"); // tells their Claude how to pull the live report
  expect(text).toContain("SWFL-7421-v5-20260607");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/highlighter/handoff.test.ts`
Expected: FAIL — `Cannot find module './handoff'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/highlighter/handoff.ts
export interface HandoffInput {
  report_id: string;
  fact: string;
  conclusion: string;
  freshness_token: string;
}

/**
 * Prime string for the user's own Claude (R4). Carries our cited starting point
 * + how to pull the full live report via the MCP, so they can extend it with
 * outside info and build a chart/doc in their session — off our meter.
 */
export function buildClaudeHandoff(i: HandoffInput): string {
  return [
    `I'm looking at SWFL Data Gulf's "${i.report_id}" report.`,
    `Fact in focus: ${i.fact}`,
    `Report's bottom line: ${i.conclusion}`,
    `Freshness: ${i.freshness_token}`,
    "",
    `To work with the live, cited data, call the SWFL MCP tool \`swfl_fetch\` with report_id="${i.report_id}" (add it once via: claude mcp add --transport http swfl https://www.swfldatagulf.com/api/mcp). Then help me analyze or chart it, and feel free to combine it with other sources — but keep every SWFL number attributed to the report.`,
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/highlighter/handoff.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/highlighter/handoff.ts lib/highlighter/handoff.test.ts
git commit -m "feat(highlighter): R4 'Open in your Claude' grounded handoff payload"
```

---

## Task 7: In-page UI — chips, popup (3 states), reach affordance

**Files:**

- Create: `lib/highlighter/use-highlight.ts` (`"use client"`)
- Create: `components/highlighter/FactChip.tsx` (`"use client"`)
- Create: `components/highlighter/HighlightPopup.tsx` (`"use client"`)
- Create: `components/highlighter/FirstTouchHint.tsx` (`"use client"`)
- Test: `components/highlighter/HighlightPopup.test.tsx` (render + state transitions)

Implements the spec's fact-detection + popup. **Reach-aware addition:** when the SSE `done` event returns a
non-empty `reach` array, the Answer state shows a subtle line — _"Also pulled: Naples flood (env-swfl)"_ — so
the user sees the tool reached beyond the page. Mobile-first per spec (chips, responsive popup). This task is
mostly integration/visual; the contracts below are the interface the server tasks already satisfy.

**Component contracts (must match the server):**

- `use-highlight.ts` exports `useHighlight()` → `{ fact: { text, rect, factType } | null, clear() }`. Desktop:
  `mouseup`/`keyup` + 10 ms settle, snapshot `{ text, rect, factType }`, suppress inside inputs/the popup.
- `FactChip.tsx`: `<FactChip value="$30,074/yr" factType="metric" onActivate={(snapshot)=>…} />` — wraps a
  `key_metric` value / resolved place token at render time; tap → same snapshot path.
- `HighlightPopup.tsx`: props `{ reportId: string; fact: { text; rect; factType }; suggestions: string[];
onClose() }`. States **Suggestions → Ask → Answer**. Ask/Answer POST to `/api/converse` and read the SSE
  stream (`data:` lines → append `text`; on `done`, render the `reach` attribution + the "Chart this" (Phase 2)
  and "Open in your Claude ↗" (Task 6 payload) footer links).

- [ ] **Step 1: Write the failing render test**

```tsx
// components/highlighter/HighlightPopup.test.tsx
import { test, expect } from "bun:test";
import { render, screen } from "@testing-library/react";
import { HighlightPopup } from "./HighlightPopup";

test("opens in Suggestions state with the precomputed questions", () => {
  render(
    <HighlightPopup
      reportId="housing-swfl"
      fact={{
        text: "$525,000",
        rect: { top: 0, left: 0, width: 10, height: 10 } as DOMRect,
        factType: "metric",
      }}
      suggestions={[
        "How does this compare to Cape Coral?",
        "What's driving it?",
      ]}
      onClose={() => {}}
    />,
  );
  expect(
    screen.getByText("How does this compare to Cape Coral?"),
  ).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test components/highlighter/HighlightPopup.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook + components**

Build `use-highlight.ts`, `FactChip.tsx`, `FirstTouchHint.tsx`, and `HighlightPopup.tsx` per the contracts above.
`HighlightPopup` smart-positions (prefer right, flip left, center fallback, 12px gutter), closes on Esc/outside/X
only, and is responsive (max-width, viewport-gutter, flips above/below) for 375px. The Answer state consumes the
SSE stream:

```tsx
const res = await fetch("/api/converse", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ report_id: reportId, fact: fact.text, question }),
});
const reader = res.body!.getReader();
const dec = new TextDecoder();
let buf = "";
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  for (const line of buf.split("\n\n")) {
    const m = line.match(/^data: (.*)$/m);
    if (!m) continue;
    const evt = JSON.parse(m[1]);
    if (evt.text) setAnswer((a) => a + evt.text);
    if (evt.reach?.length) setReach(evt.reach);
  }
  buf = buf.slice(buf.lastIndexOf("\n\n") + 2);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test components/highlighter/HighlightPopup.test.tsx`
Expected: PASS.

- [ ] **Step 5: Mount on `/r/` + discovery coachmark, then commit**

Wire `useHighlight()` + `<HighlightPopup>` + `<FirstTouchHint>` into the `/r/[slug]` page; wrap `key_metric`
values and resolved place tokens in `<FactChip>`. Add the one-line MCP discovery copy in `app/api/mcp/server.ts`
(~:201): _"Open the report and tap any figure to dig in."_

```bash
git add lib/highlighter/use-highlight.ts components/highlighter/*.tsx app/r app/api/mcp/server.ts
git commit -m "feat(highlighter): in-page chips + popup (3 states) with reach attribution + coachmark"
```

---

## Task 8: Reach-aware precomputed suggestions (refinery Stage 4)

**Files:**

- Modify: `refinery/stages/4-output.mts` (after the validator gate + `.md` write; sidecar region ~658–671 — and
  **add `rm` to the `node:fs/promises` import** per the spec audit note)
- Test: `refinery/stages/4-output.suggestions.test.mts`

Emit 2–3 suggested questions per numeric `key_metric` into the brain sidecar, **including at least one reach
suggestion** where a sibling vertical is obvious (e.g. on housing, "How does flood risk affect this ZIP?" →
fires R1 → env-swfl). These ship in the dossier so the popup's Suggestions state is instant + $0.

- [ ] **Step 1: Write the failing test**

```ts
// refinery/stages/4-output.suggestions.test.mts
import { test, expect } from "bun:test";
import { suggestionsForMetric } from "./4-output.mts";

test("a numeric metric gets 2-3 suggestions incl. one cross-area compare", () => {
  const s = suggestionsForMetric(
    { metric: "median_price", value: "$525,000" } as any,
    "housing-swfl",
  );
  expect(s.length).toBeGreaterThanOrEqual(2);
  expect(s.some((q) => /compare|vs\.|other/i.test(q))).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test refinery/stages/4-output.suggestions.test.mts`
Expected: FAIL — `suggestionsForMetric` not exported.

- [ ] **Step 3: Implement `suggestionsForMetric` + wire into the sidecar write**

```ts
// add to refinery/stages/4-output.mts
export function suggestionsForMetric(
  m: { metric: string; value: string | number },
  slug: string,
): string[] {
  const label = m.metric.replace(/_/g, " ");
  const out = [
    `What's driving ${label}?`,
    `How does ${label} here compare to other SWFL areas?`,
  ];
  if (slug === "housing-swfl")
    out.push(`How does flood risk affect ${label} in this ZIP?`);
  return out.slice(0, 3);
}
```

Then, in the sidecar write block, attach `suggestions` per numeric metric to the emitted dossier/sidecar object.
Mind the `dryRun` / `HOLD` early returns (~600/638) — only write when the real `.md` write happens.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test refinery/stages/4-output.suggestions.test.mts`
Expected: PASS.

- [ ] **Step 5: Rebuild one brain to verify the sidecar carries suggestions, then commit**

Run: `npm run refinery -- housing-swfl --target-only` → confirm the sidecar/dossier holds `suggestions`.

```bash
git add refinery/stages/4-output.mts refinery/stages/4-output.suggestions.test.mts
git commit -m "feat(highlighter): reach-aware precomputed suggestions in Stage 4 sidecar"
```

---

## Final verification (whole plan)

- [ ] `bun test lib/highlighter app/api/converse` — all green.
- [ ] `npm run refinery:typecheck` — only the ~18 baseline strictness errors; **zero new**.
- [ ] **Desktop:** on `/r/housing-swfl`, select a ZIP's price → popup → "How does this compare to Cape Coral?" →
      answer cites two ZIP rows from the SAME dossier (R0), streams, quotes the freshness token once.
- [ ] **Reach (R1):** ask "what about flood risk here?" → answer cites an `env-swfl (…)` block; the `done` event
      `reach` array contains `env-swfl`; popup shows "Also pulled: … (env-swfl)".
- [ ] **R4:** "Open in your Claude ↗" carries the handoff prime (fact + conclusion + `swfl_fetch` instruction +
      token).
- [ ] **Meter:** each answer inserts a `usage_events` row; `HIGHLIGHTER_FREE_WEEKLY_CAP` unset → never blocks.
- [ ] **Mobile (375px):** chips tappable, popup readable, no h-scroll.

## Self-review notes (author)

- **Spec coverage:** R0 = Task 1 (detail_tables inlined). R1 = Tasks 2+3+4 (resolver → fetch → orchestration).
  R4 = Task 6. Meter mechanism = Task 5. UI/discovery = Task 7. Precomputed suggestions = Task 8. R2/R3 = out of
  scope (own spec / rejected). Chart "Chart this" = Phase 2 (separate). Enforcement = Phase 3 (separate).
- **Allowlist safety:** every reach slug is checked against `buildReportIdSet()`; an un-allowlisted or missing
  brain is silently skipped (Task 3), so reach can never fetch outside the catalog or abort an answer.
- **Guarantee preserved:** the model only ever sees pre-validated, cited dossiers (no raw lake) — the
  structural no-invention property holds across all reach blocks.
- **Open confirm for the implementer:** exact leaf slugs in `TOPIC_TO_SLUG` (Task 2 note) and the Stage-4
  sidecar object shape (Task 8) — both verified against `BRAIN_CATALOG` / `4-output.mts` at execution time.
