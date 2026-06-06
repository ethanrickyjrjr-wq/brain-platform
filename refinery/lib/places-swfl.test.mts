import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PLACES,
  resolvePlace,
  parentOf,
  metricSlug,
  normalizePlace,
} from "./places-swfl.mts";
import { SWFL_COUNTY_FIPS } from "./swfl-geo.mts";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "..", "..", "fixtures");

interface CrosswalkEntry {
  place: string;
  county: string;
}
const crosswalk: { entries: CrosswalkEntry[] } = JSON.parse(
  readFileSync(
    path.join(FIXTURES_DIR, "swfl-place-zip-crosswalk.json"),
    "utf-8",
  ),
);

describe("places-swfl resolver — the two live leaks", () => {
  it('"Outlying Collier County" collapses to Collier County (not a raw label)', () => {
    const rec = resolvePlace("Outlying Collier County");
    expect(rec?.slug).toBe("collier-county");
    expect(rec?.display).toBe("Collier County");
    expect(rec?.county).toBe("Collier");
  });

  it('"sfm-san-carlos" resolves to San Carlos Park, parent Fort Myers (Lee)', () => {
    const rec = resolvePlace("sfm-san-carlos");
    expect(rec?.slug).toBe("san-carlos-park");
    expect(rec?.display).toBe("San Carlos Park");
    expect(rec?.parent).toBe("fort-myers");
    expect(rec?.county).toBe("Lee");
  });
});

describe("places-swfl resolver — bureaucratic + plain + abbreviated forms", () => {
  const cases: Array<[string[], string]> = [
    [
      ["City of Cape Coral", "CITY OF CAPE CORAL", "Cape Coral", "cape coral"],
      "cape-coral",
    ],
    [
      ["Unincorporated Lee County", "UNINC LEE", "Lee County", "Lee"],
      "lee-county",
    ],
    [
      ["Unincorporated Collier", "UNINC COLLIER", "Collier County", "Collier"],
      "collier-county",
    ],
    [["City of Naples", "Naples"], "naples"],
    [
      ["Town of Fort Myers Beach", "Fort Myers Beach", "FMB"],
      "fort-myers-beach",
    ],
    [["Village of Estero", "Estero"], "estero"],
    [["City of Marco Island", "Marco Island", "Marco"], "marco-island"],
  ];
  for (const [variants, slug] of cases) {
    for (const v of variants) {
      it(`"${v}" → ${slug}`, () => {
        expect(resolvePlace(v)?.slug).toBe(slug);
      });
    }
  }
});

describe("places-swfl resolver — roll-up (granularity decision)", () => {
  it("Naples sub-areas roll up to Naples", () => {
    for (const sub of ["East Naples", "North Naples", "Golden Gate", "Lely"]) {
      expect(parentOf(sub)?.slug).toBe("naples");
      expect(resolvePlace(sub)?.county).toBe("Collier");
    }
  });

  it("Fort Myers sub-areas roll up to Fort Myers", () => {
    for (const sub of ["North Fort Myers", "sfm-san-carlos", "The Islands"]) {
      expect(parentOf(sub)?.slug).toBe("fort-myers");
      expect(resolvePlace(sub)?.county).toBe("Lee");
    }
  });

  it("Lehigh Acres is its own community (Lee), NOT under Fort Myers", () => {
    expect(parentOf("Lehigh")?.slug).toBe("lehigh-acres");
    expect(resolvePlace("Lehigh")?.county).toBe("Lee");
  });
});

describe("places-swfl resolver — county truth vs sourced ZIP crosswalk", () => {
  it("every place we both know agrees on county", () => {
    const mismatches: string[] = [];
    for (const e of crosswalk.entries) {
      const rec = resolvePlace(e.place);
      if (!rec) continue; // crosswalk has places we don't carry (Gateway, Immokalee)
      if (rec.county.toLowerCase() !== e.county.toLowerCase()) {
        mismatches.push(`${e.place}: ours=${rec.county} crosswalk=${e.county}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe("places-swfl resolver — FIPS integrity (provenance guard)", () => {
  it("every county_fips is a known SWFL county", () => {
    for (const rec of Object.values(PLACES)) {
      expect(SWFL_COUNTY_FIPS.has(rec.county_fips)).toBe(true);
    }
  });

  it("every place_fips is a 7-digit GEOID starting 12 (FL); county rows are null", () => {
    for (const rec of Object.values(PLACES)) {
      if (rec.grain === "county") {
        expect(rec.place_fips).toBeNull();
      } else if (rec.place_fips != null) {
        expect(rec.place_fips).toMatch(/^12\d{5}$/);
      }
    }
  });

  it("the handed-map wrong FIPS never reappear (Census-verified values only)", () => {
    const wrong = new Set([
      "1210285", // Cape Coral typo → real 1210275
      "1247650", // Naples Manor, NOT Naples → real 1247625
      "1207325", // Bonita typo → real 1207525
      "1221462", // Estero typo → real 1221150
      "1264000", // Sanibel typo → real 1263700
      "1243675", // Marco typo → real 1243083
    ]);
    const reappeared = Object.values(PLACES)
      .map((r) => r.place_fips)
      .filter((f): f is string => f != null && wrong.has(f));
    expect(reappeared).toEqual([]);
  });

  it("the corrected values are present where expected", () => {
    expect(PLACES["cape-coral"].place_fips).toBe("1210275");
    expect(PLACES["naples"].place_fips).toBe("1247625");
    expect(PLACES["bonita-springs"].place_fips).toBe("1207525");
    expect(PLACES["estero"].place_fips).toBe("1221150");
    expect(PLACES["sanibel"].place_fips).toBe("1263700");
    expect(PLACES["marco-island"].place_fips).toBe("1243083");
  });
});

describe("places-swfl resolver — misc contract", () => {
  it('"The Islands" (Sanibel + Captiva) rolls up to Fort Myers / Lee', () => {
    const rec = resolvePlace("The Islands");
    expect(rec?.slug).toBe("the-islands");
    expect(rec?.display).toBe("The Islands");
    expect(rec?.place_fips).toBeNull(); // combined area, not a single Census place
    expect(parentOf("The Islands")?.slug).toBe("fort-myers");
    expect(rec?.county).toBe("Lee");
  });

  it("a genuinely unknown label returns null", () => {
    expect(resolvePlace("Atlanta")).toBeNull();
    expect(resolvePlace("")).toBeNull();
  });

  it("metricSlug converts kebab to snake", () => {
    expect(metricSlug(PLACES["east-naples"])).toBe("east_naples");
    expect(metricSlug(PLACES["san-carlos-park"])).toBe("san_carlos_park");
  });

  it("every parent pointer resolves to a real place", () => {
    for (const rec of Object.values(PLACES)) {
      expect(PLACES[rec.parent]).toBeDefined();
    }
  });

  it("normalizePlace strips government words + punctuation", () => {
    expect(normalizePlace("City of Ft. Myers")).toBe("ft myers");
    expect(normalizePlace("UNINC. COLLIER")).toBe("collier");
  });
});
