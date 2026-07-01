// comp-helper.ts — the on-demand comp path of the answer engine (SteadyAPI Phase 2B).
//
// A STRUCTURAL TWIN of web-fallback.ts: cheap gate → fetch live → render a
// "state ONLY these" grounding block the model reads + a {type:"sources"} frame.
// Wired beside webFallbackForConversation at the two conversation-path hook points.
// Everything degrades to empty and the normal answer still streams.
//
// The four hard operator rules live HERE, structurally (not as AI-trust):
//   1. Never say "SteadyAPI" — this module holds no such string for the model to echo.
//   2. Prose = comps + the MM/DD/YYYY date only; NO source named in prose. Sources ride
//      only in the collapsed accordion (compSources): SWFL Data Gulf + realtor.com homepage.
//   3. Never surface an MLS number / realtor.com id — the ids are already scrubbed at the
//      steadyapi normalizer; the surfaced RenderComp carries no propertyId at all.
//   4. Lee (12071) + Collier (12021) only — anything else → the out-of-footprint needs-block.
// Plus: never invent a number — a gap becomes a precise lane-4 `needs[]` ask, never a no-op.
import { geocodeAddress, type GeocodedAddress } from "@/lib/geo/geocode-address";
import {
  fetchNearbyValues,
  fetchSoldEvent,
  type NearbyComp,
  type SoldEvent,
} from "@/lib/listings/steadyapi";
import type { WelcomeSource } from "@/lib/welcome/frames";
import type { ChartSpec } from "@/components/charts/registry/chart-spec";
import type { ListingFacts } from "@/lib/email/listing-scrape";

/** Whether a surfaced price is a recorded sale, an AVM estimate, or a last list. */
export type PriceKind = "sold" | "estimate" | "last_list";

/** A comp as surfaced to the model — MLS-scrubbed (no propertyId), price TAGGED by
 *  kind so the renderer can never call an estimate a sale. */
export interface RenderComp {
  addressLine: string;
  city: string;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  status: string;
  price: number | null;
  priceKind: PriceKind;
  /** ISO date behind the price (sold date / AVM date); null for a last-list. */
  priceDate: string | null;
}

export interface CompResult {
  comps: RenderComp[];
  /** The call date, MM/DD/YYYY. */
  asOf: string;
  /** The place the geocoder matched — context only, never surfaced as a fact. */
  matchedAddress?: string;
  /** Lane-4 asks: what the user must supply for the helper to finish. */
  needs: string[];
}

export interface CompDeps {
  geocode?: (text: string) => Promise<GeocodedAddress | null>;
  fetchNearby?: (opts: {
    lat: number;
    lon: number;
    status?: string;
    limit?: number;
  }) => Promise<NearbyComp[]>;
  fetchSold?: (propertyId: string) => Promise<SoldEvent | null>;
  /** Injectable clock so `asOf` is deterministic in tests. */
  now?: Date;
  /** How many comps to surface (default 6). */
  topN?: number;
  /** How many sold comps to enrich with an exact sale (hard-capped at 2 → ≤3 calls). */
  enrichN?: number;
  /** Increment 3: fetch-free by construction. The pasted-link lane makes a live fetch
   *  ONLY when this is true. The caller resolves it from `analyst` (never an ambient
   *  flag), so public /welcome and every existing test stay fetch-free by default. */
  allowPastedFetch?: boolean;
  /** Injectable fetch for the pasted-link lane. Defaults to `fetchListingFacts`, which
   *  is already SSRF-guarded via `safeFetchPublicUrl`. */
  fetchPastedFacts?: (url: string) => Promise<ListingFacts | null>;
  /** The saved subject address of the current listing project (Build 1). When a comp ask
   *  carries NO typed address but this is set, the helper CONFIRMS this address (rather than
   *  guessing or cold-asking). The caller resolves a "yes"/new-address reply — see
   *  resolveCompConfirmReentry in conversation-path. */
  projectAddress?: string;
}

// ── the gate + address extraction (pure) ──────────────────────────────────────

const COMP_WORD = /\b(comps?|comparables?|cma)\b/i;
const VALUE_WORD =
  /\b(worth|valuation|apprais\w*|market value|value of|estimate[ds]?|sell for|list for)\b/i;
