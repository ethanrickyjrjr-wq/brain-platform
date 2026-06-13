import { test, expect, beforeEach, afterEach } from "bun:test";
import {
  assembleGuardedDossier,
  dossierCacheKey,
  __resetWelcomeDossierCache,
} from "./dossier-cache";
import type { LocationDossier } from "@/lib/zip-dossier";
import type { LocationInput } from "@/refinery/lib/location-resolver.mts";

const zipLoc = (zip: string): LocationInput =>
  ({ kind: "zip", resolution: { zip, in_scope: true } }) as unknown as LocationInput;

function dossier(over: Partial<LocationDossier> = {}): LocationDossier {
  return {
    resolved_as: "zip",
    zip: "33931",
    in_scope: true,
    resolution: null,
    lines: [
      {
        brain_id: "housing-swfl",
        domain: "real-estate",
        grain: "zip",
        coverage_label: "ZIP 33931",
        is_true_zip: true,
        text: "x",
        source_citation: "",
        source_url: "",
      },
    ],
    freshness_tokens: {},
    coverage_caveats: [],
    ...over,
  };
}

/** A counting fake assembler so we can assert when a real fan-out actually ran. */
function countingAssembler(result: LocationDossier = dossier()) {
  let calls = 0;
  const impl = async () => {
    calls += 1;
    return result;
  };
  return { impl, calls: () => calls };
}

const NOW = 1_700_000_000_000; // fixed epoch; same UTC day for the whole window

beforeEach(() => __resetWelcomeDossierCache());
afterEach(() => {
  delete process.env.WELCOME_DOSSIER_DAILY_CAP;
  __resetWelcomeDossierCache();
});

test("dossierCacheKey is stable per resolved location", () => {
  expect(dossierCacheKey(zipLoc("33931"))).toBe("r:33931");
  expect(dossierCacheKey({ kind: "region" } as LocationInput)).toBe("region");
});

test("second lookup of the same ZIP is served from cache (no second fan-out)", async () => {
  const fake = countingAssembler();
  const a = await assembleGuardedDossier(zipLoc("33931"), {
    assembleImpl: fake.impl,
    now: () => NOW,
  });
  const b = await assembleGuardedDossier(zipLoc("33931"), {
    assembleImpl: fake.impl,
    now: () => NOW,
  });
  expect(a.fromCache).toBe(false);
  expect(b.fromCache).toBe(true);
  expect(fake.calls()).toBe(1);
});

test("cache entry expires after the TTL → re-assembles", async () => {
  const fake = countingAssembler();
  await assembleGuardedDossier(zipLoc("33931"), { assembleImpl: fake.impl, now: () => NOW });
  // 6 minutes later (TTL is 5) — same UTC day, so it's TTL eviction, not a daily roll.
  const later = NOW + 6 * 60 * 1000;
  const b = await assembleGuardedDossier(zipLoc("33931"), {
    assembleImpl: fake.impl,
    now: () => later,
  });
  expect(b.fromCache).toBe(false);
  expect(fake.calls()).toBe(2);
});

test("daily ceiling: real fan-outs beyond the cap return capped, never fetch", async () => {
  process.env.WELCOME_DOSSIER_DAILY_CAP = "2";
  const fake = countingAssembler();
  const r1 = await assembleGuardedDossier(zipLoc("33901"), {
    assembleImpl: fake.impl,
    now: () => NOW,
  });
  const r2 = await assembleGuardedDossier(zipLoc("33902"), {
    assembleImpl: fake.impl,
    now: () => NOW,
  });
  const r3 = await assembleGuardedDossier(zipLoc("33903"), {
    assembleImpl: fake.impl,
    now: () => NOW,
  });
  expect(r1.capped).toBe(false);
  expect(r2.capped).toBe(false);
  expect(r3.capped).toBe(true); // over the daily cap
  expect(r3.dossier).toBeUndefined();
  expect(fake.calls()).toBe(2); // the 3rd never fanned out
});

test("a cache HIT does not consume daily-cap budget", async () => {
  process.env.WELCOME_DOSSIER_DAILY_CAP = "1";
  const fake = countingAssembler();
  await assembleGuardedDossier(zipLoc("33931"), { assembleImpl: fake.impl, now: () => NOW }); // 1 unit
  const hit = await assembleGuardedDossier(zipLoc("33931"), {
    assembleImpl: fake.impl,
    now: () => NOW,
  });
  expect(hit.fromCache).toBe(true);
  expect(hit.capped).toBe(false); // cache hit is free, not capped
});

test("cap unset/0 → unlimited (disabled)", async () => {
  const fake = countingAssembler();
  for (let i = 0; i < 5; i++) {
    const r = await assembleGuardedDossier(zipLoc(`3390${i}`), {
      assembleImpl: fake.impl,
      now: () => NOW,
    });
    expect(r.capped).toBe(false);
  }
  expect(fake.calls()).toBe(5);
});

test("out-of-scope / empty dossiers are neither cached nor charged to the cap", async () => {
  process.env.WELCOME_DOSSIER_DAILY_CAP = "1";
  const empty = countingAssembler(dossier({ in_scope: false, lines: [] }));
  const a = await assembleGuardedDossier(zipLoc("90210"), {
    assembleImpl: empty.impl,
    now: () => NOW,
  });
  const b = await assembleGuardedDossier(zipLoc("90210"), {
    assembleImpl: empty.impl,
    now: () => NOW,
  });
  expect(a.fromCache).toBe(false);
  expect(b.fromCache).toBe(false); // not cached (no lines)
  expect(empty.calls()).toBe(2);
  // budget untouched: a real in-scope read still succeeds despite cap=1
  const real = await assembleGuardedDossier(zipLoc("33931"), {
    assembleImpl: countingAssembler().impl,
    now: () => NOW,
  });
  expect(real.capped).toBe(false);
});
