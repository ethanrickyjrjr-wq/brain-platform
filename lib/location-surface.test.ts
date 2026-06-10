/**
 * §D3 — the human's first move, as tests.
 *
 * The web surface decisions are pure functions so they lock as runtime
 * assertions, independent of any JSX render:
 *   - a typed query routes to the right canonical surface (redirect / render /
 *     out-of-scope) — NEVER a bare 404 for a real query;
 *   - did-you-mean fires when the RESOLVED name differs from what was TYPED
 *     (matched-name ≠ input — the honest signal; "bonita" is an exact alias of
 *     "Bonita Springs", so it never reaches resolvePlace's fuzzy path);
 *   - the identity card never presents an UNASSESSED barrier as a fact (G6);
 *   - chips speak human ("ZIP-level", "County-wide"), never the word "grain".
 *
 * Plan: docs/superpowers/plans/2026-06-09-universal-location-search/04-surfaces.md
 */
import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import {
  grainChipLabel,
  GRAIN_CHIP_LABEL,
  distinctChips,
  didYouMeanBanner,
  barrierTagLabel,
  identityForZip,
  identityForLocation,
  searchRoute,
  zipReportHref,
} from "./location-surface.ts";
import { resolveLocation, type LocationInput } from "../refinery/lib/location-resolver.mts";
import { resolveZip, type ZipResolution, type Grain } from "../refinery/lib/zip-resolver.mts";

// --- grain chips — human language, never "grain" ----------------------------

describe("grain chips speak human", () => {
  test("the four named human labels match the brief verbatim", () => {
    assert.equal(grainChipLabel("zip"), "ZIP-level");
    assert.equal(grainChipLabel("county"), "County-wide");
    assert.equal(grainChipLabel("msa"), "Metro-wide");
    assert.equal(grainChipLabel("region"), "Region-wide");
  });

  test("no chip label ever contains the word 'grain'", () => {
    for (const label of Object.values(GRAIN_CHIP_LABEL)) {
      assert.ok(!/grain/i.test(label), `chip label leaks "grain": ${label}`);
      assert.ok(label.trim().length > 0);
    }
  });

  test("distinctChips dedups + orders finest→coarsest", () => {
    const grains: Grain[] = ["county", "zip", "national", "county", "region"];
    const chips = distinctChips(grains.map((g) => ({ grain: g })));
    assert.deepEqual(
      chips.map((c) => c.grain),
      ["zip", "county", "region", "national"],
    );
    assert.equal(chips[0]!.label, "ZIP-level");
  });
});

// --- did-you-mean — keys off matched-name ≠ typed input ----------------------

describe("did-you-mean banner", () => {
  test("fires when the resolved place name differs from what was typed", () => {
    const banner = didYouMeanBanner("bonita", "Bonita Springs");
    assert.ok(banner, "expected a did-you-mean banner");
    assert.match(banner!, /Bonita Springs/);
    assert.match(banner!, /bonita/);
  });

  test("is silent when the typed input already matches (case/space-insensitive)", () => {
    assert.equal(didYouMeanBanner("naples", "Naples"), null);
    assert.equal(didYouMeanBanner("Fort Myers Beach", "Fort Myers Beach"), null);
    assert.equal(didYouMeanBanner("  bonita springs ", "Bonita Springs"), null);
  });

  test("is silent with no match or no original query", () => {
    assert.equal(didYouMeanBanner("bonita", null), null);
    assert.equal(didYouMeanBanner(null, "Bonita Springs"), null);
    assert.equal(didYouMeanBanner(undefined, undefined), null);
  });
});

// --- barrier tag — G6: never present an unassessed default as a fact --------

describe("barrier tag (G6)", () => {
  test("an unassessed (null) classification yields NO tag", () => {
    assert.equal(barrierTagLabel(null), null);
  });

  test("a sourced classification humanizes", () => {
    assert.equal(barrierTagLabel("barrier"), "barrier island");
    assert.equal(barrierTagLabel("coastal-mainland"), "coastal mainland");
    assert.equal(barrierTagLabel("inland"), "inland");
  });
});

// --- identity model — the "where" confirmation ------------------------------

