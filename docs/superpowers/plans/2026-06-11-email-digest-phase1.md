# Email Digest Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **REVISION 2026-06-11 (read before executing):**
> 1. **HISTORICAL HOOK is CUT from V1.** The `historicalHook()` function returned a hardcoded string ("the last time 33908 DOM exceeded 75 days was Q3 2022…") — that is **invented data** and violates EMAIL.md Rule 4 + the platform's no-invention spine. The honest version needs historical ZIP-grain DOM data that is **not yet in the lake**. → Remove the HISTORICAL HOOK section from `DigestEmail.tsx` (section 7) and delete `historicalHook()` from `build-digest.mts`. Ship **7 sections**. Re-add only when historical rows exist and the value is **read, not written**.
> 2. **`DigestEmail.tsx` visual target = `docs/email-marketing/samples/agent-client-digest.html`.** That white-label, per-ZIP sample (real data, agent brand block, "The Read", flood-cost callout) is the design to match — not the older internal layout sketched in Task 4 below. The white-label slot (agent name/logo/contact) is now part of V1.
> 3. **Interaction model + highlighter:** see README "Interaction model" / "Highlighter" — reply-to-ask answers in email (Phase 3), click-to-chat opens the AI hook page (`samples/ai-hook-page.html`); the highlighter is **web-only, never in the email body** (JS is blocked).
> 4. **Charts ARE allowed in-email — just not JavaScript ones.** Static HTML/CSS charts (bar/comparison built from `<table>` cells, zero JS — see the "Price change" block in `samples/agent-client-digest.html`) and server-rendered PNGs both render in every client. EMAIL.md Rule 7 already permits PNGs; the "charts are tables" headline is misleading shorthand for "no *JS* charts." Only *interactive/JS* charts and the highlighter are web-only. Do NOT strip the in-email chart citing "no charts in email."
> 6. **TASK 2 WAS REBUILT AGAINST THE REAL BRAIN SCHEMA (2026-06-12).** The shipped `fetch-digest-data.mts` was written against a hallucinated `BrainOutput` shape and produced an **empty digest** (every ZIP "—", county null, no city voices). Fixed: (a) `parseBrainOutputSection` brace-matches the JSON object instead of parsing to EOF (the file continues with `--- ACTIVE PROJECTS ---` etc.); (b) ZIP metrics read `row.key` (the ZIP) + `row.cells` with real field names, normalizing the 0–100 sale-to-list to 0–1 and nulling the absent sold-above-list column; (c) county metrics key on `key_metrics[].metric` (not `slug`) with the `housing_`-prefixed slugs; (d) `parseCityVoices` parses the speak **markdown table** (`| {City} — {topic} | … |`), not the imagined `BREAKING:` lines. Plus a **city-voice relevance filter** (`selectCityVoices`) — see EMAIL.md Rule 2.5. All verified against the live API (6 ZIPs + county + voices populate; subject leads with a real transaction).
> 5. **WHITE-LABEL THEME is V1 (this revision).** The hardcoded palette in Task 4 (`const C = {navy, teal, …}`) is replaced by an optional `theme?: BrandTheme` prop that **defaults to SWFL's navy/teal**. `BrandTheme` (`{primary, accent, logoUrl}`) is added to `types.ts` (Task 1) with the **same shape as `lib/deliverable/brand-theme.ts`**, so the funnel's `extractBrandTheme()` output (manual blob now / Brandfetch later) drops straight in with no adapter. The house digest passes **no** theme (→ SWFL). The agent white-label digest (README Phase 4) and the funnel's prospect-branded send (funnel spec Phase 2) inject a theme — that injection is the **single seam** between the email track and the funnel track; they never edit the same file. Logo renders as a bounded `<Img>` (≤42px tall) in the header when `logoUrl` is set. This realizes revision #2's white-label slot. Scope guard: theme = **colors + logo only**. The masthead **text** stays "SWFL DATA GULF INTEL" for V1 (masthead copy is a later white-label content decision, not a theme primitive). Also: EMAIL.md Rule 2 still lists HISTORICAL HOOK as section 7 of 8 — it is **deferred for V1 per revision #1**; the email ships 7 sections until historical ZIP-grain rows exist.

**Goal:** First successful daily email sent to hello@swfldatagulf.com by a GHA cron (Mon–Fri 6am ET), with a JSON log written to `docs/email-marketing/email-logs/` enabling cross-day dedup and delta.

**Architecture:** A Bun script (`scripts/email/build-digest.mts`) fetches brain narrative from the live API and structured ZIP metrics from committed `brains/housing-swfl.md` on disk, renders a React Email template, sends via Resend, and writes a JSON log. Idempotency guard aborts if today's log already shows `send_status: "sent"`.

**Tech Stack:** Bun + TypeScript (`.mts`/`.tsx`), `@react-email/components` + `@react-email/render` (to install), Resend SDK (already `^6.12.3`), GitHub Actions cron. Tests: `bun:test` + `node:assert/strict`.

---

## Parallelism and Model Assignments

```
[Task 0: Install packages + lockfile]  ← sequential, blocks all
        ↓
[Task 1: types.ts — OPUS]              ← sequential, foundation contract
        ↓
┌─────────────────────────────────────────────────────┐
│  PARALLEL BLOCK (all start after Task 1)            │
│  Task 2: fetch-digest-data.mts  — SONNET            │
│  Task 3: log-io.mts             — SONNET            │
│  Task 4: DigestEmail.tsx        — OPUS              │
│  Task 5: daily-email-digest.yml — SONNET            │
└─────────────────────────────────────────────────────┘
        ↓
[Task 6: build-digest.mts — OPUS]      ← depends on 2, 3, 4
        ↓
[Task 7: Smoke test]                   ← sequential last
```

**Sonnet** handles Tasks 2, 3, 5 — mechanical fetch-and-parse, file I/O, and workflow YAML adaptation. Clear interfaces from Task 1; no architecture decisions.

**Opus** handles Tasks 1, 4, 6 — the type contract (everything else binds to it), the email template (conditional sections, CAN-SPAM, RFC 8058), and the orchestrator (idempotency, DELTA, Rule 5 transaction floor + polarity).

---

## File Structure

```
scripts/email/
  types.ts                           — EmailLog, DigestPayload, ZipMetricSnapshot, FreshnessManifest, MetricDelta
  fetch-digest-data.mts              — reads brains/housing-swfl.md + calls speak API for narrative
  log-io.mts                         — readMostRecentLog(), writeLog(), isTodayAlreadySent(), getNextIssueNumber()
  DigestEmail.tsx                    — React Email component (7 sections — HISTORICAL HOOK cut per rev #1; white-label theme prop)
  build-digest.mts                   — orchestrator: fetch → delta → render → send → log
  __tests__/
    fetch-digest-data.test.mts
    log-io.test.mts
    build-digest.test.mts
.github/workflows/
  daily-email-digest.yml             — cron Mon–Fri 10:00 UTC (6am ET)
docs/email-marketing/email-logs/
  .gitkeep                           — already exists
```

---

## Task 0: Install React Email Packages

**Model:** either · **Sequential** — blocks all tasks

**Files:** `package.json`, `bun.lock` (auto-updated)

- [ ] **Install**
```bash
bun add @react-email/components @react-email/render
```

- [ ] **Verify build**
```bash
bun run build 2>&1 | tail -5
```
Expected: exits 0, no new type errors.

