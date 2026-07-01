/**
 * Welcome-chat grounded-answer contract — the SINGLE shared seam between the
 * client UI and the streaming route. Both sides import these types so a grounded
 * ZIP answer can render structured, cited metric cards instead of parsed prose.
 *
 * Transport: the existing SSE stream (`data: {json}\n\n`). Every frame carries a
 * `type` discriminator ("text" | "data" | "place" | "done" | "error") so any
 * reader branches on `type` and IGNORES unknown types rather than breaking — a
 * strictly backward-compatible extension. `parseSseFrame` also accepts the
 * parallel grounding route's current un-typed `{text}`/`{done}`/`{error}` frames
 * and normalizes them, so the transition needs no flag-day.
 *
 * No-invention guarantee (mirrors the prose-path lints — the card egress MUST
 * inherit them, never serialize raw dossier fields):
 *   • Sources are prettySource-cleaned (default-deny) — `isInternalSource` is the
 *     client-side belt-and-suspenders so a slipped data_lake/supabase.co/amazonaws
 *     URL never reaches the DOM.
 *   • Every metric carries `is_true_zip` + `coverage_label` so a coarser aggregate
 *     can NEVER render as a ZIP-specific fact (the MOAT).
 *   • Values are cited figures, not client-derived (no-math floor); `formatMetric`
 *     only formats what it is handed.
 */
import { cleanCitation } from "../citations/clean-url";
import type { ChartSpec } from "@/components/charts/registry/chart-spec";

// ── Wire contract ─────────────────────────────────────────────────────────────

export interface PlaceEcho {
  zip: string;
  /** "Fort Myers Beach, FL" — empty until the server confirms via place/data. */
  name: string;
}

export type MetricFormat = "currency" | "percent" | "count" | "ratio" | "raw";

export interface WelcomeMetricSource {
  /** Display host, e.g. "fema.gov" — prettySource-cleaned, derive with hostDomain(url). */
  domain: string;
  /** Direct source URL — prettySource-cleaned (never a data_lake/supabase URL). */
  url: string;
  /** "2026-05" — month the value was fetched (from BrainOutputMetric.source.fetched_at). */
  as_of: string;
  /** Human citation, used for the chip title / aria-label. */
  citation: string;
  /** In-app provenance page (/r/source/[table]) when a table mapping exists. */
  provenance_url?: string;
}

/** A lane-3 web-verified source backing one figure that is NOT in our lake — fetched
 *  live and verified against a cited span (lib/assistant/web-fallback.ts). Rendered in
 *  the collapsed citation accordion at the bottom of an answer, never inline. */
export interface WelcomeSource {
  /** The figure this source backs, e.g. "Cape Coral median days on market". */
  label: string;
  /** The verified value (the digits appeared verbatim in the cited span). OPTIONAL:
   *  a provenance-only source (e.g. the comp helper's homepage citations) backs no
   *  single figure — consumers omit the number segment when this is absent. */
  value?: number;
  /** Publisher URL the value was verified against (cleaned before render). */
  url: string;
  /** Display host, e.g. "redfin.com". */
  domain: string;
}

export interface WelcomeMetric {
  /** Stable key: "home_value" | "rent" | "flood_aal" | "permits" | … */
  key: string;
  /** Human card label, e.g. "Median Value". */
  label: string;
  value: number | string;
  display_format: MetricFormat;
  /** Cadence/grain hint, e.g. "mo", "yr", "90d". */
  units?: string;
  direction?: "rising" | "falling" | "stable";
  /** true = a real per-ZIP value; false = a coarser aggregate that COVERS the ZIP
   *  (its `coverage_label` says so). Mirrors LocationDossierLine.is_true_zip. */
  is_true_zip: boolean;
  /** Honest scope phrase shown on the card, e.g. "ZIP 33931" or
   *  "Lee county-wide — covers 33931" — so a county figure can never read as a ZIP
   *  fact. Propagated from the dossier coverage label, never reconstructed. */
  coverage_label: string;
  source: WelcomeMetricSource;
}

export interface WelcomeAnswer {
  /** "SWFL-7421-v{n}-{YYYYMMDD}". */
  freshness_token: string;
  place: PlaceEcho;
  /** The hero cards (≤4): home value, rent, flood AAL, permits. */
  metrics: WelcomeMetric[];
}

