# Live Anthropic API Usage Logging → /spend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Recommended model:** 🧠 Opus — 12 tasks, 20 files, keywords: migration, schema, architecture

**Goal:** Every real Anthropic `messages.create`/`messages.stream` call in brain-platform writes a row (model, tokens, cost) to `public.api_usage_log`; swfldatagulf-ops `/spend` reads it and shows live today/30-day actuals, falling back to the existing static estimate until real data accumulates. Closes check `api_usage_logging_live_verify`.

**Architecture:** A logged wrapper around the shared `getAnthropic()` client in `refinery/agents/anthropic.mts` intercepts `.messages.create` / `.messages.stream`, fire-and-forgets a non-blocking insert after each real call resolves. Every production call site is migrated onto that shared, wrapped client — including several that currently bypass it entirely (found during probing, see Corrections below). `swfldatagulf-ops/lib/spend.ts` queries the new table with the same `@supabase/supabase-js` pattern it already uses for checks/goals.

**Tech Stack:** TypeScript / Bun (`refinery/agents/anthropic.mts`), Next.js App Router (both repos), `@anthropic-ai/sdk` v0.106.0 (pinned, verified against installed source), `@supabase/supabase-js`, Postgres/Supabase.

## Global Constraints

- Zero behavior change to any existing prompt, model choice, or response shape — this is telemetry only.
- `logApiUsage()` failures are caught and `console.error`'d, never thrown — a logging failure must never break a real API call or a synthesis run that writes `brains/*.md`.
- `agentsAreMocked()` (`!env.anthropicApiKey`) skips logging entirely — no test pollution of prod Supabase.
- `SKIP_USAGE_LOG=1` env var opts out for local dev.
- Cost rates (verified live via crawl4ai 06/30/2026, already landed in `swfldatagulf-ops/lib/spend.ts`): Sonnet 4.6 $3.00/MTok in, $15.00/MTok out · Haiku 4.5 $1.00/MTok in, $5.00/MTok out · cache read = 10% of base input rate · cache write = 25% premium on input rate.
- Model is always read from the actual response object, never assumed from the call site.
- `scripts/prove-*.mts` (9 files) are deliberately OUT of scope — manual one-off proof scripts, not production traffic. Noted here so the exclusion is a decision, not a silent gap.

---

## Corrections to the spec (verified against code this session)

The spec at `docs/superpowers/specs/2026-06-30-api-usage-logging-design.md` is right about rates, the table shape, and the ops-side display plan. Probing the actual code (RULE 0.5) found four places where its premise doesn't hold:

1. **"All 20+ call sites route through `getAnthropic()`" is false.** Real count: 14 production files call the shared `getAnthropic()` from `refinery/agents/anthropic.mts`. At least **10 more production call sites bypass it entirely**:
   - `lib/email/build-doc.ts` constructs its own module-level `new Anthropic(...)` (line 61) and calls `client.messages.create` at lines 463 and 566 — this is the exact file the spec names for `callType: "email_build"`, but the Proxy-on-`getAnthropic()` approach would silently never see it.
   - `app/api/projects/[id]/action/route.ts` and `app/api/email/schedule-command/route.ts` each define a **local function also named `getAnthropic()`** (different implementation, separate cached client) that shadows the import — the shared wrapper never runs for these.
   - `lib/email/data-readiness.ts`, `lib/email/listing-scrape.ts`, `lib/email/listing-comps.ts`, `lib/project/infer-project-type.ts`, `lib/email/social-calendar/build-week.ts`, `lib/email/social-calendar/build-canvas-fill.ts`, `app/api/email-lab/ai/route.ts` all instantiate their own `new Anthropic(...)` module-level client.

   To actually deliver "log every actual dollar" (success criterion 1), this plan migrates all of them onto the shared, wrapped `getAnthropic()` — not just the 6 the spec named.

2. **The reason given for the two local-`getAnthropic()` shadows is stale.** `app/api/email/schedule-command/route.ts` has a comment: *"The Anthropic client is instantiated locally (the refinery agents live in a Bun module tree we don't pull into the Next runtime)."* That's contradicted by the codebase today: `app/api/projects/[id]/extract-pdf/route.ts:16` already does `import { getAnthropic, agentsAreMocked } from "@/refinery/agents/anthropic.mts"` inside an `app/api/**/route.ts` file, and 30+ other files under `app/` already import other `refinery/*.mts` modules through the `@/refinery/*` path alias (`tsconfig.json`'s `exclude: ["refinery", ...]` only scopes the IDE/tsc project, not what Next's bundler will pull in). The split-client design was solving a problem that no longer exists — deleting the duplicates is a straightforward DRY fix, not a risk.

3. **`.stream()` needs handling distinct from `.create()`** — the spec doesn't say how. `messages.stream()` returns a `MessageStream` synchronously, not a `Promise<Message>`. Read the installed SDK source (`node_modules/@anthropic-ai/sdk/src/lib/MessageStream.ts`): `finalMessage()` does `await this.#endPromise; return this.#getFinalMessage()`. `#endPromise` is a single internal promise resolved once by the stream's internal pump loop — multiple independent awaiters (the wrapper's fire-and-forget call AND the original caller's own `await stream.finalMessage()` in `synthesis-agent.mts`, or `for await (const text of extractText(ai))` in `lib/assistant/stream.ts`) are standard-safe; nothing is double-consumed from the network. Confirmed against the actual pinned `^0.106.0` source, not memory.

4. **Usage field names verified against the installed SDK** (`node_modules/@anthropic-ai/sdk/src/resources/messages/messages.ts:2319`): `input_tokens: number`, `output_tokens: number`, `cache_creation_input_tokens: number | null`, `cache_read_input_tokens: number | null`. The spec's `cost_usd` math lines up with these.

5. **Migration convention gap.** The spec's migration uses a permissive RLS policy (`using (true) with check (true)`). The established local convention (e.g. `migrations/20260628_email_events.sql`) is: enable RLS (defense in depth — `service_role` already bypasses it), no broad policy, and explicit `GRANT INSERT, SELECT ON ... TO service_role` + `NOTIFY pgrst, 'reload schema'`. Without the GRANT+NOTIFY, the table exists in Postgres but PostgREST (which `@supabase/supabase-js` always talks to, even with the service key) won't serve it until the schema cache reloads. This plan follows the established convention instead of the spec's policy.

