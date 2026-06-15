import { test, expect, mock, beforeEach } from "bun:test";

/**
 * A-8.5 — recordUseForClient stamps the real auth.uid on a usage event when the
 * acting account is known (BUILD attribution), and leaves it null otherwise.
 * Mocks the service-role client and captures the insert payload. Lives in its own
 * file (not meter.test.ts) so mock.module runs BEFORE the meter import — the
 * statically-imported meter in meter.test.ts would otherwise bind the real client.
 */

let captured: Record<string, unknown> | null = null;

mock.module("@/utils/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        captured = row;
        return { error: null };
      },
    }),
  }),
}));

const { recordUseForClient } = await import("./meter");

beforeEach(() => {
  captured = null;
});

test("stamps user_id on a build event when the owner uid is provided", async () => {
  await recordUseForClient(
    "mcp:owner-1",
    { report_id: "p1", reach: [], action: "build" },
    "owner-1",
  );
  expect(captured?.client_id).toBe("mcp:owner-1");
  expect(captured?.user_id).toBe("owner-1");
  expect(captured?.action).toBe("build");
});

test("leaves user_id null for an anonymous/legacy action (no uid)", async () => {
  await recordUseForClient("sdg-anon", { report_id: "p1", reach: [], action: "item_add" });
  expect(captured?.client_id).toBe("sdg-anon");
  expect(captured?.user_id).toBeNull();
});