- [ ] **Commit lockfile** (CLAUDE.md Rule 1 — skipping this breaks CI `--frozen-lockfile`)
```bash
git add package.json bun.lock
git commit -m "build: add @react-email/components + @react-email/render"
```

---

## Task 1: Foundation Types

**Model:** OPUS · **Sequential** — every downstream task imports from here

> `scripts/email/types.ts` **already exists on disk** (the interfaces below are unchanged and built). This task now means: **add the brand-theme block** (bottom of this code block) to the existing file. Don't rewrite the rest.

**Files:**
- Create: `scripts/email/types.ts`

- [ ] **Create types.ts**

```typescript
// scripts/email/types.ts

export const ZIP_FOCUS = [
  "33908", "33919", "33912", "33907", "33931", "33914",
] as const;
export type FocusZip = (typeof ZIP_FOCUS)[number];

/** Per-ZIP or county-level metric snapshot stored in the log for DELTA. */
export interface ZipMetricSnapshot {
  median_sale_price: number | null;
  dom: number | null;
  months_of_supply: number | null;
  /** 0–1 scale (e.g. 0.97 = 97%). */
  avg_sale_to_list: number | null;
  /** 0–1 scale. */
  sold_above_list_pct: number | null;
  inventory: number | null;
  /** Number of sales in the period — used for transaction floor check. */
  sale_count_period: number | null;
}

/** Per-section freshness citations. Replaces a single global freshness_token. */
export interface FreshnessManifest {
  master: { token: string; as_of: string };
  housing_swfl: { token: string; as_of: string; period_begin: string };
  city_pulse: { token: string; as_of: string };
  lee_cre: { token: string; as_of: string } | null;
  /** "preview" = dry run, must NOT stamp live-lake provenance. */
  source_env: "live" | "preview";
}

export interface CityVoiceSignal {
  topic: "breaking" | "transactions" | "development" | "business" | "structural";
  title: string;
  source_url: string;
  city: string;
}

/** All data needed to render the email. Built by fetch-digest-data.mts. */
export interface DigestPayload {
  date: string;
  freshness_manifest: FreshnessManifest;
  /** 2–3 sentence market pulse from master brain. */
  top_line: string;
  zip_metrics: Record<string, ZipMetricSnapshot>;
  county_metrics: ZipMetricSnapshot;
  /** Sorted by topic priority: breaking first. Max 4. */
  city_voices: CityVoiceSignal[];
  top_story: { title: string; slug: string; topic: string } | null;
}

/** Written to email-logs/YYYY-MM-DD.json after every send attempt. */
export interface EmailLog {
  date: string;
  last_send_date: string;
  issue: number;
  subject: string;
  freshness_manifest: FreshnessManifest;
  top_story: { title: string; slug: string; topic: string } | null;
  zip_metrics: Record<string, ZipMetricSnapshot>;
  county_metrics: ZipMetricSnapshot;
  signals_surfaced: string[];
  cta_url: string;
  send_status: "sent" | "skipped" | "error";
  send_error: string | null;
  recipients: number;
}

/** Computed delta for one metric, with Rule 5 polarity framing. */
export interface MetricDelta {
  metric: keyof ZipMetricSnapshot;
  current: number;
  previous: number;
  pct_change: number;
  is_escalation: boolean;
  direction_framing: "bullish" | "bearish" | "context";
}

// ── Brand theme (white-label) — ADD this block to the existing types.ts ─────
// Structurally identical to lib/deliverable/brand-theme.ts `BrandTheme` so the
// funnel's extractBrandTheme() output (Brandfetch / manual blob) drops in with
// ZERO adapter. Defined here — not imported — to keep the Bun email script free
// of the chart-registry dependency graph that brand-theme.ts pulls in.
export interface BrandTheme {
  /** Header band, CTA button, big stat numbers, badge/masthead accents. */
  primary: string | null;
  /** Section labels, links, top rule, [source] links. */
  accent: string | null;
  /** Bounded <Img> in the header; omitted when null. */
  logoUrl: string | null;
}

/** SWFL Data Gulf house brand — the default when no white-label theme is passed. */
export const SWFL_THEME = { primary: "#0F2035", accent: "#1BB8C9", logoUrl: null } as const;

/** Merge a nullable/partial theme over the SWFL defaults. Null/undefined fields fall back. */
export function resolveTheme(
  theme?: BrandTheme | null,
): { primary: string; accent: string; logoUrl: string | null } {
  return {
    primary: theme?.primary ?? SWFL_THEME.primary,
    accent: theme?.accent ?? SWFL_THEME.accent,
    logoUrl: theme?.logoUrl ?? SWFL_THEME.logoUrl,
  };
}
```

- [ ] **Commit**
```bash
git add scripts/email/types.ts
git commit -m "feat(email): foundation types — DigestPayload, EmailLog, ZipMetricSnapshot"
```

---

## Task 2: Data Fetcher

**Model:** SONNET · **Parallel** (start after Task 1, independent of 3/4/5)

**Files:**
- Create: `scripts/email/fetch-digest-data.mts`
- Create: `scripts/email/__tests__/fetch-digest-data.test.mts`

**Design:** Two data sources.
1. **Narrative** (`top_line`, `city_voices`): speak API at `SITE_URL/api/b/[slug]?view=speak&tier=2`
2. **Structured metrics** (`zip_metrics`, `county_metrics`): parse `brains/housing-swfl.md` OUTPUT section from disk (committed file, available in GHA after checkout)

- [ ] **Write failing tests**

```typescript
// scripts/email/__tests__/fetch-digest-data.test.mts
import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { parseBrainOutputSection, extractZipMetrics } from "../fetch-digest-data.mts";

describe("parseBrainOutputSection", () => {
  test("extracts JSON from --- OUTPUT --- section", () => {
    const md = `---\nbrain_id: housing-swfl\n---\nNarrative.\n--- OUTPUT ---\n{"key_metrics":[],"detail_tables":[]}`;
    assert.deepEqual(parseBrainOutputSection(md), { key_metrics: [], detail_tables: [] });
  });

  test("returns null when no OUTPUT section", () => {
    assert.equal(parseBrainOutputSection("no output here"), null);
  });

  test("returns null on malformed JSON", () => {
    assert.equal(parseBrainOutputSection("--- OUTPUT ---\nnot json"), null);
  });
});

describe("extractZipMetrics", () => {
  test("maps housing row fields to ZipMetricSnapshot", () => {
    const row = {
      median_sale_price: 412000,
      median_dom: 52,
      months_of_supply: 4.1,
      avg_sale_to_list: 0.97,
      sold_above_list: 0.18,
      inventory: 143,
      homes_sold: 22,
    };
    const result = extractZipMetrics(row);
    assert.equal(result.median_sale_price, 412000);
    assert.equal(result.dom, 52);
    assert.equal(result.months_of_supply, 4.1);
    assert.equal(result.avg_sale_to_list, 0.97);
    assert.equal(result.sold_above_list_pct, 0.18);
    assert.equal(result.inventory, 143);
    assert.equal(result.sale_count_period, 22);
  });

  test("returns all-null for empty row", () => {
    const result = extractZipMetrics({});
    assert.equal(result.median_sale_price, null);
    assert.equal(result.dom, null);
    assert.equal(result.sale_count_period, null);
  });
});
```

- [ ] **Run to confirm failure**
```bash
bun test scripts/email/__tests__/fetch-digest-data.test.mts
```
Expected: `Cannot find module '../fetch-digest-data.mts'`

