import { test, expect } from "bun:test";
import { buildClaudeHandoff } from "./handoff";

test("handoff primes with the fact, report, and the MCP fetch instruction", () => {
  const text = buildClaudeHandoff({
    report_id: "housing-swfl",
    fact: "$525,000 median",
    conclusion: "Housing is cooling.",
    freshness_token: "SWFL-7421-v5-20260607",
  });
  expect(text).toContain("$525,000 median");
  expect(text).toContain("housing-swfl");
  expect(text).toContain("swfl_fetch");
  expect(text).toContain("SWFL-7421-v5-20260607");
});
