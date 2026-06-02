import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import type {
  BrainOutputMetric,
  BrainOutputMetricSource,
  BrainOutputProducerResult,
} from "../types/brain-output.mts";
import {
  faf5Source,
  FAF5_ORNL_URL,
  LATEST_HISTORICAL_FAF_YEAR,
  type FafFlowNormalized,
} from "../sources/faf5-source.mts";
import { env } from "../config/env.mts";

/**
 * logistics-swfl — inbound freight flows landing in the SWFL FAF zone (129,
 * Remainder of Florida) for the latest historical FAF5 year.
 *
 * Branches: one source — FAF5 inbound domestic flows from `data_lake.faf_flows`
 * filtered `dms_dest = 129 AND trade_type = 1`, joined against the zone +
 * SCTG lookups. The source is the entirety of the brain's data; future
 * branches (FDOT traffic counts, ATRI bottleneck data) will land as
 * additional `SourceConnector` entries here when those pipelines ship.
 *
 * Leaf brain (no upstream brains). Pure deterministic — no synthesis agent.
 * Every fact is computed in code from typed fragments and the BrainOutput is
 * assembled by a dedicated outputProducer.
 *
 * Scope discipline (per `[[data-tier-policy]]` Rule 4):
 *   logistics-swfl owns freight flow data; the macro chain stays economic.
 *   Cross-domain reads should happen in master's synthesis, not by
 *   downstreaming the macro brains into this pack.
 */

interface AggregatesByOrigin {
  origin_zone_id: number;
  origin_zone_name: string;
  origin_state_abbr: string;
  tons_thousand: number;
  value_musd: number;
}

interface AggregatesByCommodity {
  sctg_code: number;
  commodity_name: string;
  tons_thousand: number;
  value_musd: number;
}

interface LogisticsAggregate {
  totalTons: number;
  totalValueMusd: number;
  byOrigin: AggregatesByOrigin[];
  byCommodity: AggregatesByCommodity[];
  flowCount: number;
}

let lastAggregate: LogisticsAggregate | null = null;
let lastFetchedAt: string | null = null;

function flowsFrom(fragments: RawFragment[]): FafFlowNormalized[] {
  return fragments
    .map((f) => f.normalized as unknown as FafFlowNormalized)
    .filter((n) => n?.kind === "faf5-flow");
}

function aggregate(flows: FafFlowNormalized[]): LogisticsAggregate {
  const byOriginMap = new Map<number, AggregatesByOrigin>();
  const byCommodityMap = new Map<number, AggregatesByCommodity>();
  let totalTons = 0;
  let totalValueMusd = 0;

  for (const f of flows) {
    totalTons += f.tons_thousand;
    totalValueMusd += f.value_musd;

    const origin = byOriginMap.get(f.origin_zone_id);
    if (origin) {
      origin.tons_thousand += f.tons_thousand;
      origin.value_musd += f.value_musd;
    } else {
      byOriginMap.set(f.origin_zone_id, {
        origin_zone_id: f.origin_zone_id,
        origin_zone_name: f.origin_zone_name,
        origin_state_abbr: f.origin_state_abbr,
        tons_thousand: f.tons_thousand,
        value_musd: f.value_musd,
      });
    }

    const commodity = byCommodityMap.get(f.sctg_code);
    if (commodity) {
      commodity.tons_thousand += f.tons_thousand;
      commodity.value_musd += f.value_musd;
    } else {
      byCommodityMap.set(f.sctg_code, {
        sctg_code: f.sctg_code,
        commodity_name: f.commodity_name,
        tons_thousand: f.tons_thousand,
        value_musd: f.value_musd,
      });
    }
  }

  return {
    totalTons,
    totalValueMusd,
    byOrigin: [...byOriginMap.values()].sort(
      (a, b) => b.tons_thousand - a.tons_thousand,
    ),
    byCommodity: [...byCommodityMap.values()].sort(
      (a, b) => b.tons_thousand - a.tons_thousand,
    ),
    flowCount: flows.length,
  };
}

const fmt1 = (n: number): string =>
  Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString();

const fmtTonsK = (n: number): string => `${fmt1(n)}K tons`;
const fmtMusd = (n: number): string => `$${fmt1(n)}M`;

function buildFlowSource(
  agg: LogisticsAggregate,
  fetched_at: string,
): BrainOutputMetricSource {
  const url =
    env.source === "live"
      ? `${FAF5_ORNL_URL}`
      : "fixture://refinery/__fixtures__/logistics-swfl.sample.json";
  return {
    url,
    fetched_at,
    tier: 1,
    citation:
      `FAF5.7.1 inbound domestic freight flows (ORNL/FHWA Cold Lane Parquet; dms_dest=129 trade_type=1, year ${LATEST_HISTORICAL_FAF_YEAR}). ` +
      `Aggregate: ${agg.flowCount} origin × commodity flow rows summing to ${fmtTonsK(agg.totalTons)} ` +
      `(${fmtMusd(agg.totalValueMusd)}) across ${agg.byOrigin.length} origin zones and ${agg.byCommodity.length} commodity classes.`,
  };
}

function logisticsCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  const flows = flowsFrom(allFragments);
  lastAggregate = aggregate(flows);
  lastFetchedAt = allFragments[0]?.fetched_at ?? null;

  if (flows.length === 0) return [];

  const agg = lastAggregate;
  const facts: SynthesisFact[] = [];

  facts.push({
    topic: "corpus_overview",
    fact: "FAF5 inbound domestic freight corpus — SWFL zone 129, latest historical year",
    value:
      `${agg.flowCount} inbound domestic flow rows landing in FAF zone 129 (Remainder of Florida = SWFL) ` +
      `in year ${LATEST_HISTORICAL_FAF_YEAR}, summed from ${agg.byOrigin.length} distinct origin zones ` +
      `and ${agg.byCommodity.length} SCTG commodity classes. Imports (trade_type=2) and exports ` +
      `(trade_type=3) are intentionally excluded — separate brains will own those scopes if/when built.`,
    source_fragment_ids: [],
  });

  facts.push({
    topic: "metric:inbound_freight_tons_swfl",
    fact: "Total inbound domestic freight tonnage landing in SWFL",
    value:
      `Total inbound domestic freight in year ${LATEST_HISTORICAL_FAF_YEAR}: ` +
      `${fmtTonsK(agg.totalTons)} (thousand tons) across all origins and commodities.`,
    source_fragment_ids: [],
  });

  facts.push({
    topic: "metric:inbound_freight_value_swfl_musd",
    fact: "Total inbound domestic freight value landing in SWFL",
    value:
      `Total inbound domestic freight value in year ${LATEST_HISTORICAL_FAF_YEAR}: ` +
      `${fmtMusd(agg.totalValueMusd)} (millions USD) across all origins and commodities.`,
    source_fragment_ids: [],
  });

  const topOrigins = agg.byOrigin.slice(0, 3);
  if (topOrigins.length > 0) {
    const named = topOrigins
      .map(
        (o) =>
          `${o.origin_zone_name} (FAF zone ${o.origin_zone_id}, ${o.origin_state_abbr}) — ${fmtTonsK(o.tons_thousand)} / ${fmtMusd(o.value_musd)}`,
      )
      .join("; ");
    facts.push({
      topic: "top_origins",
      fact: "Top 3 origin zones by inbound tonnage",
      value: `Top 3 origins by tons in ${LATEST_HISTORICAL_FAF_YEAR}: ${named}.`,
      source_fragment_ids: [],
    });
  }

  const topCommodities = agg.byCommodity.slice(0, 3);
  if (topCommodities.length > 0) {
    const named = topCommodities
      .map(
        (c) =>
          `${c.commodity_name} (SCTG ${c.sctg_code}) — ${fmtTonsK(c.tons_thousand)} / ${fmtMusd(c.value_musd)}`,
      )
      .join("; ");
    facts.push({
      topic: "top_commodities",
      fact: "Top 3 commodity classes by inbound tonnage",
      value: `Top 3 commodities by tons in ${LATEST_HISTORICAL_FAF_YEAR}: ${named}.`,
      source_fragment_ids: [],
    });
  }

  return facts;
}

function logisticsOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const agg = lastAggregate;
  const fetched_at =
    lastFetchedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  if (!agg || agg.flowCount === 0) {
    // Live build with zero FAF5 flows is a real ingestion failure, not a valid
    // "no freight" read — a live build against empty data produces no fixture
    // sentinel, so the Stage-4 gate sails right past it. Fail loud here (the
    // way fdot-source's assertSegmentsNonEmpty does) so an empty live run can
    // never silently ship a hollow brain as "live". The graceful-degrade path
    // below is reserved for fixture mode.
    if (env.source === "live") {
      throw new Error(
        "logistics-swfl: live build resolved 0 FAF5 inbound flow rows for zone 129. " +
          "Confirm the FAF5 Parquet exists in lake-tier1 S3 (re-run ingest/scripts/faf5_to_parquet.py) " +
          "and that DuckDB S3 credentials are configured. Refusing to ship a hollow 'live' brain.",
      );
    }
    return {
      conclusion:
        "logistics-swfl could not resolve any FAF5 inbound flow rows for zone 129 — no freight context available this build.",
      key_metrics: [],
      caveats: [
        `No flows returned by ${env.source === "fixture" ? "fixture" : "live data_lake.faf_flows query"}. ` +
          "If live, confirm the dlt pipeline ran successfully and that GRANT SELECT TO service_role is in place on data_lake.faf_flows + faf_zone_lookup + faf_sctg_lookup.",
      ],
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  const flowSource = buildFlowSource(agg, fetched_at);

  const key_metrics: BrainOutputMetric[] = [
    {
      metric: "inbound_freight_tons_swfl",
      value: Math.round(agg.totalTons * 10) / 10,
      direction: "stable",
      label: `Total inbound domestic freight to SWFL, year ${LATEST_HISTORICAL_FAF_YEAR} (thousand tons)`,
      variable_type: "extensive",
      units: "thousand tons/year",
      display_format: "count",
      source: flowSource,
    },
    {
      metric: "inbound_freight_value_swfl_musd",
      value: Math.round(agg.totalValueMusd * 10) / 10,
      direction: "stable",
      label: `Total inbound domestic freight value to SWFL, year ${LATEST_HISTORICAL_FAF_YEAR} (millions USD)`,
      variable_type: "extensive",
      units: "million USD/year",
      display_format: "currency",
      source: flowSource,
    },
  ];

  const topOrigins = agg.byOrigin.slice(0, 3);
  const topCommodities = agg.byCommodity.slice(0, 3);

  const conclusionParts: string[] = [];
  conclusionParts.push(
    `In FAF5 year ${LATEST_HISTORICAL_FAF_YEAR}, SWFL (FAF zone 129) absorbed ${fmtTonsK(agg.totalTons)} of inbound domestic freight ` +
      `worth ${fmtMusd(agg.totalValueMusd)} across ${agg.byOrigin.length} origin zones and ${agg.byCommodity.length} commodity classes.`,
  );
  if (topOrigins.length > 0) {
    const originNarrative = topOrigins
      .map((o) => `${o.origin_zone_name} (${fmtTonsK(o.tons_thousand)})`)
      .join(", ");
    conclusionParts.push(
      `Top origin zones by tonnage: ${originNarrative} — the freight base loads into SWFL primarily from these corridors.`,
    );
  }
  if (topCommodities.length > 0) {
    const commodityNarrative = topCommodities
      .map((c) => `${c.commodity_name} (${fmtTonsK(c.tons_thousand)})`)
      .join(", ");
    conclusionParts.push(
      `Top commodity classes by tonnage: ${commodityNarrative}.`,
    );
  }

  const caveats: string[] = [
    `Scope is inbound domestic only (dms_dest=129 AND trade_type=1). Imports (trade_type=2), exports (trade_type=3), and outbound flows (dms_orig=129) are intentionally excluded — separate brains would own those scopes if built.`,
    `Year scope is ${LATEST_HISTORICAL_FAF_YEAR} (latest historical FAF5 year). FAF5 forecast years are deliberately not consumed here; bump LATEST_HISTORICAL_FAF_YEAR in refinery/sources/faf5-source.mts when ORNL publishes the next vintage.`,
    `v1 emits no direction/magnitude vote — the brain reports a point-in-time snapshot, not a time series. Direction reads require a multi-year retro (planned for v2 once a second FAF5 vintage is ingested).`,
  ];
  if (env.source === "fixture") {
    caveats.unshift(
      "FAF5 flows in this build are synthetic fixture data — unset REFINERY_SOURCE or set it to `live` to query data_lake.faf_flows.",
    );
  }

  return {
    conclusion: conclusionParts.join(" "),
    key_metrics,
    caveats,
    direction: "neutral",
    magnitude: 0.5,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
  };
}

export const logisticsSwfl: PackDefinition = {
  id: "logistics-swfl",
  brain_id: "logistics-swfl",
  public_label: "Logistics",
  domain: "logistics",
  scope:
    "Inbound domestic freight flows landing in the SWFL FAF zone (129, Remainder of Florida) for the latest historical FAF5 year — origin zones, commodity classes, total tonnage + value.",
  ttl_seconds: 2592000, // 30 days — FAF5 publishes annually; daily refresh is overkill
  sources: [faf5Source],
  input_brains: [],
  fitScore: (): number => 8,
  compositeCutoff: 0,
  skipTriageAgent: true,
  skipSynthesisAgent: true,
  corpusSummary: logisticsCorpusSummary,
  outputProducer: logisticsOutputProducer,
  preferences: [
    "The user is an SWFL operator or analyst who reads inbound freight composition to size demand for construction materials, fuel, food, and other shipped goods.",
    "The user treats FAF5 inbound flows as a freight-base snapshot — not a leading indicator of corridor activity. Time-series reads require multiple FAF5 vintages.",
    "The user pairs freight context with macro brains (macro-us SOFR, macro-florida labor) cross-vertically through master synthesis rather than embedding macro reads inside logistics.",
  ],
  activeProject:
    "logistics-swfl: standing snapshot of inbound domestic freight to SWFL — FAF5 origin × commodity × value/tonnage at the latest historical year.",
  prompts: {
    triageContext:
      "These fragments are FAF5 inbound freight flow rows (one per origin × commodity for the latest historical year). They are all decision-relevant by construction; the pack is pure deterministic aggregation.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). Every fact is produced deterministically by logisticsCorpusSummary and the BrainOutput is built by logisticsOutputProducer.",
  },
};
