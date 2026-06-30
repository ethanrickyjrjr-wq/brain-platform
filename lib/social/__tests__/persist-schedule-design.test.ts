import { test, expect } from "bun:test";
import { freezePost, buildSocialScheduleInsert } from "@/lib/social/persist-schedule";
import type { SocialDraft } from "@/lib/email/social-calendar/types";
import type { SocialDesign } from "@/lib/social/design/types";

const draft = {
  day: "mon",
  theme: "x",
  caption: "hi",
  hashtags: ["swfl"],
  card: { globalStyle: {}, blocks: [] },
} as unknown as SocialDraft;

const design: SocialDesign = {
  version: 1,
  format: "portrait",
  background: "#000",
  elements: [],
};

test("freezePost stores the design when given", () => {
  const f = freezePost(draft, "2026-06-30T00:00:00Z", { mediaUrl: "https://x/a.png", design });
  expect(f.design).toEqual(design);
  expect(f.media_url).toBe("https://x/a.png");
});

test("freezePost design defaults to null", () => {
  const f = freezePost(draft, "2026-06-30T00:00:00Z", { mediaUrl: null });
  expect(f.design ?? null).toBeNull();
});

test("canvas insert (design present) disables the freshness gate", () => {
  const f = freezePost(draft, "2026-06-30T00:00:00Z", { mediaUrl: "https://x/a.png", design });
  const ins = buildSocialScheduleInsert({
    userId: "u",
    projectId: null,
    socialAccountId: "a",
    platform: "x",
    cadence: { cadence: "daily", send_hour_et: 9 },
    scopeKind: null,
    scopeValue: null,
    hashtags: [],
    mediaKind: "image",
    frozenPost: f,
    signature: null,
    nextRunAtIso: "2026-07-01T13:00:00Z",
  });
  expect(ins.freshness_gate).toBe(false);
});