/** A house-number-led token, e.g. "3412 Atlantic". */
const ADDRESS_HINT = /\b\d{1,6}\s+\S/;

/** Cheap gate: an explicit comp word fires alone; a value word needs an address hint
 *  (so "median home value in Cape Coral" — a ZIP aggregate — does NOT fire here). */
export function looksLikeCompAsk(question: string): boolean {
  const q = question || "";
  return COMP_WORD.test(q) || (VALUE_WORD.test(q) && ADDRESS_HINT.test(q));
}

const TRAIL_INTENT =
  /\b(worth|sold|sell for|list for|valuation|value|estimate[ds]?|comps?|comparables?|please|now|today|right now|for me)\b.*$/i;

/** Pull the address span to geocode. Permissive by design — geocode + the Lee/Collier
 *  gate are the real filter; a miss becomes a lane-4 ask, never a crash. */
export function extractAddress(question: string): string | null {
  const q = (question || "").trim();
  if (!q) return null;
  const house = q.match(/\d{1,6}\s+[^?.!\n]*/);
  if (house) {
    const span = house[0]
      .trim()
      .replace(TRAIL_INTENT, "")
      .replace(/[,\s]+$/, "")
      .trim();
    return span || null;
  }
  const near = q.match(/\b(?:near|around|at|for|in)\s+([^?.!\n]+)$/i);
  if (near) {
    const span = near[1]
      .trim()
      .replace(TRAIL_INTENT, "")
      .replace(/[,\s]+$/, "")
      .trim();
    return span || null;
  }
  return null;
}

/** A bare affirmation ("yes", "yep, go ahead", "correct") — the confirm reply that
 *  accepts the saved project address. Kept tight so a substantive follow-up ("yes but
 *  what about 456 Oak St") is NOT swallowed (that path carries an address instead). */
