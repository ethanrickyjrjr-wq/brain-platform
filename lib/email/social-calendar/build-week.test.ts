import { test, expect } from "bun:test";
import { EmailDocSchema } from "@/lib/email/doc/schema";
import { seedSocialCard, socialPostSystem, tryParseSocial, assembleDraft } from "./build-week";
import { DAY_THEMES } from "./themes";

const monday = DAY_THEMES[0]; // hero + stats

test("seedSocialCard builds a valid doc with the theme's blocks and no header/footer", () => {
  const card = seedSocialCard(monday);
  expect(EmailDocSchema.safeParse(card).success).toBe(true);
  expect(card.blocks.map((b) => b.type)).toEqual(["hero", "stats"]);
  expect(card.blocks.some((b) => b.type === "header" || b.type === "footer")).toBe(false);
});

test("socialPostSystem carries the four-lane rule, the lake data, and the day addendum", () => {
  const sys = socialPostSystem("median $485K · LeePA · 05/2026", monday.systemAddendum);
  expect(sys).toContain("four lanes");
  expect(sys).toContain("invented number");
  expect(sys).toContain("median $485K");
  expect(sys).toContain(monday.systemAddendum);
});

test("tryParseSocial parses caption+hashtags+patch, rejects no-caption, clamps to 8 tags", () => {
  const ok = tryParseSocial(
    '{"captionText":"Median hit $485K.","hashtags":["a","b","c","d","e","f","g","h","i"],"patch":{"x":{"value":"$485K"}}}',
  );
  expect(ok?.caption).toBe("Median hit $485K.");
  expect(ok?.hashtags.length).toBe(8);
  expect(tryParseSocial('{"hashtags":[]}')).toBeNull();
  expect(tryParseSocial("not json")).toBeNull();
});

test("assembleDraft applies the patch INTO the card cells (AI-fill actually fills)", () => {
  const card = seedSocialCard(monday);
  const heroId = card.blocks[0].id;
  const draft = assembleDraft(monday, card, {
    caption: "Median hit $485K this week.",
    hashtags: ["FortMyers", "SWFLDataGulf"],
    patch: { [heroId]: { value: "$485K", label: "Median Sale Price" } },
  });
  expect(draft).not.toBeNull();
  expect((draft!.card.blocks[0].props as { value?: string }).value).toBe("$485K");
  expect(draft!.theme).toBe("Market Monday");
  expect(draft!.day).toBe("mon");
});
