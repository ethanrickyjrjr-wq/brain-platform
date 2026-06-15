import { describe, it, expect } from "bun:test";
import { EXAMPLE_CARDS } from "./example-cards";
import { EXAMPLE_SCENARIOS } from "../deliverable/examples";

/**
 * The client-safe EXAMPLE_CARDS (panel) and the server build scenarios (cron) are two
 * lists keyed by the same ids. If they drift, a card opens a /p/example-* that the
 * cron never builds (404) or the cron builds an example no card surfaces. Lock them.
 */

describe("example cards <-> build scenarios stay in sync", () => {
  it("every card id has a matching build scenario (card opens a real /p/example-*)", () => {
    const scenarioIds = new Set(EXAMPLE_SCENARIOS.map((s) => s.id));
    for (const c of EXAMPLE_CARDS) expect(scenarioIds.has(c.id)).toBe(true);
  });
  it("every build scenario has a card (no orphan example with no entry point)", () => {
    const cardIds = new Set(EXAMPLE_CARDS.map((c) => c.id));
    for (const s of EXAMPLE_SCENARIOS) expect(cardIds.has(s.id)).toBe(true);
  });
});
