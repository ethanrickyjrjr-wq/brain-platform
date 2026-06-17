import { describe, it, expect } from "bun:test";
import { parseDeliverableScope } from "./parse-scope";

describe("parseDeliverableScope", () => {
  it("accepts a zip scope verbatim (already canonical)", () => {
    expect(parseDeliverableScope("zip", "33931")).toEqual({
      scope_kind: "zip",
      scope_value: "33931",
    });
  });

  it("canonicalizes a place value to lowercase + trimmed (the scope contract)", () => {
    expect(parseDeliverableScope("place", "  Fort Myers Beach ")).toEqual({
      scope_kind: "place",
      scope_value: "fort myers beach",
    });
  });

  it("accepts county", () => {
    expect(parseDeliverableScope("county", "Lee")).toEqual({
      scope_kind: "county",
      scope_value: "lee",
    });
  });

  it("rejects an unknown scope kind → empty (no scope written)", () => {
    expect(parseDeliverableScope("msa", "cape-coral")).toEqual({});
  });

  it("drops a kind that has no value (a kind without a value is meaningless)", () => {
    expect(parseDeliverableScope("zip", "   ")).toEqual({});
    expect(parseDeliverableScope("zip", undefined)).toEqual({});
  });

  it("missing/empty kind → empty", () => {
    expect(parseDeliverableScope(undefined, "33931")).toEqual({});
    expect(parseDeliverableScope("", "33931")).toEqual({});
  });
});
