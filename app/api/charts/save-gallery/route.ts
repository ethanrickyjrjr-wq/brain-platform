import { NextResponse, type NextRequest } from "next/server";
import { lintChartBlock, type ChartValueFormat } from "@/refinery/validate/chart-block-lint.mts";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { loadGalleryPanel } from "@/lib/charts/gallery-loaders";
import type { ValueFormat } from "@/lib/charts/format";

function toChartValueFormat(f: ValueFormat): ChartValueFormat {
  switch (f) {
    case "usd":
      return "usd";
    case "rent":
      return "currency";
    case "pct":
      return "percent";
    case "count":
      return "count";
    case "index":
      return "number";
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rootId = (body as { rootId?: string } | null)?.rootId;
  if (!rootId) return NextResponse.json({ error: "no rootId" }, { status: 400 });

  const supabase = createServiceRoleClient();
  const panel = await loadGalleryPanel(supabase, rootId);
  if (!panel) return NextResponse.json({ error: "unknown rootId" }, { status: 400 });
  if (panel.error || panel.data.length === 0) {
    return NextResponse.json({ error: panel.error ?? "no data" }, { status: 500 });
  }

  // Build ChartBlock: columns are the series keys (not labels) so the workspace
  // can reconstruct ChartRow objects by key and re-render with MetroAreaChart.
  const colKeys = ["month", ...panel.series.map((s) => s.key)];
  const rows = panel.data.map((row) =>
    colKeys.map((k) => (row as Record<string, unknown>)[k] ?? null),
  ) as (string | number | null)[][];

  // Convert "YYYY-MM" → "YYYY-MM-01" (ISO date required by ChartBlock.asOf lint).
  const asOfRaw = panel.asOf ?? "";
  const asOf = /^\d{4}-\d{2}$/.test(asOfRaw) ? `${asOfRaw}-01` : asOfRaw;

  const block = {
    title: panel.title,
    columns: colKeys,
    rows,
    chart_type: "area" as const,
    value_format: toChartValueFormat(panel.valueFormat),
    asOf,
    source: { citation: "SWFL Data Gulf" },
  };

  const lint = lintChartBlock(block, null, { requireAsOf: true });
  if (!lint.ok) {
    return NextResponse.json({ error: "invalid chart", detail: lint.errors }, { status: 422 });
  }

  // Carry series/format/variant so the workspace can render MetroAreaChart
  // (with the correct gulf colors and time-range picker) instead of the generic
  // ChartBlockView fallback.
  const source_meta = {
    galleryPanel: {
      series: panel.series,
      valueFormat: panel.valueFormat,
      variant: panel.variant ?? "line",
      eyebrow: panel.eyebrow,
      subtitle: panel.subtitle,
    },
  };

  const id = crypto.randomUUID().slice(0, 8);
  const { error } = await supabase.from("saved_charts").insert({
    id,
    chart_block: block,
    source_meta,
    freshness_token: panel.asOf ?? null,
  });
  if (error) return NextResponse.json({ error: "save failed" }, { status: 500 });

  return NextResponse.json({ id });
}
