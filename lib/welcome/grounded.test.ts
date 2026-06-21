import { test, expect } from "bun:test";
import { detectWelcomeLocation, buildWelcomeGroundedSystem, prettySource } from "./grounded";
import type { LocationDossier, LocationDossierLine } from "@/lib/zip-dossier";

// --- prettySource: logical-source MAP, default-deny (RULE 5, no false citations) ---

test("prettySource maps S3 bucket hosts to the real publisher, never amazonaws.com", () => {
  expect(prettySource("https://redfin-public-data.s3.us-west-2.amazonaws.com/x/y.tsv")).toBe(
    "redfin.com",
  );
  expect(prettySource("https://noaa-ghcn-pds.s3.amazonaws.com/csv/by_station/USW.csv")).toBe(
    "noaa.gov",
  );
  expect(prettySource("https://hazards.fema.gov/nfhl/rest")).toBe("fema.gov");
  expect(prettySource("https://www.zillow.com/research/data/")).toBe("zillow.com");
});

test("prettySource default-denies internal/CDN/unknown hosts (→ '')", () => {
  expect(prettySource("https://jtkdowmrjaxfvwmemxso.supabase.co/storage/x.parquet")).toBe("");
  expect(prettySource("https://s3.wasabisys.com/app/uploads/2024/rsw.pdf")).toBe("");
  expect(prettySource("https://services2.arcgis.com/abc/FeatureServer/0")).toBe("");
  expect(prettySource("garbage")).toBe("");
  expect(prettySource("")).toBe("");
  // output is ALWAYS a clean domain or "" — never an internal lake table name
  // (a data_lake.fema_* string maps to its real publisher fema.gov, never echoes the table)
  expect(prettySource("data_lake.fema_nfip_claims_swfl")).not.toContain("data_lake");
  expect(prettySource("data_lake.some_unknown_table")).toBe("");
});

test("prettySource maps verbose citations (the render path) to clean domains", () => {
  expect(prettySource("", "FEMA NFHL Flood Hazard Zones (Layer 28 / S_FLD_HAZ_AR)")).toBe(
    "fema.gov",
  );
  expect(prettySource("", "Redfin Data Center weekly housing metrics")).toBe("redfin.com");
  expect(prettySource("", "Zillow ZORI, May 2026")).toBe("zillow.com");
  // an arcgis HOST but a FEMA citation → still resolves to fema.gov (citation wins)
  expect(prettySource("https://services2.arcgis.com/x", "FEMA NFHL flood hazard")).toBe("fema.gov");
});

// --- detectWelcomeLocation ---

const u = (content: string) => ({ role: "user" as const, content });
const a = (content: string) => ({ role: "assistant" as const, content });

test("detects an in-scope typed ZIP as an explicit ZIP", () => {
  const d = detectWelcomeLocation([u("what's the flood risk in 33931?")]);
  expect(d).toEqual({ token: "33931", explicitZip: true });
});

test("an out-of-scope 5-digit token is returned (→ gap path), never grounded", () => {
  // 90210 (Beverly Hills) and 50000 (a salary) both fail in-scope → explicitZip true,
  // and the route turns explicitZip+out-of-scope into the honest gap, never invention.
  expect(detectWelcomeLocation([u("homes in 90210?")])).toEqual({
    token: "90210",
    explicitZip: true,
  });
  expect(detectWelcomeLocation([u("I make 50000, what can I afford?")])).toEqual({
    token: "50000",
    explicitZip: true,
  });
});

test("a four-digit token is NOT treated as a ZIP", () => {
  expect(detectWelcomeLocation([u("unit 3393 is for sale")])).toBeNull();
});

test("a known town resolves to its primary ZIP but stays explicitZip:false (flood suppressed)", () => {
  const d = detectWelcomeLocation([u("tell me about Cape Coral")]);
  expect(d).not.toBeNull();
  expect(d!.explicitZip).toBe(false);
  expect(d!.token).toMatch(/^\d{5}$/);
});

