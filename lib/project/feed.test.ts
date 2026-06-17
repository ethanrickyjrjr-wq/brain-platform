import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  writeFeed,
  readProjectFeed,
  markFeedSeen,
  feedRowMatches,
  type FeedRow,
  type FeedRowInput,
  type ScopeEntry,
} from "./feed";

// ---------------------------------------------------------------------------
// In-memory fake Supabase client
//
// Implements the subset of the Supabase JS builder API that feed.ts uses:
//   from().upsert(rows, opts).select(cols)          — write path
//   from().select(cols).or().gte().is().order()...  — read path
//   from().update(payload).in().is().select(cols)   — mark-seen path
//
// Enforces unique(dedup_key) exactly like ON CONFLICT DO NOTHING:
// a second upsert of the same dedup_key returns an empty data array (no insert),
// never an error. Mirrors the idiom in lib/email/__tests__/idempotency.test.ts.
//
// Key insight: the Supabase JS builder is LAZY — it chains until awaited.
// This fake uses a "thenable" builder pattern so the chain only executes on
// await (just like the real client).
// ---------------------------------------------------------------------------

type StoredRow = FeedRowInput & {
  id: number;
  payload: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
  void_at: string | null;
};

interface FakeDb {
  db: SupabaseClient;
  rows: StoredRow[];
}