- [ ] **Implement fetch-digest-data.mts**

```typescript
// scripts/email/fetch-digest-data.mts
import fs from "node:fs";
import path from "node:path";
import type {
  DigestPayload, ZipMetricSnapshot, CityVoiceSignal, FreshnessManifest,
} from "./types.ts";
import { ZIP_FOCUS } from "./types.ts";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
const REPO_ROOT = path.join(import.meta.dirname, "..", "..");
const DRY_RUN = process.env.DRY_RUN === "true";

// ── Brain file parsing ─────────────────────────────────────────────────────

export function parseBrainOutputSection(markdown: string): unknown | null {
  const marker = "--- OUTPUT ---";
  const idx = markdown.indexOf(marker);
  if (idx === -1) return null;
  try {
    return JSON.parse(markdown.slice(idx + marker.length).trim());
  } catch {
    return null;
  }
}

export function extractZipMetrics(row: Record<string, unknown>): ZipMetricSnapshot {
  const n = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    const x = Number(v);
    return isNaN(x) ? null : x;
  };
  return {
    median_sale_price: n(row.median_sale_price),
    dom: n(row.median_dom),
    months_of_supply: n(row.months_of_supply),
    avg_sale_to_list: n(row.avg_sale_to_list),
    sold_above_list_pct: n(row.sold_above_list),
    inventory: n(row.inventory),
    sale_count_period: n(row.homes_sold),
  };
}

function readHousingBrain(): {
  zipMetrics: Record<string, ZipMetricSnapshot>;
  countyMetrics: ZipMetricSnapshot;
  periodBegin: string;
} {
  const content = fs.readFileSync(
    path.join(REPO_ROOT, "brains", "housing-swfl.md"), "utf-8"
  );
  const output = parseBrainOutputSection(content) as {
    detail_tables?: Array<{ rows: Array<Record<string, unknown>> }>;
    key_metrics?: Array<{ slug: string; value: unknown }>;
  } | null;

  const zipMetrics: Record<string, ZipMetricSnapshot> = {};
  let periodBegin = "";
  const rows = output?.detail_tables?.[0]?.rows ?? [];
  for (const row of rows) {
    const zip = String(row.zip_code ?? "");
    if ((ZIP_FOCUS as readonly string[]).includes(zip)) {
      zipMetrics[zip] = extractZipMetrics(row);
      if (!periodBegin && row.period_begin) periodBegin = String(row.period_begin);
    }
  }

  const km = output?.key_metrics ?? [];
  const kv = (slug: string): number | null => {
    const found = km.find((m) => m.slug === slug);
    return found ? (typeof found.value === "number" ? found.value : null) : null;
  };
  const countyMetrics: ZipMetricSnapshot = {
    median_sale_price: kv("median_sale_price_swfl"),
    dom: kv("median_dom_swfl"),
    months_of_supply: kv("housing_months_of_supply_swfl"),
    avg_sale_to_list: kv("avg_sale_to_list_swfl"),
    sold_above_list_pct: kv("sold_above_list_swfl"),
    inventory: null,
    sale_count_period: null,
  };
  return { zipMetrics, countyMetrics, periodBegin };
}

// ── API narrative fetch ────────────────────────────────────────────────────

async function fetchSpeak(slug: string): Promise<{ text: string; freshness_token: string }> {
  const res = await fetch(`${SITE_URL}/api/b/${slug}?view=speak&tier=2`);
  if (!res.ok) throw new Error(`Brain speak fetch failed: ${slug} (${res.status})`);
  const text = await res.text();
  const token = text.match(/SWFL-\d{4}-v\d+-\d{8}/)?.[0] ?? "unknown";
  return { text, freshness_token: token };
}

async function fetchCityVoices(): Promise<CityVoiceSignal[]> {
  const { text } = await fetchSpeak("city-pulse-swfl");
  const signals: CityVoiceSignal[] = [];
  const topicMap: Record<string, CityVoiceSignal["topic"]> = {
    BREAKING: "breaking", TRANSACTION: "transactions", DEVELOPMENT: "development",
    BUSINESS: "business", STRUCTURAL: "structural",
  };
  for (const line of text.split("\n")) {
    const m = line.match(/^(BREAKING|TRANSACTION|DEVELOPMENT|BUSINESS|STRUCTURAL):\s*(.+?)\s*—\s*(.+?)\.?\s*(?:Source:\s*(\S+))?$/i);
    if (!m) continue;
    const topic = topicMap[m[1].toUpperCase()];
    if (topic) signals.push({ topic, title: m[2].trim(), city: m[3].trim(), source_url: m[4] ?? "" });
  }
  return signals;
}

// ── Main export ────────────────────────────────────────────────────────────

export async function fetchDigestData(): Promise<DigestPayload> {
  const today = new Date().toISOString().slice(0, 10);
  const [masterSpeak, cityVoices, housing] = await Promise.all([
    fetchSpeak("master"),
    fetchCityVoices(),
    Promise.resolve(readHousingBrain()),
  ]);

  const manifest: FreshnessManifest = {
    master: { token: masterSpeak.freshness_token, as_of: today },
    housing_swfl: { token: "housing-swfl-disk", as_of: today, period_begin: housing.periodBegin },
    city_pulse: { token: "city-pulse-daily", as_of: today },
    lee_cre: null,
    source_env: DRY_RUN ? "preview" : "live",
  };

  const topStory = cityVoices.find((s) => s.topic === "breaking") ?? cityVoices[0] ?? null;

  return {
    date: today,
    freshness_manifest: manifest,
    top_line: masterSpeak.text.split("\n").slice(0, 3).join(" ").trim(),
    zip_metrics: housing.zipMetrics,
    county_metrics: housing.countyMetrics,
    city_voices: cityVoices.slice(0, 4),
    top_story: topStory ? { title: topStory.title, slug: "city-pulse-swfl", topic: topStory.topic } : null,
  };
}
```

- [ ] **Run tests — expect pass**
```bash
bun test scripts/email/__tests__/fetch-digest-data.test.mts
```

- [ ] **Commit**
```bash
git add scripts/email/fetch-digest-data.mts scripts/email/__tests__/fetch-digest-data.test.mts
git commit -m "feat(email): fetch-digest-data — brain disk parse + speak API narrative"
```

---

## Task 3: Log I/O

**Model:** SONNET · **Parallel** (start after Task 1, independent of 2/4/5)

**Files:**
- Create: `scripts/email/log-io.mts`
- Create: `scripts/email/__tests__/log-io.test.mts`

- [ ] **Write failing tests**