describe("identity model", () => {
  test("a barrier ZIP shows place · county · barrier island (live 33931)", () => {
    const id = identityForZip(resolveZip("33931"));
    assert.equal(id.headline, "Fort Myers Beach");
    assert.match(id.subline, /Lee County/);
    assert.match(id.subline, /barrier island/);
    assert.match(id.subline, /ZIP 33931/);
  });

  test("an unassessed-barrier ZIP shows NO barrier descriptor (G6)", () => {
    const synth: ZipResolution = {
      zip: "34135",
      in_scope: true,
      counties: ["12071"],
      primary_county: "12071",
      county_names: ["Lee"],
      barrier: { classification: null, score: null, name: null },
      places: [
        {
          place: "Bonita Springs",
          match: "primary",
          county: "Lee",
          usps_preferred_city: "Bonita Springs",
          source: "USPS",
          needs_verification: false,
        },
      ],
      corridors: [],
      resolution_notes: [],
    };
    const id = identityForZip(synth);
    assert.equal(id.headline, "Bonita Springs");
    assert.match(id.subline, /Lee County/);
    assert.ok(
      !/barrier|island|inland|coastal/i.test(id.subline),
      `subline leaked a barrier guess: ${id.subline}`,
    );
  });

  test("a county input identifies the county, no ZIP", () => {
    const loc: LocationInput = { kind: "county", county: "12071", county_name: "Lee County" };
    const id = identityForLocation(loc);
    assert.equal(id.headline, "Lee County");
    assert.ok(!/ZIP/i.test(id.subline));
  });

  test("a corridor (pocket-only) input identifies the pocket + its county", () => {
    const loc: LocationInput = {
      kind: "corridor",
      corridor_id: null,
      pocket: "North Naples",
      county: "12021",
    };
    const id = identityForLocation(loc);
    assert.equal(id.headline, "North Naples");
    assert.match(id.subline, /Collier County/);
  });

  test("a region input identifies the whole region", () => {
    const id = identityForLocation({ kind: "region" });
    assert.match(id.headline, /Southwest Florida/);
  });
});

// --- search routing — the human's first move, acceptance #1 + #2 ------------

describe("searchRoute + zipReportHref", () => {
  test('"bonita" → redirect to the Bonita Springs ZIP page, carrying did-you-mean (acceptance #1)', async () => {
    const loc = await resolveLocation("bonita");
    const route = searchRoute(loc);
    assert.equal(route.kind, "redirect");
    assert.equal(route.kind === "redirect" && route.zip, "34135");
    assert.equal(route.kind === "redirect" && route.matched, "Bonita Springs");

    const href = zipReportHref("34135", { q: "bonita", matched: "Bonita Springs" });
    assert.equal(href, "/r/zip-report/34135?q=bonita&matched=Bonita+Springs");
  });

  test('"Miami" → out-of-scope, never a redirect or render (acceptance #2)', async () => {
    const loc = await resolveLocation("Miami");
    assert.equal(searchRoute(loc).kind, "out-of-scope");
  });

  test("an out-of-SWFL ZIP (33131, Miami) → out-of-scope, not a redirect", async () => {
    const loc = await resolveLocation("33131");
    assert.equal(loc.kind, "zip");
    assert.equal(searchRoute(loc).kind, "out-of-scope");
  });

  test("a bare in-scope ZIP redirects with a clean URL (no did-you-mean params)", async () => {
    const loc = await resolveLocation("33931");
    const route = searchRoute(loc);
    assert.equal(route.kind, "redirect");
    // kind:"zip" carries no `matched` → the page builds a clean permalink.
    assert.equal(route.kind === "redirect" && route.matched, null);
    assert.equal(zipReportHref("33931"), "/r/zip-report/33931");
  });

  test("county / corridor / region inputs RENDER inline (no ZIP permalink to redirect to)", async () => {
    const county: LocationInput = { kind: "county", county: "12071", county_name: "Lee County" };
    const corridor: LocationInput = {
      kind: "corridor",
      corridor_id: null,
      pocket: "North Naples",
      county: "12021",
    };
    assert.equal(searchRoute(county).kind, "render");
    assert.equal(searchRoute(corridor).kind, "render");
    assert.equal(searchRoute({ kind: "region" }).kind, "render");
  });

  test("address-unsupported (pre-geocoder) is out-of-scope, never a 404 upstream", () => {
    const loc: LocationInput = { kind: "address-unsupported", raw: "123 Main St" };
    assert.equal(searchRoute(loc).kind, "out-of-scope");
  });
});
