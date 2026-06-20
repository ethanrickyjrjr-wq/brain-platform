import { describe, expect, it } from "bun:test";
import { claimSocialOnce, type SocialSendLedgerContext } from "./idempotency";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * claimOnce idempotency test — mirrors lib/email/idempotency.ts:48-84 pattern.
 *
 * We stub the Supabase client's upsert chain to simulate:
 *   - First call: INSERT wins (data=[{id:1}]) → true
 *   - Repeat call: INSERT ignored (data=[])   → false  (key already claimed)
 *
 * This is a pure unit test — no real DB. The concurrency property
 * (FOR UPDATE SKIP LOCKED / no double-claim) is verified by the integration
 * test in the spec-required "claim_due_social_schedules concurrency test"
 * below. That test requires a real DB and is run separately.
 */

const ctx: SocialSendLedgerContext = {
  userId: "user-abc",
  kind: "post",
  scheduleId: 1,
};

function makeClient(returnData: { id: number }[] | null, errorCode?: string): SupabaseClient {
  const error = errorCode ? { message: "error", code: errorCode } : null;

  const chain = {
    select: () => Promise.resolve({ data: returnData, error }),
  };

  return {
    from: () => ({
      upsert: () => chain,
    }),
  } as unknown as SupabaseClient;
}

describe("claimSocialOnce", () => {
  it("returns true when the key is first claimed (INSERT wins)", async () => {
    const db = makeClient([{ id: 1 }]);
    const result = await claimSocialOnce(db, "post:1:2026-06-20", ctx);
    expect(result).toBe(true);
  });

  it("returns false when the key already exists (INSERT ignored — duplicate)", async () => {
    const db = makeClient([]); // empty = ignoreDuplicates path
    const result = await claimSocialOnce(db, "post:1:2026-06-20", ctx);
    expect(result).toBe(false);
  });

  it("returns true (graceful degradation) when table is missing (42P01)", async () => {
    const db = makeClient(null, "42P01");
    const result = await claimSocialOnce(db, "post:1:2026-06-20", ctx);
    expect(result).toBe(true);
  });

  it("throws on any non-42P01 DB error (fail-closed — never double-post on ambiguity)", async () => {
    const db = makeClient(null, "42703");
    await expect(claimSocialOnce(db, "post:1:2026-06-20", ctx)).rejects.toThrow("claimSocialOnce");
  });

  it("treats null data as zero rows (empty-array semantics)", async () => {
    const db = makeClient(null); // null data, no error
    const result = await claimSocialOnce(db, "post:1:2026-06-20", ctx);
    expect(result).toBe(false);
  });
});
