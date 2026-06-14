// lib/email/__tests__/scoped-content.test.ts
// Step-04 — pure unit tests for the scoped-content lane (no DB / no network).
// Covers: resolveScope (async), topic filter, fact assembly (no-invention),
//         regression (null scope → global fallback), fallback (unresolvable scope),
//         and renderScopedBody (03a).

import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import {
  resolveScope,
  assembleScopedContent,
  renderScopedBody,
  type ScopedContent,
  type ScopedDeps,
} from "../scoped-content";
import type { ScheduleRow } from "../scheduler";
import type { WelcomeAnswer, WelcomeMetric } from "@/lib/welcome/frames";
import type { LocationDossier } from "@/lib/zip-dossier";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRow(over: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    id: 1,
    user_id: "user-1",
    project_id: null,
    status: "active",
    cadence: "weekly",
    day_of_week: 1,
    day_of_month: null,
    send_hour_et: 10,
    audience_slug: null,
    template_id: "hero",
    next_run_at: null,
    last_run_at: null,
    ...over,
  };
}

function makeCard(key: string, label: string): WelcomeMetric {
  return {
    key,
    label,
    value: 100_000,
    display_format: "currency",
    units: "yr",
    is_true_zip: true,
    coverage_label: "ZIP 33904",
    source: {
      domain: "zillow.com",
      url: "https://zillow.com/research/data",
      as_of: "2026-05",
      citation: `Zillow ${label}`,
    },
  };
}

const FLOOD_CARD = makeCard("flood_aal", "Annual Flood Risk");
const HOME_CARD = makeCard("home_value", "Median Home Value");
const RENT_CARD = makeCard("rent", "Monthly Rent");
const ALL_CARDS = [FLOOD_CARD, HOME_CARD, RENT_CARD];

const STUB_ANSWER: WelcomeAnswer = {
  freshness_token: "SWFL-7421-v5-20260614",
  place: { zip: "33904", name: "Cape Coral, FL" },
  metrics: ALL_CARDS,
};

// Minimal dossier — assembleScopedContent only checks in_scope + lines.length.
// buildWelcomeAnswer is stubbed so the full ZipResolution shape isn't needed.
const STUB_DOSSIER = {
  resolved_as: "zip",
  zip: "33904",
  in_scope: true,
  resolution: null,
  lines: [
    {
      brain_id: "housing-swfl",
      domain: "real-estate",
      grain: "zip",
      coverage_label: "ZIP 33904",
      is_true_zip: true,
      text: "Median home value $280,000",
      source_citation: "Zillow ZHVI",
      source_url: "https://zillow.com/research/data",
    },
  ],
  freshness_tokens: { "housing-swfl": "SWFL-7421-v5-20260614" },
  coverage_caveats: [],
} as unknown as LocationDossier;

