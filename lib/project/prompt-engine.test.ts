import { describe, it, expect } from "bun:test";
import { projectPrompts, type PromptEngineInput } from "./prompt-engine";
import type { ProjectDigest } from "./digest";
import type { Overlap, OverlapHit } from "./cross-project-index";

function digest(over: Partial<ProjectDigest> = {}): ProjectDigest {
  return {
    projectId: "p1",
    title: "Fort Myers Beach 33931",
    rev: "r1",
    scope: { zip: "33931", place: "Fort Myers Beach", topic: "Flood" },
    itemCount: 3,
    kindCounts: { metric: 3 },
    identityKeys: [],
    freshnessChangedSinceSeen: false,
    deliverables: [],
    schedules: [],
    recentSends: [],
    staleMetrics: [],
    feedSignals: [],
    ...over,
  };
}

const reuseHit = (label: string, otherTitle: string): OverlapHit => ({
  type: "reuse",
  identityKey: `metric:${label}@33931`,
  label,
  otherProjectId: "p2",
  otherProjectTitle: otherTitle,
  dedupeKey: `reuse:metric:${label}@33931`,
});
const gapHit = (label: string, otherTitle: string): OverlapHit => ({
  type: "gap",
  identityKey: `metric:${label}@33931`,
  label,
  otherProjectId: "p3",
  otherProjectTitle: otherTitle,
  dedupeKey: `gap:metric:${label}@33931:p3`,
});
const overlap = (over: Partial<Overlap> = {}): Overlap => ({
  reuse: [],
  gap: [],
  pairing: [],
  ...over,
});

describe("projectPrompts — open project", () => {
  it("always returns exactly 3 situational prompts + a project build offer", () => {
    const out = projectPrompts({ digest: digest() });
    expect(out.prompts).toHaveLength(3);
    expect(/project|deliverable/i.test(out.offer)).toBe(true);
  });

  it("leads with fresh-data when the project's data moved since last seen", () => {
    const out = projectPrompts({
      digest: digest({ freshnessChangedSinceSeen: true, freshnessToken: "SWFL-7421-v5-20260610" }),
    });
    expect(out.prompts[0]).toMatch(/new data landed for fort myers beach \(as of 06\/10\/2026\)/i);
  });

  it("surfaces a stale-metric refresh prompt naming the metric", () => {
    const out = projectPrompts({ digest: digest({ staleMetrics: [{ label: "Median rent" }] }) });
    expect(out.prompts.some((p) => /median rent may be out of date/i.test(p))).toBe(true);
  });

  it("offers 'Ready to send?' only when the caller flags the send surface ready", () => {
    expect(projectPrompts({ digest: digest() }).prompts.some((p) => /ready to send/i.test(p))).toBe(
      false,
    );
    const out = projectPrompts({ digest: digest(), signals: { sendReady: true } });
    expect(out.prompts.some((p) => /ready to send your fort myers beach update/i.test(p))).toBe(
      true,
    );
  });

  it("surfaces cross-project reuse (pull in) and gap (push out)", () => {
    const reuse = projectPrompts({
      digest: digest(),
      overlap: overlap({ reuse: [reuseHit("Median rent: $2,100", "Luxury Clients")] }),
    });
    expect(reuse.prompts.some((p) => /pull it in here/i.test(p) && /luxury clients/i.test(p))).toBe(
      true,
    );

    const gap = projectPrompts({
      digest: digest(),
      overlap: overlap({ gap: [gapHit("Permit count: 42", "Naples Book")] }),
    });
    expect(gap.prompts.some((p) => /add it there/i.test(p) && /naples book/i.test(p))).toBe(true);
  });

  it("ranks fresh-data above cross-project", () => {
    const out = projectPrompts({
      digest: digest({ freshnessChangedSinceSeen: true, freshnessToken: "SWFL-7421-v5-20260610" }),
      overlap: overlap({ reuse: [reuseHit("Median rent", "Luxury Clients")] }),
    });
    const freshIdx = out.prompts.findIndex((p) => /new data landed/i.test(p));
    const reuseIdx = out.prompts.findIndex((p) => /pull it in here/i.test(p));
    expect(freshIdx).toBeGreaterThanOrEqual(0);
    expect(freshIdx).toBeLessThan(reuseIdx === -1 ? Infinity : reuseIdx);
  });

  it("surfaces ONE feed signal, ranked between fresh-data and stale-metric", () => {
    const out = projectPrompts({
      digest: digest({
        freshnessChangedSinceSeen: true,
        freshnessToken: "SWFL-7421-v5-20260610",
        staleMetrics: [{ label: "Median rent" }],
        feedSignals: [
          {
            feedId: 7,
            kind: "outside-action",
            title: "Flood chart you saved",
            overlapKey: "chart:abc",
          },
          { feedId: 8, kind: "outside-action", title: "Second signal", overlapKey: "chart:def" },
        ],
      }),
    });
    const freshIdx = out.prompts.findIndex((p) => /new data landed/i.test(p));
    const feedIdx = out.prompts.findIndex((p) => /flood chart you saved/i.test(p));
    const staleIdx = out.prompts.findIndex((p) => /median rent may be out of date/i.test(p));
    expect(freshIdx).toBeGreaterThanOrEqual(0);
    expect(feedIdx).toBeGreaterThan(freshIdx);
    expect(feedIdx).toBeLessThan(staleIdx);
  });

  it("caps feed signals to the top 1 (a second signal never surfaces)", () => {
    const out = projectPrompts({
      digest: digest({
        feedSignals: [
          {
            feedId: 7,
            kind: "outside-action",
            title: "First feed signal",
            overlapKey: "chart:abc",
          },
          {
            feedId: 8,
            kind: "outside-action",
            title: "Second feed signal",
            overlapKey: "chart:def",
          },
        ],
      }),
    });
    expect(out.prompts.some((p) => /first feed signal/i.test(p))).toBe(true);
    expect(out.prompts.some((p) => /second feed signal/i.test(p))).toBe(false);
  });

  it("suppresses a feed signal whose overlapKey is dismissed; falls through to the next", () => {
    const out = projectPrompts({
      digest: digest({
        feedSignals: [
          { feedId: 7, kind: "outside-action", title: "Dismissed signal", overlapKey: "chart:abc" },
          { feedId: 8, kind: "outside-action", title: "Live signal", overlapKey: "chart:def" },
        ],
      }),
      signals: { dismissedOverlapKeys: ["chart:abc"] },
    });
    expect(out.prompts.some((p) => /dismissed signal/i.test(p))).toBe(false);
    expect(out.prompts.some((p) => /live signal/i.test(p))).toBe(true);
  });

  it("emits no feed prompt when there are no feed signals", () => {
    const out = projectPrompts({ digest: digest({ feedSignals: [] }) });
    expect(out.prompts.length).toBe(3); // floor still fills to 3, no crash
  });

  it("is deterministic — same input yields an equal result", () => {
    const input: PromptEngineInput = {
      digest: digest({ freshnessChangedSinceSeen: true, freshnessToken: "SWFL-7421-v5-20260610" }),
      overlap: overlap({ reuse: [reuseHit("Median rent", "Luxury Clients")] }),
    };
    expect(projectPrompts(input)).toEqual(projectPrompts(input));
  });
});

