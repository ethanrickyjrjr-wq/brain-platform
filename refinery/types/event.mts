/**
 * A refined fact before it becomes a SynthesizedEvent — produced either by the
 * synthesis agent or by a pack's deterministic `corpusSummary` hook. Stage 3
 * resolves `src` / `composite` / `date` / `event_id` from this.
 */
export interface SynthesisFact {
  topic: string;
  fact: string;
  value: string;
  /** fragment_id(s) this fact draws from — empty for corpus-level aggregates */
  source_fragment_ids: string[];
  /**
   * Optional reporting period this fact describes (e.g. "2026-Q3"). Carried
   * through so per-period sources — MarketBeat quarterlies, fiscal-year
   * aggregates — preserve the freshness anchor that single-string `value`
   * would otherwise lose. Existing facts simply omit it.
   */
  period?: string;
}

/**
 * Stage 3 output: one refined, citable fact merged from one or more triaged fragments.
 * Maps directly onto a SAVED FACTS entry in the spec-v1.1 Master Index.
 */
export interface SynthesizedEvent {
  /** becomes the SAVED FACTS "id" (f001, f002, ...) — assigned at render time */
  event_id: string;
  topic: string;
  /** short description of what this fact asserts */
  fact: string;
  /** the refined value */
  value: string;
  /** citation id from the citation table (s01, ...) */
  src: string;
  /** ISO date the fact was true / extracted */
  date: string;
  /** provenance — Stage 1 fragment_ids this event was synthesized from */
  source_event_ids: string[];
  /** carried from triage for composite-descending ordering */
  composite: number;
}
