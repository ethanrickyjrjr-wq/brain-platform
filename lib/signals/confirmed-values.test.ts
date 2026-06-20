import { test, expect } from "bun:test";
import { confirmKey, isConfirmed, withConfirmed, withoutConfirmed } from "./confirmed-values";

test("confirmKey is stable and value-sensitive", () => {
  expect(confirmKey("i1", "6.8%")).toBe(confirmKey("i1", "6.8%"));
  expect(confirmKey("i1", "6.8%")).not.toBe(confirmKey("i1", "7.3%"));
});

test("isConfirmed only when itemId AND exact filed value match", () => {
  const cv = { i1: "6.8%" };
  expect(isConfirmed(cv, "i1", "6.8%")).toBe(true);
  expect(isConfirmed(cv, "i1", "7.3%")).toBe(false);
  expect(isConfirmed(cv, "i2", "6.8%")).toBe(false);
  expect(isConfirmed(undefined, "i1", "6.8%")).toBe(false);
});

test("withConfirmed merges immutably; withoutConfirmed drops the item", () => {
  const ui = { mcp_dismissed_count: 1, confirmed_values: { i1: "6.8%" } };
  const added = withConfirmed(ui, "i2", "100");
  expect(added.confirmed_values).toEqual({ i1: "6.8%", i2: "100" });
  expect(ui.confirmed_values).toEqual({ i1: "6.8%" });
  expect(added.mcp_dismissed_count).toBe(1);
  const dropped = withoutConfirmed(added, "i1");
  expect(dropped.confirmed_values).toEqual({ i2: "100" });
});
