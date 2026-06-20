/**
 * lib/social/idempotency.ts
 *
 * At-most-once claim primitive for the social scheduler.
 * Mirrors lib/email/idempotency.ts:48-84 exactly — same INSERT ON CONFLICT DO NOTHING
 * atomic pattern, same error handling contract, but against social_send_ledger.
 *
 * `claimSocialOnce` is a SINGLE atomic statement — Supabase `.upsert(..., {
 * ignoreDuplicates: true })` → PostgREST `INSERT ... ON CONFLICT DO NOTHING`
 * against the UNIQUE(idempotency_key) index in `public.social_send_ledger`.
 * Two concurrent cron workers racing the same key can't both win: the DB serializes
 * on the unique index and exactly one INSERT returns a row.
 *
 * Key format (from targets.ts buildIdempotencyKey):
 *   `post:<scheduleId>:<YYYY-MM-DD>`
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface SocialSendLedgerContext {
  userId: string;
  kind: string; // "post" | "nonce" | …
  scheduleId?: number | null;
}

/**
 * Try to claim `key`. Returns:
 *   - `true`  → THIS caller won the claim → proceed with publish
 *   - `false` → already claimed → skip (do NOT re-publish)
 *
 * Error handling mirrors email/idempotency.ts:
 *   - `42P01` (table missing — migration not applied yet): returns `true` + warns.
 *     The cron is OFF until go-live applies the migration; this degrades gracefully.
 *   - any other DB error: THROWS (fail-closed — never double-post on ambiguity).
 */
export async function claimSocialOnce(
  db: SupabaseClient,
  key: string,
  ctx: SocialSendLedgerContext,
): Promise<boolean> {
  const { data, error } = await db
    .from("social_send_ledger")
    .upsert(
      {
        idempotency_key: key,
        user_id: ctx.userId,
        kind: ctx.kind,
        schedule_id: ctx.scheduleId ?? null,
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true },
    )
    .select("id");

  if (error) {
    if ((error as { code?: string }).code === "42P01") {
      console.warn(
        `[social-idempotency] social_send_ledger missing — proceeding WITHOUT idempotency for "${key}". ` +
          `Apply docs/sql/20260620_social_schema.sql.`,
      );
      return true;
    }
    throw new Error(`claimSocialOnce("${key}"): ${error.message}`);
  }

  // ignoreDuplicates: PostgREST returns only rows actually inserted.
  // Non-empty → WE inserted (won); empty → key existed (lost).
  return (data?.length ?? 0) > 0;
}
