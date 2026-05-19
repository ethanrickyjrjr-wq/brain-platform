import { test } from "node:test";
import assert from "node:assert/strict";

// Force fixture mode BEFORE importing — env.mts reads process.env at module init.
process.env["REFINERY_SOURCE"] = "fixture";

const { hurricaneTracksFl, hurricaneTracksFlSource, buildSnapshot } =
  await import("./hurricane-tracks-fl.mts");

// Pin "now" to 2026-05-19 so the trailing-window tests are stable regardless of
// when CI runs. buildSnapshot accepts a Date; the producer's runtime path uses
// real Date.now() but tests inject a frozen value here.
const PINNED_NOW = new Date("2026-05-19T12:00:00Z");

test("pack metadata: id, brain_id, domain, leaf shape", () => {
  assert.equal(hurricaneTracksFl.id, "hurricane-tracks-fl");
  assert.equal(hurricaneTracksFl.brain_id, "hurricane-tracks-fl");
  assert.equal(hurricaneTracksFl.domain, "environmental");
  assert.deepEqual(hurricaneTracksFl.input_brains, []);
  assert.equal(hurricaneTracksFl.sources.length, 1);
  assert.equal(
    hurricaneTracksFl.sources[0]!.source_id,
    "hurdat2_fl_x_fema_nfip",
  );
  assert.equal(hurricaneTracksFl.sources[0]!.trust_tier, 1);
  assert.equal(hurricaneTracksFl.skipTriageAgent, true);
  assert.equal(hurricaneTracksFl.skipSynthesisAgent, true);
  assert.equal(hurricaneTracksFl.synthesisStrategy, "deterministic");
});

test("fixture-mode fetch yields >0 fragments, all tier 1", async () => {
  const fragments = await hurricaneTracksFlSource.fetch();
  assert.ok(
    fragments.length >= 10,
    `expected >=10 fixture fragments, got ${fragments.length}`,
  );
  for (const f of fragments) {
    assert.equal(f.source_id, "hurdat2_fl_x_fema_nfip");
    assert.equal(f.source_trust_tier, 1);
  }
});

test("buildSnapshot derives all 6 metrics from fixture", async () => {
  const fragments = await hurricaneTracksFlSource.fetch();
  const rows = fragments.map((f) => f.normalized as Record<string, unknown>);
  const snap = buildSnapshot(rows as never, PINNED_NOW);

  // Fixture has Ian 2022, Irma 2017, Charley 2004, Ivan 2004 (no landfall),
  // Helene 2024, Milton 2024. As of 2026-05-19:
  //  - 30yr landfall window covers 1996+: Ian (Lee+Charlotte landfall),
  //    Irma (Collier landfall), Charley (Charlotte landfall), Milton (Sarasota).
  //    Helene 2024 row has landfall_in_county=false in fixture. Ivan 2004 no landfall.
  //    Distinct storm_ids: AL092022, AL112017, AL062004, AL142024 = 4.
  assert.equal(snap.landfalls_30yr_storms, 4);

  // Cat3+ within 50mi in last 30yr: Ian (Cat4), Irma (Cat4), Charley (Cat4),
  // Helene (Cat4), Milton (Cat3). Ivan row's closest pass is 41.2mi (within 50)
  // but distance check is at SQL layer; here in fixture it's already filtered.
  // Distinct storms in fixture with max_category_saffir>=3 and storm_year>=1996.
  // = AL092022, AL112017, AL062004, AL122024, AL142024 (5) — Ivan excluded only
  // if its row isn't there; fixture has Ivan AL092004 with cat 5 within 50mi.
  // So 6 distinct storms.
  assert.equal(snap.cat3plus_passes_50mi_30yr_storms, 6);

  // Avg NFIP per landfall row > 0
  assert.ok(snap.nfip_paid_per_landfall_storm_avg_usd > 0);

  // Worst landfall row: Ian × Lee 2022 fixture = $4.52B
  assert.equal(snap.worst_storm_county_year_nfip_paid_usd, 4_520_000_000);

  // Most recent landfall: Milton 2024-10-09 beats Ian 2022-09-28.
  assert.ok(snap.most_recent_landfall_label?.includes("MILTON"));
  assert.ok(snap.most_recent_landfall_label?.includes("2024-10-09"));

  // Closest pass last 5yr (2021+): Milton 6.7mi, Ian 4.2mi → 4.2.
  assert.equal(snap.closest_pass_5yr_min_mi, 4.2);
});

test("Ian 2022 appears in fixture with correct shape", async () => {
  const fragments = await hurricaneTracksFlSource.fetch();
  const ianLee = fragments.find((f) => {
    const r = f.normalized as Record<string, unknown>;
    return r["storm_id"] === "AL092022" && r["county_fips"] === "12071";
  });
  assert.ok(ianLee, "Ian × Lee row must exist in fixture");
  const r = ianLee!.normalized as Record<string, unknown>;
  assert.equal(r["storm_name"], "IAN");
  assert.equal(r["max_category_saffir"], 4);
  assert.equal(r["landfall_in_county"], true);
  assert.equal(r["nfip_paid_usd_storm_year"], 4_520_000_000);
});

test("outputProducer emits direction=neutral, magnitude=0.2, >0 metrics", async () => {
  // Touch the corpusSummary first to populate the module-level lastSnapshot.
  const fragments = await hurricaneTracksFlSource.fetch();
  hurricaneTracksFl.corpusSummary!(fragments);

  const result = hurricaneTracksFl.outputProducer!({
    pack: hurricaneTracksFl,
    version: 1,
    refined_at: "2026-05-19T12:00:00Z",
    citations: [],
    facts: [],
    recentNote: "",
  });

  assert.equal(result.direction, "neutral");
  assert.equal(result.magnitude, 0.2);
  assert.ok(result.key_metrics.length >= 5);
  for (const m of result.key_metrics) {
    assert.equal(m.source.tier, 1);
    assert.ok(m.source.url.length > 0);
    assert.ok(m.source.citation.length > 0);
  }
  assert.ok(result.conclusion.length > 100);
  assert.ok(result.caveats.length >= 4);
  // Fixture-mode caveat should be prepended.
  assert.ok(result.caveats[0]!.includes("fixture"));
});

test("outputProducer is deterministic — same input -> same output", async () => {
  const fragments = await hurricaneTracksFlSource.fetch();
  hurricaneTracksFl.corpusSummary!(fragments);
  const a = hurricaneTracksFl.outputProducer!({
    pack: hurricaneTracksFl,
    version: 1,
    refined_at: "2026-05-19T12:00:00Z",
    citations: [],
    facts: [],
    recentNote: "",
  });
  hurricaneTracksFl.corpusSummary!(fragments);
  const b = hurricaneTracksFl.outputProducer!({
    pack: hurricaneTracksFl,
    version: 1,
    refined_at: "2026-05-19T12:00:00Z",
    citations: [],
    facts: [],
    recentNote: "",
  });
  assert.deepEqual(a, b);
});
