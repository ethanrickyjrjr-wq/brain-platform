import { describe, expect, test } from "bun:test";
import {
  deliverableToScheduleRecipe,
  type DeliverableRecipeRow,
  type ScheduleChoices,
} from "./schedule-recipe";

function row(over: Partial<DeliverableRecipeRow> = {}): DeliverableRecipeRow {
  return { template: "email", scope_kind: "zip", scope_value: "33901", ...over };
}

function weekly(over: Partial<ScheduleChoices> = {}): ScheduleChoices {
  return { audience_slug: "buyers", cadence: "weekly", day_of_week: 1, send_hour_et: 8, ...over };
}

describe("deliverableToScheduleRecipe", () => {
  test("a ZIP-scoped email deliverable yields a `report` recurring recipe", () => {
    const r = deliverableToScheduleRecipe(row(), weekly());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.command.action).toBe("create");
    // The recurring grounded lane keys on `report`, NOT the deliverable's `email` type.
    expect(r.command.template_id).toBe("report");
    expect(r.command.scope_kind).toBe("zip");
    expect(r.command.scope_value).toBe("33901");
    expect(r.command.audience_slug).toBe("buyers");
    expect(r.command.cadence).toBe("weekly");
    expect(r.command.day_of_week).toBe(1);
    expect(r.command.send_hour_et).toBe(8);
  });

  test("scope-only synthetic row (Task 5 in-chat fromScope) yields the same report recipe", () => {
    // The /api/email/schedule-command `fromScope` branch has no deliverable — it
    // builds a row from the chat's grounded ZIP with a synthetic `template`. Because
    // the recipe reads ONLY the scope, the in-chat lane and the built-deliverable lane
    // produce an identical `report` recipe (they can't diverge).
    const fromScope = deliverableToScheduleRecipe(
      { template: "report", scope_kind: "zip", scope_value: "33931" },
      weekly({ audience_slug: undefined }),
    );
    const fromDeliverable = deliverableToScheduleRecipe(
      { template: "email", scope_kind: "zip", scope_value: "33931" },
      weekly({ audience_slug: undefined }),
    );
    expect(fromScope.ok && fromDeliverable.ok).toBe(true);
    if (!fromScope.ok || !fromDeliverable.ok) return;
    expect(fromScope.command).toEqual(fromDeliverable.command);
    expect(fromScope.command.template_id).toBe("report");
    expect(fromScope.command.scope_value).toBe("33931");
  });

  test("the recipe carries NO snapshot / narrative / topic — recipe-only", () => {
    const r = deliverableToScheduleRecipe(row(), weekly());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect("items_snapshot" in r.command).toBe(false);
    expect("narrative" in r.command).toBe(false);
    expect(r.command.topic).toBeUndefined();
  });

  test("a non-ZIP scope cannot become a grounded report → error", () => {
    const r = deliverableToScheduleRecipe(
      row({ scope_kind: "place", scope_value: "cape coral" }),
      weekly(),
    );
    expect(r.ok).toBe(false);
  });

  test("a blank / null scope → error (never invent a ZIP)", () => {
    expect(
      deliverableToScheduleRecipe(row({ scope_kind: null, scope_value: null }), weekly()).ok,
    ).toBe(false);
    expect(deliverableToScheduleRecipe(row({ scope_value: "" }), weekly()).ok).toBe(false);
  });

  test("scope is normalized via the shared ZIP guard (kind 'ZIP', padded value)", () => {
    const r = deliverableToScheduleRecipe(
      row({ scope_kind: "ZIP", scope_value: " 33901 " }),
      weekly(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.command.scope_value).toBe("33901");
  });

  test("invalid cadence choices are rejected (weekly without day_of_week)", () => {
    const r = deliverableToScheduleRecipe(row(), {
      cadence: "weekly",
      send_hour_et: 8,
    } as ScheduleChoices);
    expect(r.ok).toBe(false);
  });

  test("no audience is allowed (audience is picked later in the chat) — omitted, not null-coerced", () => {
    const r = deliverableToScheduleRecipe(row(), { cadence: "daily", send_hour_et: 8 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.command.audience_slug).toBeUndefined();
  });

  test("deterministic: same inputs → deep-equal command", () => {
    const a = deliverableToScheduleRecipe(row(), weekly());
    const b = deliverableToScheduleRecipe(row(), weekly());
    expect(a).toEqual(b);
  });
});
