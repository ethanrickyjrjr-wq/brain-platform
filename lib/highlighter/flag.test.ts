import { test, expect } from "bun:test";
import { highlighterUiEnabled } from "./flag";

test("OFF by default when unset", () => {
  expect(highlighterUiEnabled({})).toBe(false);
});

test("OFF for empty / falsey / typo values", () => {
  expect(highlighterUiEnabled({ HIGHLIGHTER_UI: "" })).toBe(false);
  expect(highlighterUiEnabled({ HIGHLIGHTER_UI: "0" })).toBe(false);
  expect(highlighterUiEnabled({ HIGHLIGHTER_UI: "false" })).toBe(false);
  expect(highlighterUiEnabled({ HIGHLIGHTER_UI: "on" })).toBe(false);
});

test("ON only for the explicit '1' or 'true'", () => {
  expect(highlighterUiEnabled({ HIGHLIGHTER_UI: "1" })).toBe(true);
  expect(highlighterUiEnabled({ HIGHLIGHTER_UI: "true" })).toBe(true);
});
