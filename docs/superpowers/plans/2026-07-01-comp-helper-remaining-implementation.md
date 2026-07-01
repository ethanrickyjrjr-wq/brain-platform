# Comp Helper: Comps Chart + Pasted-Link Lane — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Recommended model:** 🧠 Opus — 11 files, keywords: schema, architecture

**Goal:** Ship the two remaining comp-helper items — a comps bar chart (Increment 2) and an
authenticated pasted-listing-link lane (Increment 3) — closing a live zero-guard SSRF gap in
`fetchListingFacts` as part of building Increment 3.

**Architecture:** Increment 2 adds one pure function (`buildCompsChartSpec`) plus two wiring
lines in `conversation-path.ts`. Increment 3 adds a new SSRF-safe fetch module
(`lib/email/safe-fetch.ts`), rewires `fetchListingFacts` through it, and adds a new
`pasted-link-comp.ts` module that is a structural twin of `compHelper` (cheap gate → guarded
fetch → `needs[]` on any failure, never a guess). `compForConversation` becomes the single
seam that both increments plug into.

**Tech Stack:** TypeScript, Next.js App Router, `bun:test`, `node:dns/promises`.

**Spec:** `docs/superpowers/specs/2026-07-01-comp-helper-remaining-design.md`

## Global Constraints

- Lee = county FIPS `12071`, Collier = `12021`. Every footprint check compares against these two
  literals — no other county passes.
- Never surface the string `"SteadyAPI"` anywhere a model or a citation could echo it.
- Increment 3 network fetch fires ONLY when `allowFetch`/`deps.allowPastedFetch` is explicitly
  `true`. Default `false`. No ambient flag, no third caller can "forget" the gate.
- Every failure mode (fetch not permitted / fetch failed / no price / zip missing / zip outside
  Lee-Collier) resolves to a `needs[]` ask string — never a guess, never a silent no-op with no
  explanation.
- `safeListingUrl` is https-only; rejects `localhost` / `*.local` / single-label hosts; then
  DNS-resolves the hostname and rejects if ANY resolved address is private/reserved.
- `safeFetchPublicUrl` fetches with `redirect:"manual"` and rejects any 3xx response outright
  (never follows a redirect hop). **Empirically confirmed** (this session, both Node's native
  fetch/undici and Bun's fetch): `redirect:"manual"` returns the real 3xx status code directly —
  it is NOT an opaque `status:0` response in this runtime, so `res.status >= 300 && res.status <
  400` is a reliable check here.
- `dns.lookup(ipLiteral, {all:true})` returns the literal synchronously with no network I/O —
  **empirically confirmed** this session for both `127.0.0.1` and `8.8.8.8` (2ms). Tests exploit
  this: IP-literal hosts exercise the guard fully offline with zero mocking.
- The comps chart is comps-only — no subject/median bar. `buildCompsChartSpec` returns `null`
  below 2 priced comps (2-bar minimum-informative threshold, matching the rest of the codebase).
- Verify every task with `bunx next build` (not bare `tsc`) per project convention — Vercel's
  build catches things local `tsc` misses.
- `mock.module(...)` is process-global in this codebase's `bun:test` setup (no per-file
  isolation) — every new/edited test file that uses it follows the established snapshot +
  `afterAll` restore pattern (see `lib/reso/pull-zip-stats.test.ts` for precedent).

---

## Task 1: `buildCompsChartSpec` — the comps bar chart (Increment 2 core)

**Files:**
- 🔴 Modify: `lib/assistant/comp-helper.ts`
- Test: `lib/assistant/comp-helper.test.ts`

**Interfaces:**
- Consumes: `CompResult`, `RenderComp`, `PriceKind` (already defined in this file).
- Produces: `export function buildCompsChartSpec(result: CompResult): ChartSpec | null` and
  `export function fmtMDY(d: Date): string` (existing private function, now exported) — Task 5
  consumes both.

- [ ] **Step 1: Write the failing tests**

Add to `lib/assistant/comp-helper.test.ts`. First add `buildCompsChartSpec` to the existing
import line at the top of the file:

```ts
import {
  looksLikeCompAsk,
  extractAddress,
  compHelper,
  renderCompBlock,
  compSources,
  buildCompsChartSpec,
  type CompDeps,
  type CompResult,
} from "./comp-helper";
```

Then append this block at the end of the file:

```ts
describe("buildCompsChartSpec — the comps bar chart (comps-only, no subject bar)", () => {
  const baseResult: CompResult = {
    asOf: "06/30/2026",
    matchedAddress: "Cape Coral",
    needs: [],
    comps: [
      {
        addressLine: "100 A St",
        city: "Cape Coral",
        beds: 3,
        baths: 2,
        sqft: 1500,
        status: "sold",
        price: 400000,
        priceKind: "sold",
        priceDate: "2026-05-12",
      },
      {
        addressLine: "200 B St",
        city: "Cape Coral",
        beds: 3,
        baths: 2,
        sqft: 1600,
        status: "active",
        price: 450000,
        priceKind: "last_list",
        priceDate: null,
      },
      {
        addressLine: "300 C St",
        city: "Cape Coral",
        beds: 3,
        baths: 2,
        sqft: 1550,
        status: "off_market",
        price: 420000,
        priceKind: "estimate",
        priceDate: "2026-04-01",
      },
    ],
  };

  it("returns null when fewer than 2 comps carry a price", () => {
    expect(buildCompsChartSpec({ ...baseResult, comps: [baseResult.comps[0]] })).toBeNull();
    expect(
      buildCompsChartSpec({
        ...baseResult,
        comps: [
          { ...baseResult.comps[0], price: null },
          { ...baseResult.comps[1], price: null },
        ],
      }),
    ).toBeNull();
  });

  it("sorts price-desc and suffixes labels honestly by priceKind", () => {
    const spec = buildCompsChartSpec(baseResult)!;
    expect(spec).not.toBeNull();
    expect(spec.rows.map((r) => r[0])).toEqual([
      "200 B St (list)", // 450000 — highest
      "300 C St (est.)", // 420000
      "100 A St", // 400000 — sold, no suffix
    ]);
    expect(spec.rows.map((r) => r[1])).toEqual([450000, 420000, 400000]);
  });

  it("carries the correct title/columns/source/asOf conversion", () => {
    const spec = buildCompsChartSpec(baseResult)!;
    expect(spec.title).toBe("Nearby comparable prices near Cape Coral");
    expect(spec.columns).toEqual(["Property", "Price"]);
    expect(spec.value_format).toBe("usd");
    expect(spec.chart_type).toBe("bar");
    expect(spec.frameId).toBe("bar-table");
    expect(spec.asOf).toBe("2026-06-30"); // MM/DD/YYYY -> ISO
    expect(spec.source).toEqual({
      citation: "Nearby comps, SWFL Data Gulf + realtor.com",
      url: "https://www.realtor.com",
    });
  });

  it("falls back to a plain title when matchedAddress is absent", () => {
    const spec = buildCompsChartSpec({ ...baseResult, matchedAddress: undefined })!;
    expect(spec.title).toBe("Nearby comparable prices");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test lib/assistant/comp-helper.test.ts`
