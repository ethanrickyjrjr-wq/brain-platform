import { describe, it, expect } from "bun:test";
import { buildProjectDigest, type ProjectDigestInput } from "./digest";
import type { ProjectItem } from "./items";
import type { FeedRow } from "./feed";

function feedRow(over: Partial<FeedRow> = {}): FeedRow {
  return {
    id: 1,
    user_id: "u1",
    project_id: "p1",
    kind: "outside-action",
    scope_kind: "zip",
    scope_value: "33931",
    title: "New flood chart you saved Outside",
    detail: null,
    ref_url: "/charts/abc",
    payload: { identityKey: "chart:abc" },
    dedup_key: "outside-action:abc",
    created_at: "2026-06-16T08:00:00Z",
    read_at: null,
    void_at: null,
    ...over,
  };
}

const base = { id: "x", added_at: "2026-06-10T08:00:00Z", origin: "web" as const };

function metric(
  id: string,
  opts: Partial<Extract<ProjectItem, { kind: "metric" }>> = {},
): ProjectItem {
  return {
    ...base,
    id,
    kind: "metric",
    report_id: "33931",
    label: "Annual flood loss",
    value: "$30,074/yr",
    freshness_token: "SWFL-7421-v5-20260610",
    ...opts,
  };
}

function input(over: Partial<ProjectDigestInput> = {}): ProjectDigestInput {
  return { projectId: "p1", title: "Fort Myers Beach 33931", items: [metric("a")], ...over };
}

