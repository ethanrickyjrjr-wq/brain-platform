import { describe, expect, it } from "bun:test";
import {
  buildSocialContent,
  type BrainDossier,
  type BuildSocialContentDeps,
} from "./build-content";
import type { SocialTarget } from "./types";

function makeTarget(over: Partial<SocialTarget> = {}): SocialTarget {
  return {
    scheduleId: 1,
    userId: "user-abc",
    platform: "linkedin",
    accountId: "acct-1",
    scopeKind: "zip",
    scopeValue: "33931",
    topic: null,
    cadence: "weekly",
    hashtags: ["#FortMyersBeach"],
    contentTemplate: "stat_card",
    freshnessGate: true,
    lastFreshnessToken: null,
    ...over,
  };
}

const inScopeDossier: BrainDossier = {
  in_scope: true,
  freshness_token: "SWFL-7421-v5-20260620",
  conclusion: "Fort Myers Beach remains a high-value market.",
  key_metrics: [{ label: "Median home value", value: "$482K" }],
};

const outOfScopeDossier: BrainDossier = {
  in_scope: false,
  freshness_token: "SWFL-7421-v5-20260620",
};

function deps(fetchResult: BrainDossier | null): BuildSocialContentDeps {
  return { fetchBrain: async () => fetchResult };
}

describe("buildSocialContent", () => {
  it("returns content for an in-scope ZIP target", async () => {
    const content = await buildSocialContent(makeTarget(), deps(inScopeDossier));
    expect(content).not.toBeNull();
    expect(content!.freshness).toBe("SWFL-7421-v5-20260620");
    expect(content!.caption).toContain("Fort Myers Beach");
    expect(content!.caption).toContain("Median home value");
    expect(content!.hashtags).toContain("#FortMyersBeach");
  });

  it("MOAT gate: returns null when in_scope=false (never posts out-of-scope data)", async () => {
    const content = await buildSocialContent(makeTarget(), deps(outOfScopeDossier));
    expect(content).toBeNull();
  });

  it("MOAT gate: returns null when brain fetch returns null (unavailable)", async () => {
    const content = await buildSocialContent(makeTarget(), deps(null));
    expect(content).toBeNull();
  });

  it("handles place scope (not ZIP — scope-agnostic)", async () => {
    const target = makeTarget({ scopeKind: "place", scopeValue: "naples" });
    const content = await buildSocialContent(target, deps(inScopeDossier));
    expect(content).not.toBeNull();
    expect(content!.hashtags.some((h) => h.toLowerCase().includes("naples"))).toBe(true);
  });

  it("handles county scope", async () => {
    const target = makeTarget({ scopeKind: "county", scopeValue: "lee county" });
    const content = await buildSocialContent(target, deps(inScopeDossier));
    expect(content).not.toBeNull();
    expect(content!.hashtags.some((h) => h.includes("LeeCounty"))).toBe(true);
  });

  it("handles null scope (whole region)", async () => {
    const target = makeTarget({ scopeKind: null, scopeValue: null });
    const content = await buildSocialContent(target, deps(inScopeDossier));
    expect(content).not.toBeNull();
    // No invented sub-region label when scope is whole region
    expect(content!.hashtags).toContain("#SWFL");
  });

  it("caption does not include any placeholder literals (no-invention smoke)", async () => {
    const content = await buildSocialContent(makeTarget(), deps(inScopeDossier));
    // Placeholder literals that a templated system might accidentally emit
    const PLACEHOLDERS = ["{{", "}}", "[VALUE]", "[METRIC]", "undefined", "null"];
    for (const placeholder of PLACEHOLDERS) {
      expect(content!.caption).not.toContain(placeholder);
    }
  });

  it("includes data attribution in the caption", async () => {
    const content = await buildSocialContent(makeTarget(), deps(inScopeDossier));
    expect(content!.caption).toContain("SWFL Data Gulf");
  });
});