test("an in-scope ZIP in the same message beats a place name", () => {
  const d = detectWelcomeLocation([u("Cape Coral, specifically 33931")]);
  expect(d).toEqual({ token: "33931", explicitZip: true });
});

test("falls back to an older user turn when the latest names no location", () => {
  const d = detectWelcomeLocation([u("flood risk in 33931?"), a("…"), u("and what about prices?")]);
  expect(d).toEqual({ token: "33931", explicitZip: true });
});

test("returns null when no location is named", () => {
  expect(detectWelcomeLocation([u("what can you do?")])).toBeNull();
});

// --- buildWelcomeGroundedSystem ---

function line(over: Partial<LocationDossierLine> & { brain_id: string }): LocationDossierLine {
  return {
    domain: "real-estate",
    grain: "zip",
    coverage_label: `ZIP 33931`,
    is_true_zip: true,
    text: "**Metric** — value.",
    source_citation: "",
    source_url: "",
    ...over,
  };
}

function dossier(lines: LocationDossierLine[]): LocationDossier {
  return {
    resolved_as: "zip",
    zip: "33931",
    in_scope: true,
    resolution: null,
    lines,
    freshness_tokens: {
      "env-swfl": "SWFL-7421-v9-20260601",
      "housing-swfl": "SWFL-7421-v9-20260601",
    },
    coverage_caveats: [],
  };
}

const FLOOD = line({
  brain_id: "env-swfl",
  domain: "environmental",
  text: "**Flood (NFIP AAL)** — $30,074/yr.\n\nSource: FEMA NFHL Flood Hazard Zones (Layer 28 / S_FLD_HAZ_AR)\n\n_Freshness:_ `SWFL-7421-v9-20260601`",
});
const HOUSING = line({
  brain_id: "housing-swfl",
  text: "**Median value** — $450,000.\n\nSource: Redfin Data Center weekly metrics",
});

test("grounded system carries the no-math floor + coverage-label rule + RULES + one freshness token", () => {
  const sys = buildWelcomeGroundedSystem({
    dossier: dossier([FLOOD, HOUSING]),
    detectedText: "33931",
    explicitZip: true,
  });
  // moat: the structural no-derivation floor
  expect(sys).toContain("arithmetic");
  expect(sys).toContain("fabrication");
  // coverage-label propagation rule present
  expect(sys.toLowerCase()).toContain("county-wide");
  // the lean rules block rides in the prompt
  expect(sys).toContain("RULES OF ENGAGEMENT");
  // freshness is stated as a clean as-of DATE — the raw internal token never leaks into prose
  expect(sys).toContain("as of 06/01/2026");
  expect(sys).toContain("Never print an internal freshness token");
  expect(sys).not.toContain("Quote this freshness token");
  // sources are cleaned to homepage domains, never the verbose/internal string
  expect(sys).toContain("Source: fema.gov");
  expect(sys).toContain("Source: redfin.com");
  expect(sys).not.toContain("S_FLD_HAZ_AR");
  // ZIP→place ground truth pinned (never the raw token interpolated as an instruction)
  expect(sys).toContain("ZIP 33931 =");
});

test("flood AAL is shown for an explicit ZIP but SUPPRESSED for a town name", () => {
  const withZip = buildWelcomeGroundedSystem({
    dossier: dossier([FLOOD, HOUSING]),
    detectedText: "33931",
    explicitZip: true,
  });
  expect(withZip).toContain("$30,074"); // flood present for explicit ZIP

  const withTown = buildWelcomeGroundedSystem({
    dossier: dossier([FLOOD, HOUSING]),
    detectedText: "33931",
    explicitZip: false,
  });
  expect(withTown).not.toContain("$30,074"); // env-swfl flood suppressed for a town
  expect(withTown).toContain("$450,000"); // other per-ZIP data still flows
});