describe("buildProjectDigest", () => {
  it("infers scope from items (zip + place + topic)", () => {
    const d = buildProjectDigest(input());
    expect(d.scope).toEqual({ zip: "33931", place: "Fort Myers Beach", topic: "Flood" });
  });

  it("falls back to a schedule's scope/topic when items name no place", () => {
    const d = buildProjectDigest(
      input({
        items: [{ ...base, kind: "note", text: "misc" }],
        schedules: [
          { cadence: "weekly", scope_kind: "zip", scope_value: "34104", topic: "Rentals" },
        ],
      }),
    );
    expect(d.scope.zip).toBe("34104");
    expect(d.scope.topic).toBe("Rentals");
  });

  it("counts items by kind and stamps one identity key per item", () => {
    const items: ProjectItem[] = [
      metric("a"),
      metric("b", { metric_slug: "rent_zori", report_id: "rentals-swfl", label: "ZORI" }),
      { ...base, id: "c", kind: "report", slug: "permits-swfl" },
    ];
    const d = buildProjectDigest(input({ items }));
    expect(d.itemCount).toBe(3);
    expect(d.kindCounts).toEqual({ metric: 2, report: 1 });
    expect(d.identityKeys).toEqual([
      "metric:Annual flood loss@33931",
      "metric:rent_zori@rentals-swfl",
      "report:permits-swfl",
    ]);
  });

  it("picks the newest freshness token by the YYYYMMDD tail, not the version number", () => {
    const items: ProjectItem[] = [
      metric("a", { freshness_token: "SWFL-7421-v10-20260610" }),
      metric("b", { freshness_token: "SWFL-7421-v9-20260701" }), // lower version, LATER date
    ];
    const d = buildProjectDigest(input({ items }));
    expect(d.freshnessToken).toBe("SWFL-7421-v9-20260701");
  });

  it("freshnessChangedSinceSeen: true when never seen, true when newer, false when same/older", () => {
    const items = [metric("a", { freshness_token: "SWFL-7421-v5-20260610" })];
    expect(buildProjectDigest(input({ items })).freshnessChangedSinceSeen).toBe(true); // never seen
    expect(
      buildProjectDigest(input({ items, lastFreshnessTokenSeen: "SWFL-7421-v4-20260601" }))
        .freshnessChangedSinceSeen,
    ).toBe(true); // newer
    expect(
      buildProjectDigest(input({ items, lastFreshnessTokenSeen: "SWFL-7421-v5-20260610" }))
        .freshnessChangedSinceSeen,
    ).toBe(false); // same day
    expect(
      buildProjectDigest(input({ items, lastFreshnessTokenSeen: "SWFL-7421-v9-20260701" }))
        .freshnessChangedSinceSeen,
    ).toBe(false); // older item than seen
  });

  it("has no freshness when no item carries a token", () => {
    const d = buildProjectDigest(input({ items: [{ ...base, kind: "note", text: "hi" }] }));
    expect(d.freshnessToken).toBeUndefined();
    expect(d.freshnessChangedSinceSeen).toBe(false);
  });

  it("latestActivityAt = max(item.added_at ∪ deliverable.created_at)", () => {
    const d = buildProjectDigest(
      input({
        items: [
          { ...metric("a"), added_at: "2026-06-10T08:00:00Z" },
          { ...metric("b"), added_at: "2026-06-12T08:00:00Z" },
        ],
        deliverables: [{ id: "d1", template: "email", created_at: "2026-06-15T09:00:00Z" }],
      }),
    );
    expect(d.latestActivityAt).toBe("2026-06-15T09:00:00Z");
  });

  it("maps deliverables / schedules / recentSends and defaults staleMetrics to []", () => {
    const d = buildProjectDigest(
      input({
        deliverables: [{ id: "d1", template: "one_pager", created_at: "2026-06-15T09:00:00Z" }],
        schedules: [
          { cadence: "weekly", scope_value: "33931", last_run_at: "2026-06-16T10:00:00Z" },
        ],
        recentSends: [{ sent_at: "2026-06-16T10:01:00Z" }],
      }),
    );
    expect(d.deliverables).toEqual([
      { id: "d1", template: "one_pager", createdAt: "2026-06-15T09:00:00Z" },
    ]);
    expect(d.schedules).toEqual([
      { cadence: "weekly", scope: "33931", lastRunAt: "2026-06-16T10:00:00Z" },
    ]);
    expect(d.recentSends).toEqual([{ sentAt: "2026-06-16T10:01:00Z" }]);
    expect(d.staleMetrics).toEqual([]);
  });

  it("passes through provided staleMetrics (TTL gate ON)", () => {
    const d = buildProjectDigest(
      input({ staleMetrics: [{ label: "Median rent", expiredAt: "2026-05-01" }] }),
    );
    expect(d.staleMetrics).toEqual([{ label: "Median rent", expiredAt: "2026-05-01" }]);
  });

  it("rev is stable for identical input and changes when an item changes", () => {
    const a = buildProjectDigest(input());
    const b = buildProjectDigest(input());
    expect(a.rev).toBe(b.rev);
    const c = buildProjectDigest(
      input({ items: [metric("a"), metric("z", { report_id: "34104" })] }),
    );
    expect(c.rev).not.toBe(a.rev);
  });

  it("rev changes when ONLY the title changes (a rename must reach the AI context bus)", () => {
    const a = buildProjectDigest(input({ title: "Fort Myers Beach 33931" }));
    const b = buildProjectDigest(input({ title: "Beach House Clients" }));
    expect(b.rev).not.toBe(a.rev);
  });

  it("rev changes when ONLY the schedule-derived scope changes", () => {
    const items: ProjectItem[] = [{ ...base, kind: "note", text: "misc" }]; // items name no place
    const a = buildProjectDigest(
      input({ items, schedules: [{ cadence: "weekly", scope_kind: "zip", scope_value: "33931" }] }),
    );
    const b = buildProjectDigest(
      input({ items, schedules: [{ cadence: "weekly", scope_kind: "zip", scope_value: "34104" }] }),
    );
    expect(b.scope.zip).toBe("34104");
    expect(b.rev).not.toBe(a.rev);
  });

  it("on a same-DAY version tie, picks the higher-version token regardless of order", () => {
    const lo = "SWFL-7421-v5-20260610";
    const hi = "SWFL-7421-v9-20260610";
    expect(
      buildProjectDigest(
        input({
          items: [metric("a", { freshness_token: lo }), metric("b", { freshness_token: hi })],
        }),
      ).freshnessToken,
    ).toBe(hi);
    expect(
      buildProjectDigest(
        input({
          items: [metric("a", { freshness_token: hi }), metric("b", { freshness_token: lo })],
        }),
      ).freshnessToken,
    ).toBe(hi);
  });

  it("treats an unparseable lastFreshnessTokenSeen as never-seen (changed = true)", () => {
    const d = buildProjectDigest(input({ lastFreshnessTokenSeen: "GARBAGE-NO-DATE" }));
    expect(d.freshnessChangedSinceSeen).toBe(true);
  });

  it("feedSignals defaults to [] when no feedRows are passed", () => {
    const d = buildProjectDigest(input());
    expect(d.feedSignals).toEqual([]);
  });

  it("folds unread feedRows into feedSignals (id/kind/title/refUrl/overlapKey), order preserved", () => {
    const d = buildProjectDigest(
      input({
        feedRows: [
          feedRow({ id: 7, title: "First", payload: { identityKey: "chart:abc" } }),
          feedRow({
            id: 8,
            kind: "data-change",
            title: "Second",
            ref_url: null,
            payload: {},
          }),
        ],
      }),
    );
    expect(d.feedSignals).toEqual([
      {
        feedId: 7,
        kind: "outside-action",
        title: "First",
        refUrl: "/charts/abc",
        overlapKey: "chart:abc",
      },
      { feedId: 8, kind: "data-change", title: "Second", refUrl: undefined, overlapKey: undefined },
    ]);
  });

  it("suppresses feedRows that are already read (read_at set)", () => {
    const d = buildProjectDigest(
      input({
        feedRows: [
          feedRow({ id: 7, title: "Unread" }),
          feedRow({ id: 8, title: "Read", read_at: "2026-06-16T09:00:00Z" }),
        ],
      }),
    );
    expect(d.feedSignals.map((s) => s.feedId)).toEqual([7]);
  });

  it("rev changes when feedRows change (signals must reach the AI context bus)", () => {
    const a = buildProjectDigest(input());
    const b = buildProjectDigest(input({ feedRows: [feedRow({ id: 7 })] }));
    expect(b.rev).not.toBe(a.rev);
    const c = buildProjectDigest(
      input({ feedRows: [feedRow({ id: 7, title: "different title" })] }),
    );
    expect(c.rev).not.toBe(b.rev);
  });

  it("schedule fallback: a scope_value with NO scope_kind is not applied; place beats a later zip", () => {
    const items: ProjectItem[] = [{ ...base, kind: "note", text: "misc" }];
    const noKind = buildProjectDigest(
      input({ items, schedules: [{ cadence: "weekly", scope_value: "33931" }] }),
    );
    expect(noKind.scope.zip).toBeUndefined();
    expect(noKind.scope.place).toBeUndefined();

    const placeFirst = buildProjectDigest(
      input({
        items,
        schedules: [
          { cadence: "weekly", scope_kind: "place", scope_value: "naples" },
          { cadence: "weekly", scope_kind: "zip", scope_value: "33931" },
        ],
      }),
    );
    expect(placeFirst.scope.place).toBe("naples"); // first scope-yielding schedule wins (break)
    expect(placeFirst.scope.zip).toBeUndefined();
  });
});
