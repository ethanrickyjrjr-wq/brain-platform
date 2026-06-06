import { describe, it, expect } from "vitest";
import {
  resolveJurisdiction,
  KNOWN_JURISDICTIONS,
} from "./permit-jurisdiction-aliases.mts";

describe("permit-jurisdiction-aliases — Lee/Collier crosswalk", () => {
  // raw jurisdiction → [expected slug, expected place_fips (null=county grain), in_scope]
  const cases: Array<[string, string, string | null, boolean]> = [
    ["Unincorporated Lee County", "lee-county", null, true],
    ["City of Cape Coral", "cape-coral", "1210275", true],
    ["City of Fort Myers", "fort-myers", "1224125", true],
    ["City of Sanibel", "sanibel", "1263700", true],
    ["City of Bonita Springs", "bonita-springs", "1207525", true],
    ["Town of Fort Myers Beach", "fort-myers-beach", "1224150", true],
    ["Village of Estero", "estero", "1221150", true],
    ["Unincorporated Collier", "collier-county", null, true],
    ["City of Naples", "naples", "1247625", true],
    ["City of Marco Island", "marco-island", "1243083", true],
    // Charlotte County — present in the PDF, out of scope:
    ["Unincorporated Charlotte County", "charlotte-county", null, false],
    ["City of Punta Gorda", "punta-gorda", "1259200", false],
  ];

  for (const [raw, slug, fips, inScope] of cases) {
    it(`"${raw}" → ${slug} (in_scope=${inScope})`, () => {
      const r = resolveJurisdiction(raw);
      expect(r).not.toBeNull();
      expect(r!.place.slug).toBe(slug);
      expect(r!.place.place_fips).toBe(fips);
      expect(r!.in_scope).toBe(inScope);
    });
  }

  it("every KNOWN_JURISDICTIONS entry resolves (no holes)", () => {
    const unresolved = KNOWN_JURISDICTIONS.filter(
      (j) => resolveJurisdiction(j) === null,
    );
    expect(unresolved).toEqual([]);
  });

  it("only Lee + Collier jurisdictions are in_scope", () => {
    for (const j of KNOWN_JURISDICTIONS) {
      const r = resolveJurisdiction(j)!;
      expect(r.in_scope).toBe(
        r.place.county === "Lee" || r.place.county === "Collier",
      );
    }
  });

  it("an unrecognized jurisdiction returns null (never invents a place)", () => {
    expect(resolveJurisdiction("City of Tampa")).toBeNull();
    expect(resolveJurisdiction("")).toBeNull();
  });
});
