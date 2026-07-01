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
