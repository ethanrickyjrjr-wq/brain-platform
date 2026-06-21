import { test, expect, mock } from "bun:test";
import * as fb from "@/lib/fetch-brain";

// Stateful brain mock: master is up by default; every other slug 404s. This lets us prove
// the #11 contract — resolveReportGrounding NEVER throws — on every failure path, and that
// it returns ungrounded (not a throw) even when master itself is down.
const state = { masterUp: true };
const MASTER_OUTPUT = {
  conclusion: "SWFL is cooling into summer 2026.",
  direction: "bearish",
  magnitude: 0.42,
  confidence: 0.71,
  refined_at: "2026-06-12",
  key_metrics: [],
  detail_tables: [],
  caveats: [],
};
mock.module("@/lib/fetch-brain", () => ({
  ...fb,
  fetchBrain: async (slug: string) => {
    if (slug === "master" && state.masterUp) {
      return { output: MASTER_OUTPUT, freshness_token: "SWFL-7421-v9-20260612" };
    }
    throw new fb.BrainNotFoundError(slug);
  },
}));

const { resolveReportGrounding } = await import("@/lib/highlighter/report-grounding");
const opts = { origin: "https://x" };

test("invalid-format ZIP degrades to the master region read — never throws (#11)", async () => {
  const g = await resolveReportGrounding("zip:abc", opts);
  expect(g.blocks.length).toBeGreaterThan(0);
  expect(g.surfaceNote).toBeTruthy(); // pinned to "answer at nearest grain, offer to pull"
});

test("a missing brain degrades to master — never throws (#11)", async () => {
  const g = await resolveReportGrounding("nope-not-real", opts);
  expect(g.blocks.length).toBeGreaterThan(0);
});

test("a valid ZIP whose brain is missing still degrades to master — never throws (#11)", async () => {
  const g = await resolveReportGrounding("zip:33913", opts); // home-values-swfl 404s here
  expect(g.blocks.length).toBeGreaterThan(0);
});

test("a corridor whose brain is missing degrades — never throws", async () => {
  const g = await resolveReportGrounding("corridor:does-not-exist", opts); // cre-swfl 404s
  expect(g.blocks.length).toBeGreaterThan(0);
});

test("even with master DOWN, returns ungrounded (empty) — still never throws (#11)", async () => {
  state.masterUp = false;
  try {
    const g = await resolveReportGrounding("nope-not-real", opts);
    expect(g.blocks.length).toBe(0); // ungrounded → engine answers honestly, but NO throw
  } finally {
    state.masterUp = true;
  }
});