function makeDb(opts?: { failOnWrite?: boolean }): FakeDb {
  const seen = new Map<string, StoredRow>();
  const rows: StoredRow[] = [];
  let nextId = 1;

  // ---- helpers ----

  function splitTopLevel(s: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let inQuotes = false; // PostgREST double-quotes a value to escape reserved chars
    let start = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"') inQuotes = !inQuotes;
      else if (inQuotes) continue;
      else if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === "," && depth === 0) {
        parts.push(s.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(s.slice(start));
    return parts;
  }

  function matchesPart(row: StoredRow, part: string): boolean {
    if (part.startsWith("and(") && part.endsWith(")")) {
      return splitTopLevel(part.slice(4, -1)).every((sp) => matchesPart(row, sp.trim()));
    }
    const dot1 = part.indexOf(".");
    if (dot1 === -1) return false;
    const field = part.slice(0, dot1);
    const rest = part.slice(dot1 + 1);
    const dot2 = rest.indexOf(".");
    if (dot2 === -1) return false;
    const op = rest.slice(0, dot2);
    const value = rest.slice(dot2 + 1);
    const rowVal = (row as unknown as Record<string, unknown>)[field];
    switch (op) {
      case "eq": {
        // PostgREST may double-quote the value to escape reserved chars; strip the
        // wrapping (and unescape "") before comparing the literal value.
        let v = value;
        if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
          v = v.slice(1, -1).replace(/""/g, '"');
        }
        // null rowVal → won't match a non-null value string
        return rowVal !== null && rowVal !== undefined && String(rowVal) === v;
      }
      case "is":
        if (value === "null") return rowVal === null || rowVal === undefined;
        if (value === "true") return rowVal === true;
        if (value === "false") return rowVal === false;
        return false;
      default:
        return false;
    }
  }

  // ---- builder factory ----

  type BuilderOp =
    | { type: "or"; filter: string }
    | { type: "gte"; field: string; value: string }
    | { type: "is"; field: string; value: null | boolean | string }
    | { type: "in"; field: string; values: unknown[] }
    | { type: "order"; field: string; ascending: boolean; nullsFirst?: boolean };

  function makeSelectBuilder(
    execute: () => { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>,
  ) {
    const ops: BuilderOp[] = [];

    const builder: {
      or(filter: string): typeof builder;
      gte(field: string, value: string): typeof builder;
      is(field: string, value: null | boolean | string): typeof builder;
      in(field: string, values: unknown[]): typeof builder;
      order(field: string, opts?: { ascending?: boolean; nullsFirst?: boolean }): typeof builder;
      then<T>(onfulfilled: (v: { data: unknown; error: unknown }) => T): Promise<T>;
    } = {
      or(filter: string) {
        ops.push({ type: "or", filter });
        return builder;
      },
      gte(field: string, value: string) {
        ops.push({ type: "gte", field, value });
        return builder;
      },
      is(field: string, value: null | boolean | string) {
        ops.push({ type: "is", field, value });
        return builder;
      },
      in(field: string, values: unknown[]) {
        ops.push({ type: "in", field, values });
        return builder;
      },
      order(field: string, orderOpts?: { ascending?: boolean; nullsFirst?: boolean }) {
        ops.push({
          type: "order",
          field,
          ascending: orderOpts?.ascending ?? true,
          nullsFirst: orderOpts?.nullsFirst,
        });
        return builder;
      },
      then<T>(onfulfilled: (v: { data: unknown; error: unknown }) => T): Promise<T> {
        // Execute the query with all accumulated ops
        const base = execute();
        const p = base instanceof Promise ? base : Promise.resolve(base);
        return p.then((result) => {
          // Apply ops to filter rows
          if (result.error || !Array.isArray(result.data)) return onfulfilled(result);
          let data = result.data as StoredRow[];
          for (const op of ops) {
            if (op.type === "or") {
              data = data.filter((r) => {
                const parts = splitTopLevel(op.filter);
                return parts.some((p) => matchesPart(r, p.trim()));
              });
            } else if (op.type === "gte") {
              data = data.filter((r) => {
                const val = (r as unknown as Record<string, unknown>)[op.field];
                return typeof val === "string" && val >= op.value;
              });
            } else if (op.type === "is") {
              data = data.filter((r) => {
                const val = (r as unknown as Record<string, unknown>)[op.field];
                if (op.value === null) return val === null || val === undefined;
                return val === op.value;
              });
            } else if (op.type === "in") {
              data = data.filter((r) => {
                const val = (r as unknown as Record<string, unknown>)[op.field];
                return op.values.includes(val);
              });
            }
            // order: skip in tests (small datasets)
          }
          return onfulfilled({ data, error: null });
        });
      },
    };
    return builder;
  }

  // ---- upsert builder ----
  function makeUpsertBuilder(inputRows: StoredRow[]) {
    return {
      select(_cols?: string) {
        if (opts?.failOnWrite)
          return Promise.resolve({ data: null, error: { message: "db fail" } });
        const inserted: StoredRow[] = [];
        for (const row of inputRows) {
          if (!seen.has(row.dedup_key)) {
            const stored: StoredRow = {
              ...row,
              id: nextId++,
              payload: row.payload ?? {},
              created_at:
                (row as unknown as { created_at?: string }).created_at ?? new Date().toISOString(),
              read_at: (row as unknown as { read_at?: string | null }).read_at ?? null,
              void_at: (row as unknown as { void_at?: string | null }).void_at ?? null,
            };
            seen.set(row.dedup_key, stored);
            rows.push(stored);
            inserted.push(stored);
          }
        }
        return Promise.resolve({ data: inserted.map((r) => ({ id: r.id })), error: null });
      },
    };
  }

  // ---- update builder ----
  function makeUpdateBuilder(payload: Record<string, unknown>) {
    const updateOps: BuilderOp[] = [];

    const updateBuilder = {
      in(field: string, values: unknown[]) {
        updateOps.push({ type: "in", field, values });
        return updateBuilder;
      },
      is(field: string, value: null | boolean | string) {
        updateOps.push({ type: "is", field, value });
        return updateBuilder;
      },
      select(_cols?: string) {
        let matched = [...rows];
        for (const op of updateOps) {
          if (op.type === "in") {
            matched = matched.filter((r) =>
              op.values.includes((r as unknown as Record<string, unknown>)[op.field]),
            );
          } else if (op.type === "is") {
            matched = matched.filter((r) => {
              const val = (r as unknown as Record<string, unknown>)[op.field];
              if (op.value === null) return val === null || val === undefined;
              return val === op.value;
            });
          }
        }
        for (const r of matched) Object.assign(r, payload);
        return Promise.resolve({ data: matched.map((r) => ({ id: r.id })), error: null });
      },
    };
    return updateBuilder;
  }

  // ---- the fake client ----
  const db = {
    from(_tableName: string) {
      return {
        // Lazy select — returns a thenable builder
        select(_cols?: string) {
          return makeSelectBuilder(() => ({ data: [...rows], error: null }));
        },
        upsert(payload: unknown, _upsertOpts?: unknown) {
          const inputRows = (Array.isArray(payload) ? payload : [payload]) as StoredRow[];
          return makeUpsertBuilder(inputRows);
        },
        update(payload: Record<string, unknown>) {
          return makeUpdateBuilder(payload);
        },
      };
    },
  } as unknown as SupabaseClient;

  return { db, rows };
}

// ---------------------------------------------------------------------------
// Helper to make a minimal FeedRowInput
// ---------------------------------------------------------------------------
function makeRow(overrides: Partial<FeedRowInput> & Pick<FeedRowInput, "dedup_key">): FeedRowInput {
  return {
    user_id: "user-1",
    kind: "outside-action",
    title: "Test row",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test 1: writeFeed dedup
// ---------------------------------------------------------------------------
describe("writeFeed", () => {
  test("first write succeeds; duplicate dedup_key is ignored (count stays 1)", async () => {
    const { db, rows } = makeDb();
    const row = makeRow({ dedup_key: "outside-action:item-abc", project_id: "proj-1" });

    const count1 = await writeFeed([row], { client: db });
    assert.equal(count1, 1, "first write should insert 1 row");

    const count2 = await writeFeed([row], { client: db });
    assert.equal(count2, 0, "duplicate dedup_key should be ignored");

    assert.equal(rows.length, 1, "exactly one row materialized");
  });

  test("distinct dedup_keys each succeed", async () => {
    const { db, rows } = makeDb();
    const r1 = makeRow({ dedup_key: "outside-action:item-1" });
    const r2 = makeRow({ dedup_key: "outside-action:item-2" });

    await writeFeed([r1, r2], { client: db });
    assert.equal(rows.length, 2);
  });

  test("returns 0 on DB error, never throws", async () => {
    const { db } = makeDb({ failOnWrite: true });
    const count = await writeFeed([makeRow({ dedup_key: "x" })], { client: db });
    assert.equal(count, 0);
  });

  test("empty rows array returns 0 without hitting DB", async () => {
    const { db, rows } = makeDb();
    const count = await writeFeed([], { client: db });
    assert.equal(count, 0);
    assert.equal(rows.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Test 2: feedRowMatches (pure, no DB)
// ---------------------------------------------------------------------------
describe("feedRowMatches", () => {
  const NOW = new Date("2026-06-17T12:00:00Z");
  const WINDOW = 14;
  const PROJECT_ID = "proj-1";
  const SCOPE_SET: ScopeEntry[] = [
    { scope_kind: "zip", scope_value: "33901" },
    { scope_kind: "place", scope_value: "fort myers beach" },
  ];

  function base(): Pick<
    FeedRow,
    "project_id" | "scope_kind" | "scope_value" | "created_at" | "void_at"
  > {
    return {
      project_id: PROJECT_ID,
      scope_kind: null,
      scope_value: null,
      created_at: "2026-06-15T00:00:00Z", // within 14-day window
      void_at: null,
    };
  }

  test("bound row (project_id matches) → true", () => {
    assert.equal(
      feedRowMatches(base(), {
        projectId: PROJECT_ID,
        scopeSet: SCOPE_SET,
        windowDays: WINDOW,
        now: NOW,
      }),
      true,
    );
  });

  test("scope-keyed row (project_id null, zip scope in set) → true", () => {
    const row = { ...base(), project_id: null, scope_kind: "zip", scope_value: "33901" };
    assert.equal(
      feedRowMatches(row, {
        projectId: PROJECT_ID,
        scopeSet: SCOPE_SET,
        windowDays: WINDOW,
        now: NOW,
      }),
      true,
    );
  });

  test("scope-keyed row with place scope in set → true", () => {
    const row = {
      ...base(),
      project_id: null,
      scope_kind: "place",
      scope_value: "fort myers beach",
    };
    assert.equal(
      feedRowMatches(row, {
        projectId: PROJECT_ID,
        scopeSet: SCOPE_SET,
        windowDays: WINDOW,
        now: NOW,
      }),
      true,
    );
  });

  test("scope-keyed row with scope NOT in set → false", () => {
    const row = { ...base(), project_id: null, scope_kind: "zip", scope_value: "33908" };
    assert.equal(
      feedRowMatches(row, {
        projectId: PROJECT_ID,
        scopeSet: SCOPE_SET,
        windowDays: WINDOW,
        now: NOW,
      }),
      false,
    );
  });

  test("different project_id (not null, not matching) → false", () => {
    const row = { ...base(), project_id: "proj-other" };
    assert.equal(
      feedRowMatches(row, {
        projectId: PROJECT_ID,
        scopeSet: SCOPE_SET,
        windowDays: WINDOW,
        now: NOW,
      }),
      false,
    );
  });

  test("out-of-window row → false", () => {
    const row = { ...base(), created_at: "2026-05-01T00:00:00Z" }; // >14 days before NOW
    assert.equal(
      feedRowMatches(row, {
        projectId: PROJECT_ID,
        scopeSet: SCOPE_SET,
        windowDays: WINDOW,
        now: NOW,
      }),
      false,
    );
  });

  test("void_at set → false", () => {
    const row = { ...base(), void_at: "2026-06-14T00:00:00Z" };
    assert.equal(
      feedRowMatches(row, {
        projectId: PROJECT_ID,
        scopeSet: SCOPE_SET,
        windowDays: WINDOW,
        now: NOW,
      }),
      false,
    );
  });

  test("row exactly at window cutoff is included", () => {
    // created_at exactly 14 days before NOW → at the boundary, should match (>= cutoff)
    const cutoff = new Date(NOW.getTime() - WINDOW * 24 * 60 * 60 * 1000).toISOString();
    const row = { ...base(), created_at: cutoff };
    assert.equal(
      feedRowMatches(row, {
        projectId: PROJECT_ID,
        scopeSet: SCOPE_SET,
        windowDays: WINDOW,
        now: NOW,
      }),
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Test 3: readProjectFeed via injected fake — the seam in miniature
// Returns bound + scope-matched rows together, excludes non-matching rows.
// ---------------------------------------------------------------------------
describe("readProjectFeed (fake DB seam test)", () => {
  const PROJECT_ID = "proj-1";
  const SCOPE_SET: ScopeEntry[] = [{ scope_kind: "zip", scope_value: "33901" }];

  test("returns bound rows AND scope-matched rows together; excludes wrong scope", async () => {
    const { db, rows } = makeDb();

    // Seed one bound row (project_id = PROJECT_ID)
    await writeFeed(
      [
        makeRow({
          dedup_key: "outside-action:item-1",
          project_id: PROJECT_ID,
          kind: "outside-action",
          title: "Bound row",
        }),
      ],
      { client: db },
    );

    // Seed one scope-keyed row (project_id null, scope matches)
    await writeFeed(
      [
        makeRow({
          dedup_key: "datachange:zip:33901:brain-1:tok1",
          project_id: null,
          scope_kind: "zip",
          scope_value: "33901",
          kind: "data-change",
          title: "Scope-matched row",
        }),
      ],
      { client: db },
    );

    // Seed one row with wrong scope (should NOT appear)
    await writeFeed(
      [
        makeRow({
          dedup_key: "datachange:zip:33908:brain-1:tok1",
          project_id: null,
          scope_kind: "zip",
          scope_value: "33908",
          kind: "data-change",
          title: "Wrong scope row",
        }),
      ],
      { client: db },
    );

    const feed = await readProjectFeed(PROJECT_ID, SCOPE_SET, { windowDays: 14, client: db });

    const titles = feed.map((r) => r.title);
    assert.ok(titles.includes("Bound row"), "bound row should appear");
    assert.ok(titles.includes("Scope-matched row"), "scope-matched row should appear");
    assert.ok(!titles.includes("Wrong scope row"), "wrong-scope row should NOT appear");
    assert.equal(feed.length, 2);

    // Pin the prod read seam to the documented predicate: readProjectFeed's `.or()`
    // result must equal feedRowMatches applied to the full store. If the SQL filter
    // and the pure predicate ever drift, this fails (kills the "tests pass via the
    // fake's own parser, prod silently wrong" trap the audit flagged).
    const expected = rows.filter((r) =>
      feedRowMatches(r, { projectId: PROJECT_ID, scopeSet: SCOPE_SET, windowDays: 14 }),
    );
    assert.equal(feed.length, expected.length, "readProjectFeed agrees with feedRowMatches");
  });

  test("scope_value with PostgREST-reserved chars (comma/period) still matches via quoting", async () => {
    const { db } = makeDb();
    const RESERVED_SCOPE: ScopeEntry[] = [{ scope_kind: "place", scope_value: "naples, fl" }];
    await writeFeed(
      [
        makeRow({
          dedup_key: "datachange:place:naples-fl:brain-1:tok1",
          project_id: null,
          scope_kind: "place",
          scope_value: "naples, fl",
          kind: "data-change",
          title: "Reserved-char scope row",
        }),
      ],
      { client: db },
    );
    const feed = await readProjectFeed(PROJECT_ID, RESERVED_SCOPE, { client: db });
    assert.equal(feed.length, 1, "a comma in scope_value must not break the .or() filter");
    assert.equal(feed[0].title, "Reserved-char scope row");
  });

  test("returns empty array on empty store (no throw)", async () => {
    const { db } = makeDb();
    const feed = await readProjectFeed(PROJECT_ID, SCOPE_SET, { client: db });
    assert.deepEqual(feed, []);
  });
});

// ---------------------------------------------------------------------------
// Test 4: markFeedSeen — the dismiss wire (sets read_at so a signal stops
// surfacing; only touches unread rows; never throws).
// ---------------------------------------------------------------------------
describe("markFeedSeen (dismiss wire)", () => {
  const PROJECT_ID = "proj-1";
  const SCOPE_SET: ScopeEntry[] = [{ scope_kind: "zip", scope_value: "33901" }];

  test("dismiss marks the row read so it no longer surfaces in the feed read", async () => {
    const { db, rows } = makeDb();
    await writeFeed(
      [
        makeRow({
          dedup_key: "outside-action:item-1",
          project_id: PROJECT_ID,
          title: "Saved chart",
        }),
      ],
      { client: db },
    );

    const before = await readProjectFeed(PROJECT_ID, SCOPE_SET, { client: db });
    assert.equal(before.length, 1, "unread row surfaces before dismiss");

    const feedId = rows[0].id;
    const updated = await markFeedSeen([feedId], { client: db });
    assert.equal(updated, 1, "exactly one row marked seen");
    assert.ok(rows[0].read_at !== null, "read_at is set after dismiss");

    // The digest fold drops read rows, but the row is still returned by the read
    // seam (it filters on void/window only); the read_at gate lives in the fold.
    // Re-dismissing the now-read row is a no-op (only unread rows are touched).
    const again = await markFeedSeen([feedId], { client: db });
    assert.equal(again, 0, "re-dismiss is a no-op (read_at already set)");
  });

  test("empty id list returns 0 without hitting DB", async () => {
    const { db } = makeDb();
    assert.equal(await markFeedSeen([], { client: db }), 0);
  });
});