```typescript
// scripts/email/__tests__/log-io.test.mts
import { describe, test, beforeEach, afterEach } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readMostRecentLog, writeLog, isTodayAlreadySent, getNextIssueNumber } from "../log-io.mts";
import type { EmailLog } from "../types.ts";

function stub(overrides: Partial<EmailLog> = {}): EmailLog {
  return {
    date: "2026-06-10", last_send_date: "2026-06-10", issue: 1,
    subject: "Test", freshness_manifest: {
      master: { token: "t", as_of: "2026-06-10" },
      housing_swfl: { token: "t", as_of: "2026-06-10", period_begin: "2026-03-01" },
      city_pulse: { token: "t", as_of: "2026-06-10" }, lee_cre: null, source_env: "preview",
    },
    top_story: null, zip_metrics: {}, county_metrics: {
      median_sale_price: 400000, dom: 50, months_of_supply: 4.0,
      avg_sale_to_list: 0.97, sold_above_list_pct: 0.18, inventory: null, sale_count_period: null,
    },
    signals_surfaced: [], cta_url: "https://swfldatagulf.com",
    send_status: "sent", send_error: null, recipients: 1,
    ...overrides,
  };
}

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "log-test-")); });
afterEach(() => { fs.rmSync(tmp, { recursive: true }); });

describe("readMostRecentLog", () => {
  test("returns null when no logs", () => { assert.equal(readMostRecentLog(tmp), null); });

  test("returns newest by filename", () => {
    fs.writeFileSync(path.join(tmp, "2026-06-09.json"), JSON.stringify(stub({ date: "2026-06-09" })));
    fs.writeFileSync(path.join(tmp, "2026-06-10.json"), JSON.stringify(stub({ date: "2026-06-10" })));
    assert.equal(readMostRecentLog(tmp)?.date, "2026-06-10");
  });

  test("ignores .gitkeep", () => {
    fs.writeFileSync(path.join(tmp, ".gitkeep"), "");
    assert.equal(readMostRecentLog(tmp), null);
  });
});

describe("isTodayAlreadySent", () => {
  test("true when today log has send_status sent", () => {
    fs.writeFileSync(path.join(tmp, "2026-06-11.json"), JSON.stringify(stub({ date: "2026-06-11", send_status: "sent" })));
    assert.equal(isTodayAlreadySent("2026-06-11", tmp), true);
  });

  test("false when today log has send_status error", () => {
    fs.writeFileSync(path.join(tmp, "2026-06-11.json"), JSON.stringify(stub({ date: "2026-06-11", send_status: "error" })));
    assert.equal(isTodayAlreadySent("2026-06-11", tmp), false);
  });

  test("false when no log for today", () => { assert.equal(isTodayAlreadySent("2026-06-11", tmp), false); });
});

describe("writeLog + getNextIssueNumber", () => {
  test("writeLog writes to YYYY-MM-DD.json", () => {
    writeLog(stub({ date: "2026-06-11" }), tmp);
    const written = JSON.parse(fs.readFileSync(path.join(tmp, "2026-06-11.json"), "utf-8"));
    assert.equal(written.date, "2026-06-11");
  });

  test("getNextIssueNumber returns 1 with no logs", () => { assert.equal(getNextIssueNumber(tmp), 1); });

  test("getNextIssueNumber increments from last log", () => {
    fs.writeFileSync(path.join(tmp, "2026-06-10.json"), JSON.stringify(stub({ issue: 7 })));
    assert.equal(getNextIssueNumber(tmp), 8);
  });
});
```

- [ ] **Run to confirm failure**
```bash
bun test scripts/email/__tests__/log-io.test.mts
```

- [ ] **Implement log-io.mts**

```typescript
// scripts/email/log-io.mts
import fs from "node:fs";
import path from "node:path";
import type { EmailLog } from "./types.ts";

const REPO_ROOT = path.join(import.meta.dirname, "..", "..");
export const DEFAULT_LOG_DIR = path.join(REPO_ROOT, "docs", "email-marketing", "email-logs");

/** Most recent log by filename descending — NOT calendar-yesterday (EMAIL.md Rule 1). */
export function readMostRecentLog(logDir = DEFAULT_LOG_DIR): EmailLog | null {
  const files = fs.readdirSync(logDir)
    .filter((f) => f.endsWith(".json"))
    .sort().reverse();
  for (const f of files) {
    try { return JSON.parse(fs.readFileSync(path.join(logDir, f), "utf-8")) as EmailLog; }
    catch { continue; }
  }
  return null;
}

/**
 * True if today's log exists with send_status "sent" → abort, don't re-send.
 * send_status "error" → false, retry is allowed.
 */
export function isTodayAlreadySent(today: string, logDir = DEFAULT_LOG_DIR): boolean {
  const p = path.join(logDir, `${today}.json`);
  if (!fs.existsSync(p)) return false;
  try { return (JSON.parse(fs.readFileSync(p, "utf-8")) as EmailLog).send_status === "sent"; }
  catch { return false; }
}

/** Write log. Overwrites existing file for the same date. */
export function writeLog(log: EmailLog, logDir = DEFAULT_LOG_DIR): void {
  fs.writeFileSync(path.join(logDir, `${log.date}.json`), JSON.stringify(log, null, 2));
}

export function getNextIssueNumber(logDir = DEFAULT_LOG_DIR): number {
  return (readMostRecentLog(logDir)?.issue ?? 0) + 1;
}
```

- [ ] **Run tests — expect pass**
```bash
bun test scripts/email/__tests__/log-io.test.mts
```

- [ ] **Commit**
```bash
git add scripts/email/log-io.mts scripts/email/__tests__/log-io.test.mts
git commit -m "feat(email): log-io — read/write/idempotency for email logs"
```

---

## Task 4: React Email Template

**Model:** OPUS · **Parallel** (start after Task 1, independent of 2/3/5)

**Files:**
- Create: `scripts/email/DigestEmail.tsx`

No unit test — visual correctness validated in Task 7 smoke test.

- [ ] **Create DigestEmail.tsx**