Expected: FAIL — `buildCompsChartSpec is not a function` / import error (not exported yet).

- [ ] **Step 3: Implement `buildCompsChartSpec`**

In `lib/assistant/comp-helper.ts`, add the `ChartSpec` type import near the top (after the
existing `WelcomeSource` import at line 23):

```ts
import type { WelcomeSource } from "@/lib/welcome/frames";
import type { ChartSpec } from "@/components/charts/registry/chart-spec";
```

Export the existing `fmtMDY` function (line 116) by adding `export`:

```ts
export function fmtMDY(d: Date): string {
```

Add `mdyToIso` right after the existing `isoToMDY` helper (after line 127):

```ts
/** "06/30/2026" -> "2026-06-30". Input is always CompResult.asOf, which is always
 *  well-formed MM/DD/YYYY (produced by fmtMDY) — no defensive validation needed. */
function mdyToIso(mdy: string): string {
  const [mm, dd, yyyy] = mdy.split("/");
  return `${yyyy}-${mm}-${dd}`;
}
```

Add `buildCompsChartSpec` at the end of the file, after `compSources` (after line 316):

```ts

/** The honesty suffix so an estimate/last-list price can never look like a sale on the
 *  chart — bar-mode rendering (adaptToHBar) reads only columns[0]/columns[1], so the
 *  label suffix is the only place this distinction survives into the bar view. */
function priceKindSuffix(k: PriceKind): string {
  if (k === "estimate") return " (est.)";
  if (k === "last_list") return " (list)";
  return "";
}

/**
 * Comps-only bar chart (no subject/median bar — buildCompsSpec's subject-bar shape
 * doesn't apply here: the geocoded comp-helper subject has no price to anchor it, and
 * labeling an area median "(Subject)" would misrepresent an aggregate as this
 * property's valuation). Filters to priced comps; null under the 2-bar minimum.
 */
export function buildCompsChartSpec(result: CompResult): ChartSpec | null {
  const priced = result.comps.filter((c) => c.price != null);
  if (priced.length < 2) return null;

  const sorted = [...priced].sort((a, b) => (b.price as number) - (a.price as number));
  const rows: (string | number | null)[][] = sorted.map((c) => [
    `${c.addressLine}${priceKindSuffix(c.priceKind)}`,
    c.price as number,
  ]);

  const title = result.matchedAddress
    ? `Nearby comparable prices near ${result.matchedAddress}`
    : "Nearby comparable prices";

  return {
    frameId: "bar-table",
    title,
    columns: ["Property", "Price"],
    rows,
    value_format: "usd",
    chart_type: "bar",
    asOf: mdyToIso(result.asOf),
    source: {
      citation: "Nearby comps, SWFL Data Gulf + realtor.com",
      url: "https://www.realtor.com",
    },
  } as ChartSpec;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/assistant/comp-helper.test.ts`
Expected: PASS (all existing + new tests).

- [ ] **Step 5: Commit**

```bash
git add lib/assistant/comp-helper.ts lib/assistant/comp-helper.test.ts
git commit -m "feat(comp-helper): add buildCompsChartSpec — the comps bar chart (Increment 2)"
```

---

## Task 2: `lib/email/safe-fetch.ts` — the real-SSRF-safe fetch guard

**Files:**
- Create: `lib/email/safe-fetch.ts`
- Test: `lib/email/safe-fetch.test.ts`

**Interfaces:**
- Produces: `isPrivateOrReservedIp(address: string): boolean`,
  `safeListingUrl(rawUrl: string, lookupFn?: (hostname: string) => Promise<{address:string}[]>): Promise<URL | null>`,
  `safeFetchPublicUrl(rawUrl: string, opts?: {timeoutMs?: number; accept?: string}): Promise<Response | null>`
  — Task 3 and Task 4 consume `safeFetchPublicUrl`.
- Note on `lookupFn`: the spec sketch showed `safeListingUrl(rawUrl): Promise<URL|null>` with no
  second param. This plan adds an **optional** `lookupFn` (defaults to a thin wrapper around the
  real `node:dns/promises` `lookup`) purely as a test seam — it changes no observable behavior
  for any real caller (which never passes it) and avoids depending on `mock.module` working
  against a `node:` builtin (which has zero precedent in this codebase — every existing
  `mock.module` call targets an app/`@` or sibling module). IP-literal hosts (`127.0.0.1`,
  `8.8.8.8`) already exercise the real default `lookupFn` fully offline (dns.lookup resolves an
  IP literal synchronously, no network — empirically confirmed this session), so the DI seam is
  only needed for the "a domain name resolves to a private A-record" cases.

- [ ] **Step 1: Write the failing tests**

Create `lib/email/safe-fetch.test.ts`:

