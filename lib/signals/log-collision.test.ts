import { test, expect } from "bun:test";
import { buildCollisionRow } from "./log-collision";

test("builds an in_project confirmed evidence row", () => {
  const row = buildCollisionRow({
    projectId: "p1",
    change: { slug: "mortgage_rate", item_id: "i1", label: "30-yr rate",
      previous_value: "6.8%", current_value: "7.3%", delta_description: "rose 7.4%",
      signal_strength: 2, impact_weight: 8, priority: 16 } as any,
    scopeKind: "county", scopeValue: "12071",
    userAction: "confirmed",
  });
  expect(row).toMatchObject({
    project_id: "p1", metric_slug: "mortgage_rate", metric_label: "30-yr rate",
    scope_kind: "county", scope_value: "12071",
    snapshot_value: "6.8%", value_used: "7.3%",
    surface: "in_project", user_action: "confirmed",
  });
});