```tsx
// scripts/email/DigestEmail.tsx
import {
  Html, Head, Body, Container, Section, Row, Column,
  Text, Link, Hr, Img, Preview,
} from "@react-email/components";
import type { DigestPayload, MetricDelta, ZipMetricSnapshot, BrandTheme } from "./types.ts";
import { ZIP_FOCUS, resolveTheme } from "./types.ts";

// Fixed neutrals — never themed. Brand colors (primary/accent) come from `theme`.
const NEUTRAL = {
  sand: "#F5E6C8", bg: "#F7F9FB", text: "#1A1A2E", muted: "#6B7280", border: "#E5E7EB",
};
const F = "Inter, -apple-system, 'Helvetica Neue', Arial, sans-serif";
const fmtPrice = (v: number | null) => v === null ? "—" : `$${Math.round(v / 1000)}k`;
const fmtDom   = (v: number | null) => v === null ? "—" : `${Math.round(v)}d`;
const fmtMos   = (v: number | null) => v === null ? "—" : `${v.toFixed(1)} mo`;

const TOPIC_BADGE: Record<string, string> = {
  breaking: "🔴 BREAKING", transactions: "📋 DEAL",
  development: "🏗 BUILD", business: "💼 BIZ", structural: "📊 DATA",
};

export interface DigestEmailProps {
  payload: DigestPayload;
  escalations: MetricDelta[];
  deltaText: string;
  subject: string;
  unsubscribeUrl: string;
  issue: number;
  senderName: string;
  senderAddress: string;
  senderContact: string;
  /**
   * White-label brand. Omit → SWFL house colors (navy/teal, no logo image).
   * Same shape as lib/deliverable/brand-theme.ts `BrandTheme`, so the funnel's
   * extractBrandTheme() output (Brandfetch / manual blob) drops in unchanged.
   */
  theme?: BrandTheme | null;
}

export function DigestEmail({
  payload, escalations, deltaText,
  subject, unsubscribeUrl, issue,
  senderName, senderAddress, senderContact,
  theme,
}: DigestEmailProps) {
  const { primary, accent, logoUrl } = resolveTheme(theme);
  const escMap = new Map(escalations.map((d) => [d.metric, d]));

  return (
    <Html lang="en">
      <Head />
      <Preview>{subject}</Preview>
      <Body style={{ backgroundColor: NEUTRAL.bg, margin: 0, padding: 0 }}>
        <Container style={{ maxWidth: "600px", margin: "0 auto", backgroundColor: "#fff" }}>

          {/* 1. HEADER */}
          <Section style={{ backgroundColor: primary, padding: "20px 24px", borderBottom: `3px solid ${accent}` }}>
            {logoUrl && (
              <Img src={logoUrl} alt={senderName}
                style={{ maxHeight: "42px", maxWidth: "160px", margin: "0 0 8px", display: "block" }} />
            )}
            <Text style={{ fontFamily: F, fontSize: "18px", fontWeight: "700", color: "#fff", margin: 0 }}>
              SWFL DATA GULF INTEL
            </Text>
            <Text style={{ fontFamily: F, fontSize: "12px", color: accent, margin: "4px 0 0" }}>
              {payload.date} · Issue #{issue} · 33908 + Lee County
              {payload.freshness_manifest.source_env === "preview" ? " · [PREVIEW]" : ""}
            </Text>
          </Section>

          {/* 2. TOP LINE */}
          <Section style={{ padding: "20px 24px", borderBottom: `1px solid ${NEUTRAL.border}` }}>
            <Text style={{ fontFamily: F, fontSize: "11px", fontWeight: "700", color: accent, letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 8px" }}>
              Lee County Market Pulse
            </Text>
            <Text style={{ fontFamily: F, fontSize: "15px", lineHeight: "1.6", color: NEUTRAL.text, margin: 0 }}>
              {payload.top_line}
            </Text>
            <Text style={{ fontFamily: F, fontSize: "10px", color: NEUTRAL.muted, margin: "6px 0 0" }}>
              master brain · as of {payload.freshness_manifest.master.as_of}
            </Text>
          </Section>

          {/* 3. ZIP FOCUS */}
          <Section style={{ padding: "20px 24px", borderBottom: `1px solid ${NEUTRAL.border}` }}>
            <Text style={{ fontFamily: F, fontSize: "11px", fontWeight: "700", color: accent, letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 12px" }}>
              ZIP Focus: 33908 + Nearby
            </Text>
            {/* Header row */}
            <Row style={{ backgroundColor: primary }}>
              {["ZIP", "Med Price", "DOM", "Mo Supply"].map((h) => (
                <Column key={h} style={{ padding: "5px 8px", fontFamily: F, fontSize: "11px", fontWeight: "700", color: "#fff" }}>
                  {h}
                </Column>
              ))}
            </Row>
            {ZIP_FOCUS.map((zip, i) => {
              const m = payload.zip_metrics[zip];
              if (!m) return null;
              const priceEsc = escMap.get("median_sale_price");
              const bold = priceEsc?.is_escalation ? { fontWeight: "700" as const } : {};
              return (
                <Row key={zip} style={{ backgroundColor: i % 2 === 0 ? "#fff" : "#F9FAFB", borderBottom: `1px solid ${NEUTRAL.border}` }}>
                  <Column style={{ padding: "6px 8px", fontFamily: F, fontSize: "13px", fontWeight: "600" }}>{zip}</Column>
                  <Column style={{ padding: "6px 8px", fontFamily: F, fontSize: "13px", ...bold }}>{fmtPrice(m.median_sale_price)}</Column>
                  <Column style={{ padding: "6px 8px", fontFamily: F, fontSize: "13px" }}>{fmtDom(m.dom)}</Column>
                  <Column style={{ padding: "6px 8px", fontFamily: F, fontSize: "13px" }}>{fmtMos(m.months_of_supply)}</Column>
                </Row>
              );
            })}
            <Text style={{ fontFamily: F, fontSize: "10px", color: NEUTRAL.muted, margin: "6px 0 0" }}>
              housing-swfl · period beginning {payload.freshness_manifest.housing_swfl.period_begin}
            </Text>
          </Section>

          {/* 4. LEE COUNTY SNAPSHOT */}
          <Section style={{ padding: "20px 24px", backgroundColor: "#F0F9FA", borderBottom: `1px solid ${NEUTRAL.border}` }}>
            <Text style={{ fontFamily: F, fontSize: "11px", fontWeight: "700", color: accent, letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 12px" }}>
              Lee County Snapshot
            </Text>
            <Row>
              {[
                { label: "Median Price", val: fmtPrice(payload.county_metrics.median_sale_price) },
                { label: "Median DOM", val: fmtDom(payload.county_metrics.dom) },
                { label: "Mo Supply", val: fmtMos(payload.county_metrics.months_of_supply) },
              ].map(({ label, val }) => (
                <Column key={label} style={{ textAlign: "center", padding: "8px" }}>
                  <Text style={{ fontFamily: F, fontSize: "22px", fontWeight: "700", color: primary, margin: 0 }}>{val}</Text>
                  <Text style={{ fontFamily: F, fontSize: "11px", color: NEUTRAL.muted, margin: "2px 0 0" }}>{label}</Text>
                </Column>
              ))}
            </Row>
          </Section>

          {/* 5. CITY VOICES — omitted if empty (EMAIL.md Rule 2) */}
          {payload.city_voices.length > 0 && (
            <Section style={{ padding: "20px 24px", borderBottom: `1px solid ${NEUTRAL.border}` }}>
              <Text style={{ fontFamily: F, fontSize: "11px", fontWeight: "700", color: accent, letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 12px" }}>
                City Voices
              </Text>
              {payload.city_voices.map((s, i) => (
                <Row key={i} style={{ marginBottom: "8px" }}>
                  <Column>
                    <Text style={{ fontFamily: F, fontSize: "11px", fontWeight: "700", color: primary, margin: "0 0 2px" }}>
                      {TOPIC_BADGE[s.topic] ?? s.topic.toUpperCase()} — {s.city}
                    </Text>
                    <Text style={{ fontFamily: F, fontSize: "13px", color: NEUTRAL.text, margin: 0 }}>
                      {s.title}{" "}
                      {s.source_url && <Link href={s.source_url} style={{ color: accent, fontSize: "11px" }}>[source]</Link>}
                    </Text>
                  </Column>
                </Row>
              ))}
              <Text style={{ fontFamily: F, fontSize: "10px", color: NEUTRAL.muted, margin: "6px 0 0" }}>
                city-pulse-swfl · as of {payload.freshness_manifest.city_pulse.as_of}
              </Text>
            </Section>
          )}

          {/* 6. DELTA */}
          {deltaText && (
            <Section style={{ padding: "20px 24px", backgroundColor: "#FFFBEB", borderBottom: `1px solid ${NEUTRAL.border}` }}>
              <Text style={{ fontFamily: F, fontSize: "11px", fontWeight: "700", color: "#92400E", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 8px" }}>
                What Changed
              </Text>
              <Text style={{ fontFamily: F, fontSize: "13px", lineHeight: "1.6", color: NEUTRAL.text, margin: 0, whiteSpace: "pre-line" }}>
                {deltaText}
              </Text>
            </Section>
          )}

          {/* NOTE: HISTORICAL HOOK (old section 7) is CUT for V1 — revision #1.
              It returned a hardcoded string = invented data (EMAIL.md Rule 4).
              Re-add only when historical ZIP-grain rows exist and the value is
              READ from the lake, not written. */}

          {/* CTA */}
          <Section style={{ padding: "20px 24px", textAlign: "center", borderBottom: `1px solid ${NEUTRAL.border}` }}>
            <Link href="https://swfldatagulf.com/r/housing-swfl" style={{
              backgroundColor: primary, color: "#fff", padding: "12px 28px",
              borderRadius: "6px", fontFamily: F, fontSize: "14px",
              fontWeight: "600", textDecoration: "none", display: "inline-block",
            }}>
              View Full Report →
            </Link>
          </Section>

          {/* 7. FOOTER */}
          <Section style={{ padding: "20px 24px", backgroundColor: "#F9FAFB" }}>
            <Hr style={{ borderColor: NEUTRAL.border, margin: "0 0 14px" }} />
            <Text style={{ fontFamily: F, fontSize: "11px", color: NEUTRAL.muted, margin: "0 0 4px", lineHeight: "1.6" }}>
              {senderName}<br />{senderAddress}<br />{senderContact} · hello@swfldatagulf.com
            </Text>
            <Text style={{ fontFamily: F, fontSize: "11px", color: NEUTRAL.muted, margin: "8px 0 0" }}>
              Data sourced from{" "}
              <Link href="https://swfldatagulf.com" style={{ color: accent }}>swfldatagulf.com</Link>.
              {" "}You received this because you subscribed at swfldatagulf.com.
            </Text>
            <Text style={{ fontFamily: F, fontSize: "11px", margin: "6px 0 0" }}>
              <Link href={unsubscribeUrl} style={{ color: NEUTRAL.muted }}>Unsubscribe</Link>
              {" · "}
              <Link href="https://swfldatagulf.com/privacy" style={{ color: NEUTRAL.muted }}>Privacy Policy</Link>
            </Text>
          </Section>

        </Container>
      </Body>
    </Html>
  );
}
```

