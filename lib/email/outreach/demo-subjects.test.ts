// lib/email/outreach/demo-subjects.test.ts
import { describe, expect, test } from "bun:test";
import { demoSubject } from "./demo-subjects";

const base = {
  track: "agent" as const,
  variant: "a" as const,
  name: "Dana",
  brokerage: null,
  place: "Park Shore",
  headlineFigure: null,
  medianDeltaK: null,
  sinceLabel: null,
};

describe("T1", () => {
  test("agent a carries name + place", () => {
    expect(demoSubject({ ...base, touch: "t1" })).toBe(
      "Dana, the Park Shore email your clients didn't get this morning",
    );
  });
  test("agent b uses a REAL figure; without one it falls back to shape a", () => {
    expect(
      demoSubject({ ...base, touch: "t1", variant: "b", headlineFigure: "214 active listings" }),
    ).toBe("Park Shore: 214 active listings — your clients could've had this by 9 AM");
    expect(demoSubject({ ...base, touch: "t1", variant: "b" })).toBe(
      "Dana, the Park Shore email your clients didn't get this morning",
    );
  });
  test("broker shapes speak fleet", () => {
    expect(
      demoSubject({ ...base, touch: "t1", track: "broker", brokerage: "BHHS Florida Realty" }),
    ).toBe("BHHS Florida Realty's Park Shore agents, powered by one data engine");
    expect(
      demoSubject({
        ...base,
        touch: "t1",
        track: "broker",
        variant: "b",
        brokerage: "BHHS Florida Realty",
        headlineFigure: "214 active listings",
      }),
    ).toBe("214 active listings in Park Shore — one engine for every BHHS Florida Realty agent");
  });
  test("a possessive brokerage does not double the 's", () => {
    expect(
      demoSubject({ ...base, touch: "t1", track: "broker", brokerage: "Premier Sotheby's" }),
    ).toBe("Premier Sotheby's Park Shore agents, powered by one data engine");
  });
});

describe("T2 truthfulness", () => {
  test("delta shape ONLY with a real non-zero move", () => {
    expect(demoSubject({ ...base, touch: "t2", medianDeltaK: 12, sinceLabel: "Tuesday" })).toBe(
      "Park Shore's median moved $12K since Tuesday",
    );
    expect(demoSubject({ ...base, touch: "t2", medianDeltaK: 0, sinceLabel: "Tuesday" })).toBe(
      "Park Shore re-checked Tuesday — your numbers held",
    );
    expect(demoSubject({ ...base, touch: "t2" })).toBe(
      "Park Shore re-checked today — your numbers held",
    );
  });
  test("negative move renders as a real signed figure", () => {
    expect(demoSubject({ ...base, touch: "t2", medianDeltaK: -8, sinceLabel: "Monday" })).toBe(
      "Park Shore's median moved -$8K since Monday",
    );
  });
});

describe("later touches", () => {
  test("t3 shapes per track", () => {
    expect(demoSubject({ ...base, touch: "t3" })).toBe(
      "Your Park Shore social calendar, already written",
    );
    expect(demoSubject({ ...base, touch: "t3", track: "broker", brokerage: "BHHS" })).toBe(
      "Which BHHS listings emails get opened? You'd know",
    );
  });
  test("t4 breakup + place stays-live", () => {
    expect(demoSubject({ ...base, touch: "t4" })).toBe(
      "Last one from us, Dana — your Park Shore setup stays live",
    );
  });
  test("trial daily uses a real figure or the honest fallback", () => {
    expect(demoSubject({ ...base, touch: "trial", headlineFigure: "3 new listings" })).toBe(
      "Park Shore today: 3 new listings",
    );
    expect(demoSubject({ ...base, touch: "trial" })).toBe(
      "Park Shore today — your daily market read",
    );
  });
  test("reengage", () => {
    expect(demoSubject({ ...base, touch: "reengage" })).toBe(
      "What changed in Park Shore since we last wrote",
    );
  });
});

describe("hygiene", () => {
  test("no banned cold-email phrases or raw tokens in any shape", () => {
    const all: string[] = [];
    for (const touch of ["t1", "t2", "t3", "t4", "trial", "reengage"] as const)
      for (const track of ["agent", "broker"] as const)
        for (const variant of ["a", "b"] as const)
          all.push(
            demoSubject({
              ...base,
              touch,
              track,
              variant,
              brokerage: "BHHS",
              headlineFigure: "214 active listings",
              medianDeltaK: 12,
              sinceLabel: "Tuesday",
            }),
          );
    for (const s of all) {
      expect(s.toLowerCase()).not.toContain("quick question");
      expect(s.toLowerCase()).not.toContain("just checking in");
      expect(s).not.toMatch(/SWFL-\d+-v\d+-\d{8}/);
    }
  });
});