function makeDeps(over: Partial<ScopedDeps> = {}): ScopedDeps {
  return {
    assembleDossier: async () => STUB_DOSSIER,
    identityForLocation: () => ({ headline: "Cape Coral, FL", subline: "Lee County" }),
    buildWelcomeAnswer: async () => STUB_ANSWER,
    log: () => {},
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. resolveScope — async, real resolver against swfl-zip-county fixture
// ---------------------------------------------------------------------------

describe("resolveScope", () => {
  test("zip '33904' → explicit-zip, in-scope", async () => {
    const r = await resolveScope(makeRow({ scope_kind: "zip", scope_value: "33904" }));
    assert.ok(r, "should resolve");
    assert.strictEqual(r.loc.kind, "zip");
    assert.strictEqual(r.zip, "33904");
    assert.strictEqual(r.explicitZip, true);
    assert.strictEqual(r.topic, null);
  });

  test("place 'cape coral' → place kind, ZIP resolved, explicitZip false", async () => {
    const r = await resolveScope(makeRow({ scope_kind: "place", scope_value: "cape coral" }));
    assert.ok(r, "should resolve");
    assert.strictEqual(r.loc.kind, "place");
    assert.strictEqual(r.zip, "33904");
    assert.strictEqual(r.explicitZip, false);
  });

  test("county 'lee' → county kind, zip null, explicitZip false", async () => {
    const r = await resolveScope(makeRow({ scope_kind: "county", scope_value: "lee" }));
    assert.ok(r, "should resolve");
    assert.strictEqual(r.loc.kind, "county");
    assert.strictEqual(r.zip, null);
    assert.strictEqual(r.explicitZip, false);
  });

  test("out-of-scope ZIP '90210' → null", async () => {
    const r = await resolveScope(makeRow({ scope_kind: "zip", scope_value: "90210" }));
    assert.strictEqual(r, null);
  });

  test("null scope_kind and scope_value → null", async () => {
    const r = await resolveScope(makeRow({ scope_kind: null, scope_value: null }));
    assert.strictEqual(r, null);
  });
});

// ---------------------------------------------------------------------------
// 2. Topic filter
// ---------------------------------------------------------------------------

describe("topic filter", () => {
  test("'flood' keeps only flood_aal card", async () => {
    const c = await assembleScopedContent(
      makeRow({ scope_kind: "zip", scope_value: "33904", topic: "flood" }),
      makeDeps(),
    );
    assert.ok(c);
    assert.strictEqual(c.cards.length, 1);
    assert.strictEqual(c.cards[0].key, "flood_aal");
  });

  test("'prices' keeps only home_value card", async () => {
    const c = await assembleScopedContent(
      makeRow({ scope_kind: "zip", scope_value: "33904", topic: "prices" }),
      makeDeps(),
    );
    assert.ok(c);
    assert.strictEqual(c.cards.length, 1);
    assert.strictEqual(c.cards[0].key, "home_value");
  });

  test("'rent' keeps only rent card", async () => {
    const c = await assembleScopedContent(
      makeRow({ scope_kind: "zip", scope_value: "33904", topic: "rent" }),
      makeDeps(),
    );
    assert.ok(c);
    assert.strictEqual(c.cards.length, 1);
    assert.strictEqual(c.cards[0].key, "rent");
  });

  test("unknown topic 'permits' keeps all cards (never blank the send)", async () => {
    const c = await assembleScopedContent(
      makeRow({ scope_kind: "zip", scope_value: "33904", topic: "permits" }),
      makeDeps(),
    );
    assert.ok(c);
    assert.strictEqual(c.cards.length, ALL_CARDS.length);
  });
});

// ---------------------------------------------------------------------------
// 3. Fact assembly — no-invention
// ---------------------------------------------------------------------------

describe("fact assembly (no-invention)", () => {
  test("cards carry source.domain and source.citation from stub", async () => {
    const c = await assembleScopedContent(
      makeRow({ scope_kind: "zip", scope_value: "33904" }),
      makeDeps(),
    );
    assert.ok(c);
    for (const card of c.cards) {
      assert.ok(card.source.domain, `card ${card.key} missing source.domain`);
      assert.ok(card.source.citation, `card ${card.key} missing source.citation`);
    }
  });

  test("no card carries a value absent from the stub answer (no invention)", async () => {
    const c = await assembleScopedContent(
      makeRow({ scope_kind: "zip", scope_value: "33904" }),
      makeDeps(),
    );
    assert.ok(c);
    const stubValues = new Set(STUB_ANSWER.metrics.map((m) => m.value));
    for (const card of c.cards) {
      assert.ok(stubValues.has(card.value), `invented value ${String(card.value)} not in stub`);
    }
  });

  test("freshness_token is carried from WelcomeAnswer", async () => {
    const c = await assembleScopedContent(
      makeRow({ scope_kind: "zip", scope_value: "33904" }),
      makeDeps(),
    );
    assert.ok(c);
    assert.strictEqual(c.freshness_token, STUB_ANSWER.freshness_token);
  });

  test("place_label is carried from identity headline (state suffix stripped)", async () => {
    // identityForLocation stub returns "Cape Coral, FL"; place_label keeps the
    // locality only so the subject reads cleanly for a zip scope.
    const c = await assembleScopedContent(
      makeRow({ scope_kind: "zip", scope_value: "33904" }),
      makeDeps(),
    );
    assert.ok(c);
    assert.strictEqual(c.place_label, "Cape Coral");
  });
});

// ---------------------------------------------------------------------------
// 4. Regression — null scope → assembleScopedContent returns null (global path)
// ---------------------------------------------------------------------------

describe("regression: null scope → global fallback", () => {
  test("scope_kind=null && topic=null → assembleScopedContent returns null", async () => {
    // resolveScope returns null for null/null → assembleScopedContent returns null
    // → buildContent (03b) takes the unchanged global-digest path.
    const c = await assembleScopedContent(
      makeRow({ scope_kind: null, scope_value: null, topic: null }),
      makeDeps(),
    );
    assert.strictEqual(c, null);
  });
});

// ---------------------------------------------------------------------------
// 5. Fallback — unresolvable or empty scope → null
// ---------------------------------------------------------------------------

describe("fallback: unresolvable scope → null", () => {
  test("out-of-footprint ZIP '90210' → null", async () => {
    const c = await assembleScopedContent(
      makeRow({ scope_kind: "zip", scope_value: "90210" }),
      makeDeps(),
    );
    assert.strictEqual(c, null);
  });

  test("null dossier from assembleDossier → null", async () => {
    const c = await assembleScopedContent(
      makeRow({ scope_kind: "zip", scope_value: "33904" }),
      makeDeps({ assembleDossier: async () => null }),
    );
    assert.strictEqual(c, null);
  });

  test("empty dossier lines → null", async () => {
    const c = await assembleScopedContent(
      makeRow({ scope_kind: "zip", scope_value: "33904" }),
      makeDeps({
        assembleDossier: async () => ({ ...STUB_DOSSIER, lines: [] }) as unknown as LocationDossier,
      }),
    );
    assert.strictEqual(c, null);
  });
});

// ---------------------------------------------------------------------------
// renderScopedBody (03a)
// ---------------------------------------------------------------------------

describe("renderScopedBody", () => {
  const content: ScopedContent = {
    cards: ALL_CARDS,
    scope_kind: "zip",
    scope_value: "cape coral",
    topic: "flood",
    freshness_token: "SWFL-7421-v5-20260614",
  };

  test("subject: title-case place + topic", () => {
    const { subject } = renderScopedBody(content);
    assert.strictEqual(subject, "Cape Coral Flood — this week");
  });

  test("subject: 'market' when topic is null", () => {
    const { subject } = renderScopedBody({ ...content, topic: null });
    assert.strictEqual(subject, "Cape Coral market — this week");
  });

  test("body has one bullet line per card", () => {
    const { body } = renderScopedBody(content);
    const bullets = body.split("\n").filter((l) => l.startsWith("•"));
    assert.strictEqual(bullets.length, ALL_CARDS.length);
  });

  test("body lines contain source domain and citation", () => {
    const { body } = renderScopedBody(content);
    for (const card of ALL_CARDS) {
      assert.ok(body.includes(card.source.domain), `missing domain for ${card.key}`);
      assert.ok(body.includes(card.source.citation), `missing citation for ${card.key}`);
    }
  });

  test("freshness_token is quoted exactly once at end of body", () => {
    const { body } = renderScopedBody(content);
    assert.ok(body.includes("SWFL-7421-v5-20260614"), "freshness_token missing from body");
    const count = body.split("SWFL-7421-v5-20260614").length - 1;
    assert.strictEqual(count, 1, "freshness_token must appear exactly once");
  });

  test("no freshness_token → no Data: line in body", () => {
    const { body } = renderScopedBody({ ...content, freshness_token: undefined });
    assert.ok(!body.includes("Data:"), "unexpected Data: line when no token");
  });

  test("subject: prefers place_label over a digit scope_value (zip scope)", () => {
    // A zip scope's scope_value is the digits "33904"; place_label carries the
    // resolved town so the subject reads "Cape Coral", not "33904".
    const { subject } = renderScopedBody({
      ...content,
      scope_value: "33904",
      place_label: "Cape Coral",
    });
    assert.strictEqual(subject, "Cape Coral Flood — this week");
  });

  test("subject: topic whose card did NOT render → 'market' (no false advertising)", () => {
    // topic='flood' but no flood_aal card present → the subject must not claim
    // "Flood" when the body carries only price/rent.
    const { subject } = renderScopedBody({
      ...content,
      scope_value: "cape coral",
      place_label: undefined,
      topic: "flood",
      cards: [HOME_CARD, RENT_CARD],
    });
    assert.strictEqual(subject, "Cape Coral market — this week");
  });
});
