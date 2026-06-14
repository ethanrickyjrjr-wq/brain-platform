/**
 * scoped-content — per-scope email content (Task 02, hybrid: cards now,
 * prose-ready). Contract pinned in step-01; assembly implemented in step-02.
 *
 * A scoped `email_schedules` row (scope_kind/scope_value/topic) becomes cited
 * `WelcomeMetric` cards via `buildWelcomeAnswer` (lib/welcome/answer.ts) — zero
 * LLM, $0/send, the SAME no-invention + MOAT-grain guarantees as the welcome
 * path. `scope_kind==NULL && topic==NULL` is the caller's global-digest path;
 * `resolveScope`/`assembleScopedContent` are only invoked when a scope is present.
 *
 * No-invention spine: every figure rides from `buildWelcomeAnswer` (already
 * cited, MOAT-gated, grain-consistent). This module never adds a second source,
 * never regexes prose, never recomputes a number. Out-of-footprint / unresolvable
 * scopes return `null` → the caller falls back to the global digest and logs.
 */
import type { WelcomeMetric, PlaceEcho } from "@/lib/welcome/frames";
import type { ScheduleRow } from "@/lib/email/scheduler";
import { resolveLocation, type LocationInput } from "@/refinery/lib/location-resolver.mts";
import { assembleLocationDossier, type LocationDossier } from "@/lib/zip-dossier";
import { identityForLocation, type IdentityModel } from "@/lib/location-surface";
import { buildWelcomeAnswer } from "@/lib/welcome/answer";

/** Cited cards for one scope, plus the scope identity. Prose-ready (a narrative
 *  layer can later read `cards`), but v1 emits cards only — no LLM. The `cards`
 *  type is `WelcomeMetric[]` from buildWelcomeAnswer — do NOT redefine it. */
export interface ScopedContent {
  cards: WelcomeMetric[];
  scope_kind: string;
  scope_value: string;
  topic: string | null;
}

/**
 * `resolveScope(row)` output. Carries the full `LocationInput` (not a bare zip):
 *   • `assembleLocationDossier(loc)` AND `identityForLocation(loc)` both need it.
 *   • Re-deriving loc from a bare zip would relabel a `scope_kind='place'`
 *     ('cape coral') as "ZIP 33904" — losing the town identity.
 *   • `scope_kind='county'` resolves with NO zip → `zip` is nullable here
 *     (buildWelcomeAnswer takes the coarse path when dossier.zip is empty).
 * `explicitZip` is true ONLY for `scope_kind='zip'` (it gates the flood card;
 * a place/county spans ZIPs → false → flood self-suppresses, per the welcome path).
 */
export interface ResolvedScope {
  loc: LocationInput;
  zip: string | null;
  explicitZip: boolean;
  topic: string | null;
}

/**
 * Signature pinned in step-01; implemented in step-02. **Async** — `resolveLocation`
 * is async (it hosts the §E geocoder rescue), so the resolver must await it (the
 * step-01 sync draft was refuted by the code; RULE 3 C1). Returns null when the
 * scope is unresolvable / out of the 6-county footprint (caller falls back to the
 * global digest and logs — never invent below grain).
 */
export type ResolveScope = (row: ScheduleRow) => Promise<ResolvedScope | null>;

/**
 * Resolve a scoped row to a grain-honest `ResolvedScope`, or `null` to fall back
 * to the global digest. One primitive — `resolveLocation` — covers zip + place +
 * county; the 6-county MOAT gate is `loc.resolution.in_scope` (already enforced
 * inside `resolveZip` against `fixtures/swfl-zip-county.json`).
 */
export const resolveScope: ResolveScope = async (row) => {
  const scopeKind = (row.scope_kind ?? "").trim().toLowerCase();
  const scopeValue = (row.scope_value ?? "").trim();
  const topic = row.topic ?? null;

  // resolveScope is only invoked when a scope is present; a missing kind/value is
  // the caller's global-digest path (scope_kind==NULL && topic==NULL).
  if (!scopeKind || !scopeValue) return null;

  const loc = await resolveLocation(scopeValue);
  // explicitZip follows the DECLARED grain, not the resolved kind: only a
  // scope_kind='zip' is a single ZIP whose flood AAL is honest; a place/county
  // spans ZIPs → suppress the flood card (mirrors the welcome path).
  const explicitZip = scopeKind === "zip";

  switch (loc.kind) {
    // Resolution-bearing kinds carry the 6-county MOAT gate in `in_scope`.
    case "zip":
    case "place":
    case "address":
      if (!loc.resolution.in_scope) return null; // outside the 6-county footprint
      return { loc, zip: loc.resolution.zip, explicitZip, topic };
    // A resolved SWFL county is in-scope by construction and carries no ZIP →
    // buildWelcomeAnswer takes the coarse path (dossier.zip empty).
    case "county":
      return { loc, zip: null, explicitZip, topic };
    // corridor / region / out-of-scope / address-unsupported: no clean
    // single-scope digest → caller falls back to the global digest.
    default:
      return null;
  }
};

