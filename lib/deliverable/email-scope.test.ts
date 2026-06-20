import { describe, it, expect } from "bun:test";
import { emailDeliverableScope } from "./email-scope";
import type { ProjectItem } from "@/lib/project/items";

const base = { id: "x", added_at: "2026-06-10T08:00:00Z", origin: "web" as const };

function metric(report_id: string): ProjectItem {
  return {
    ...base,
    kind: "metric",
    report_id,
    label: "Annual flood loss",
    value: "$30,074/yr",
    freshness_token: "SWFL-7421-v5-20260610",
  };
}

describe("emailDeliverableScope", () => {
  it("derives the project's ZIP scope for an email when an item grounds a ZIP", () => {
    expect(emailDeliverableScope([metric("33931")])).toEqual({
      scope_kind: "zip",
      scope_value: "33931",
    });
  });

  it("returns null when no item grounds a ZIP (the caller must clarify, not build empty)", () => {
    expect(emailDeliverableScope([{ ...base, kind: "note", text: "misc" }])).toBeNull();
    expect(emailDeliverableScope([])).toBeNull();
  });

  it("ignores a non-ZIP report slug (a brain slug is not a place)", () => {
    expect(emailDeliverableScope([metric("rentals-swfl")])).toBeNull();
  });
});
