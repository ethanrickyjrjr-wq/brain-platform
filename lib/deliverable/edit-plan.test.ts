import { test, expect } from "bun:test";
import { planDeliverableEdit, type EditPlan } from "./edit-plan";

test("empty body → noop", () => {
  expect(planDeliverableEdit({}).mode).toBe("noop");
  expect(planDeliverableEdit(null).mode).toBe("noop");
  expect(planDeliverableEdit(undefined).mode).toBe("noop");
});

test("template only → cosmetic in-place", () => {
  const plan = planDeliverableEdit({ template: "one-pager" });
  expect(plan.mode).toBe("cosmetic");
  if (plan.mode === "cosmetic") expect(plan.patch).toEqual({ template: "one-pager" });
});

test("branding only → cosmetic in-place", () => {
  const plan = planDeliverableEdit({ branding: { primary_color: "#0a0" } });
  expect(plan.mode).toBe("cosmetic");
  if (plan.mode === "cosmetic") expect(plan.patch).toEqual({ branding: { primary_color: "#0a0" } });
});

test("template + branding → cosmetic patches both", () => {
  const plan = planDeliverableEdit({ template: "bov-lite", branding: { accent_color: "#fff" } });
  expect(plan.mode).toBe("cosmetic");
  if (plan.mode === "cosmetic")
    expect(plan.patch).toEqual({ template: "bov-lite", branding: { accent_color: "#fff" } });
});

test("branding: null → cosmetic patch clears branding", () => {
  const plan = planDeliverableEdit({ branding: null });
  expect(plan.mode).toBe("cosmetic");
  if (plan.mode === "cosmetic") expect(plan.patch).toEqual({ branding: null });
});

test("invalid template → invalid 400", () => {
  const plan = planDeliverableEdit({ template: "not-a-template" });
  expect(plan).toEqual({ mode: "invalid", status: 400, error: "invalid template" } as EditPlan);
});

test("'email' is rejected as an edit target (scope-bound render path)", () => {
  expect(planDeliverableEdit({ template: "email" })).toEqual({
    mode: "invalid",
    status: 400,
    error: "invalid template",
  } as EditPlan);
});

test("invalid branding (string / array) → invalid 400", () => {
  expect(planDeliverableEdit({ branding: "red" }).mode).toBe("invalid");
  expect(planDeliverableEdit({ branding: [1, 2] }).mode).toBe("invalid");
});

test("invalid instruction (non-string) → invalid 400", () => {
  expect(planDeliverableEdit({ instruction: 5 }).mode).toBe("invalid");
});

test("items provided → content fork (itemsProvided true)", () => {
  const plan = planDeliverableEdit({ items: [{ id: "a" }] });
  expect(plan.mode).toBe("content");
  if (plan.mode === "content") {
    expect(plan.itemsProvided).toBe(true);
    expect(plan.items).toEqual([{ id: "a" }]);
    expect(plan.instructionProvided).toBe(false);
  }
});

test("instruction provided → content fork (regenerates narrative)", () => {
  const plan = planDeliverableEdit({ instruction: "lead with rents" });
  expect(plan.mode).toBe("content");
  if (plan.mode === "content") {
    expect(plan.instructionProvided).toBe(true);
    expect(plan.instruction).toBe("lead with rents");
    expect(plan.itemsProvided).toBe(false);
  }
});

test("empty instruction string still forks content (regen with no steer)", () => {
  const plan = planDeliverableEdit({ instruction: "" });
  expect(plan.mode).toBe("content");
  if (plan.mode === "content") expect(plan.instructionProvided).toBe(true);
});

test("content edit carries template + branding for the merge", () => {
  const plan = planDeliverableEdit({
    items: [{ id: "a" }],
    template: "market-overview",
    branding: { name: "Acme" },
  });
  expect(plan.mode).toBe("content");
  if (plan.mode === "content") {
    expect(plan.template).toBe("market-overview");
    expect(plan.brandingProvided).toBe(true);
    expect(plan.branding).toEqual({ name: "Acme" });
  }
});

test("invalid template wins even when content fields are present", () => {
  const plan = planDeliverableEdit({ items: [{ id: "a" }], template: "bogus" });
  expect(plan.mode).toBe("invalid");
});