```ts
import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { isPrivateOrReservedIp, safeListingUrl, safeFetchPublicUrl } from "./safe-fetch";

describe("isPrivateOrReservedIp — pure table", () => {
  const cases: [string, boolean][] = [
    ["127.0.0.1", true], // loopback
    ["10.1.2.3", true], // RFC1918 10/8
    ["172.16.0.5", true], // RFC1918 172.16/12
    ["172.31.255.255", true], // RFC1918 172.16/12 upper bound
    ["192.168.1.1", true], // RFC1918 192.168/16
    ["169.254.169.254", true], // link-local — cloud metadata address
    ["169.254.0.1", true], // link-local
    ["100.64.0.1", true], // CGNAT
    ["100.127.255.255", true], // CGNAT upper bound
    ["0.0.0.1", true], // 0.0.0.0/8
    ["::1", true], // IPv6 loopback
    ["fc00::1", true], // IPv6 ULA
    ["fd12:3456::1", true], // IPv6 ULA
    ["fe80::1", true], // IPv6 link-local
    ["::ffff:127.0.0.1", true], // IPv4-mapped loopback
    ["8.8.8.8", false], // public
    ["93.184.216.34", false], // public
    ["2606:4700:4700::1111", false], // public IPv6
    ["172.32.0.1", false], // just outside 172.16/12
  ];
  for (const [address, expected] of cases) {
    test(`${address} -> ${expected}`, () => {
      expect(isPrivateOrReservedIp(address)).toBe(expected);
    });
  }
});

describe("safeListingUrl — https-only + DNS-resolved guard", () => {
  test("rejects http", async () => {
    expect(await safeListingUrl("http://example.com/listing")).toBeNull();
  });

  test("rejects localhost / .local / single-label hosts", async () => {
    expect(await safeListingUrl("https://localhost/x")).toBeNull();
    expect(await safeListingUrl("https://myhost.local/x")).toBeNull();
    expect(await safeListingUrl("https://intranet/x")).toBeNull();
  });

  test("rejects an IP-literal private host (real lookup, no mock — IP literals resolve locally)", async () => {
    expect(await safeListingUrl("https://127.0.0.1/listing")).toBeNull();
  });

  test("passes an IP-literal public host (real lookup, no mock)", async () => {
    const u = await safeListingUrl("https://8.8.8.8/listing");
    expect(u).not.toBeNull();
    expect(u!.hostname).toBe("8.8.8.8");
  });

  test("rejects a domain whose resolved A-record is private (injected lookup)", async () => {
    const u = await safeListingUrl("https://evil.example.com/listing", async () => [
      { address: "127.0.0.1" },
    ]);
    expect(u).toBeNull();
  });

  test("passes a domain whose resolved A-record is public (injected lookup)", async () => {
    const u = await safeListingUrl("https://good.example.com/listing", async () => [
      { address: "93.184.216.34" },
    ]);
    expect(u).not.toBeNull();
    expect(u!.hostname).toBe("good.example.com");
  });

  test("rejects when ANY resolved address is private (multi-A-record host)", async () => {
    const u = await safeListingUrl("https://mixed.example.com/listing", async () => [
      { address: "93.184.216.34" },
      { address: "169.254.169.254" },
    ]);
    expect(u).toBeNull();
  });
});

describe("safeFetchPublicUrl — manual redirect, rejects any 3xx outright", () => {
  let fetchSpy: ReturnType<typeof spyOn>;
  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  test("rejects a 3xx response outright and never follows it", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(null, { status: 302, headers: { location: "https://169.254.169.254/" } }),
    );
    const res = await safeFetchPublicUrl("https://8.8.8.8/listing");
    expect(res).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1); // the redirect target is never fetched
  });

  test("passes a 200 response through", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response("<html>ok</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    const res = await safeFetchPublicUrl("https://8.8.8.8/listing");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(await res!.text()).toBe("<html>ok</html>");
  });

  test("returns null and never calls fetch when the guard rejects first (bad protocol)", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("should never be called");
    });
    const res = await safeFetchPublicUrl("http://not-https.example.com/listing");
    expect(res).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test lib/email/safe-fetch.test.ts`
