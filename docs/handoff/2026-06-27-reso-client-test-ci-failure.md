# Handoff — RESO client tests: 3 persistent CI failures

**Date:** 2026-06-27
**Status:** Pre-existing — failing on EVERY CI run all day (20+ runs), independent of any diff.
**File:** `lib/reso/client.test.ts`
**Impact:** CI is fully red on `main`; every push blocked by these 3 regardless of what changed.

---

## The 3 failing tests

```
(fail) paginates until an empty page is returned
(fail) throws on non-ok HTTP response
(fail) throws when env vars are missing for a board
```

All 3 pass locally every time (`bun test lib/reso/client.test.ts` — 5/5 loops clean).
All 3 fail on every GHA run. This is a **CI-environment-specific failure**, not a logic bug.

---

## Root cause

The tests mock `global.fetch` by direct assignment:

```ts
beforeEach(() => { originalFetch = global.fetch; });
afterEach(() => { global.fetch = originalFetch; });

// inside test:
global.fetch = makeFetchMock([...]) as typeof fetch;
```

**Bun runs test files concurrently by default.** On the GHA runner, many test files run in parallel. When another file also mutates `global.fetch` (or when Bun's internal fetch plumbing re-initialises between files), the `beforeEach` snapshot captures the wrong value — and when the mock is set, a concurrent file's `afterEach` restores `global.fetch` underneath it before the test's own fetch call fires. The result: `fetch` is either the wrong mock or the un-mocked original by the time `ResoClient.get()` calls it, so the mock never triggers — all 3 tests fail together.

Test 3 (`throws when env vars are missing for a board`) is sensitive to env isolation for the same reason: concurrent files can set `RESO_BASE_URL_NABOR` / `RESO_TOKEN_NABOR` while this test deletes them, or vice versa.

---

## The fix

Replace raw `global.fetch` mutation with **Bun's `spyOn` / `mock.module`** pattern, which is test-file-isolated and properly undone per-test without touching the shared global:

```ts
import { test, expect, spyOn, beforeEach, afterEach } from "bun:test";

let fetchSpy: ReturnType<typeof spyOn>;

afterEach(() => {
  fetchSpy?.mockRestore();
});

test("paginates until an empty page is returned", async () => {
  process.env.RESO_BASE_URL_SWFL_MLS = "https://sandbox.example.com";
  process.env.RESO_TOKEN_SWFL_MLS = "tok-test";

  const items200 = Array.from({ length: 200 }, (_, i) => ({ ListingKey: `K${i}` }));
  const items50  = Array.from({ length: 50  }, (_, i) => ({ ListingKey: `L${i}` }));
  let call = 0;
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => {
    const page = [items200, items50][call++] ?? [];
    return new Response(JSON.stringify({ value: page }), { status: 200 });
  });

  const { ResoClient } = await import("./client");
  const client = new ResoClient("swfl_mls");
  const results = await client.get("Property", { $select: "ListingKey" });
  expect(results.length).toBe(250);
});

test("throws on non-ok HTTP response", async () => {
  process.env.RESO_BASE_URL_SWFL_MLS = "https://sandbox.example.com";
  process.env.RESO_TOKEN_SWFL_MLS = "tok-test";

  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response("Unauthorized", { status: 401 })
  );

  const { ResoClient } = await import("./client");
  const client = new ResoClient("swfl_mls");
  await expect(client.get("Property", {})).rejects.toThrow("401");
});

test("throws when env vars are missing for a board", async () => {
  const saved = {
    url: process.env.RESO_BASE_URL_NABOR,
    tok: process.env.RESO_TOKEN_NABOR,
  };
  delete process.env.RESO_BASE_URL_NABOR;
  delete process.env.RESO_TOKEN_NABOR;

  const { ResoClient } = await import("./client");
  expect(() => new ResoClient("nabor")).toThrow("env vars not configured");

  // restore so concurrent tests aren't affected
  if (saved.url) process.env.RESO_BASE_URL_NABOR = saved.url;
  if (saved.tok) process.env.RESO_TOKEN_NABOR = saved.tok;
});
```

Key changes:
- `spyOn(globalThis, "fetch").mockImplementation(...)` — Bun-native mock, scoped to this file
- `fetchSpy.mockRestore()` in `afterEach` — atomic undo, won't clobber concurrent files
- `Response` objects instead of plain `{ ok, json }` literals — matches the real fetch contract
- Env var save/restore in test 3 — protects concurrent files that may legitimately have NABOR set

---

## Also clean up: env vars leaked between tests

Tests 1 and 2 set `RESO_BASE_URL_SWFL_MLS` / `RESO_TOKEN_SWFL_MLS` but never delete them. Add cleanup in `afterEach`:

```ts
afterEach(() => {
  fetchSpy?.mockRestore();
  delete process.env.RESO_BASE_URL_SWFL_MLS;
  delete process.env.RESO_TOKEN_SWFL_MLS;
});
```

---

## How to verify the fix

```bash
# Run the file solo — should be 3/3 clean
bun test lib/reso/client.test.ts

# Loop 10x to confirm no residual flake
for i in {1..10}; do bun test lib/reso/client.test.ts 2>&1 | tail -2; done

# Run the full suite — confirm 0 fail
bun test
```

Then push and confirm CI green.

---

## Context

- `lib/reso/client.ts` — OData client for Bridge (SWFL MLS) and Trestle (NABOR) boards
- `lib/reso/boards.ts` — reads `RESO_BASE_URL_*` / `RESO_TOKEN_*` from env at call time
- MLS integration plan: `docs/superpowers/plans/2026-06-25-mls-reso-integration.md`
- These tests were written with the RESO MLS integration; the global.fetch pattern works locally
  because local `bun test` runs files sequentially by default — concurrency only hits on CI.
