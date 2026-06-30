// lib/social/design/__tests__/serialize.test.ts
import { test, expect } from "bun:test";
import {
  newDesign,
  serializeDesign,
  deserializeDesign,
  designToSkeleton,
  applyDesignPatch,
} from "@/lib/social/design/serialize";
import type { SocialDesign } from "@/lib/social/design/types";

const sample: SocialDesign = {
  version: 1,
  format: "square",
  background: "#0f1d24",
  elements: [
    {
      id: "t1",
      type: "text",
      x: 80,
      y: 80,
      width: 920,
      height: 120,
      text: "Headline here",
      fontSize: 64,
      fontFamily: "Arial",
      fill: "#ffffff",
    },
    {
      id: "s1",
      type: "stat",
      x: 80,
      y: 240,
      width: 600,
      height: 200,
      value: "$412K",
      label: "median sale price",
      valueFontSize: 130,
      labelFontSize: 34,
      fill: "#ffffff",
      accent: "#0ea5b7",
    },
    { id: "i1", type: "image", x: 0, y: 700, width: 1080, height: 380, src: "https://x/p.png" },
  ],
};

test("newDesign seeds an empty design at the requested format", () => {
  const d = newDesign("portrait");
  expect(d.version).toBe(1);
  expect(d.format).toBe("portrait");
  expect(d.elements).toEqual([]);
});

test("serialize → deserialize round-trips", () => {
  const json = serializeDesign(sample);
  const back = deserializeDesign(json);
  expect(back).toEqual(sample);
});

test("deserialize rejects garbage", () => {
  expect(deserializeDesign("not json")).toBeNull();
  expect(deserializeDesign(JSON.stringify({ version: 99 }))).toBeNull();
});

test("designToSkeleton emits only text-bearing elements + their text fields", () => {
  expect(designToSkeleton(sample)).toEqual({
    t1: { type: "text", text: "Headline here" },
    s1: { type: "stat", value: "$412K", label: "median sale price" },
    // i1 (image) excluded — no text
  });
});

test("applyDesignPatch updates text fields by id, leaves geometry/colors/images untouched", () => {
  const patched = applyDesignPatch(sample, {
    t1: { text: "New headline" },
    s1: { value: "$455K", label: "median list price", fill: "#000000" /* ignored */ },
    i1: { src: "https://evil/x.png" /* ignored — image not text-patchable */ },
    bogus: { text: "no element" /* ignored */ },
  });
  const t1 = patched.elements.find((e) => e.id === "t1")!;
  const s1 = patched.elements.find((e) => e.id === "s1")!;
  const i1 = patched.elements.find((e) => e.id === "i1")!;
  expect(t1.type === "text" && t1.text).toBe("New headline");
  expect(t1.type === "text" && t1.fontSize).toBe(64); // geometry intact
  expect(s1.type === "stat" && s1.value).toBe("$455K");
  expect(s1.type === "stat" && s1.label).toBe("median list price");
  expect(s1.type === "stat" && s1.fill).toBe("#ffffff"); // color NOT patched
  expect(i1.type === "image" && i1.src).toBe("https://x/p.png"); // image NOT patched
  expect(patched).not.toBe(sample); // immutable
});
