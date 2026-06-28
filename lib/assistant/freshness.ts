// freshness.ts — "we don't ship old data." Decide when a HELD figure is too old to
// ship, so the answer path goes to the web lane for the CURRENT cited value instead.
//
// THE RULE (cadence-aware, NOT a flat "1 week"): each metric has a PUBLISH cadence —
// how often a newer value becomes available at its source. A held figure is STALE when
// its as-of is older than that cadence allows (one interval + a publish-lag grace).
// "Stale" is relative to what the SOURCE publishes, never to "today": a monthly metric
// held at the freshest published month is NOT stale even though that month is weeks old.
// A flat threshold is wrong — there is no daily home-value figure; chasing one would push
// the model to invent. So weekly metrics refresh weekly, monthly when a new month drops.
//
// Pure: no I/O, no Date.now() inside the rule — `today` is passed in (deterministic,
// testable). The web fetch + verbatim-citation moat lives in gap-fill.ts / web-fallback.ts;
// this module only decides WHEN to reach for it.

export type Cadence = "daily" | "weekly" | "monthly" | "quarterly" | "annual";

/** Days after which a held figure of this cadence should have a newer published vintage.
 *  = one interval + publish lag. Monthly = 45d so the freshest published month reads fresh
 *  (May 31 → Jun 28 = 28d, fresh) while a month behind reads stale (Apr 30 → Jun 28 = 59d). */
const STALE_AFTER_DAYS: Record<Cadence, number> = {
  daily: 4,
  weekly: 12,
  monthly: 45,
  quarterly: 135,
  annual: 430,
};

/** Map a held figure's source/key/label to its publish cadence. Seeded from the sources
 *  the Email Lab feed actually emits (market-context.ts) + cadence_registry.yaml; grow
 *  from observed sources, not imagination. Unknown → null (we never claim stale blindly). */
const SOURCE_CADENCE: { test: RegExp; cadence: Cadence }[] = [
  { test: /census|\bacs\b/i, cadence: "annual" },
  { test: /zhvi|zori|zillow/i, cadence: "monthly" },
  { test: /redfin/i, cadence: "monthly" },
  {
    test: /\bmls\b|active.?listing|days on market|\bdom\b|inventory|list price/i,
    cadence: "daily",
  },
];

export interface FigureLike {
  key?: string;
  label?: string;
  source?: string;
  as_of?: string;
}

export function cadenceForFigure(f: FigureLike): Cadence | null {
  const hay = `${f.source ?? ""} ${f.key ?? ""} ${f.label ?? ""}`;
  for (const { test, cadence } of SOURCE_CADENCE) if (test.test(hay)) return cadence;
  return null;
}

/** Parse "MM/DD/YYYY" (our figure format) or ISO "YYYY-MM-DD" to a UTC Date; null if
 *  unparseable. Anchored at UTC midnight so day-count math is stable across runs. */
export function parseAsOf(s: string | null | undefined): Date | null {
  if (!s || typeof s !== "string") return null;
  const us = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (us) {
    const [, mm, dd, yyyy] = us;
    const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Is a held figure of `cadence`, dated `asOf`, older than its publish cadence allows?
 *  An unknown/unparseable as-of is NEVER stale — we don't send the model hunting blind. */
export function isStale(asOf: string | null | undefined, cadence: Cadence, today: Date): boolean {
  const d = parseAsOf(asOf);
  if (!d) return false;
  const ageDays = (today.getTime() - d.getTime()) / 86_400_000;
  return ageDays > STALE_AFTER_DAYS[cadence];
}

/** The held figures that are stale (known cadence AND behind it) — the set the web lane
 *  should refresh to current, cited values. */
export function staleFigures<T extends FigureLike>(figs: T[], today: Date): T[] {
  return figs.filter((f) => {
    const c = cadenceForFigure(f);
    return c !== null && isStale(f.as_of, c, today);
  });
}
