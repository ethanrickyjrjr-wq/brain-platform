/**
 * change-detection.test.ts — Piece 3 (Signal Layer) Track B, pure-core tests.
 *
 * The `data-change` cron's decision logic, fully unit-testable with NO DB and NO
 * disk: dedup-key construction, the scope→user fan-out map, and the
 * emit/baseline/skip verdict built on `reconcileMetric` (current lake fact vs the
 * prior snapshot stored in the last data-change feed row).
 */
import { describe, test, expect } from "bun:test";
import {
  ZIP_SIGNAL_BRAINS,
  dataChangeDedupKey,
  buildScopeUserMap,
  decideDataChange,
  indexPriorSnapshots,
} from "./change-detection";
import type { LaneOneFact } from "@/lib/reconcile/types";

const SOURCE = {
  url: "https://www.zillow.com/research/data/",
  fetched_at: "2026-06-15T00:00:00Z",
  tier: 1 as const,
  citation: "Zillow ZHVI",
};
const FRESH = "2999-01-01T00:00:00Z";
const STALE = "2000-01-01T00:00:00Z";
const NOW = new Date("2026-06-17T12:00:00Z");

const BRAIN = {
  report_id: "housing-swfl",
  metric_slug: "median_sale_price",
  label: "median sale price",
};
const TOKEN = "SWFL-7421-v10-20260615";

function fact(value: number | string, expires = FRESH): LaneOneFact {
  return {
    brain_id: "housing-swfl",
    metric_slug: "median_sale_price",
    label: "Median sale price",
    value,
    grain: "zip",
    source: SOURCE,
    expires,
  };
}

// ---------------------------------------------------------------------------
// ZIP_SIGNAL_BRAINS — the verified allowlist
// ---------------------------------------------------------------------------

