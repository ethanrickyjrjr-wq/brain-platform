import type { PackDefinition } from "../types/pack.mts";

/**
 * fgcu-reri — SWFL monthly economic snapshot from FGCU's Regional Economic
 * Research Institute (Lutgert College of Business).
 *
 * Source: public.fgcu_reri_indicators (ingest/pipelines/fgcu_reri_indicators)
 * Cadence: monthly ~4th of month, ~2-month data lag.
 * Coverage: Lee + Collier + Charlotte counties.
 *
 * 8 indicators per report month:
 *   airport_activity, tourist_tax_revenues, taxable_sales, unemployment_rate,
 *   permits_single_family, home_sales_single_family, home_prices_single_family
 *   (per county: Lee / Collier / Charlotte), active_listings_residential.
 *
 * STATUS: skeleton — source connector + outputProducer not yet implemented.
 * Brain-first gate satisfied: PackDefinition ships with the ingest pipeline PR.
 * Full implementation tracked in docs/ontology-and-roadmap.md §NEAR-TERM.
 */
export const fgcuReri: PackDefinition = {
  id: "fgcu-reri",
  brain_id: "fgcu-reri",
  domain: "macro",
  scope: "Southwest Florida — FGCU RERI monthly regional economic indicators",
  ttl_seconds: 30 * 24 * 60 * 60, // 30 days

  sources: [],
  input_brains: [],

  fitScore: () => 0,

  skipSynthesisAgent: true,
  skipTriageAgent: true,

  corpusSummary: () => [],
};