describe("projectPrompts — no project (Outside / list)", () => {
  it("offers to pick up the most-recent project and refresh a stale one", () => {
    const out = projectPrompts({
      digest: null,
      projects: [
        { projectId: "a", title: "Cape Coral 33904", latestActivityAt: "2026-06-16T00:00:00Z" },
        {
          projectId: "b",
          title: "Naples 34104",
          latestActivityAt: "2026-06-10T00:00:00Z",
          freshnessChangedSinceSeen: true,
        },
      ],
    });
    expect(out.prompts[0]).toMatch(/pick up where you left off in cape coral 33904/i);
    expect(out.prompts.some((p) => /naples 34104 has new data/i.test(p))).toBe(true);
    expect(/briefcase|deliverable/i.test(out.offer)).toBe(true);
  });

  it("falls back to the region floor when the user has no projects", () => {
    const out = projectPrompts({ digest: null });
    expect(out.prompts.length).toBeGreaterThan(0);
    expect(out.prompts.some((p) => /SWFL|flood|rent|corridor/i.test(p))).toBe(true);
  });

  it("is order-independent on equal latestActivityAt (deterministic tiebreaker)", () => {
    const ps = [
      { projectId: "a", title: "Alpha", latestActivityAt: "2026-06-16T00:00:00Z" },
      { projectId: "b", title: "Beta", latestActivityAt: "2026-06-16T00:00:00Z" },
    ];
    const fwd = projectPrompts({ digest: null, projects: ps });
    const rev = projectPrompts({ digest: null, projects: [...ps].reverse() });
    expect(fwd.prompts[0]).toBe(rev.prompts[0]); // same winner regardless of input order
  });

  it("surfaces a stale refresh prompt even when NO project has activity", () => {
    const out = projectPrompts({
      digest: null,
      projects: [{ projectId: "a", title: "Alpha", freshnessChangedSinceSeen: true }],
    });
    expect(out.prompts.some((p) => /alpha has new data/i.test(p))).toBe(true);
    expect(out.prompts.some((p) => /pick up where you left off/i.test(p))).toBe(false);
  });

  it("does not double-offer the most-recent project as both 'pick up' and 'has new data'", () => {
    const out = projectPrompts({
      digest: null,
      projects: [
        {
          projectId: "a",
          title: "Alpha",
          latestActivityAt: "2026-06-16T00:00:00Z",
          freshnessChangedSinceSeen: true,
        },
        { projectId: "b", title: "Beta", latestActivityAt: "2026-06-10T00:00:00Z" },
      ],
    });
    expect(out.prompts.some((p) => /pick up where you left off in alpha/i.test(p))).toBe(true);
    expect(out.prompts.some((p) => /alpha has new data/i.test(p))).toBe(false); // not double-offered
  });
});