const AFFIRMATION =
  /^\s*(y(es|ep|eah|up)|sure|ok(ay)?|correct|right|confirmed?|go ahead|do it|please\s+do|that'?s?\s+(it|right|correct))\b/i;

export function isAffirmation(text: string): boolean {
  return AFFIRMATION.test(text || "");
}

/**
 * The confirm-turn re-entry (Build 1), resolved at the CALLER because compHelper only
 * ever sees the last message. Reconstructs the confirm situation deterministically from
 * the PRIOR user turn (never the model-paraphrased assistant text): the confirm fires
 * only when the prior user turn was a comp ask with NO typed address AND a project
 * address exists. On this turn a newly typed address wins; otherwise a bare affirmation
 * resolves to the saved project address. Returns "" when this is not a confirm reply.
 */
export function resolveCompConfirmReentry(
  messages: { role: "user" | "assistant"; content: string }[],
  projectAddress: string,
): string {
  if (!projectAddress) return "";
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return "";
  const priorUser = [...messages.slice(0, -1)].reverse().find((m) => m.role === "user");
  if (!priorUser) return "";
  // The confirm is only shown for a comp ask that carried no address of its own.
  if (!looksLikeCompAsk(priorUser.content) || extractAddress(priorUser.content)) return "";
  const typed = extractAddress(last.content);
  if (typed) return typed; // a new address wins over the saved one
  if (isAffirmation(last.content)) return projectAddress; // "yes" → the saved address
  return "";
}

// ── date + money formatting ───────────────────────────────────────────────────

export function fmtMDY(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

/** "2026-05-12" → "05/12/2026". Null when the input isn't an ISO date. */
function isoToMDY(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : null;
}

/** "06/30/2026" -> "2026-06-30". Input is always CompResult.asOf, which is always
 *  well-formed MM/DD/YYYY (produced by fmtMDY) — no defensive validation needed. */
function mdyToIso(mdy: string): string {
  const [mm, dd, yyyy] = mdy.split("/");
  return `${yyyy}-${mm}-${dd}`;
}

function usd(n: number): string {
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

// ── the orchestrator ──────────────────────────────────────────────────────────

/**
 * Run the on-demand comp path for one question. DI-injectable
 * (geocode/fetchNearby/fetchSold/now) so it is fully offline-testable. Hard cap of
 * **≤3 Steady calls**: 1 `/nearby-home-values` + ≤2 `/property-tax-history`. Returns
 * `{ comps, asOf, needs }`; a non-comp ask is a no-op (`comps:[]`, `needs:[]`) so the
 * caller falls through to web-fallback. Never throws.
 */
export async function compHelper(question: string, deps: CompDeps = {}): Promise<CompResult> {
  const now = deps.now ?? new Date();
  const asOf = fmtMDY(now);
  const done = (comps: RenderComp[], needs: string[], matchedAddress?: string): CompResult => ({
    comps,
    asOf,
    needs,
    ...(matchedAddress ? { matchedAddress } : {}),
  });

  if (!looksLikeCompAsk(question)) return done([], []); // no-op → fall through to web-fallback

  const address = extractAddress(question);
  if (!address) {
    // Build 1 — a listing project with a saved subject address: CONFIRM it instead of
    // guessing or cold-asking. No geocode/fetch here — the user's next turn ("yes" or a
    // different address) is resolved by the caller (resolveCompConfirmReentry) and
    // re-enters with a real address. Falls back to the plain cold-ask with no saved address.
    if (deps.projectAddress) {
      return done(
        [],
        [`Is this comp for ${deps.projectAddress}? Reply "yes" or send a different address.`],
      );
    }
    return done(
      [],
      ["Send me the full street address (with the city or ZIP) and I'll pull nearby comps."],
    );
  }

  const geocode = deps.geocode ?? geocodeAddress;
  const geo = await geocode(address);
  if (!geo) {
    return done(
      [],
      [
        "I couldn't pin that address — send the full street address plus the city or ZIP and I'll run comps.",
      ],
    );
  }

  const inFootprint = geo.countyFips === "12071" || geo.countyFips === "12021";
  if (!inFootprint) {
    return done(
      [],
      [
        "I'm running comps for Lee and Collier right now — what's the Lee or Collier address you want compared?",
      ],
      geo.matchedAddress,
    );
  }

  const fetchNearby =
    deps.fetchNearby ?? ((o) => fetchNearbyValues({ ...o, status: o.status ?? "sold" }));
  const nearby = await fetchNearby({ lat: geo.lat, lon: geo.lon, status: "sold", limit: 25 });
  const surfaced = nearby.slice(0, deps.topN ?? 6);
  if (surfaced.length === 0) {
    return done(
      [],
      [
        "I didn't find nearby comps at that point — want me to widen the search, or you can share any comps you already know?",
      ],
      geo.matchedAddress,
    );
  }

  // Enrich the top ≤2 SOLD-status comps with their exact recorded sale. Hard-capped
  // so the whole request is ≤3 Steady calls.
  const cap = Math.min(deps.enrichN ?? 2, 2);
  const fetchSold = deps.fetchSold ?? fetchSoldEvent;
  const targets = surfaced.filter((c) => c.status === "sold" && c.propertyId).slice(0, cap);
  const soldByPid = new Map<string, SoldEvent>();
  await Promise.all(
    targets.map(async (c) => {
      const ev = await fetchSold(c.propertyId as string);
      if (ev) soldByPid.set(c.propertyId as string, ev);
    }),
  );

  const comps: RenderComp[] = surfaced.map((c) => {
    const sold = c.propertyId ? soldByPid.get(c.propertyId) : undefined;
    let price: number | null;
    let priceKind: PriceKind;
    let priceDate: string | null;
    if (sold) {
      price = sold.soldPrice;
      priceKind = "sold";
      priceDate = sold.soldDate;
    } else if (c.estimateValue != null) {
      price = c.estimateValue;
      priceKind = "estimate";
      priceDate = c.estimateDate;
    } else {
      price = c.listPrice; // may be null — the renderer omits a missing price
      priceKind = "last_list";
      priceDate = null;
    }
    return {
      addressLine: c.addressLine,
      city: c.city,
      beds: c.beds,
      baths: c.baths,
      sqft: c.sqft,
      status: c.status,
      price,
      priceKind,
      priceDate,
    };
  });

  const needs: string[] = [];
  if (surfaced.length < 2) {
    needs.push(
      "Only one nearby comp came back — want me to widen the search, or add any comps you know?",
    );
  }
  return done(comps, needs, geo.matchedAddress);
}

// ── render + sources (the two seams the wiring uses) ──────────────────────────

/** The price phrase, labeled by kind so an AVM/last-list is never called a sale. */
function pricePhrase(c: RenderComp): string {
  if (c.price == null) return "price not available";
  if (c.priceKind === "sold") {
    const d = isoToMDY(c.priceDate);
    return `sold ${usd(c.price)}${d ? ` on ${d}` : ""}`;
  }
  if (c.priceKind === "estimate") return `estimated value ${usd(c.price)}`;
  return `last listed ${usd(c.price)}`;
}

/**
 * The grounding block the answer model reads: comps + the as-of date, with a strict
 * "don't name the source, don't invent, don't call an estimate a sale" directive, plus
 * a lane-4 needs-block. Contains NO vendor strings. "" when there's nothing to say.
 */
export function renderCompBlock(result: CompResult): string {
  const parts: string[] = [];

  if (result.comps.length > 0) {
    const lines = result.comps
      .map((c) => {
        const spec = [
          c.beds != null ? `${c.beds} bd` : "",
          c.baths != null ? `${c.baths} ba` : "",
          c.sqft != null ? `${c.sqft.toLocaleString("en-US")} sqft` : "",
        ]
          .filter(Boolean)
          .join("/");
        const loc = [c.addressLine, c.city].filter(Boolean).join(", ");
        return `- ${spec ? spec + " — " : ""}${pricePhrase(c)}${loc ? ` (${loc})` : ""}`;
      })
      .join("\n");
    parts.push(
      `=== NEARBY COMPARABLE PROPERTIES (fetched live, as of ${result.asOf}) — state these in ` +
        `plain text and give the as-of date. Do NOT name any website, data provider, or MLS in ` +
        `your answer. Never invent a number. A "sold" figure is a recorded sale; an "estimated ` +
        `value" or "last listed" figure is NOT a sale — never describe it as one. ===\n` +
        lines,
    );
  }

  if (result.needs.length > 0) {
    parts.push(
      `=== TO FINISH, ASK THE USER FOR THIS (never invent it; answer everything else you can) ===\n` +
        result.needs.map((n) => `- ${n}`).join("\n"),
    );
  }

  return parts.length > 0 ? "\n\n" + parts.join("\n\n") : "";
}

/**
 * The collapsed citation accordion for a comp answer: homepage-only, never SteadyAPI,
 * never a realtor.com permalink. Empty unless comps were actually surfaced. Rendered
 * through the one citation root (CitationList / clean-url).
 */
export function compSources(result: CompResult): WelcomeSource[] {
  if (result.comps.length === 0) return [];
  return [
    { label: "SWFL Data Gulf", domain: "swfldatagulf.com", url: "https://www.swfldatagulf.com" },
    { label: "realtor.com", domain: "realtor.com", url: "https://www.realtor.com" },
  ];
}

/** The honesty suffix so an estimate/last-list price can never look like a sale on the
 *  chart — bar-mode rendering (adaptToHBar) reads only columns[0]/columns[1], so the
 *  label suffix is the only place this distinction survives into the bar view. */
function priceKindSuffix(k: PriceKind): string {
  if (k === "estimate") return " (est.)";
  if (k === "last_list") return " (list)";
  return "";
}

/**
 * Comps-only bar chart (no subject/median bar — buildCompsSpec's subject-bar shape
 * doesn't apply here: the geocoded comp-helper subject has no price to anchor it, and
 * labeling an area median "(Subject)" would misrepresent an aggregate as this
 * property's valuation). Filters to priced comps; null under the 2-bar minimum.
 */
export function buildCompsChartSpec(result: CompResult): ChartSpec | null {
  const priced = result.comps.filter((c) => c.price != null);
  if (priced.length < 2) return null;

  const sorted = [...priced].sort((a, b) => (b.price as number) - (a.price as number));
  const rows: (string | number | null)[][] = sorted.map((c) => [
    `${c.addressLine}${priceKindSuffix(c.priceKind)}`,
    c.price as number,
  ]);

  const title = result.matchedAddress
    ? `Nearby comparable prices near ${result.matchedAddress}`
    : "Nearby comparable prices";

  return {
    frameId: "bar-table",
    title,
    columns: ["Property", "Price"],
    rows,
    value_format: "usd",
    chart_type: "bar",
    asOf: mdyToIso(result.asOf),
    source: {
      citation: "Nearby comps, SWFL Data Gulf + realtor.com",
      url: "https://www.realtor.com",
    },
  };
}