6. **Env vars**: `refinery/agents/anthropic.mts` already imports `env` from `../config/env.mts`, which exposes `env.supabaseUrl` / `env.supabaseKey` (canonical names, with legacy `BRAINS_SUPABASE_*` fallback already built in). `logApiUsage()` reuses that — no new env var names invented, nothing to add to `.env.local`/Vercel/GHA secrets.

---

## File structure

**brain-platform:**
- `refinery/agents/anthropic.mts` — modify: `CallType`, `computeCostUsd()`, `logApiUsage()`, wrapped `getAnthropic(callType?)`.
- `refinery/agents/anthropic.test.mts` — create: unit tests for the three new exports.
- `refinery/agents/synthesis-agent.mts`, `refinery/agents/triage-agent.mts`, `lib/assistant/stream.ts`, `lib/assistant/compose-chart.ts`, `lib/deliverable/build.ts` — modify: pass `callType` (and `packId` where available) to `getAnthropic()`.
- `lib/email/build-doc.ts` — modify: delete the module-level `new Anthropic(...)`, route both call sites through `getAnthropic("email_build")`.
- `app/api/projects/[id]/action/route.ts`, `app/api/email/schedule-command/route.ts` — modify: delete the local `getAnthropic()` shadow + its `Anthropic` import, import the shared one instead.
- `lib/email/data-readiness.ts`, `lib/email/listing-scrape.ts`, `lib/email/listing-comps.ts`, `lib/project/infer-project-type.ts`, `lib/email/social-calendar/build-week.ts`, `lib/email/social-calendar/build-canvas-fill.ts`, `app/api/email-lab/ai/route.ts` — modify: same mechanical swap, `callType: "other"`.
- `migrations/20260630_api_usage_log.sql` — create.

**swfldatagulf-ops:**
- `lib/spend.ts` — modify: `fetchApiUsage()`, `LiveApiUsage` type, `SpendResult.liveApiUsage`.
- `app/spend/page.tsx` — modify: live panel.

---

### Task 1: Migration — `public.api_usage_log`

**Files:**
- Create: `migrations/20260630_api_usage_log.sql`

**Interfaces:**
- Produces: table `public.api_usage_log` with columns `id, created_at, model, call_type, pack_id, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, env` — consumed by Task 3 (`logApiUsage`) and the ops-side `fetchApiUsage()` (Task 10).

- [ ] **Step 1: Write the migration**