describe("ZIP_SIGNAL_BRAINS", () => {
  test("is a non-empty list of verified per-ZIP detail-table columns", () => {
    expect(ZIP_SIGNAL_BRAINS.length).toBeGreaterThan(0);
    for (const b of ZIP_SIGNAL_BRAINS) {
      expect(typeof b.report_id).toBe("string");
      expect(typeof b.metric_slug).toBe("string");
      expect(typeof b.label).toBe("string");
    }
  });

  test("includes the two canonical property signals with their real column ids", () => {
    const byId = new Map(ZIP_SIGNAL_BRAINS.map((b) => [b.report_id, b.metric_slug]));
    // Both MUST be catalog-resolvable (housing-swfl + rentals-swfl are in
    // BRAIN_CATALOG); the ZHVI brains (home-values-swfl / investor-zip-swfl) are
    // NOT, so they'd reconcile not_found and silently never emit — excluded.
    expect(byId.get("housing-swfl")).toBe("median_sale_price");
    expect(byId.get("rentals-swfl")).toBe("rent_index_latest");
    expect(byId.has("home-values-swfl")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// dataChangeDedupKey
// ---------------------------------------------------------------------------

describe("dataChangeDedupKey", () => {
  test("builds the canonical datachange:<user>:<zip>:<brain>:<token> key", () => {
    expect(dataChangeDedupKey("u1", "33901", "home-values-swfl", TOKEN)).toBe(
      "datachange:u1:33901:home-values-swfl:SWFL-7421-v10-20260615",
    );
  });

  test("a different token yields a different key (so a new refine can re-emit)", () => {
    const a = dataChangeDedupKey("u1", "33901", "home-values-swfl", "SWFL-7421-v9-20260515");
    const b = dataChangeDedupKey("u1", "33901", "home-values-swfl", "SWFL-7421-v10-20260615");
    expect(a).not.toBe(b);
  });

  test("DIFFERENT USERS scoping the same ZIP get DISTINCT keys (per-user fan-out must survive the global UNIQUE index)", () => {
    const a = dataChangeDedupKey("u1", "33901", "home-values-swfl", TOKEN);
    const b = dataChangeDedupKey("u2", "33901", "home-values-swfl", TOKEN);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// buildScopeUserMap — zip → set of users whose projects scope it
// ---------------------------------------------------------------------------

describe("buildScopeUserMap", () => {
  test("maps each ZIP to the set of users scoping it", () => {
    const m = buildScopeUserMap([
      { user_id: "u1", zips: ["33901", "33908"] },
      { user_id: "u2", zips: ["33901"] },
    ]);
    expect([...(m.get("33901") ?? [])].sort()).toEqual(["u1", "u2"]);
    expect([...(m.get("33908") ?? [])]).toEqual(["u1"]);
  });

  test("dedups a user that scopes the same ZIP from two projects", () => {
    const m = buildScopeUserMap([
      { user_id: "u1", zips: ["33901"] },
      { user_id: "u1", zips: ["33901"] },
    ]);
    expect([...(m.get("33901") ?? [])]).toEqual(["u1"]);
  });

  test("a project with no ZIP scopes contributes nothing", () => {
    const m = buildScopeUserMap([{ user_id: "u1", zips: [] }]);
    expect(m.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// decideDataChange — the heart: emit | baseline | skip
// ---------------------------------------------------------------------------

describe("decideDataChange", () => {
  const base = { token: TOKEN, brain: BRAIN, zip: "33901", userId: "u1", now: NOW };

  test("no lake row for this ZIP (fact null) → skip", () => {
    const d = decideDataChange({ ...base, fact: null, prior: null });
    expect(d.action).toBe("skip");
    expect(d.row).toBeUndefined();
  });

  test("first sighting (no prior) → baseline row, recorded-not-surfaced (read_at set)", () => {
    const d = decideDataChange({ ...base, fact: fact(264506), prior: null });
    expect(d.action).toBe("baseline");
    const row = d.row!;
    expect(row.kind).toBe("data-change");
    expect(row.project_id).toBeNull(); // Tier-2 scope-keyed, late-bind at read
    expect(row.scope_kind).toBe("zip");
    expect(row.scope_value).toBe("33901");
    expect(row.user_id).toBe("u1");
    expect(row.read_at).toBe(NOW.toISOString()); // muted on cold start
    expect(row.dedup_key).toBe(dataChangeDedupKey("u1", "33901", "housing-swfl", TOKEN));
    expect(row.payload).toMatchObject({
      brain: "housing-swfl",
      metric_slug: "median_sale_price",
      value: 264506,
      token: TOKEN,
      baseline: true,
    });
    expect(row.ref_url).toBe("/r/housing-swfl");
  });

  test("value unchanged vs prior → skip (no noise on a bare token bump)", () => {
    const d = decideDataChange({
      ...base,
      fact: fact(264506),
      prior: { value: 264506, token: "SWFL-7421-v9-20260515" },
    });
    expect(d.action).toBe("skip");
    expect(d.verdict?.status).toBe("verified");
  });

  test("value moved vs prior → emit an UNREAD row titled with the reconcile reason", () => {
    const d = decideDataChange({
      ...base,
      fact: fact(268000),
      prior: { value: 264506, token: "SWFL-7421-v9-20260515" },
    });
    expect(d.action).toBe("emit");
    expect(d.verdict?.status).toBe("needs_review");
    const row = d.row!;
    expect(row.read_at).toBeUndefined(); // unread → P2 surfaces it
    expect(row.title).toBe(d.verdict!.reason); // title = deterministic reconcile reason
    expect(row.title).toContain("differ");
    expect(row.detail).toBe("median sale price: 264506 → 268000"); // deterministic, real numbers
    expect(row.dedup_key).toBe(dataChangeDedupKey("u1", "33901", "housing-swfl", TOKEN));
    expect(row.payload).toMatchObject({
      brain: "housing-swfl",
      value: 268000,
      prior_value: 264506,
      token: TOKEN,
    });
    // reconcile's delta_pct is ours=current/theirs=prior → a RISE reads negative
    expect(row.payload.delta_pct).toBeCloseTo(-1.3, 1);
    // change_pct is the natural (current − prior)/prior → a RISE reads POSITIVE
    expect(row.payload.change_pct).toBeCloseTo(1.32, 1);
  });

  test("current fact is STALE (past TTL) → skip (cannot assert a move we can't assert)", () => {
    const d = decideDataChange({
      ...base,
      fact: fact(268000, STALE),
      prior: { value: 264506, token: "SWFL-7421-v9-20260515" },
    });
    expect(d.action).toBe("skip");
    expect(d.verdict?.status).toBe("cannot_assert_stale");
  });
});

// ---------------------------------------------------------------------------
// indexPriorSnapshots — newest snapshot per (user, zip, brain)
// ---------------------------------------------------------------------------

describe("indexPriorSnapshots", () => {
  test("keeps the newest snapshot per (user, zip, brain) — rows arrive newest-first", () => {
    const m = indexPriorSnapshots([
      {
        user_id: "u1",
        scope_value: "33901",
        payload: { brain: "home-values-swfl", value: 268000, token: "T2" },
      },
      {
        user_id: "u1",
        scope_value: "33901",
        payload: { brain: "home-values-swfl", value: 264506, token: "T1" },
      },
    ]);
    expect(m.get("u1|33901|home-values-swfl")).toEqual({ value: 268000, token: "T2" });
  });

  test("a baseline row counts as a valid prior snapshot", () => {
    const m = indexPriorSnapshots([
      {
        user_id: "u1",
        scope_value: "33901",
        payload: { brain: "rentals-swfl", value: 1589, token: "T1", baseline: true },
      },
    ]);
    expect(m.get("u1|33901|rentals-swfl")).toEqual({ value: 1589, token: "T1" });
  });

  test("skips rows missing brain / token / value / scope_value", () => {
    const m = indexPriorSnapshots([
      { user_id: "u1", scope_value: "33901", payload: { value: 1, token: "T" } }, // no brain
      { user_id: "u1", scope_value: "33901", payload: { brain: "b", token: "T" } }, // no value
      { user_id: "u1", scope_value: "33901", payload: { brain: "b", value: 1 } }, // no token
      { user_id: "u1", scope_value: null, payload: { brain: "b", value: 1, token: "T" } }, // no scope
    ]);
    expect(m.size).toBe(0);
  });
});