export type WelcomeFrame =
  // `freshness_token` is the RAW internal token ("SWFL-7421-v{n}-{YYYYMMDD}") kept
  // ONLY for filing/pinning a Q&A (BriefcaseChat tokenRef) — never displayed. `as_of`
  // is the cleaned MM/DD/YYYY derived from it (asOfFromToken), the ONLY freshness form
  // a surface may render to the user (rule 5: state the as-of date, never the raw token).
  | { type: "place"; place: PlaceEcho; freshness_token?: string; as_of?: string }
  | { type: "data"; answer: WelcomeAnswer }
  // A deterministic, cited chart built server-side from REAL brain numbers
  // (computeMetricChart / buildChartForIntent) — emitted before the text stream
  // on the conversation path. The LLM never touches its figures (the moat). A
  // consumer that doesn't paint charts ignores it (reduceWelcome's default case).
  | { type: "chart"; chart: ChartSpec }
  // Lane-3 web-verified citations for a figure NOT in our lake (web-fallback.ts) —
  // painted as a collapsed, click-to-open sources accordion under the answer, never
  // inline. A reader that doesn't render sources ignores it (reduceWelcome stores it).
  | { type: "sources"; sources: WelcomeSource[] }
  | { type: "text"; text: string }
  | { type: "done" }
  | { type: "error"; error: string };

// ── Client state machine ──────────────────────────────────────────────────────

export type WelcomeStatus = "idle" | "awaiting" | "answered" | "streaming" | "done" | "error";

export interface WelcomeState {
  status: WelcomeStatus;
  /** The submitted ZIP — drives the optimistic echo before the place frame lands. */
  zip: string | null;
  place: PlaceEcho | null;
  answer: WelcomeAnswer | null;
  prose: string;
  /** Lane-3 web-verified sources for the collapsed accordion (empty when none). */
  sources: WelcomeSource[];
  error: string | null;
}

export const initialWelcomeState: WelcomeState = {
  status: "idle",
  zip: null,
  place: null,
  answer: null,
  prose: "",
  sources: [],
  error: null,
};

export type WelcomeAction =
  { type: "submit"; zip: string } | { type: "frame"; frame: WelcomeFrame } | { type: "reset" };

const TERMINAL: ReadonlySet<WelcomeStatus> = new Set(["done", "error"]);

/**
 * Pure reducer for the grounded-answer lifecycle. Order-tolerant: cards and prose
 * may arrive in either order; `done`/`error` are terminal and never reopened.
 */
export function reduceWelcome(state: WelcomeState, action: WelcomeAction): WelcomeState {
  switch (action.type) {
    case "reset":
      return initialWelcomeState;

    case "submit":
      return { ...initialWelcomeState, status: "awaiting", zip: action.zip };

    case "frame": {
      const f = action.frame;
      switch (f.type) {
        case "error":
          return { ...state, error: f.error, status: "error" };
        case "done":
          return { ...state, status: "done" };
        case "text":
          return {
            ...state,
            prose: state.prose + f.text,
            status: TERMINAL.has(state.status) ? state.status : "streaming",
          };
        case "data": {
          // Cards land. Don't downgrade an already-streaming/terminal status —
          // just attach the cards + authoritative place.
          const keep = state.status === "streaming" || TERMINAL.has(state.status);
          return {
            ...state,
            answer: f.answer,
            place: f.answer.place,
            status: keep ? state.status : "answered",
          };
        }
        case "place":
          return {
            ...state,
            place: f.place,
            status: state.status === "idle" ? "awaiting" : state.status,
          };
        case "sources":
          // Order-tolerant: sources may arrive before/after prose; never change status.
          return { ...state, sources: f.sources };
        default:
          return state;
      }
    }

    default:
      return state;
  }
}

// ── SSE line parsing ──────────────────────────────────────────────────────────

/**
 * Parse one `data: {json}` SSE line into a typed WelcomeFrame. Accepts both the
 * typed contract AND legacy un-typed `{text}`/`{done}`/`{error}` frames (the
 * parallel grounding route's current shape), normalizing the latter. Returns null
 * for blank lines, malformed JSON, or frames with no recognized type — so the
 * reader skips noise (and any future frame type) without throwing.
 */