Expected: FAIL — `Cannot find module './safe-fetch'` (module doesn't exist yet).

- [ ] **Step 3: Implement `lib/email/safe-fetch.ts`**

```ts
// lib/email/safe-fetch.ts
//
// Real-SSRF-safe fetch for user-supplied listing URLs. isSafePublicUrl (og-image.ts)
// only pattern-matches the initial hostname — a domain whose A-record resolves to a
// private IP passes it, and it doesn't re-check on redirect, so a later 302 to
// 169.254.169.254 (cloud metadata) or 127.0.0.1 gets followed anyway under
// redirect:"follow". This module closes both gaps: resolve-then-check the DNS answer,
// and reject any redirect outright rather than following it.
import { lookup } from "node:dns/promises";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const DEFAULT_TIMEOUT_MS = 9000;

/** Pure: true when `address` (IPv4, IPv6, or an IPv4-mapped IPv6 literal) is loopback,
 *  RFC1918 private, link-local (incl. the 169.254.169.254 cloud metadata address),
 *  CGNAT, 0.0.0.0/8, or an IPv6 ULA/link-local range. */
export function isPrivateOrReservedIp(address: string): boolean {
  const a = address.toLowerCase().trim();
  const v4 = a.startsWith("::ffff:") ? a.slice(7) : a;

  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(v4)) {
    const octets = v4.split(".").map(Number);
    if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return true; // malformed -> unsafe
    const [o1, o2] = octets;
    if (o1 === 127) return true; // 127.0.0.0/8 loopback
    if (o1 === 10) return true; // 10.0.0.0/8
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true; // 172.16.0.0/12
    if (o1 === 192 && o2 === 168) return true; // 192.168.0.0/16
    if (o1 === 169 && o2 === 254) return true; // 169.254.0.0/16 (incl. cloud metadata)
    if (o1 === 100 && o2 >= 64 && o2 <= 127) return true; // 100.64.0.0/10 CGNAT
    if (o1 === 0) return true; // 0.0.0.0/8
    return false;
  }

  if (a === "::1") return true; // IPv6 loopback
  if (/^fe[89ab][0-9a-f]:/.test(a)) return true; // fe80::/10 link-local
  if (/^f[cd][0-9a-f]{2}:/.test(a)) return true; // fc00::/7 ULA
  return false;
}

/** DNS-resolved addresses for one hostname — the shape safeListingUrl needs, decoupled
 *  from node:dns's overloaded typings so a test can inject a fake without fighting them. */
type LookupAllFn = (hostname: string) => Promise<{ address: string }[]>;

/**
 * https-only; rejects localhost/.local/single-label hosts (same posture as og-image.ts's
 * isSafePublicUrl); then resolves the hostname and rejects if ANY resolved address is
 * private/reserved — the piece a hostname-pattern check alone misses (a domain whose
 * A-record points at an internal IP passes pattern matching, fails this).
 */
export async function safeListingUrl(
  rawUrl: string,
  lookupFn: LookupAllFn = (h) => lookup(h, { all: true }),
): Promise<URL | null> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;

  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || !h.includes(".")) return null;

  let addrs: { address: string }[];
  try {
    addrs = await lookupFn(h);
  } catch {
    return null;
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateOrReservedIp(a.address))) return null;

  return u;
}

/**
 * Guarded fetch for a user-supplied listing URL. Fetches with redirect:"manual" and
 * rejects any 3xx response outright rather than following it — sidesteps re-validating
 * each redirect hop at the cost of not following a legitimate redirecting listing URL
 * (documented trade-off: most pasted listing URLs are already the final resolved URL).
 * Residual risk, deliberately deferred: full DNS-rebinding connection pinning (so a
 * second DNS lookup at connect time can't return a different, private address) is not
 * built — the DNS-resolve check above closes the practical gap (a malicious host
 * record); the TOCTOU race against the runtime's own connection-time resolution is a
 * much smaller residual window. NEVER throws — null on any guard/network failure.
 */
export async function safeFetchPublicUrl(
  rawUrl: string,
  opts: { timeoutMs?: number; accept?: string } = {},
): Promise<Response | null> {
  const u = await safeListingUrl(rawUrl);
  if (!u) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(u.toString(), {
      method: "GET",
      redirect: "manual",
      signal: ctrl.signal,
      headers: { "user-agent": BROWSER_UA, accept: opts.accept ?? "text/html,*/*" },
    });
    if (res.status >= 300 && res.status < 400) return null; // never follow a redirect hop
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/email/safe-fetch.test.ts`
Expected: PASS (all tests, fully offline — no real network calls: IP literals resolve
locally, `fetch` is spied for the 3xx/200 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/email/safe-fetch.ts lib/email/safe-fetch.test.ts
git commit -m "feat(safe-fetch): add real-SSRF-safe fetch guard (DNS-resolve + reject-any-redirect)"
```

---

## Task 3: Wire `fetchListingFacts` through the guard

**Files:**
- Modify: `lib/email/listing-scrape.ts`
- Modify: `lib/email/build-doc-listing.test.ts` (fixes a live landmine this change would
  otherwise introduce — see note below)
- Test: `lib/email/listing-scrape.test.ts` (extend)

**Interfaces:**
- Consumes: `safeFetchPublicUrl` from Task 2.
- Produces: `fetchListingFacts` keeps its exact existing signature
  `(url: string) => Promise<ListingFacts | null>` — no caller changes needed anywhere else.

**Landmine found while researching this task (RULE 0.5 — read the actual code, not
memory):** `lib/email/build-doc-listing.test.ts` calls the real `buildContentDoc` →
`fetchListingFacts` cascade and mocks it "offline" by raw-mutating `globalThis.fetch`.
After this task's change, `fetchListingFacts` calls `safeFetchPublicUrl`, which calls
`safeListingUrl`, which does a REAL `dns.lookup("www.beach-homes.com")` — a live DNS
call this test does not currently make and does not mock. Left unfixed, this task would
silently turn a claimed-offline test into a network-dependent one. Fixed as part of this
task by mocking `@/lib/email/safe-fetch` (an app module — the well-precedented
`mock.module` pattern already used throughout this codebase) instead of raw
`globalThis.fetch`.

- [ ] **Step 1: Write the failing tests**

Replace the top of `lib/email/listing-scrape.test.ts` (through line 14, keeping the
existing `parseListingFacts` test body unchanged) with:

```ts
import { test, expect, mock, afterAll, spyOn, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as realSafeFetch from "@/lib/email/safe-fetch";

// mock.module is process-global (no per-file isolation) — snapshot + restore, same
// pattern as lib/reso/pull-zip-stats.test.ts.
const safeFetchOrig = { ...realSafeFetch };
afterAll(() => {
  mock.module("@/lib/email/safe-fetch", () => safeFetchOrig);
});

const mockSafeFetch = mock(async (_url: string, _opts?: unknown): Promise<Response | null> => null);
mock.module("@/lib/email/safe-fetch", () => ({ safeFetchPublicUrl: mockSafeFetch }));

const { parseListingFacts, fetchListingFacts } = await import("./listing-scrape");

afterEach(() => {
  mockSafeFetch.mockReset();
});

// Deterministic fixture: the REAL Hickory Blvd page, captured via a plain Node
// fetch (the production scrape path), saved under __fixtures__. No live network
// in CI — the parser is pure over saved HTML.
const URL_HICKORY =
  "https://www.beach-homes.com/florida/bonita-springs/27804-hickory-blvd-bonita-springs-fl-34134-lhrmls-03646837";
const html = readFileSync(
  join(import.meta.dir, "__fixtures__", "listing-hickory-blvd.html"),
  "utf8",
);

test("parseListingFacts pulls the real specs from the structured data island", () => {
  const f = parseListingFacts(html, URL_HICKORY);
  expect(f.price).toBe("$20,895,000");
  expect(f.beds).toBe("5");
  expect(f.baths).toBe("7");
  expect(f.sqft).toBe("7453");
  expect(f.lotSize).toBe("0.692");
  expect(f.yearBuilt).toMatch(/^20\d\d$/);
  expect(f.propertyType).toMatch(/single family/i);
  expect(f.city).toBe("BONITA SPRINGS");
  expect(f.state).toBe("FL");
  expect(f.zip).toBe("34134");
  expect(f.sourceUrl).toBe(URL_HICKORY);
});

test("fetchListingFacts routes its primary fetch through the SSRF guard, never raw fetch", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("fetchListingFacts must never call raw fetch directly");
  });
  mockSafeFetch.mockImplementation(
    async () =>
      new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
  );
  const out = await fetchListingFacts(URL_HICKORY);
  expect(mockSafeFetch).toHaveBeenCalledTimes(1);
  expect(mockSafeFetch).toHaveBeenCalledWith(URL_HICKORY, expect.anything());
  expect(out?.price).toBe("$20,895,000"); // the guard-passed page still parses correctly
  fetchSpy.mockRestore();
});

test("fetchListingFacts returns null (fail-safe) when the SSRF guard rejects the url", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("fetchListingFacts must never call raw fetch directly");
  });
  mockSafeFetch.mockImplementation(async () => null);
  const out = await fetchListingFacts("https://evil.example.com/listing");
  expect(out).toBeNull();
  fetchSpy.mockRestore();
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `bun test lib/email/listing-scrape.test.ts`
Expected: the existing `parseListingFacts` test PASSes unchanged. The new
`"routes its primary fetch through the SSRF guard"` test FAILs —
`mockSafeFetch` was called 0 times (current code still calls raw `fetch` directly,
which the `fetchSpy` throws on, so `fetchListingFacts` catches the throw and returns
null without ever touching `mockSafeFetch`).

- [ ] **Step 3: Wire `fetchListingFacts` to the guard**

In `lib/email/listing-scrape.ts`, add the import near the top (after the `fetchOgImage`
import at line 18):

```ts
import { fetchOgImage } from "./og-image";
import { safeFetchPublicUrl } from "./safe-fetch";
```