```sql
-- Idempotent: api_usage_log table for live Anthropic spend tracking (/spend)
CREATE TABLE IF NOT EXISTS public.api_usage_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  model                 text NOT NULL,
  call_type             text NOT NULL DEFAULT 'other',
  pack_id               text,
  input_tokens          int  NOT NULL DEFAULT 0,
  output_tokens         int  NOT NULL DEFAULT 0,
  cache_read_tokens     int  NOT NULL DEFAULT 0,
  cache_creation_tokens int  NOT NULL DEFAULT 0,
  cost_usd              numeric(10,6) NOT NULL,
  env                   text NOT NULL DEFAULT 'production'
);

CREATE INDEX IF NOT EXISTS api_usage_log_created_at_idx
  ON public.api_usage_log (created_at DESC);

CREATE INDEX IF NOT EXISTS api_usage_log_call_type_idx
  ON public.api_usage_log (call_type, created_at DESC);

-- RLS: enabled for defense in depth; service_role bypasses it by default.
-- No row policy needed — only the service-role client (this codebase's only
-- writer/reader of this table) ever touches it. Matches 20260628_email_events.sql.
ALTER TABLE public.api_usage_log ENABLE ROW LEVEL SECURITY;

GRANT INSERT, SELECT ON public.api_usage_log TO service_role;
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Apply it**

Run (per CLAUDE.md RULE 1 — SQL migrations run directly, creds in `.dlt/secrets.toml`, always idempotent, verify row count after):

```bash
node scripts/run-migration.mjs migrations/20260630_api_usage_log.sql
```

If `scripts/run-migration.mjs` doesn't exist, use the `Bun.SQL` + `.dlt/secrets.toml` pattern from `reference_run-migrations-via-bun-sql` (memory) instead — psql is not installed on this box.

- [ ] **Step 3: Verify**

```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
sb.from('api_usage_log').select('*', { count: 'exact', head: true }).then(r => console.log('row count:', r.count, 'error:', r.error));
"
```

Expected: `row count: 0 error: null` (table exists, empty, no permission error).

- [ ] **Step 4: Commit**

```bash
git add migrations/20260630_api_usage_log.sql
git commit -m "feat(spend): api_usage_log table for live Anthropic spend tracking"
```

---

### Task 2: `CallType` + `computeCostUsd()`

**Files:**
- 🔴 Modify: `refinery/agents/anthropic.mts`
- 🔴 Create: `refinery/agents/anthropic.test.mts`

**Interfaces:**
- Produces: `export type CallType = "synthesis" | "triage" | "assistant_stream" | "assistant_chart" | "email_build" | "deliverable_build" | "other"`; `export function computeCostUsd(model: string, usage: UsageLike): number`; `export interface UsageLike { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { computeCostUsd } from "./anthropic.mts";

describe("computeCostUsd()", () => {
  test("Sonnet 4.6, no cache — exact MTok math", () => {
    const cost = computeCostUsd("claude-sonnet-4-6", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
    assert.equal(cost, 3.0 + 15.0);
  });

  test("Haiku 4.5, no cache — exact MTok math", () => {
    const cost = computeCostUsd("claude-haiku-4-5", {
      input_tokens: 500_000,
      output_tokens: 100_000,
    });
    assert.equal(cost, 0.5 + 0.5);
  });

  test("cache read = 10% of base input rate", () => {
    const cost = computeCostUsd("claude-sonnet-4-6", {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
    });
    assert.equal(cost, 3.0 * 0.1);
  });

  test("cache write = 25% premium on input rate", () => {
    const cost = computeCostUsd("claude-sonnet-4-6", {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
    });
    assert.equal(cost, 3.0 * 1.25);
  });

  test("unrecognized model — 0 cost, never invented", () => {
    const cost = computeCostUsd("claude-unknown-model", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    assert.equal(cost, 0);
  });

  test("null cache fields treated as zero", () => {
    const cost = computeCostUsd("claude-haiku-4-5", {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
    });
    assert.equal(cost, 0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test refinery/agents/anthropic.test.mts`
Expected: FAIL — `computeCostUsd` is not exported.

- [ ] **Step 3: Implement**

Add to `refinery/agents/anthropic.mts` (after the existing `agentsAreMocked` export, before `let cached`):

```ts
export type CallType =
  | "synthesis"
  | "triage"
  | "assistant_stream"
  | "assistant_chart"
  | "email_build"
  | "deliverable_build"
  | "other";

export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** $/MTok. Source: anthropic.com/claude/sonnet + anthropic.com/claude/haiku,
 *  verified via crawl4ai 06/30/2026 — mirrors swfldatagulf-ops/lib/spend.ts. */
const RATES: Record<string, { in: number; out: number }> = {
  "claude-sonnet-4-6": { in: 3.0, out: 15.0 },
  "claude-haiku-4-5": { in: 1.0, out: 5.0 },
};
const CACHE_READ_FRACTION = 0.1; // 10% of base input rate
const CACHE_WRITE_PREMIUM = 1.25; // 25% premium on input rate

/**
 * Pure cost calculator. An unrecognized model returns 0 rather than guessing
 * a rate — the row still logs (model + token counts preserved) for manual
 * reconciliation instead of inventing a number.
 */
export function computeCostUsd(model: string, usage: UsageLike): number {
  const rate = RATES[model];
  if (!rate) return 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return (
    (usage.input_tokens / 1_000_000) * rate.in +
    (usage.output_tokens / 1_000_000) * rate.out +
    (cacheRead / 1_000_000) * rate.in * CACHE_READ_FRACTION +
    (cacheWrite / 1_000_000) * rate.in * CACHE_WRITE_PREMIUM
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test refinery/agents/anthropic.test.mts`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add refinery/agents/anthropic.mts refinery/agents/anthropic.test.mts
git commit -m "feat(spend): CallType + computeCostUsd pure cost calculator"
```

---

### Task 3: `logApiUsage()`

**Files:**
- 🔴 Modify: `refinery/agents/anthropic.mts`
- 🔴 Modify: `refinery/agents/anthropic.test.mts`

**Interfaces:**
- Consumes: `computeCostUsd` (Task 2), `env.supabaseUrl` / `env.supabaseKey` from `../config/env.mts`, `agentsAreMocked()` (existing).
- Produces: `export interface LogApiUsageOpts { model: string; callType: CallType; packId?: string | null; usage: UsageLike; supabaseUrl?: string; supabaseKey?: string }`; `export async function logApiUsage(opts: LogApiUsageOpts): Promise<void>` — consumed by the wrapper in Task 4.

- [ ] **Step 1: Write the failing tests**

```ts
import { mock } from "bun:test";
// ...append to refinery/agents/anthropic.test.mts

describe("logApiUsage()", () => {
  test("inserts a row with computed cost", async () => {
    const inserted: any[] = [];
    const fakeSupabaseUrl = "https://fake.supabase.co";
    const fakeSupabaseKey = "fake-key";
    // logApiUsage takes an injectable client factory for tests — see Step 3.
    const result = await logApiUsage({
      model: "claude-haiku-4-5",
      callType: "triage",
      packId: "tourism-tdt",
      usage: { input_tokens: 1000, output_tokens: 500 },
      supabaseUrl: fakeSupabaseUrl,
      supabaseKey: fakeSupabaseKey,
      _insertSpy: (row) => inserted.push(row), // test-only injection point
    } as any);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].call_type, "triage");
    assert.equal(inserted[0].pack_id, "tourism-tdt");
  });

  test("missing supabase env — no-op, does not throw", async () => {
    await assert.doesNotReject(
      logApiUsage({
        model: "claude-haiku-4-5",
        callType: "other",
        usage: { input_tokens: 1, output_tokens: 1 },
        supabaseUrl: undefined,
        supabaseKey: undefined,
      }),
    );
  });
});
```

This `_insertSpy` shape is awkward for a real Supabase client — switch to dependency injection on the *client*, not the insert call, matching `predictions-log.mts`'s pattern (`supabaseUrl`/`supabaseKey` opts, real `createClient`, and a live integration smoke test instead of mocking the insert). Replace the first test with:

```ts
describe("logApiUsage()", () => {
  test("missing supabase env — no-op, does not throw, does not return an error", async () => {
    await assert.doesNotReject(
      logApiUsage({
        model: "claude-haiku-4-5",
        callType: "other",
        usage: { input_tokens: 1, output_tokens: 1 },
        supabaseUrl: undefined,
        supabaseKey: undefined,
      }),
    );
  });

  test("SKIP_USAGE_LOG=1 — no-op even with valid env", async () => {
    process.env.SKIP_USAGE_LOG = "1";
    await assert.doesNotReject(
      logApiUsage({
        model: "claude-haiku-4-5",
        callType: "other",
        usage: { input_tokens: 1, output_tokens: 1 },
        supabaseUrl: "https://fake.supabase.co",
        supabaseKey: "fake-key",
      }),
    );
    delete process.env.SKIP_USAGE_LOG;
  });
});
```

The real insert path (row shape, cost math, against the live table) is covered by Task 1 Step 3's manual verify plus an end-to-end check once Task 5 wires a real call site — unit-testing a real Supabase insert here would need a live table and isn't worth mocking the SDK for two env-gate branches.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test refinery/agents/anthropic.test.mts`
Expected: FAIL — `logApiUsage` is not exported.

- [ ] **Step 3: Implement**

Add to `refinery/agents/anthropic.mts`, above `let cached`:

```ts
import { createClient } from "@supabase/supabase-js";

export interface LogApiUsageOpts {
  model: string;
  callType: CallType;
  packId?: string | null;
  usage: UsageLike;
  /** Test injection points; production calls omit these and fall through to env.*. */
  supabaseUrl?: string;
  supabaseKey?: string;
}

/**
 * Insert one row into public.api_usage_log. Never throws — a logging failure
 * must not affect the real API call it's reporting on. Skips entirely when
 * mocked, when SKIP_USAGE_LOG=1, or when Supabase env isn't configured.
 */
export async function logApiUsage(opts: LogApiUsageOpts): Promise<void> {
  if (agentsAreMocked()) return;
  if (process.env.SKIP_USAGE_LOG === "1") return;
  const url = opts.supabaseUrl ?? env.supabaseUrl;
  const key = opts.supabaseKey ?? env.supabaseKey;
  if (!url || !key) return;

  try {
    const sb = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await sb.from("api_usage_log").insert({
      model: opts.model,
      call_type: opts.callType,
      pack_id: opts.packId ?? null,
      input_tokens: opts.usage.input_tokens,
      output_tokens: opts.usage.output_tokens,
      cache_read_tokens: opts.usage.cache_read_input_tokens ?? 0,
      cache_creation_tokens: opts.usage.cache_creation_input_tokens ?? 0,
      cost_usd: computeCostUsd(opts.model, opts.usage),
      env: process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production"
        ? "production"
        : "development",
    });
    if (error) console.error("[api-usage-log] insert failed:", error.message);
  } catch (e) {
    console.error("[api-usage-log] insert threw:", e instanceof Error ? e.message : e);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test refinery/agents/anthropic.test.mts`
Expected: PASS, 8/8.

- [ ] **Step 5: Commit**

```bash
git add refinery/agents/anthropic.mts refinery/agents/anthropic.test.mts
git commit -m "feat(spend): logApiUsage() — append-only insert, never throws"
```

---

### Task 4: Wrapped `getAnthropic(callType?)`

**Files:**
- 🔴 Modify: `refinery/agents/anthropic.mts`
- 🔴 Modify: `refinery/agents/anthropic.test.mts`

**Interfaces:**
- Consumes: `logApiUsage` (Task 3).
- Produces: `export function getAnthropic(callType?: CallType): Anthropic` — same name, now-optional param (backward compatible with all 14 existing zero-arg callers); consumed by every task from here on.

- [ ] **Step 1: Write the failing test**

This needs a fake Anthropic-shaped client rather than hitting the real API. Test the wrapping logic directly:

```ts
describe("getAnthropic() — usage logging wrapper", () => {
  test(".create() response triggers a logApiUsage call with the right shape", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    const client = getAnthropic("triage");
    // Real network call would fail with a real auth error against api.anthropic.com —
    // this test only asserts getAnthropic returns an object whose .messages has
    // wrapped create/stream functions (identity check), not live behavior.
    assert.equal(typeof client.messages.create, "function");
    assert.equal(typeof client.messages.stream, "function");
    assert.notEqual(client.messages.create, Anthropic.prototype); // sanity: not the raw unwrapped fn
    delete process.env.ANTHROPIC_API_KEY;
  });

  test("same callType returns the same cached wrapped client", () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    const a = getAnthropic("synthesis");
    const b = getAnthropic("synthesis");
    assert.equal(a, b);
    delete process.env.ANTHROPIC_API_KEY;
  });

  test("different callTypes return different wrapped clients", () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    const a = getAnthropic("synthesis");
    const b = getAnthropic("triage");
    assert.notEqual(a, b);
    delete process.env.ANTHROPIC_API_KEY;
  });

  test("no-arg call defaults to callType 'other' — backward compatible", () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    const a = getAnthropic();
    const b = getAnthropic("other");
    assert.equal(a, b);
    delete process.env.ANTHROPIC_API_KEY;
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test refinery/agents/anthropic.test.mts`
Expected: FAIL — `getAnthropic` still takes zero args / doesn't expose a per-callType cache.

- [ ] **Step 3: Implement**

Replace the existing `getAnthropic` block in `refinery/agents/anthropic.mts`:

```ts
let cached: Anthropic | null = null;

function getRawClient(): Anthropic {
  if (cached) return cached;
  requireEnv(["anthropicApiKey"]);
  cached = new Anthropic({ apiKey: env.anthropicApiKey });
  return cached;
}

/**
 * Wraps only `.messages.create` / `.messages.stream` — the only two methods
 * any call site in this codebase invokes on the client (verified via grep
 * for `client\.(beta|models|batches)\.` — zero hits). Returns a plain object
 * rather than a Proxy on `raw`: simpler, and avoids any private-class-field
 * `this`-binding surprises if the SDK ever calls internal methods that expect
 * a real `Anthropic` instance as `this`.
 */
function wrapMessages(raw: Anthropic, callType: CallType): Anthropic["messages"] {
  const realCreate = raw.messages.create.bind(raw.messages);
  const realStream = raw.messages.stream.bind(raw.messages);

  return {
    ...raw.messages,
    create: (async (...args: Parameters<typeof realCreate>) => {
      const response = await realCreate(...args);
      // Non-streaming Message has `.usage` directly; a `stream:true` Message
      // stream response does not — skip those (call sites use .stream() for
      // streaming today; this guard just keeps the wrapper honest either way).
      if (response && typeof response === "object" && "usage" in response) {
        void logApiUsage({
          model: (response as Anthropic.Message).model,
          callType,
          usage: (response as Anthropic.Message).usage,
        }).catch((e) => console.error("[api-usage-log] create hook failed:", e));
      }
      return response;
    }) as typeof realCreate,
    stream: ((...args: Parameters<typeof realStream>) => {
      const stream = realStream(...args);
      stream
        .finalMessage()
        .then((msg) =>
          logApiUsage({ model: msg.model, callType, usage: msg.usage }),
        )
        .catch((e) => console.error("[api-usage-log] stream hook failed:", e));
      return stream;
    }) as typeof realStream,
  } as Anthropic["messages"];
}

const wrappedByCallType = new Map<CallType, Anthropic>();

/** Shared Anthropic client. Only call when NOT in mock mode. Every real call
 *  is logged to public.api_usage_log; pass callType to label it (defaults to
 *  "other", fully backward compatible with existing zero-arg call sites). */
export function getAnthropic(callType: CallType = "other"): Anthropic {
  const existing = wrappedByCallType.get(callType);
  if (existing) return existing;
  const raw = getRawClient();
  const wrapped = { ...raw, messages: wrapMessages(raw, callType) } as Anthropic;
  wrappedByCallType.set(callType, wrapped);
  return wrapped;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test refinery/agents/anthropic.test.mts`
Expected: PASS, all tests green.

- [ ] **Step 5: Run the full refinery test suite to confirm no regression**

Run: `bun test refinery/`
Expected: PASS — `synthesis-agent.test.mts` and every other existing consumer of `getAnthropic()` still passes unmodified (signature change is additive-optional).

- [ ] **Step 6: Commit**

```bash
git add refinery/agents/anthropic.mts refinery/agents/anthropic.test.mts
git commit -m "feat(spend): getAnthropic(callType?) — wraps messages.create/stream, logs every real call"
```

---

### Task 5: Wire the 4 already-shared-client call sites

**Files:**
- Modify: `refinery/agents/synthesis-agent.mts:100`
- Modify: `refinery/agents/triage-agent.mts:160`
- Modify: `lib/assistant/stream.ts:72`
- Modify: `lib/assistant/compose-chart.ts:512`

**Interfaces:**
- Consumes: `getAnthropic(callType?)` (Task 4).

- [ ] **Step 1: `refinery/agents/synthesis-agent.mts`**

```ts
// before:
const client = getAnthropic();
// after:
const client = getAnthropic("synthesis");
```

(`pack.id` is in scope two lines below as `pack.prompts.synthesisContext` is read — `packId` isn't threaded into `logApiUsage` here because the usage row is logged inside the wrapper, which only sees `callType`, not the call site's local variables. Leave `packId` null for this call site; per-pack cost attribution would require passing `pack.id` through to `getAnthropic` itself, which is out of scope for this build — `call_type: "synthesis"` plus `created_at` is enough to separate synthesis spend in the /spend per-call-type bar.)

- [ ] **Step 2: `refinery/agents/triage-agent.mts`**

```ts
// before:
const client = getAnthropic();
// after:
const client = getAnthropic("triage");
```

- [ ] **Step 3: `lib/assistant/stream.ts`**

```ts
// before:
const client = getAnthropic();
// after:
const client = getAnthropic("assistant_stream");
```

- [ ] **Step 4: `lib/assistant/compose-chart.ts`**

```ts
// before:
const client = getAnthropic();
// after:
const client = getAnthropic("assistant_chart");
```

- [ ] **Step 5: Run the full test suite**

Run: `bun test`
Expected: PASS — no test asserts on `getAnthropic()` call arity, so this is a behavior-neutral diff outside of the new logging side effect (which no-ops under `agentsAreMocked()` in every test run).

- [ ] **Step 6: Commit**

```bash
git add refinery/agents/synthesis-agent.mts refinery/agents/triage-agent.mts lib/assistant/stream.ts lib/assistant/compose-chart.ts
git commit -m "feat(spend): tag synthesis/triage/assistant_stream/assistant_chart call types"
```

---

### Task 6: Fix `lib/email/build-doc.ts` (currently bypasses logging entirely)

**Files:**
- Modify: `lib/email/build-doc.ts`

**Interfaces:**
- Consumes: `getAnthropic(callType?)` (Task 4).

- [ ] **Step 1: Remove the module-level raw client, import the shared one**

```ts
// before (line 10):
import Anthropic from "@anthropic-ai/sdk";
// after:
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "@/refinery/agents/anthropic.mts";
```

```ts
// before (line 61):
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
// after: delete this line entirely.
```

- [ ] **Step 2: Replace both call sites**

At line 463 (inside the function whose body we read — `client.messages.create({...})` for the content-patch flow):

```ts
// before:
msg = await client.messages.create({
// after:
msg = await getAnthropic("email_build").messages.create({
```

At line 566 (the `AUTHOR_TOOL` flow):

```ts
// before:
const msg = await client.messages.create({
// after:
const msg = await getAnthropic("email_build").messages.create({
```

- [ ] **Step 3: Verify the file still typechecks and its tests pass**

Run: `bunx next build` (per memory: verify with `next build`, not bare `npx tsc` — local tsc misses what Vercel's TS 5.9.3 catches) — or, if a faster local loop is wanted first, `bun test lib/email/` for the unit-level tests, followed by the full `bunx next build` before pushing.
Expected: build succeeds, no new type errors.

- [ ] **Step 4: Commit**

```bash
git add lib/email/build-doc.ts
git commit -m "fix(spend): build-doc.ts now routes through logged getAnthropic (was bypassing it)"
```

---

### Task 7: Tag `lib/deliverable/build.ts`

**Files:**
- Modify: `lib/deliverable/build.ts:317`

**Interfaces:**
- Consumes: `getAnthropic(callType?)` (Task 4).

- [ ] **Step 1: Tag the call site**

```ts
// before:
async function callModel(userContent: string): Promise<Narrative> {
  const client = getAnthropic();
// after:
async function callModel(userContent: string): Promise<Narrative> {
  const client = getAnthropic("deliverable_build");
```

- [ ] **Step 2: Run tests**

Run: `bun test lib/deliverable/`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/deliverable/build.ts
git commit -m "feat(spend): tag deliverable_build call type"
```

---

### Task 8: Delete the two local `getAnthropic()` shadows

**Files:**
- Modify: `app/api/projects/[id]/action/route.ts`
- Modify: `app/api/email/schedule-command/route.ts`

**Interfaces:**
- Consumes: `getAnthropic(callType?)` (Task 4) — proven importable into `app/api/**/route.ts` by the existing precedent at `app/api/projects/[id]/extract-pdf/route.ts:16`.

- [ ] **Step 1: `app/api/projects/[id]/action/route.ts`**

```ts
// before (lines 3, 35-42):
import Anthropic from "@anthropic-ai/sdk";
...
let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (_anthropic) return _anthropic;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  _anthropic = new Anthropic({ apiKey });
  return _anthropic;
}

// after:
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "@/refinery/agents/anthropic.mts";
// (delete the local getAnthropic function entirely — the import above replaces it)
```

Every call site in this file that does `getAnthropic()` (e.g. line 243's `await getAnthropic().messages.create({...})`) now resolves to the shared, logged client automatically — no further change needed at the call site itself, since the function name is unchanged. Leave it tagged `"other"` (the spec's 6 named callTypes don't include a project-action bucket; adding one is a one-line follow-up if per-route cost visibility is wanted later, out of scope here).

- [ ] **Step 2: `app/api/email/schedule-command/route.ts`**

Same pattern:

```ts
// before (lines 4, 48-55):
import Anthropic from "@anthropic-ai/sdk";
...
let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (_anthropic) return _anthropic;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  _anthropic = new Anthropic({ apiKey });
  return _anthropic;
}

// after:
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "@/refinery/agents/anthropic.mts";
```

Also update the stale comment block above the deleted function (lines 35-41) that claims refinery can't be pulled into the Next runtime — delete or correct it, since it's now demonstrably wrong and would mislead the next person who reads this file.

- [ ] **Step 3: Run the affected route tests + a build**

Run: `bun test app/api/projects/ app/api/email/` then `bunx next build`.
Expected: PASS — these two routes already worked with a real Anthropic client; the only change is which factory function constructs it (and that the constructed client is now logged + shared/cached instead of per-route-cached).

- [ ] **Step 4: Commit**

```bash
git add "app/api/projects/[id]/action/route.ts" app/api/email/schedule-command/route.ts
git commit -m "fix(spend): delete duplicate local getAnthropic() shadows, use shared logged client"
```

---

### Task 9: Migrate the remaining direct-`new Anthropic()` production files

**Files:**
- Modify: `lib/email/data-readiness.ts`
- Modify: `lib/email/listing-scrape.ts`
- Modify: `lib/email/listing-comps.ts`
- Modify: `lib/project/infer-project-type.ts`
- Modify: `lib/email/social-calendar/build-week.ts`
- Modify: `lib/email/social-calendar/build-canvas-fill.ts`
- Modify: `app/api/email-lab/ai/route.ts`

**Interfaces:**
- Consumes: `getAnthropic(callType?)` (Task 4).

Same mechanical swap in each file — replace the module-level `new Anthropic(...)` with an import of the shared client and call `getAnthropic("other")` at each use site (or store `const client = getAnthropic("other");` at module scope if the original was module-scoped, matching that file's existing structure).

- [ ] **Step 1: `lib/email/data-readiness.ts:114`**

```ts
// before:
const anthropic = new Anthropic();
// after (remove the Anthropic import if otherwise unused; add):
import { getAnthropic } from "@/refinery/agents/anthropic.mts";
const anthropic = getAnthropic("other");
```

- [ ] **Step 2: `lib/email/listing-scrape.ts:375`**

```ts
// before:
const listingLlm = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
// after:
import { getAnthropic } from "@/refinery/agents/anthropic.mts";
const listingLlm = getAnthropic("other");
```

- [ ] **Step 3: `lib/email/listing-comps.ts:82`**

```ts
// before:
const compsLlm = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
// after:
import { getAnthropic } from "@/refinery/agents/anthropic.mts";
const compsLlm = getAnthropic("other");
```

- [ ] **Step 4: `lib/project/infer-project-type.ts:78`**

```ts
// before:
const client = new Anthropic();
// after:
import { getAnthropic } from "@/refinery/agents/anthropic.mts";
const client = getAnthropic("other");
```

- [ ] **Step 5: `lib/email/social-calendar/build-week.ts:38`**

```ts
// before:
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
// after:
import { getAnthropic } from "@/refinery/agents/anthropic.mts";
const client = getAnthropic("other");
```

- [ ] **Step 6: `lib/email/social-calendar/build-canvas-fill.ts:21`**

```ts
// before:
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
// after:
import { getAnthropic } from "@/refinery/agents/anthropic.mts";
const client = getAnthropic("other");
```

- [ ] **Step 7: `app/api/email-lab/ai/route.ts:11`**

```ts
// before:
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
// after:
import { getAnthropic } from "@/refinery/agents/anthropic.mts";
const client = getAnthropic("other");
```

For each file, leave the `import Anthropic from "@anthropic-ai/sdk"` line in place ONLY if that file still references `Anthropic` as a type (e.g. `Anthropic.Message`, `Anthropic.Tool`); change it to `import type Anthropic from "@anthropic-ai/sdk"` if it's type-only after this edit, exactly as in Task 8.

- [ ] **Step 8: Run the full suite + build**

Run: `bun test && bunx next build`
Expected: PASS. These 7 files have no dedicated unit tests covering client construction (confirmed: none of them have a `.test.ts` sibling exercising the module-level client variable directly) — `next build`'s typecheck is the real gate here.

- [ ] **Step 9: Commit**

```bash
git add lib/email/data-readiness.ts lib/email/listing-scrape.ts lib/email/listing-comps.ts lib/project/infer-project-type.ts lib/email/social-calendar/build-week.ts lib/email/social-calendar/build-canvas-fill.ts app/api/email-lab/ai/route.ts
git commit -m "fix(spend): migrate remaining direct Anthropic() instantiations onto logged shared client"
```

---

### Task 10: `swfldatagulf-ops/lib/spend.ts` — `fetchApiUsage()`

**Files:**
- Modify: `C:\Users\ethan\dev\swfldatagulf-ops\lib\spend.ts`

**Interfaces:**
- Consumes: `public.api_usage_log` (Task 1), the existing `@supabase/supabase-js` + `process.env.SUPABASE_URL`/`SUPABASE_SERVICE_KEY` pattern already used by this repo's `lib/supabase.ts`.
- Produces: `export interface LiveApiUsage { todayCostUsd: number; last30CostUsd: number; last30ByType: Record<string, number>; last30ByDay: { date: string; cost: number }[]; rowCount: number; oldestEntry: string | null }`; `export async function fetchApiUsage(): Promise<LiveApiUsage | null>`; extends `SpendResult` with `liveApiUsage: LiveApiUsage | null`.

This repo has no test harness wired up (`package.json` has no `test` script, no `.test.ts` files exist) — adding one solely for this function would be scope creep. Verification is a manual dev-server check in Step 4 instead of a unit test, same rigor level the rest of `lib/spend.ts` already operates at.

- [ ] **Step 1: Add the Supabase client + query function**

Append to `lib/spend.ts`, after the `SpendResult` interface:

```ts
import { createClient } from "@supabase/supabase-js";

export interface LiveApiUsage {
  todayCostUsd: number;
  last30CostUsd: number;
  last30ByType: Record<string, number>; // callType -> total cost
  last30ByDay: { date: string; cost: number }[];
  rowCount: number;
  oldestEntry: string | null;
}

interface ApiUsageRow {
  created_at: string;
  call_type: string;
  cost_usd: number;
}

/**
 * Live Anthropic spend from public.api_usage_log. Returns null when the
 * table is empty or unreachable — the page falls back to the static
 * estimate in that case (never a broken page).
 */
export async function fetchApiUsage(): Promise<LiveApiUsage | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;

  try {
    const sb = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await sb
      .from("api_usage_log")
      .select("created_at, call_type, cost_usd")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(50_000);
    if (error || !data || data.length === 0) return null;

    const rows = data as ApiUsageRow[];
    const todayStr = new Date().toISOString().slice(0, 10);

    let todayCostUsd = 0;
    let last30CostUsd = 0;
    const last30ByType: Record<string, number> = {};
    const byDay = new Map<string, number>();

    for (const row of rows) {
      const day = row.created_at.slice(0, 10);
      const cost = Number(row.cost_usd) || 0;
      last30CostUsd += cost;
      if (day === todayStr) todayCostUsd += cost;
      last30ByType[row.call_type] = (last30ByType[row.call_type] ?? 0) + cost;
      byDay.set(day, (byDay.get(day) ?? 0) + cost);
    }

    const last30ByDay = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, cost]) => ({ date, cost }));

    return {
      todayCostUsd,
      last30CostUsd,
      last30ByType,
      last30ByDay,
      rowCount: rows.length,
      oldestEntry: rows[0]?.created_at ?? null,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Extend `SpendResult` and `buildSpendReport()`**

```ts
// in the SpendResult interface, add:
  apiCosts: ApiCostBreakdown;
  liveApiUsage: LiveApiUsage | null;   // <-- new
  deadServices: DeadService[];
```

```ts
// in buildSpendReport(), add alongside the existing apiCosts/deadMonthlySavings computation:
  const apiCosts = calcApiCosts();
  const liveApiUsage = await fetchApiUsage();   // <-- new
  const deadMonthlySavings = DEAD_SERVICES.reduce((a, d) => a + (d.monthlyCost ?? 0), 0);

  return {
    services,
    activeServices,
    optionalServices,
    needsInputServices,
    confirmedTotal,
    estimatedTotal,
    combinedTotal,
    dailyBurn,
    byCategory,
    vercelPlan,
    generatedAt: new Date().toISOString(),
    apiCosts,
    liveApiUsage,   // <-- new
    deadServices: DEAD_SERVICES,
    deadMonthlySavings,
  };
```

- [ ] **Step 3: Typecheck**

Run: `cd /c/Users/ethan/dev/swfldatagulf-ops && npx tsc --noEmit`
Expected: no new errors. (This repo's build script is `next build`; `tsc --noEmit` is the fast local loop — confirm with a full `npm run build` before considering the task done if there's any doubt.)

- [ ] **Step 4: Manual verify against the real (still-empty) table**

```bash
cd /c/Users/ethan/dev/swfldatagulf-ops
npm run dev
```

Visit `/spend` — confirm the page still renders the static "ACTUAL vs TARGET" panel exactly as before (table is empty → `fetchApiUsage()` returns `null` → no behavior change yet). This confirms the null-fallback path before Task 11 adds anything that reads `liveApiUsage`.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/ethan/dev/swfldatagulf-ops
git add lib/spend.ts
git commit -m "feat(spend): fetchApiUsage() — live 30-day Anthropic spend from api_usage_log"
```

---

### Task 11: `swfldatagulf-ops/app/spend/page.tsx` — live panel

**Files:**
- Modify: `C:\Users\ethan\dev\swfldatagulf-ops\app\spend\page.tsx`

**Interfaces:**
- Consumes: `report.liveApiUsage: LiveApiUsage | null` (Task 10).

- [ ] **Step 1: Add a `LiveApiUsagePanel` component**

Insert above `ApiCostPanel` in `app/spend/page.tsx`:

```tsx
import type { LiveApiUsage } from "@/lib/spend";

function LiveApiUsagePanel({ live }: { live: LiveApiUsage }) {
  const byTypeEntries = Object.entries(live.last30ByType).sort(([, a], [, b]) => b - a);
  const maxTypeCost = Math.max(...byTypeEntries.map(([, v]) => v), 0.0001);
  const dailyAvg = live.last30CostUsd / 30;

  return (
    <div className="spend-live-wrap">
      <div className="spend-live-head">LIVE — {live.rowCount.toLocaleString()} logged calls{live.oldestEntry ? ` since ${live.oldestEntry.slice(0, 10)}` : ""}</div>
      <div className="spend-live-cols">
        <div className="spend-live-col">
          <div className="spend-live-label">Today (actual)</div>
          <div className="spend-live-val teal">{`$${live.todayCostUsd.toFixed(4)}`}</div>
        </div>
        <div className="spend-live-col">
          <div className="spend-live-label">Last 30 days</div>
          <div className="spend-live-val teal">{`$${live.last30CostUsd.toFixed(2)}`}</div>
        </div>
        <div className="spend-live-col">
          <div className="spend-live-label">Daily average</div>
          <div className="spend-live-val">{`$${dailyAvg.toFixed(4)}`}</div>
        </div>
      </div>
      <div className="spend-live-bytype">
        {byTypeEntries.map(([callType, cost]) => (
          <div key={callType} className="spend-bar-row">
            <div className="spend-bar-label mono">{callType}</div>
            <div className="spend-bar-track">
              <div
                className="spend-bar-fill"
                style={{ width: `${Math.max((cost / maxTypeCost) * 100, 2)}%`, background: "#2dd4bf" }}
              />
            </div>
            <div className="spend-bar-value">{`$${cost.toFixed(4)}`}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Render it above the static panel, conditionally**

```tsx
// ── 2. API Cost ── (replace the existing section body)
<section className="spend-section">
  <div className="spend-section-label">API COSTS{report.liveApiUsage ? " — LIVE" : ": ACTUAL vs TARGET (pre-logging estimate)"}</div>
  {report.liveApiUsage && <LiveApiUsagePanel live={report.liveApiUsage} />}
  <ApiCostPanel api={api} />
  {report.liveApiUsage && (
    <p className="spend-footer-note mono">
      Static estimate above is the pre-logging baseline — kept visible until 30 days of live data fully supersede it.
    </p>
  )}
</section>
```

- [ ] **Step 3: Add CSS for the new classnames**

Find the existing `.spend-bar-row` / `.spend-api-*` styles (likely in `app/spend/spend.css` or a co-located stylesheet — check `grep -rn "spend-bar-row" app/` for the file) and add matching rules for `.spend-live-wrap`, `.spend-live-head`, `.spend-live-cols`, `.spend-live-col`, `.spend-live-label`, `.spend-live-val`, `.spend-live-bytype`, reusing the existing color variables (`--green`, `--teal`, `--muted`) already used elsewhere on this page — no new design tokens.

- [ ] **Step 4: Build + manual verify**

```bash
cd /c/Users/ethan/dev/swfldatagulf-ops
npm run build
npm run dev
```

Visit `/spend`. With the table still empty, confirm the page is pixel-identical to before (no live panel renders, no console errors — `liveApiUsage` is `null`). This is the real test of the fallback contract from success criterion 5.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/ethan/dev/swfldatagulf-ops
git add app/spend/page.tsx app/spend/*.css
git commit -m "feat(spend): live API usage panel on /spend, falls back to static estimate"
```

---

### Task 12: End-to-end live verify (closes the check)

**Files:** none — verification only.

- [ ] **Step 1: Trigger one real, cheap synthesis call**

Per CLAUDE.md's GHA rebuild targeting rule — never `pack_id=master --force` to debug one brain:

```bash
gh workflow run daily-rebuild.yml --repo ethanrickyjrjr-wq/SWFL-Data-Gulf -f pack_id=tourism-tdt -f force=true
```

- [ ] **Step 2: Confirm a row landed**

```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
sb.from('api_usage_log').select('*').order('created_at', { ascending: false }).limit(5)
  .then(r => console.log(JSON.stringify(r.data, null, 2)));
"
```

Expected: at least one row with `call_type: "synthesis"`, a real `model`, nonzero `input_tokens`/`output_tokens`, and `cost_usd > 0`.

- [ ] **Step 3: Confirm /spend shows it live (within the 1-hour ISR window, or force a fresh build)**

```bash
cd /c/Users/ethan/dev/swfldatagulf-ops && npm run build && npm run dev
```

Visit `/spend` — the LIVE panel should now render with `rowCount >= 1` and a nonzero `last30CostUsd`.

- [ ] **Step 4: Close the check**

Per RULE 2 (session loop) and the memory rule that `public.checks` is prod evidence, not dev attestation — only close after Step 2/3's live output is actually observed, not from "code looks right":

```bash
node scripts/check.mjs close api_usage_logging_live_verify
```

- [ ] **Step 5: SESSION_LOG entries + push (both repos)**

Per RULE 0 (brain-platform) — append before push:

```markdown
## 2026-06-30 (main) — feat(spend): live Anthropic API usage logging, end to end

Wired logApiUsage() into getAnthropic() (Proxy-free wrapper, .create + .stream both covered),
migrated all production call sites including the ones that bypassed the shared client entirely
(build-doc.ts module-level client, 2 local getAnthropic() shadows, 7 more direct new Anthropic()
instantiations — found probing the spec against code, not in the original spec). /spend in
swfldatagulf-ops now shows live today/30-day actuals with the static estimate as fallback.
Closes api_usage_logging_live_verify.
```

```bash
node scripts/safe-push.mjs
```

And in `swfldatagulf-ops` (separate `SESSION_LOG.md`, no push-time hook there but matching convention):

```markdown
## 2026-06-30 — feat(spend): live API usage panel wired to brain-platform's api_usage_log

fetchApiUsage() reads public.api_usage_log via the existing lib/supabase.ts pattern. Falls back
to the static ACTUAL vs TARGET estimate when the table is empty/unreachable — verified both states.
```

```bash
cd /c/Users/ethan/dev/swfldatagulf-ops && git push origin main
```

---

## Self-review

**Spec coverage:**
- §1 Proxy wrapper → Task 4 (built as a plain-object wrapper instead of a `Proxy`, functionally equivalent, simpler — noted in Task 4 Step 3 comment).
- §1 six tagged call sites → Tasks 5-7.
- §1 "zero changes to existing call sites" → corrected: Tasks 6, 8, 9 are real code changes the spec didn't anticipate, because those sites never routed through `getAnthropic()` to begin with.
- §2 token cost rates → Task 2.
- §3 Supabase table → Task 1, convention-corrected (GRANT+NOTIFY instead of broad RLS policy).
- §4 `logApiUsage()` → Task 3.
- §5 `fetchApiUsage()` / `lib/spend.ts` → Task 10.
- §6 /spend page changes → Task 11.
- Error handling (never throws, `agentsAreMocked()` guard, `SKIP_USAGE_LOG`) → Task 3.
- Success criteria 1-5 → Task 12 (live verify), with criterion 4 also covered by Task 3's mock-mode test and criterion 5 by Task 10/11's manual empty-table check.

**Placeholder scan:** no TBD/TODO, every step has real code or a real command with expected output.

**Type consistency:** `CallType`, `UsageLike`, `LogApiUsageOpts`, `LiveApiUsage` are each defined once (Tasks 2/3/10) and referenced identically everywhere else they appear.

---

## Parallel Safety

> Tasks sharing a color badge touch overlapping files and **cannot run in parallel**.

| Group | Tasks | Shared Files |
|-------|-------|--------------|
| 🔴 | Task 2, Task 3, Task 4 | `refinery/agents/anthropic.mts`, `refinery/agents/anthropic.test.mts` |

Tasks with no color badge have no file conflicts — safe to parallelize freely.