/**
 * Topic (free-text, lowercase) → the HERO_CARDS key it selects. This lane owns
 * the topic→card mapping; the keys (`home_value` / `rent` / `flood_aal`) are the
 * HERO_CARDS keys in lib/welcome/answer.ts. An UNKNOWN topic (e.g. 'permits' —
 * no card yet) is absent here on purpose → keep all geography-scoped cards.
 */
const TOPIC_TO_CARD_KEY: Record<string, string> = {
  flood: "flood_aal",
  price: "home_value",
  prices: "home_value",
  value: "home_value",
  home: "home_value",
  rent: "rent",
  rents: "rent",
};

/** Dependency seam for `assembleScopedContent` — pure + DI so it unit-tests with
 *  no DB/network. `defaultScopedDeps()` binds the real implementations. */
export interface ScopedDeps {
  /** DI seam over `assembleLocationDossier(loc,{origin})` — takes the resolved
   *  loc, NOT a zip (re-deriving from a bare zip loses place identity). */
  assembleDossier: (loc: LocationInput) => Promise<LocationDossier | null>;
  /** Returns `{ headline, subline }` — the route composes the PlaceEcho from it. */
  identityForLocation: (loc: LocationInput) => IdentityModel;
  buildWelcomeAnswer: typeof buildWelcomeAnswer;
  log: (line: string) => void;
}

/**
 * Turn a scoped `ScheduleRow` into cited cards, gated to the 6-county footprint
 * and filtered by topic — or `null` (caller falls back to the global digest).
 * The cards come ONLY from `buildWelcomeAnswer`; this function never invents a
 * figure.
 */
export async function assembleScopedContent(
  row: ScheduleRow,
  deps: ScopedDeps,
): Promise<ScopedContent | null> {
  const r = await resolveScope(row);
  if (!r) {
    deps.log(
      `[scoped-content] unresolved scope ${row.scope_kind}:${row.scope_value} → global fallback`,
    );
    return null;
  }

  const dossier = await deps.assembleDossier(r.loc);
  if (!dossier || !dossier.in_scope || dossier.lines.length === 0) {
    deps.log(
      `[scoped-content] empty dossier for ${row.scope_kind}:${row.scope_value} → global fallback`,
    );
    return null;
  }

  // The route composes the echo: zip from the dossier (authoritative), then the
  // resolved zip, then "" (county has none); name = the place headline.
  const place: PlaceEcho = {
    zip: dossier.zip ?? r.zip ?? "",
    name: deps.identityForLocation(r.loc).headline,
  };
  const answer = await deps.buildWelcomeAnswer({
    dossier,
    explicitZip: r.explicitZip,
    place,
  });
  if (!answer) {
    deps.log(
      `[scoped-content] no cards for ${row.scope_kind}:${row.scope_value} → global fallback`,
    );
    return null;
  }

  // Topic filter. A KNOWN topic narrows to its card(s); if that yields nothing
  // (the card didn't render for this geography) keep ALL cards — geography
  // already narrows it, never blank the send. An UNKNOWN topic keeps all cards.
  let cards = answer.metrics;
  const topic = (row.topic ?? "").trim().toLowerCase();
  if (topic) {
    const wantKey = TOPIC_TO_CARD_KEY[topic];
    if (wantKey) {
      const filtered = cards.filter((c) => c.key === wantKey);
      if (filtered.length > 0) cards = filtered;
    }
  }

  return {
    cards,
    scope_kind: row.scope_kind ?? "",
    scope_value: row.scope_value ?? "",
    topic: row.topic ?? null,
  };
}

/**
 * Real bindings for the cron worker / route (step-03b wires this into
 * `buildContent`). Tests inject stubs instead. `origin` flows to
 * `assembleLocationDossier` for live-vs-fixture citation branching; omit it for
 * the disk loader.
 */
export function defaultScopedDeps(
  opts: { origin?: string; log?: (line: string) => void } = {},
): ScopedDeps {
  return {
    assembleDossier: (loc) => assembleLocationDossier(loc, { origin: opts.origin }),
    identityForLocation,
    buildWelcomeAnswer,
    log: opts.log ?? (() => {}),
  };
}
