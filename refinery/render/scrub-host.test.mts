import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { scrubCaveatTechnical } from "./speaker.mts";

describe("scrubCaveatTechnical — host-phrase hygiene", () => {
  test("maps 'Brains Supabase' to the public lake name", () => {
    const out = scrubCaveatTechnical(
      "Florida DOR Tourist Development Tax via Brains Supabase fl_dor_tdt_collections (666 rows)",
    );
    assert.ok(!/Supabase/i.test(out), `"Supabase" survived: ${out}`);
    assert.match(out, /SWFL Data Gulf/);
  });

  test("pass-through battery: never eats domain acronyms, numbers, or dates", () => {
    for (const safe of [
      "SOFR",
      "NFIP",
      "FEMA",
      "FDOT",
      "NAICS",
      "AAL",
      "WGS84",
      "2026-04",
      "20260530",
      "Lee + Collier",
    ]) {
      assert.equal(scrubCaveatTechnical(safe), safe, `scrub altered a safe token: ${safe}`);
    }
  });
});