Remove the now-unused `BROWSER_UA` constant (lines 398-399) — it moved into
`safe-fetch.ts`. Replace the whole `fetchListingFacts` function (lines 403-445) with:

```ts
const FETCH_TIMEOUT_MS = 9000;
const MAX_HTML_BYTES = 2_000_000;

/** Best-effort: fetch a listing URL (through the SSRF-safe guard) and parse its facts.
 *  Falls back to the og:image hero when the page has no inline photos. NEVER throws —
 *  returns null on any guard-reject/block/failure so the build degrades, never crashes. */
export async function fetchListingFacts(url: string): Promise<ListingFacts | null> {
  try {
    const res = await safeFetchPublicUrl(url, { timeoutMs: FETCH_TIMEOUT_MS });
    if (!res || !res.ok) return null;
    if (!(res.headers.get("content-type") ?? "").includes("html")) return null;
    const html = (await res.text()).slice(0, MAX_HTML_BYTES);

    // CASCADE — deterministic tiers first (numbers from code, never invented):
    //   Tier 1 island → Tier 2 schema.org JSON-LD (merged, island wins on conflict).
    let facts = mergeFacts(parseListingFacts(html, url), parseJsonLdFacts(html, url));

    // Tier 3 (text + LLM) — ONLY when a core spec is still missing, so structured
    // pages cost nothing. The LLM reads the page text; it fills gaps and can never
    // override a deterministic value (mergeFacts: existing facts win).
    const coreMissing = !facts.price || !facts.beds || !facts.baths || !facts.sqft;
    if (coreMissing && process.env.ANTHROPIC_API_KEY) {
      const llm = await llmExtractFacts(html, url).catch(() => null);
      if (llm) facts = mergeFacts(facts, llm);
    }

    if (facts.photos.length === 0) {
      const og = await fetchOgImage(url).catch(() => null);
      if (og?.image) facts.photos.push(og.image);
    }
    // Usable only if we got at least one real fact — else the caller keeps the
    // newsletter path rather than building a flyer from nothing.
    const hasFact = Boolean(facts.price || facts.beds || facts.sqft || facts.remarks);
    return hasFact ? facts : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Fix the `build-doc-listing.test.ts` landmine**

Replace the entire contents of `lib/email/build-doc-listing.test.ts`:

```ts
import { test, expect, mock, afterAll } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as realSafeFetch from "@/lib/email/safe-fetch";

const html = readFileSync(
  join(import.meta.dir, "__fixtures__", "listing-hickory-blvd.html"),
  "utf8",
);
const HICKORY =
  "https://www.beach-homes.com/florida/bonita-springs/27804-hickory-blvd-bonita-springs-fl-34134-lhrmls-03646837";

// mock.module is process-global (no per-file isolation) — snapshot + restore, same
// pattern as lib/reso/pull-zip-stats.test.ts. Stubs the SSRF-guarded fetch (not raw
// global fetch, which fetchListingFacts no longer calls directly) so this test stays
// fully offline through the real guarded call path.
const safeFetchOrig = { ...realSafeFetch };
afterAll(() => {
  mock.module("@/lib/email/safe-fetch", () => safeFetchOrig);
});
mock.module("@/lib/email/safe-fetch", () => ({
  safeFetchPublicUrl: async () =>
    new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
}));

const { buildContentDoc } = await import("./build-doc");
const { SEED_DOCS } = await import("./doc/default-docs");