- [ ] **Commit**
```bash
git add scripts/email/DigestEmail.tsx
git commit -m "feat(email): DigestEmail — 7 sections, white-label theme prop, CAN-SPAM footer"
```

---

## Task 5: GHA Workflow

**Model:** SONNET · **Parallel** (start after Task 1, independent of 2/3/4)

**Files:**
- Create: `.github/workflows/daily-email-digest.yml`

- [ ] **Create workflow**

```yaml
# .github/workflows/daily-email-digest.yml
name: Daily Email Digest

on:
  schedule:
    # 10:00 UTC = 6:00 AM ET Mon–Fri.
    # Clear of: daily-rebuild (0 6), city-pulse (0 9), freshness-probe (0 14).
    - cron: "0 10 * * 1-5"
  workflow_dispatch:
    inputs:
      dry_run:
        description: "Dry run — render + write preview log, do NOT send"
        required: false
        default: "false"

concurrency:
  group: daily-email-digest
  cancel-in-progress: false

jobs:
  send-digest:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: write   # needed to commit the email log

    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.14"

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Send daily digest
        env:
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          NEXT_PUBLIC_SITE_URL: ${{ secrets.NEXT_PUBLIC_SITE_URL }}
          DRY_RUN: ${{ github.event.inputs.dry_run || 'false' }}
          # Set these as Actions Variables (not secrets — not sensitive)
          DIGEST_SENDER_NAME: ${{ vars.DIGEST_SENDER_NAME }}
          DIGEST_SENDER_ADDRESS: ${{ vars.DIGEST_SENDER_ADDRESS }}
          DIGEST_SENDER_CONTACT: ${{ vars.DIGEST_SENDER_CONTACT }}
        run: bun scripts/email/build-digest.mts

      - name: Commit email log
        if: always()
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add docs/email-marketing/email-logs/ || true
          git diff --staged --quiet || git commit -m "log(email): digest $(date -u +%Y-%m-%d)"
          git push || true
```

- [ ] **Commit**
```bash
git add .github/workflows/daily-email-digest.yml
git commit -m "ci: daily-email-digest GHA cron Mon-Fri 10:00 UTC"
```

---

## Task 6: Orchestrator

**Model:** OPUS · **Sequential** — starts only after Tasks 2, 3, 4 are merged/complete

**Files:**
- Create: `scripts/email/build-digest.mts`
- Create: `scripts/email/__tests__/build-digest.test.mts`

Threshold constants (from EMAIL.md SOURCED THRESHOLDS):

| Constant | Value | Rule |
|---|---|---|
| `ZIP_PRICE_THRESHOLD` | 0.05 | 5% move flags ZIP price |
| `ZIP_PRICE_FLOOR` | 10 | min sales at ZIP grain |
| `COUNTY_PRICE_THRESHOLD` | 0.03 | 3% move flags county price |
| `COUNTY_PRICE_FLOOR` | 50 | min sales at county grain |
| `DOM_DELTA_DAYS` | 10 | abs days change to flag DOM |
| `INVENTORY_MOM_THRESHOLD` | 0.20 | 20% change flags inventory |

- [ ] **Write failing tests**

```typescript
// scripts/email/__tests__/build-digest.test.mts
import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { computeDelta, buildSubjectLine } from "../build-digest.mts";
import type { ZipMetricSnapshot, DigestPayload } from "../types.ts";

function snap(o: Partial<ZipMetricSnapshot> = {}): ZipMetricSnapshot {
  return {
    median_sale_price: 400000, dom: 50, months_of_supply: 4.0,
    avg_sale_to_list: 0.97, sold_above_list_pct: 0.18,
    inventory: 100, sale_count_period: 20, ...o,
  };
}

describe("computeDelta — transaction floor", () => {
  test("no flag when sale_count below floor (3 sales, >5% move)", () => {
    const prev = snap({ median_sale_price: 300000, sale_count_period: 3 });
    const curr = snap({ median_sale_price: 400000, sale_count_period: 4 });
    const deltas = computeDelta(curr, prev, "zip");
    assert.equal(deltas.find((d) => d.metric === "median_sale_price" && d.is_escalation), undefined);
  });

  test("flags price move when floor met (15 sales, >5%)", () => {
    const prev = snap({ median_sale_price: 380000, sale_count_period: 15 });
    const curr = snap({ median_sale_price: 412000, sale_count_period: 15 });
    const deltas = computeDelta(curr, prev, "zip");
    const esc = deltas.find((d) => d.metric === "median_sale_price" && d.is_escalation);
    assert.ok(esc);
    assert.equal(esc.direction_framing, "bullish");
  });

  test("DOM +20 days → bearish escalation", () => {
    const prev = snap({ dom: 50 });
    const curr = snap({ dom: 70 });
    const deltas = computeDelta(curr, prev, "zip");
    const esc = deltas.find((d) => d.metric === "dom" && d.is_escalation);
    assert.ok(esc);
    assert.equal(esc.direction_framing, "bearish");
  });

  test("returns empty array when previous is null", () => {
    assert.deepEqual(computeDelta(snap(), null, "zip"), []);
  });
});

describe("buildSubjectLine", () => {
  function fakePayload(overrides: Partial<DigestPayload> = {}): DigestPayload {
    return {
      date: "2026-06-11",
      freshness_manifest: {} as DigestPayload["freshness_manifest"],
      top_line: "Market steady.",
      zip_metrics: { "33908": snap({ dom: 52 }) },
      county_metrics: snap(),
      city_voices: [],
      top_story: null,
      ...overrides,
    };
  }

  test("breaking top_story → subject ≤50 chars", () => {
    const p = fakePayload({ top_story: { title: "Cape Coral zoning vote passes", slug: "city-pulse-swfl", topic: "breaking" } });
    const s = buildSubjectLine(p, []);
    assert.ok(s.length <= 50, `too long: "${s}" (${s.length})`);
  });

  test("no top_story → includes ZIP", () => {
    const s = buildSubjectLine(fakePayload(), []);
    assert.ok(s.includes("33908"));
    assert.ok(s.length <= 50);
  });

  test("no ALL-CAPS words", () => {
    const s = buildSubjectLine(fakePayload(), []);
    assert.ok(!/\b[A-Z]{4,}\b/.test(s), `ALL-CAPS found: "${s}"`);
  });
});
```