export function parseSseFrame(raw: string): WelcomeFrame | null {
  const line = raw.replace(/^data: /, "").trim();
  if (!line) return null;
  let obj: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(line);
    if (!parsed || typeof parsed !== "object") return null;
    obj = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  // Typed frames (the contract).
  switch (obj.type) {
    case "text":
      return typeof obj.text === "string" ? { type: "text", text: obj.text } : null;
    case "place":
      return obj.place
        ? {
            type: "place",
            place: obj.place as PlaceEcho,
            // Carry both: the raw token (filing/pinning only) and the cleaned
            // as-of date (the only form that may be displayed).
            ...(typeof obj.freshness_token === "string"
              ? { freshness_token: obj.freshness_token }
              : {}),
            ...(typeof obj.as_of === "string" ? { as_of: obj.as_of } : {}),
          }
        : null;
    case "data":
      return obj.answer ? { type: "data", answer: obj.answer as WelcomeAnswer } : null;
    case "chart":
      return obj.chart ? { type: "chart", chart: obj.chart as ChartSpec } : null;
    case "sources":
      return Array.isArray(obj.sources)
        ? { type: "sources", sources: obj.sources as WelcomeSource[] }
        : null;
    case "done":
      return { type: "done" };
    case "error":
      return { type: "error", error: String(obj.error ?? "error") };
  }

  // Legacy un-typed frames → normalize.
  if (typeof obj.text === "string") return { type: "text", text: obj.text };
  if (obj.done === true) return { type: "done" };
  if (typeof obj.error === "string") return { type: "error", error: obj.error };
  return null;
}

// ── Source safety (default-deny) ──────────────────────────────────────────────

// isInternalSource + hostDomain live in the zero-dep leaf lib/citations/internal-markers
// (breaks the frames ↔ clean-url runtime import cycle). Re-exported here so existing
// `@/lib/welcome/frames` importers (answer.ts, frames.test.ts) are unchanged.
export { isInternalSource, hostDomain } from "../citations/internal-markers";

/**
 * Resolve the chip's safe link + display host. Belt-and-suspenders to the backend
 * prettySource: if either the URL or domain looks internal, drop the link and show
 * a neutral "source" label instead of leaking a data_lake/supabase URL.
 */
export function citationLink(source: WelcomeMetricSource): { href: string | null; domain: string } {
  // Delegate to the shared root — ONE call stack, no double-strip. cleanCitation is the
  // only thing that inspects the raw URL; map its result back to this {href, domain} shape.
  const c = cleanCitation({ url: source.provenance_url ?? source.url, label: source.domain });
  return { href: c.linkable ? (c.href ?? null) : null, domain: c.linkable ? c.label : "source" };
}

// ── Display helpers (format, never fabricate) ─────────────────────────────────

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Cadence labels that read as a per-period suffix on a currency value. */
const NON_USD_UNIT = /^(mo|yr|wk|day|sqft|unit)$/i;

/**
 * Format a metric value for display. Categorical strings pass through untouched;
 * numbers are formatted by `display_format`. Only currency carries a units suffix
 * (e.g. "/mo", "/yr") — every other unit is conveyed by the card label, so the
 * number stays clean.
 */
export function formatMetric(value: number | string, format: MetricFormat, units?: string): string {
  if (typeof value === "string") return value;

  switch (format) {
    case "currency": {
      const base = usd.format(value);
      return units && NON_USD_UNIT.test(units) ? `${base}/${units.toLowerCase()}` : base;
    }
    case "percent":
      return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
    case "count":
      return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
    case "ratio":
      return value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    case "raw":
    default:
      return String(value);
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Turn a freshness token ("SWFL-7421-v5-20260522") into a human "Data as of" date
 * ("May 22, 2026"). Parsed digit-wise (no Date/TZ surprises). Null if no trailing
 * YYYYMMDD — the badge then shows the raw token only.
 */
export function parseFreshnessDate(token: string): string | null {
  const m = /(\d{4})(\d{2})(\d{2})$/.exec(token);
  if (!m) return null;
  const [, y, mm, dd] = m;
  const month = MONTHS[Number(mm) - 1];
  if (!month) return null;
  return `${month} ${Number(dd)}, ${y}`;
}