test("buildContentDoc replaces the canvas with a property flyer for a listing prompt", async () => {
  const current = SEED_DOCS.find((s) => s.id === "market-spotlight")!.build();
  const res = await buildContentDoc({
    prompt: `JUST GOT THIS LISTING. Build me an email describing it for my clients. ${HICKORY}`,
    rawDoc: current,
  });

  expect(res.payload.applied).toBe(true);
  expect(res.payload.replacedLayout).toBe(true);

  const doc = res.payload.doc as {
    blocks: Array<{ type: string; props: Record<string, unknown> }>;
  };
  const hero = doc.blocks.find((b) => b.type === "hero");
  expect(hero?.props.value).toBe("$20,895,000");
  const stats = doc.blocks.find((b) => b.type === "stats");
  expect((stats?.props.stats as Array<unknown>)?.[0]).toEqual({ value: "5", label: "Beds" });
  const text = doc.blocks.find((b) => b.type === "text");
  expect(String(text?.props.body ?? "")).toContain("become the view");
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test lib/email/listing-scrape.test.ts lib/email/build-doc-listing.test.ts`
Expected: PASS — all tests in both files, fully offline (no real DNS/network calls).

- [ ] **Step 6: Commit**

```bash
git add lib/email/listing-scrape.ts lib/email/listing-scrape.test.ts lib/email/build-doc-listing.test.ts
git commit -m "fix(listing-scrape): route fetchListingFacts through the SSRF-safe guard (closes a live zero-guard gap)"
```

---

## Task 4: `lib/assistant/pasted-link-comp.ts` — the pasted-link lane (Increment 3 core)

**Files:**
- 🔴 Modify: `lib/assistant/comp-helper.ts` (extend `CompDeps`)
- Create: `lib/assistant/pasted-link-comp.ts`
- Test: `lib/assistant/pasted-link-comp.test.ts`

**Interfaces:**
- Consumes: `CompDeps`, `RenderComp`, `PriceKind` from `comp-helper.ts` (Task 1);
  `fetchListingFacts`, `ListingFacts` from `lib/email/listing-scrape.ts` (Task 3, now
  guarded); `extractUrls` from `lib/email/og-image.ts`; `looksLikeCompAsk` from
  `comp-helper.ts`; `hostOf` from `lib/assistant/web-fallback.ts`; `resolveZip` from
  `refinery/lib/zip-resolver.mts`; `WelcomeSource` from `lib/welcome/frames.ts`.
- Produces: `looksLikePastedListingLink(question: string): boolean`,
  `pastedLinkComp(question: string, allowFetch: boolean, deps?: CompDeps): Promise<{comp: RenderComp | null; source: WelcomeSource | null; needs: string[]}>`
  — Task 5 consumes both.

- [ ] **Step 1: Extend `CompDeps` in `lib/assistant/comp-helper.ts`**

Add the `ListingFacts` type import (after the `ChartSpec` import added in Task 1):

```ts
import type { ChartSpec } from "@/components/charts/registry/chart-spec";
import type { ListingFacts } from "@/lib/email/listing-scrape";
```

Extend the `CompDeps` interface (currently lines 53-68) — add two fields at the end,
right before the closing brace:

```ts
export interface CompDeps {
  geocode?: (text: string) => Promise<GeocodedAddress | null>;
  fetchNearby?: (opts: {
    lat: number;
    lon: number;
    status?: string;
    limit?: number;
  }) => Promise<NearbyComp[]>;
  fetchSold?: (propertyId: string) => Promise<SoldEvent | null>;
  /** Injectable clock so `asOf` is deterministic in tests. */
  now?: Date;
  /** How many comps to surface (default 6). */
  topN?: number;
  /** How many sold comps to enrich with an exact sale (hard-capped at 2 → ≤3 calls). */
  enrichN?: number;
  /** Increment 3: fetch-free by construction. The pasted-link lane makes a live fetch
   *  ONLY when this is true. The caller resolves it from `analyst` (never an ambient
   *  flag), so public /welcome and every existing test stay fetch-free by default. */
  allowPastedFetch?: boolean;
  /** Injectable fetch for the pasted-link lane. Defaults to `fetchListingFacts`, which
   *  is already SSRF-guarded via `safeFetchPublicUrl`. */
  fetchPastedFacts?: (url: string) => Promise<ListingFacts | null>;
}
```

Run: `bun test lib/assistant/comp-helper.test.ts` — Expected: still PASS (additive,
optional fields, no behavior change).

- [ ] **Step 2: Write the failing tests**

Create `lib/assistant/pasted-link-comp.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { looksLikePastedListingLink, pastedLinkComp } from "./pasted-link-comp";
import type { ListingFacts } from "@/lib/email/listing-scrape";

const LINK = "https://www.beach-homes.com/florida/cape-coral/123-palm-dr";

function facts(over: Partial<ListingFacts> = {}): ListingFacts {
  return {
    address: "123 Palm Dr, Cape Coral, FL 33914",
    city: "Cape Coral",
    state: "FL",
    zip: "33914",
    price: "$650,000",
    beds: "3",
    baths: "2",
    sqft: "1900",
    photos: [],
    sourceUrl: LINK,
    ...over,
  };
}

describe("looksLikePastedListingLink — comp-ish wording + a pasted URL", () => {
  it("fires when a comp ask carries a link", () => {
    expect(looksLikePastedListingLink(`what are comps for ${LINK}`)).toBe(true);
    expect(looksLikePastedListingLink(`pull comparables for ${LINK} please`)).toBe(true);
  });
  it("stays quiet on a bare link with no comp-ish wording", () => {
    expect(looksLikePastedListingLink(LINK)).toBe(false);
  });
  it("stays quiet on comp-ish wording with no link", () => {
    expect(looksLikePastedListingLink("what are comps near 3412 Atlantic Circle")).toBe(false);
  });
});

describe("pastedLinkComp — gate order (fetch-free by construction)", () => {
  it("no-ops on a non-pasted-link ask (caller falls through)", async () => {
    const out = await pastedLinkComp("what's driving prices?", true, {});
    expect(out).toEqual({ comp: null, source: null, needs: [] });
  });

  it("asks to type it in instead — and NEVER calls the injected fetch — when allowFetch is false", async () => {
    let calls = 0;
    const out = await pastedLinkComp(`what are comps for ${LINK}`, false, {
      fetchPastedFacts: async () => {
        calls++;
        return facts();
      },
    });
    expect(calls).toBe(0);
    expect(out.comp).toBeNull();
    expect(out.needs).toEqual([
      "I can't open links directly here — reply with the address and price and I'll add it as a comp.",
    ]);
  });

  it("asks to type it in when the fetch returns nothing", async () => {
    const out = await pastedLinkComp(`what are comps for ${LINK}`, true, {
      fetchPastedFacts: async () => null,
    });
    expect(out.comp).toBeNull();
    expect(out.needs[0]).toContain("couldn't read that link");
  });

  it("asks to type it in when the fetch returns no price", async () => {
    const out = await pastedLinkComp(`what are comps for ${LINK}`, true, {
      fetchPastedFacts: async () => facts({ price: undefined }),
    });
    expect(out.comp).toBeNull();
    expect(out.needs[0]).toContain("couldn't read that link");
  });

  it("asks the footprint question when the zip is out of Lee/Collier", async () => {
    const out = await pastedLinkComp(`what are comps for ${LINK}`, true, {
      fetchPastedFacts: async () => facts({ zip: "33101" }), // Miami-Dade — outside the fixture
    });
    expect(out.comp).toBeNull();
    expect(out.needs[0]).toContain("Lee or Collier");
  });

  it("asks the footprint question when the fetch returned no zip at all", async () => {
    const out = await pastedLinkComp(`what are comps for ${LINK}`, true, {
      fetchPastedFacts: async () => facts({ zip: undefined }),
    });
    expect(out.comp).toBeNull();
    expect(out.needs[0]).toContain("Lee or Collier");
  });

  it("builds one RenderComp + a homepage-only source for a valid Lee/Collier listing", async () => {
    const out = await pastedLinkComp(`what are comps for ${LINK}`, true, {
      fetchPastedFacts: async () => facts(),
    });
    expect(out.needs).toEqual([]);
    expect(out.comp).toEqual({
      addressLine: "123 Palm Dr, Cape Coral, FL 33914",
      city: "Cape Coral",
      beds: 3,
      baths: 2,
      sqft: 1900,
      status: "active",
      price: 650000,
      priceKind: "last_list",
      priceDate: null,
    });
    expect(out.source).toEqual({
      label: "beach-homes.com",
      domain: "beach-homes.com",
      url: "https://www.beach-homes.com",
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test lib/assistant/pasted-link-comp.test.ts`
Expected: FAIL — `Cannot find module './pasted-link-comp'` (module doesn't exist yet).

- [ ] **Step 4: Implement `lib/assistant/pasted-link-comp.ts`**

```ts
// lib/assistant/pasted-link-comp.ts
//
// Increment 3 of the on-demand comp helper: a user who pastes a listing link in an
// authenticated conversation gets that property folded in as one cited comp. Gated to
// analyst (authenticated) users — `allowFetch` is threaded in by the caller from
// `analyst`, never read from an ambient flag, so the guard can't be silently bypassed
// by a future caller. Every failure mode (fetch not permitted / fetch failed / no price
// / zip missing / zip outside Lee-Collier) resolves to a needs[] ask, never a guess —
// the same no-invention floor as compHelper.
import { looksLikeCompAsk } from "./comp-helper";
import type { CompDeps, PriceKind, RenderComp } from "./comp-helper";
import { extractUrls } from "@/lib/email/og-image";
import { fetchListingFacts, type ListingFacts } from "@/lib/email/listing-scrape";
import { hostOf } from "@/lib/assistant/web-fallback";
import { resolveZip } from "@/refinery/lib/zip-resolver.mts";
import type { WelcomeSource } from "@/lib/welcome/frames";

const CANT_OPEN =
  "I can't open links directly here — reply with the address and price and I'll add it as a comp.";
const COULDNT_READ =
  "I couldn't read that link — reply with the address and price and I'll add it as a comp.";
const OUT_OF_FOOTPRINT =
  "I couldn't confirm that's a Lee or Collier property with a price — reply with the address and price and I'll add it as a comp.";

/** Cheap gate: comp-ish wording (looksLikeCompAsk) AND at least one pasted URL. A bare
 *  link with no comp-ish wording does not trigger this lane in v1 (documented
 *  limitation — the message still gets a normal answer, never a silent drop). */
export function looksLikePastedListingLink(question: string): boolean {
  return looksLikeCompAsk(question) && extractUrls(question).length > 0;
}

/** "$650,000" / "3" -> a number; undefined/unparseable -> null. Never invents a value. */
function numOrNull(s: string | undefined): number | null {
  if (!s) return null;
  const digits = s.replace(/[^0-9.]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

/** The one WelcomeSource this lane ever emits: the listing site's homepage, never the
 *  pasted permalink. `domain` (www-stripped) mirrors compSources()'s label convention;
 *  `url` keeps the page's real hostname verbatim (may or may not carry "www"). */
function homepageSource(sourceUrl: string): WelcomeSource {
  const u = new URL(sourceUrl);
  const domain = hostOf(sourceUrl);
  return { label: domain, domain, url: `${u.protocol}//${u.hostname}` };
}

/** A scraped listing page price is a current ask, never a confirmed sale — always
 *  priceKind:"last_list", never a sold price. */
function toRenderComp(facts: ListingFacts): RenderComp {
  const priceKind: PriceKind = "last_list";
  return {
    addressLine: facts.address ?? facts.city ?? "",
    city: facts.city ?? "",
    beds: numOrNull(facts.beds),
    baths: numOrNull(facts.baths),
    sqft: numOrNull(facts.sqft),
    status: "active",
    price: numOrNull(facts.price),
    priceKind,
    priceDate: null,
  };
}

export interface PastedLinkResult {
  comp: RenderComp | null;
  source: WelcomeSource | null;
  needs: string[];
}

/**
 * Run the pasted-link comp lane for one question. Fetch-free by construction unless
 * `allowFetch` is true (the caller resolves this from `analyst`) — a public/
 * unauthenticated caller can never trigger a network call, even if this function is
 * reached by mistake. Never throws.
 */
export async function pastedLinkComp(
  question: string,
  allowFetch: boolean,
  deps: CompDeps = {},
): Promise<PastedLinkResult> {
  const none = (needs: string[] = []): PastedLinkResult => ({ comp: null, source: null, needs });

  if (!looksLikePastedListingLink(question)) return none();
  if (!allowFetch) return none([CANT_OPEN]);

  const [url] = extractUrls(question);
  const fetchFacts = deps.fetchPastedFacts ?? fetchListingFacts;
  const facts = await fetchFacts(url);
  if (!facts || !facts.price) return none([COULDNT_READ]);

  if (!facts.zip) return none([OUT_OF_FOOTPRINT]);
  const county = resolveZip(facts.zip).primary_county;
  if (county !== "12071" && county !== "12021") return none([OUT_OF_FOOTPRINT]);

  return { comp: toRenderComp(facts), source: homepageSource(facts.sourceUrl), needs: [] };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test lib/assistant/pasted-link-comp.test.ts`
Expected: PASS (all tests, fully offline — `resolveZip` is a pure lookup over a static
fixture, no network anywhere in this file).

- [ ] **Step 6: Commit**

```bash
git add lib/assistant/comp-helper.ts lib/assistant/pasted-link-comp.ts lib/assistant/pasted-link-comp.test.ts
git commit -m "feat(pasted-link-comp): add the authenticated pasted-listing-link lane (Increment 3)"
```

---

## Task 5: Wire `compForConversation` — combine both increments

**Files:**
- Modify: `lib/assistant/conversation-path.ts`
- Test: `lib/assistant/comp-for-conversation.test.ts` (extend)

**Interfaces:**
- Consumes: `buildCompsChartSpec`, `fmtMDY` (Task 1); `looksLikePastedListingLink`,
  `pastedLinkComp` (Task 4).
- Produces: `compForConversation`'s return type gains `chart?: ChartSpec`; the pasted-link
  branch takes precedence over the address/SteadyAPI branch when a link is present.

- [ ] **Step 1: Write the failing tests**

Add to `lib/assistant/comp-for-conversation.test.ts`. Append at the end of the file:

```ts
describe("compForConversation — pasted-link lane takes over when a link is present", () => {
  const pastedFacts = {
    address: "123 Palm Dr, Cape Coral, FL 33914",
    city: "Cape Coral",
    zip: "33914",
    price: "$650,000",
    beds: "3",
    baths: "2",
    sqft: "1900",
    photos: [] as string[],
    sourceUrl: "https://www.beach-homes.com/florida/cape-coral/123-palm-dr",
  };
  const LINK_MSG = `what are comps for ${pastedFacts.sourceUrl}`;

  it("selects the pasted-link branch over the address branch when a link is present and fetch is allowed", async () => {
    let fetchCalls = 0;
    const out = await compForConversation(LINK_MSG, {
      ...compDeps(),
      allowPastedFetch: true,
      fetchPastedFacts: async () => {
        fetchCalls++;
        return pastedFacts;
      },
    });
    expect(fetchCalls).toBe(1);
    expect(out.hit).toBe(true);
    expect(out.sources).toHaveLength(1);
    expect(out.sources[0].url).toBe("https://www.beach-homes.com");
    expect(out.sources[0].url).not.toContain("123-palm-dr"); // homepage only, never the permalink
    expect(out.block).toContain("last listed $650,000");
  });

  it("never invokes the injected fetch when allowPastedFetch is false (the public-path default)", async () => {
    let fetchCalls = 0;
    const out = await compForConversation(LINK_MSG, {
      ...compDeps(),
      fetchPastedFacts: async () => {
        fetchCalls++;
        return pastedFacts;
      },
    });
    expect(fetchCalls).toBe(0);
    expect(out.hit).toBe(true);
    expect(out.block.toLowerCase()).toContain("can't open links");
  });
});

describe("compForConversation — comps chart (Increment 2)", () => {
  it("populates chart when ≥2 priced comps come back from the address lane", async () => {
    const out = await compForConversation("comps near 1403 NE 19th Ter, Cape Coral", {
      ...compDeps(),
      fetchNearby: async () => [
        soldComp,
        { ...soldComp, propertyId: "M-2", addressLine: "1500 NE 20th Ter" },
      ],
    });
    expect(out.chart).toBeTruthy();
    expect(out.chart!.rows.length).toBeGreaterThanOrEqual(2);
  });

  it("leaves chart absent when fewer than 2 priced comps come back", async () => {
    const out = await compForConversation(
      "how much is 1403 NE 19th Ter, Cape Coral worth?",
      compDeps(),
    );
    expect(out.chart).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test lib/assistant/comp-for-conversation.test.ts`
Expected: FAIL — `compForConversation` doesn't yet know about `allowPastedFetch` /
`fetchPastedFacts` (pasted-link tests get the address-branch's "full street address"
needs-ask instead) and never sets `chart` (chart tests get `undefined` for both cases,
so the first chart test fails on `expect(out.chart).toBeTruthy()`).

- [ ] **Step 3: Wire `compForConversation` in `lib/assistant/conversation-path.ts`**

Update the import block (lines 50-56):

```ts
import {
  looksLikeCompAsk,
  compHelper,
  renderCompBlock,
  compSources,
  buildCompsChartSpec,
  fmtMDY,
  type CompDeps,
} from "@/lib/assistant/comp-helper";
import { looksLikePastedListingLink, pastedLinkComp } from "@/lib/assistant/pasted-link-comp";
import type { ChartSpec } from "@/components/charts/registry/chart-spec";
```

Replace the whole `compForConversation` function (lines 111-119):

```ts
export async function compForConversation(
  question: string,
  deps: CompDeps = {},
): Promise<{ block: string; sources: WelcomeSource[]; hit: boolean; chart?: ChartSpec }> {
  if (looksLikePastedListingLink(question)) {
    const { comp, source, needs } = await pastedLinkComp(
      question,
      deps.allowPastedFetch ?? false,
      deps,
    );
    const comps = comp ? [comp] : [];
    const result = { comps, asOf: fmtMDY(deps.now ?? new Date()), needs };
    const hit = comps.length > 0 || needs.length > 0;
    return { block: renderCompBlock(result), sources: source ? [source] : [], hit };
  }

  if (!looksLikeCompAsk(question)) return { block: "", sources: [], hit: false };
  const result = await compHelper(question, deps);
  const hit = result.comps.length > 0 || result.needs.length > 0;
  const chart = buildCompsChartSpec(result);
  return {
    block: renderCompBlock(result),
    sources: compSources(result),
    hit,
    ...(chart ? { chart } : {}),
  };
}
```

Update the first call site (the no-location region branch, currently at line 649):

```ts
    const comp = await compForConversation(lastUser, { allowPastedFetch: analyst });
    if (comp.chart) prelude.push({ type: "chart", chart: comp.chart });
    const { block: gapBlock, sources: gapSources } = comp.hit
      ? comp
      : await webFallbackForConversation(lastUser, system);
    if (gapSources.length) prelude.push({ type: "sources", sources: gapSources });
```

Update the second call site (the located branch, currently at line 737):

```ts
  const comp = await compForConversation(lastUser, { allowPastedFetch: analyst });
  if (comp.chart) prelude.push({ type: "chart", chart: comp.chart });
  const { block: gapBlock, sources: gapSources } = comp.hit
    ? comp
    : await webFallbackForConversation(lastUser, system);
  if (gapSources.length) prelude.push({ type: "sources", sources: gapSources });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/assistant/comp-for-conversation.test.ts lib/assistant/comp-helper.test.ts lib/assistant/pasted-link-comp.test.ts lib/assistant/conversation-path.test.ts`
Expected: PASS — all tests in all four files. `conversation-path.test.ts` is included
because it exercises `compForConversation` indirectly through the full route; none of
its fixture messages contain a URL or match `looksLikeCompAsk` (verified while
researching this plan), so its existing assertions are unaffected.

- [ ] **Step 5: Run the full offline suite + the project build gate**

Run: `bun test`
Expected: PASS — 0 failures across the whole suite (confirms no other file was affected
by the `mock.module` changes in Task 3).

Run: `bunx next build`
Expected: build succeeds — this is the project's real type-check bar (per project
convention, stricter than bare `tsc`).

- [ ] **Step 6: Commit**

```bash
git add lib/assistant/conversation-path.ts lib/assistant/comp-for-conversation.test.ts
git commit -m "feat(comp-helper): wire compForConversation — comps chart + pasted-link lane (Increments 2 & 3)"
```

---

## Self-Review Notes (for whoever executes this plan)

- **Spec coverage:** Increment 2 (chart) — Task 1 + Task 5. Increment 3 (pasted-link lane
  + the SSRF guard) — Tasks 2, 3, 4, 5. The "Out of scope" section of the spec
  (`fetchOgImage`'s weaker guard, DNS-rebinding pinning, combined address+link messages,
  public `/welcome` auto-fetch) is intentionally NOT built here — matches the spec.
- **Landmine, not scope creep:** the `build-doc-listing.test.ts` fix in Task 3 is not an
  extra feature — it is a direct, foreseeable consequence of swapping
  `fetchListingFacts`'s fetch call (confirmed by reading that test's mocking strategy),
  and shipping Task 3 without it would silently turn a claimed-offline test into a
  network-dependent one.
- **`lookupFn` DI seam on `safeListingUrl`:** the spec's sketch didn't show this second
  parameter. It was added after research showed this codebase's `mock.module` has zero
  precedent working against a `node:` builtin, and real IP-literal DNS lookups are
  empirically confirmed synchronous/local. The seam is optional, defaults to real
  behavior, and is invisible to every real caller (`safeFetchPublicUrl` never passes it).

---

## Parallel Safety

> Tasks sharing a color badge touch overlapping files and **cannot run in parallel**.

| Group | Tasks | Shared Files |
|-------|-------|--------------|
| 🔴 | Task 1, Task 4 | `lib/assistant/comp-helper.ts` |

Tasks with no color badge have no file conflicts — safe to parallelize freely.