- [ ] **Run to confirm failure**
```bash
bun test scripts/email/__tests__/build-digest.test.mts
```

- [ ] **Implement build-digest.mts**

```typescript
// scripts/email/build-digest.mts
import { render } from "@react-email/render";
import { Resend } from "resend";
import type { DigestPayload, EmailLog, MetricDelta, ZipMetricSnapshot } from "./types.ts";
import { ZIP_FOCUS } from "./types.ts";
import { fetchDigestData } from "./fetch-digest-data.mts";
import { readMostRecentLog, writeLog, isTodayAlreadySent, getNextIssueNumber } from "./log-io.mts";
import { DigestEmail } from "./DigestEmail.tsx";

// Threshold constants — sourced in EMAIL.md SOURCED THRESHOLDS
const ZIP_PRICE_THRESHOLD    = 0.05;
const ZIP_PRICE_FLOOR        = 10;
const COUNTY_PRICE_THRESHOLD = 0.03;
const COUNTY_PRICE_FLOOR     = 50;
const DOM_DELTA_DAYS         = 10;
const INVENTORY_MOM_THRESHOLD = 0.20;

const DRY_RUN = process.env.DRY_RUN === "true";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
const SENDER_NAME    = process.env.DIGEST_SENDER_NAME    ?? "[PLACEHOLDER — set DIGEST_SENDER_NAME]";
const SENDER_ADDRESS = process.env.DIGEST_SENDER_ADDRESS ?? "[PLACEHOLDER — set DIGEST_SENDER_ADDRESS]";
const SENDER_CONTACT = process.env.DIGEST_SENDER_CONTACT ?? "[PLACEHOLDER — set DIGEST_SENDER_CONTACT]";

// ── Delta (EMAIL.md Rule 5) ────────────────────────────────────────────────

export function computeDelta(
  current: ZipMetricSnapshot,
  previous: ZipMetricSnapshot | null,
  grain: "zip" | "county"
): MetricDelta[] {
  if (!previous) return [];
  const results: MetricDelta[] = [];
  const priceThreshold = grain === "zip" ? ZIP_PRICE_THRESHOLD : COUNTY_PRICE_THRESHOLD;
  const priceFloor     = grain === "zip" ? ZIP_PRICE_FLOOR     : COUNTY_PRICE_FLOOR;

  // Median sale price
  if (current.median_sale_price !== null && previous.median_sale_price !== null && previous.median_sale_price !== 0) {
    const pct = (current.median_sale_price - previous.median_sale_price) / previous.median_sale_price;
    const floorMet = (current.sale_count_period ?? 0) >= priceFloor;
    results.push({
      metric: "median_sale_price",
      current: current.median_sale_price,
      previous: previous.median_sale_price,
      pct_change: pct,
      is_escalation: Math.abs(pct) > priceThreshold && floorMet,
      direction_framing: pct > 0 ? "bullish" : "bearish",
    });
  }

  // DOM (absolute days, not %)
  if (current.dom !== null && previous.dom !== null) {
    const changeDays = current.dom - previous.dom;
    results.push({
      metric: "dom",
      current: current.dom,
      previous: previous.dom,
      pct_change: previous.dom !== 0 ? changeDays / previous.dom : 0,
      is_escalation: Math.abs(changeDays) > DOM_DELTA_DAYS,
      direction_framing: changeDays > 0 ? "bearish" : "bullish",
    });
  }

  // Inventory MoM
  if (current.inventory !== null && previous.inventory !== null && previous.inventory !== 0) {
    const pct = (current.inventory - previous.inventory) / previous.inventory;
    results.push({
      metric: "inventory",
      current: current.inventory,
      previous: previous.inventory,
      pct_change: pct,
      is_escalation: Math.abs(pct) > INVENTORY_MOM_THRESHOLD,
      direction_framing: "context",
    });
  }

  return results;
}

// ── Subject line (EMAIL.md Rule 11) ───────────────────────────────────────

const SPAM_TRIGGERS = /\b(free|guarantee|winner|urgent|act now|limited time|exclusive offer|click here|buy now|no cost|risk.free)\b/i;

export function buildSubjectLine(payload: DigestPayload, escalations: MetricDelta[]): string {
  let s = "";
  const ts = payload.top_story;
  if (ts?.topic === "breaking" || ts?.topic === "transactions") {
    const prefix = "[SWFL] ";
    const max = 50 - prefix.length;
    s = prefix + (ts.title.length > max ? ts.title.slice(0, max - 1) + "…" : ts.title);
  } else if (escalations.some((d) => d.is_escalation)) {
    const top = escalations.find((d) => d.is_escalation)!;
    if (top.metric === "dom") {
      s = `33908 DOM: ${Math.round(top.current)}d${top.pct_change > 0 ? " and climbing" : " falling"}`;
    } else {
      const mo = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
      s = `33908 market update · ${mo}`;
    }
  } else {
    const dom = payload.zip_metrics["33908"]?.dom;
    s = dom ? `33908 DOM: ${Math.round(dom)} days · Lee County update` : `Lee County pulse · ${payload.date}`;
  }
  return s.replace(SPAM_TRIGGERS, "").trim().slice(0, 50);
}

// ── Delta narrative ────────────────────────────────────────────────────────

function buildDeltaText(current: DigestPayload, prevLog: EmailLog | null): string {
  if (!prevLog) return "First issue — no prior data to compare.";
  const gap = Math.round((new Date(current.date).getTime() - new Date(prevLog.last_send_date).getTime()) / 86400000);
  const lines = [`Since ${prevLog.last_send_date} (${gap} day${gap !== 1 ? "s" : ""} ago):`];
  for (const zip of ZIP_FOCUS) {
    const curr = current.zip_metrics[zip], prev = prevLog.zip_metrics[zip];
    if (!curr || !prev) continue;
    for (const d of computeDelta(curr, prev, "zip").filter((d) => d.is_escalation)) {
      const arrow = d.direction_framing === "bullish" ? "↑" : d.direction_framing === "bearish" ? "↓" : "→";
      if (d.metric === "median_sale_price") {
        lines.push(`  ${arrow} ${zip} price ${d.pct_change > 0 ? "up" : "down"} ${Math.abs(d.pct_change * 100).toFixed(1)}% (${d.direction_framing})`);
      } else if (d.metric === "dom") {
        lines.push(`  ${arrow} ${zip} DOM ${d.pct_change > 0 ? "up" : "down"} ${Math.abs(d.current - d.previous).toFixed(0)}d (${d.direction_framing})`);
      } else if (d.metric === "inventory") {
        lines.push(`  ${arrow} ${zip} inventory ${d.pct_change > 0 ? "up" : "down"} ${Math.abs(d.pct_change * 100).toFixed(0)}% (context)`);
      }
    }
  }
  const newSigs = current.city_voices.filter((s) => !prevLog.signals_surfaced.includes(s.title));
  if (newSigs.length) lines.push(`  + ${newSigs.length} new city voice signal${newSigs.length > 1 ? "s" : ""}`);
  return lines.join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  // Idempotency guard (EMAIL.md Rule 8)
  if (isTodayAlreadySent(today)) {
    console.log("[DIGEST ABORT] today's log already shows send_status=sent; skipping.");
    process.exit(0);
  }

  const prevLog = readMostRecentLog();
  const issue = getNextIssueNumber();
  const payload = await fetchDigestData();

  const allDeltas: MetricDelta[] = [];
  for (const zip of ZIP_FOCUS) {
    const curr = payload.zip_metrics[zip], prev = prevLog?.zip_metrics[zip] ?? null;
    if (curr) allDeltas.push(...computeDelta(curr, prev, "zip"));
  }
  const escalations = allDeltas.filter((d) => d.is_escalation);

  const subject        = buildSubjectLine(payload, escalations);
  const deltaText      = buildDeltaText(payload, prevLog);
  const unsubscribeUrl = `${SITE_URL}/unsubscribe?token=phase1-static`;

  // No `theme` passed → SWFL house colors (resolveTheme defaults). The agent
  // white-label digest (README Phase 4) and the funnel's prospect-branded send
  // (funnel spec Phase 2) inject a BrandTheme here — no other change needed.
  const html = await render(
    DigestEmail({ payload, escalations, deltaText, subject, unsubscribeUrl, issue, senderName: SENDER_NAME, senderAddress: SENDER_ADDRESS, senderContact: SENDER_CONTACT })
  );

  // Write log BEFORE send — error log allows re-run; avoids double-send on crash
  const log: EmailLog = {
    date: today, last_send_date: today, issue, subject,
    freshness_manifest: payload.freshness_manifest,
    top_story: payload.top_story,
    zip_metrics: payload.zip_metrics,
    county_metrics: payload.county_metrics,
    signals_surfaced: payload.city_voices.map((s) => s.title),
    cta_url: "https://swfldatagulf.com/r/housing-swfl",
    send_status: "error", send_error: null, recipients: 0,
  };
  writeLog(log);

  if (DRY_RUN) {
    console.log(`[DRY RUN] Subject: ${subject}`);
    console.log(`[DRY RUN] HTML: ${html.length} bytes`);
    console.log(`[DRY RUN] Escalations: ${escalations.length}`);
    log.send_status = "skipped";
    writeLog(log);
    process.exit(0);
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: "SWFL Data Gulf <hello@swfldatagulf.com>",
      to: ["hello@swfldatagulf.com"],
      subject,
      html,
      headers: {
        // RFC 8058 — Gmail/Yahoo bulk-sender requirement (Feb 2024)
        "List-Unsubscribe": `<${unsubscribeUrl}>, <mailto:unsubscribe@swfldatagulf.com?subject=unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    log.send_status = "sent";
    log.recipients = 1;
    console.log(`[DIGEST] Issue #${issue} sent · Resend ID: ${result.data?.id}`);
  } catch (err) {
    log.send_error = String(err);
    console.error("[DIGEST ERROR]", err);
  }
  writeLog(log);
}

