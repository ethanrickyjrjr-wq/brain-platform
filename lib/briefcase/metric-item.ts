import type { ProjectItem } from "@/lib/project/items";

export interface MetricItemInput {
  deliverable_id: string;
  label: string;
  value: string;
  source_url?: string;
  source_label?: string;
  freshness_token?: string;
}

export function buildMetricItem(input: MetricItemInput): ProjectItem {
  const item: Extract<ProjectItem, { kind: "metric" }> = {
    id: crypto.randomUUID(),
    added_at: new Date().toISOString(),
    origin: "web",
    kind: "metric",
    report_id: input.deliverable_id,
    label: input.label,
    value: input.value,
    freshness_token: input.freshness_token ?? "",
  };
  if (input.source_url) item.source_url = input.source_url;
  if (input.source_label) item.source_label = input.source_label;
  return item;
}
