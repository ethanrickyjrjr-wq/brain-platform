import { describe, it, expect, beforeAll } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildMcpServer } from "./server";

/**
 * C-5 — the keyless, anonymous, read-only `swfl_reconcile` tool. These exercise
 * the registered handler directly (same fake-McpServer capture pattern as
 * server.test.ts). Content-level per-status prose is covered deterministically
 * by lib/reconcile/render-verdict.test.ts; here we assert the live tool wiring:
 * resilient not_found, determinism, clean errors, and that swfl_fetch is intact.
 */

interface ReconcileArgs {
  report_id: string;
  label?: string;
  metric_slug?: string;
  value: string;
  freshness_token: string;
  zip?: string;
}
interface ToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
  _meta?: { rules?: unknown };
}
type AnyHandler = (args: ReconcileArgs) => Promise<ToolResult>;

function captureTools(): Map<string, AnyHandler> {
  const byName = new Map<string, AnyHandler>();
  const fake = {
    registerTool(name: string, _config: unknown, cb: AnyHandler) {
      byName.set(name, cb);
    },
  } as unknown as McpServer;
  buildMcpServer(fake);
  return byName;
}

const MISSING = "zzz-nonexistent-brain-xyz"; // never on disk → lookupLakeFact null → not_found

describe("swfl_reconcile — keyless reconciliation tool", () => {
  let tools: Map<string, AnyHandler>;
  let reconcile: AnyHandler;
  beforeAll(() => {
    tools = captureTools();
    const h = tools.get("swfl_reconcile");
    if (!h) throw new Error("buildMcpServer did not register swfl_reconcile");
    reconcile = h;
  });

  it("is registered alongside an intact swfl_fetch (read surface untouched)", () => {
    expect(tools.get("swfl_fetch")).toBeDefined();
    expect(tools.get("swfl_reconcile")).toBeDefined();
  });

  it("a missing/uncataloged brain → not_found, never a crash, never 'expired'", async () => {
    const res = await reconcile({
      report_id: MISSING,
      label: "Median sale price",
      value: "$362,000",
      freshness_token: "SWFL-7421-v5-20260610",
    });
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text.toLowerCase();
    expect(text).toContain("don't hold");
    expect(text).not.toContain("expired"); // no-TTL-basis is NEVER framed as stale
  });

  it("a garbage freshness_token still yields a clean verdict (no crash)", async () => {
    const res = await reconcile({
      report_id: MISSING,
      label: "X",
      value: "1",
      freshness_token: "totally-garbage",
    });
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text.length).toBeGreaterThan(0);
  });

  it("two identical calls → identical output (pure / deterministic)", async () => {
    const args: ReconcileArgs = {
      report_id: MISSING,
      label: "Median sale price",
      value: "$362,000",
      freshness_token: "SWFL-7421-v5-20260610",
    };
    const a = await reconcile({ ...args });
    const b = await reconcile({ ...args });
    expect(a.content[0].text).toBe(b.content[0].text);
  });

  it("neither label nor metric_slug → a clean error, not a crash", async () => {
    const res = await reconcile({
      report_id: "housing-swfl",
      value: "1",
      freshness_token: "SWFL-7421-v5-20260610",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text.toLowerCase()).toContain("label or metric_slug");
  });

  it("a slug-only call (no human label) NEVER speaks the raw metric slug", async () => {
    const res = await reconcile({
      report_id: MISSING,
      metric_slug: "median_sale_price",
      value: "$362,000",
      freshness_token: "SWFL-7421-v5-20260610",
    });
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).not.toContain("median_sale_price");
  });

  it("carries the rules-of-engagement in _meta (downstream honesty bundle), no key", async () => {
    const res = await reconcile({
      report_id: MISSING,
      label: "X",
      value: "1",
      freshness_token: "SWFL-7421-v5-20260610",
    });
    expect(res._meta?.rules).toBeTruthy();
  });
});