main().catch((err) => { console.error("[DIGEST FATAL]", err); process.exit(1); });
```

- [ ] **Run tests**
```bash
bun test scripts/email/__tests__/build-digest.test.mts
```

- [ ] **Commit**
```bash
git add scripts/email/build-digest.mts scripts/email/__tests__/build-digest.test.mts
git commit -m "feat(email): build-digest orchestrator — DELTA, Rule 5 floors, idempotency, RFC 8058"
```

---

## Task 7: Smoke Test

**Model:** either · **Sequential** — validates pipeline before first live send

Prerequisites: `NEXT_PUBLIC_SITE_URL` and `RESEND_API_KEY` in `.env.local`.

- [ ] **Run all unit tests**
```bash
bun test scripts/email/
```
Expected: all pass.

- [ ] **Dry run against live API**
```bash
NEXT_PUBLIC_SITE_URL=https://www.swfldatagulf.com DRY_RUN=true bun scripts/email/build-digest.mts
```
Expected output (all three lines must appear):
```
[DRY RUN] Subject: <string, ≤50 chars>
[DRY RUN] HTML: <10000–90000> bytes    ← if >90000, Gmail will clip; trim a section
[DRY RUN] Escalations: <number>
```

- [ ] **Inspect log**
```bash
cat "docs/email-marketing/email-logs/$(node -e "console.log(new Date().toISOString().slice(0,10))").json"
```
Verify: `date`, `last_send_date`, `issue`, `freshness_manifest` (all 4 brains), `zip_metrics` (6 ZIPs or null for any with no data), `send_status: "skipped"`.

- [ ] **Set GitHub Actions Variables before live send**

`Settings → Secrets and Variables → Actions → Variables` (not Secrets — not sensitive):
```
DIGEST_SENDER_NAME     = <real entity name — decision required, see EMAIL.md Rule 9>
DIGEST_SENDER_ADDRESS  = <real USPS-valid physical address>
DIGEST_SENDER_CONTACT  = <name or role>
NEXT_PUBLIC_SITE_URL   = https://www.swfldatagulf.com
```

- [ ] **Push everything**
```bash
node scripts/safe-push.mjs
```

---

## Spec Coverage

| EMAIL.md Rule | Implemented by |
|---|---|
| Rule 1: most-recent log by filename, not yesterday | `readMostRecentLog()` sorts `.json` files descending |
| Rule 1: error→no-log, skip→valid-prior | `isTodayAlreadySent()` checks `send_status === "sent"` only |
| Rule 2: section order locked | `DigestEmail.tsx` section ordering |
| Rule 3: per-section freshness manifest | `FreshnessManifest` type; header in template |
| Rule 3: dry-run cannot stamp live provenance | `source_env: "preview"` when `DRY_RUN=true` |
| Rule 4: no invention | `null` propagated; never substituted |
| Rule 5: transaction floor | `computeDelta()` checks `sale_count_period >= floor` |
| Rule 5: directional polarity | `direction_framing` field; `buildDeltaText` uses arrows |
| Rule 6: one CTA | Single CTA button in template |
| Rule 7: no JS charts | React Email = static HTML; no Recharts |
| Rule 8: idempotency guard | `isTodayAlreadySent()` at top of `main()` |
| Rule 8: log written before send | `writeLog(log)` called before `resend.emails.send()` |
| Rule 8: full metric schema | `ZipMetricSnapshot` has all 7 fields including `sale_count_period` |
| Rule 9: List-Unsubscribe headers (RFC 8058) | `headers` block in `resend.emails.send()` |
| Rule 9: CAN-SPAM footer | Footer section in `DigestEmail.tsx` |
| Rule 9: PLACEHOLDER identity | `SENDER_*` env vars with explicit placeholder fallback text |
| Rule 10: 6am ET send window | GHA cron `0 10 * * 1-5` |
| Rule 11: subject ≤50 chars, no spam triggers | `buildSubjectLine()` with `SPAM_TRIGGERS` regex + `.slice(0, 50)` |
| SOURCED THRESHOLDS | Named constants at top of `build-digest.mts` with comment citations |

**Known Phase 2 deferral:** `zip_speak` in `DigestPayload` is not populated (per-ZIP narrative from the API drill). The orchestrator uses the structured table for the body. Populating per-ZIP prose requires 6 additional API calls; deferred to Phase 2 when a dedicated `/api/email/zip-metrics` endpoint returns both prose and structured data in one round-trip.
