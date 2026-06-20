// scripts/social/run-schedules.mts
//
// Social scheduler cron WORKER (build 04). A standalone Bun process invoked by
// the GHA cron (social-scheduler.yml) every N minutes. Mirrors the email worker
// (`scripts/email/run-schedules.mts`) exactly in structure; swaps email seams for
// social seams.
//
// ARCHITECTURE:
//   - Claims due social_schedules rows via `claim_due_social_schedules` RPC
//     (FOR UPDATE SKIP LOCKED + park-on-claim).
//   - Per claimed row: freshness gate → idempotency claim → compose → render →
//     publish gate → postToChannel (or dry_run record) → re-arm.
//   - Self-healing reaper re-arms crash-orphaned rows (parked > 1h).
//
// DRY_RUN = process.env.DRY_RUN === "true"
//   A true read-only run: SELECT instead of claim RPC, no writes, no platform calls.
//
// SOCIAL_PUBLISH_ENABLED = process.env.SOCIAL_PUBLISH_ENABLED === "true"
//   When false (the default): compose + render + claim + record run, but
//   postToChannel is short-circuited and the post is written with status='dry_run'.
//   When true: postToChannel fires and platform_post_id is recorded.
//
// EXIT CODES:
//   0 — clean (including zero-due)
//   1 — top-level fatal only (missing env, claim unreachable, can't build client)
//   Per-row errors NEVER change the exit code.

import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { computeNextRunAt } from "@/lib/email/schedule-cadence";
import { claimSocialOnce } from "@/lib/social/idempotency";
import { buildTargetsFromSchedules, buildIdempotencyKey } from "@/lib/social/targets";
import { composePosts } from "@/lib/social/compose";
import { buildSocialContent } from "@/lib/social/build-content";
import { passesFreshnessGate } from "@/lib/social/lifecycle";
import { renderSocialImage } from "@/lib/social/render-social-image";
import { postToChannel } from "@/lib/social/channels/index";
import type { SocialSchedule, SocialTarget, SocialContent } from "@/lib/social/types";
import type { BuildSocialContentDeps } from "@/lib/social/build-content";

const DRY_RUN = process.env.DRY_RUN === "true";
const PUBLISH_ENABLED = process.env.SOCIAL_PUBLISH_ENABLED === "true";
const CLAIM_LIMIT = 50;
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";

// Crash-orphan reaper window: a parked row (next_run_at=NULL) whose last_run_at
// is older than this is a genuine crash-orphan, safe to re-arm. A freshly-claimed
// row has last_run_at=now, so it will NOT be reaped mid-flight by a concurrent run.
const ORPHAN_STALE_MS = 60 * 60 * 1000; // 1 hour

// ── content deps ──────────────────────────────────────────────────────────────

/**
 * Build the injectable BuildSocialContentDeps for this run. Fetches the brain
 * dossier for a scope from the live API (or from a per-run cache when the same
 * scope is requested multiple times across schedules).
 */
function buildContentDeps(): BuildSocialContentDeps {
  const cache = new Map<string, Awaited<ReturnType<BuildSocialContentDeps["fetchBrain"]>>>();

  return {
    async fetchBrain(scopeKind, scopeValue) {
      const key = `${scopeKind ?? ""}|${scopeValue ?? ""}`;
      if (cache.has(key)) return cache.get(key) ?? null;

      try {
        const params = new URLSearchParams({ format: "json", view: "speak", tier: "2" });
        if (scopeKind && scopeValue) {
          params.set("scope_kind", scopeKind);
          params.set("scope_value", scopeValue);
        }
        const url = `${SITE_URL}/api/b/master?${params.toString()}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) {
          console.warn(`[social] brain fetch ${res.status} for scope ${key}`);
          cache.set(key, null);
          return null;
        }
        const json = (await res.json()) as {
          in_scope?: boolean;
          freshness_token?: string;
          conclusion?: string | null;
          key_metrics?: Array<{ label: string; value: string | number }>;
          brain_id?: string;
        };
        const dossier = {
          in_scope: json.in_scope ?? false,
          freshness_token: json.freshness_token ?? "",
          conclusion: json.conclusion ?? null,
          key_metrics: json.key_metrics ?? [],
          brain_id: json.brain_id,
        };
        cache.set(key, dossier);
        return dossier;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(`[social] brain fetch error for scope ${key}: ${reason}`);
        cache.set(key, null);
        return null;
      }
    },
  };
}

// ── main ───────────────────────────────────────────────────────────────────────

function requireEnv(): void {
  // SDG_CRYPTO_KEY is required for token decryption (refreshAccessToken reads it).
  // Only enforce on a real publish run (a DRY_RUN with PUBLISH_ENABLED=false never
  // calls token refresh); but SDG_CRYPTO_KEY is also needed for local dry-runs in CI
  // if we're claiming + reading account rows. Warn rather than hard-block so a pure
  // dry-run smoke pass without crypto secrets still exits 0 and logs the gap.
  if (!DRY_RUN && PUBLISH_ENABLED && !process.env.SDG_CRYPTO_KEY) {
    throw new Error("SDG_CRYPTO_KEY is required for live publish runs (token decryption).");
  }
  if (!DRY_RUN && !process.env.SUPABASE_URL) {
    throw new Error("SUPABASE_URL is required for a real run.");
  }
}

async function main(): Promise<void> {
  requireEnv();
  const db = createServiceRoleClient(); // throws → top-level fatal
  const now = new Date();
  const nowIso = now.toISOString();
  const contentDeps = buildContentDeps();

  // ── DRY_RUN vs. real claim ────────────────────────────────────────────────
  async function claimDue(): Promise<SocialSchedule[]> {
    if (DRY_RUN) {
      const { data, error } = await db
        .from("social_schedules")
        .select("*")
        .eq("status", "active")
        .not("next_run_at", "is", null)
        .lte("next_run_at", nowIso)
        .order("next_run_at", { ascending: true })
        .limit(CLAIM_LIMIT);
      if (error) throw new Error(`dry-run select due schedules failed: ${error.message}`);
      return (data ?? []) as SocialSchedule[];
    }
    const { data, error } = await db.rpc("claim_due_social_schedules", {
      p_now: nowIso,
      p_limit: CLAIM_LIMIT,
    });
    if (error) throw new Error(`claim_due_social_schedules failed: ${error.message}`);
    return (data ?? []) as SocialSchedule[];
  }

  // ── SELF-HEALING REAPER (real runs only) ──────────────────────────────────
  // Re-arms active rows whose next_run_at was parked (NULL) by a prior crashed
  // worker and never re-armed. The staleness guard (last_run_at older than
  // ORPHAN_STALE_MS) ensures a freshly-claimed row is NOT reaped mid-flight.
  async function reapCrashOrphans(): Promise<void> {
    if (DRY_RUN) return; // never mutate in a dry run
    const staleBeforeIso = new Date(now.getTime() - ORPHAN_STALE_MS).toISOString();
    const { data, error } = await db
      .from("social_schedules")
      .select("*")
      .is("next_run_at", null)
      .eq("status", "active")
      .lt("last_run_at", staleBeforeIso)
      .limit(CLAIM_LIMIT);
    if (error) throw new Error(`reaper select crash-orphans failed: ${error.message}`);
    const orphans = (data ?? []) as SocialSchedule[];
    if (orphans.length === 0) return;

    let reaped = 0;
    for (const row of orphans) {
      try {
        const nextRunAt = computeNextRunAt(row as Parameters<typeof computeNextRunAt>[0], now);
        const { error: upErr } = await db
          .from("social_schedules")
          .update({ next_run_at: nextRunAt?.toISOString() ?? null, updated_at: nowIso })
          .eq("id", row.id);
        if (upErr) throw new Error(upErr.message);
        reaped++;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[social] reaper failed for schedule ${row.id}: ${reason}`);
      }
    }
    console.log(
      `[social] reaper re-armed ${reaped} crash-orphaned schedule(s) ` +
        `(of ${orphans.length} stale parked, threshold=${staleBeforeIso}).`,
    );
  }

  await reapCrashOrphans();

  const rows = await claimDue();
  console.log(
    `[social] ${DRY_RUN ? "DRY_RUN " : ""}claimed ${rows.length} due schedule(s) at ${nowIso}.`,
  );
  if (rows.length === 0) {
    console.log("[social] nothing due; exiting clean.");
    return;
  }

  // ── Look up the last freshness_token posted per schedule (freshness gate) ──
  // Batch: one IN query for all claimed schedule IDs.
  const scheduleIds = rows.map((r) => r.id);
  const lastTokenByScheduleId = new Map<number, string | null>();
  if (!DRY_RUN) {
    const { data: posts } = await db
      .from("social_posts")
      .select("post_schedule_id, freshness_token, created_at")
      .in("post_schedule_id", scheduleIds)
      .order("created_at", { ascending: false })
      .limit(scheduleIds.length * 5); // fetch enough rows to cover all schedules
    if (posts) {
      for (const post of posts as Array<{
        post_schedule_id: number | null;
        freshness_token: string | null;
      }>) {
        if (post.post_schedule_id != null && !lastTokenByScheduleId.has(post.post_schedule_id)) {
          lastTokenByScheduleId.set(post.post_schedule_id, post.freshness_token);
        }
      }
    }
  }

  // ── Build targets from schedule rows ──────────────────────────────────────
  const { targets: allTargets, errors: parseErrors } = buildTargetsFromSchedules(
    rows,
    lastTokenByScheduleId,
  );
  for (const e of parseErrors) {
    console.error(`[social] schedule ${e.scheduleId} invalid: ${e.reason}`);
  }

  // ── Process per row (one bad row NEVER aborts the batch) ──────────────────
  const tally = { published: 0, dry_run: 0, skipped: 0, error: 0 };

  for (const row of rows) {
    const target = allTargets.find((t) => t.scheduleId === row.id);
    try {
      if (!target) {
        // parse error already logged above — re-arm and move on.
        tally.skipped++;
        continue;
      }
      const outcome = await processSchedule(row, target, db, now, contentDeps);
      tally[outcome]++;
    } catch (err) {
      // Per-row errors are isolated — never change the exit code.
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[social] schedule ${row.id} FATAL: ${reason}`);
      tally.error++;
    } finally {
      // Re-arm in `finally` so a crashed process still gets a next_run_at if we
      // were mid-flight; DRY_RUN skip (read-only).
      if (!DRY_RUN) {
        const nextRunAt = computeNextRunAt(row as Parameters<typeof computeNextRunAt>[0], now);
        const { error: rearmErr } = await db
          .from("social_schedules")
          .update({
            next_run_at: nextRunAt?.toISOString() ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        if (rearmErr) {
          console.error(`[social] re-arm schedule ${row.id}: ${rearmErr.message}`);
        }
      }
    }
  }

  console.log(
    `[social] done — published=${tally.published} dry_run=${tally.dry_run} ` +
      `skipped=${tally.skipped} error=${tally.error} (total=${rows.length}).`,
  );
}

type RowOutcome = "published" | "dry_run" | "skipped" | "error";

/**
 * Process one claimed social schedule:
 *   freshness gate → idempotency claim → compose → render → publish gate →
 *   write social_posts.
 *
 * Returns the outcome key for the summary tally.
 * Never throws past its boundary (the caller's try/catch is a safety net, but
 * per-row errors should resolve to "error" or "skipped" here, not propagate).
 */
async function processSchedule(
  row: SocialSchedule,
  target: SocialTarget,
  db: ReturnType<typeof createServiceRoleClient>,
  now: Date,
  contentDeps: BuildSocialContentDeps,
): Promise<RowOutcome> {
  const scheduleId = row.id;
  const log = (msg: string) => console.log(`[social:${scheduleId}] ${msg}`);

  // 1. Build content first — we need the freshness_token for the gate check.
  const content: SocialContent | null = await buildSocialContent(target, contentDeps);

  if (!content) {
    log(
      `out_of_scope — no in-scope brain data for ${target.scopeKind ?? "region"}:${target.scopeValue ?? ""}`,
    );
    return "skipped";
  }

  // 2. Freshness gate: skip if the brain data hasn't advanced since last post.
  //    If freshness_gate is disabled on this schedule, always proceed.
  if (!passesFreshnessGate(target.freshnessGate, content.freshness, target.lastFreshnessToken)) {
    log(`freshness gate: token unchanged (${content.freshness}) — skip`);
    return "skipped";
  }

  // 3. At-most-once idempotency claim (DRY_RUN: skip — read-only).
  if (!DRY_RUN) {
    const idempotencyKey = buildIdempotencyKey(scheduleId, now);
    const won = await claimSocialOnce(db, idempotencyKey, {
      userId: target.userId,
      kind: "post",
      scheduleId,
    });
    if (!won) {
      log(`already claimed for ${idempotencyKey} — skipping duplicate`);
      return "skipped";
    }
  }

  // 4. Compose (build caption + hashtags). We already have content from step 1,
  //    but we route through composePosts to keep the MOAT gate in one place.
  //    Pass the already-fetched content to avoid a double fetch.
  const { posts } = await composePosts([target], async () => content);
  const composed = posts[0];

  if (composed.status !== "ready" || !composed.post) {
    log(`compose ${composed.status}: ${composed.reason ?? "no post"}`);
    return "skipped";
  }

  // 5. Render social image (build 02).
  //    renderSocialImage returns a PNG Buffer; we upload it or skip gracefully on error.
  //    In v1, mediaUrl stays null (no CDN upload yet — the publish adapters handle
  //    media separately). The render still runs to validate the card composition.
  //    Future: replace this with `mediaUrl = await uploadToStorage(imageBuffer)`.
  const mediaUrl: string | null = null;
  try {
    const imageBuffer = await renderSocialImage({
      model: {
        headline: composed.post.caption.split("\n\n")[0] ?? composed.post.caption,
        stat: target.scopeValue
          ? {
              label: target.scopeValue,
              value: composed.post.freshness,
            }
          : undefined,
        freshness_token: composed.post.freshness,
        source: `${target.scopeKind ?? "region"}:${target.scopeValue ?? "swfl"}`,
        as_of: now.toISOString().slice(0, 10),
      },
      format: "square",
      now,
    });
    // In a full implementation, upload imageBuffer to Supabase Storage / CDN and
    // set mediaUrl. For v1, we store the buffer size as a confirmation and skip
    // the actual upload (the publish adapters handle media separately).
    log(`rendered image: ${imageBuffer.byteLength} bytes (square, 1080×1080)`);
    // mediaUrl would be set here after upload: mediaUrl = await uploadToStorage(imageBuffer);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // Image render failures are non-fatal: post without an image rather than skip.
    log(`image render failed (non-fatal): ${reason}`);
  }

  // 6. Publish gate + write social_posts.
  const idempotencyKey = buildIdempotencyKey(scheduleId, now);
  const caption = composed.post.caption;
  const nowIso = now.toISOString();

  if (DRY_RUN || !PUBLISH_ENABLED) {
    // DRY or publish gate closed: write status='dry_run', never call postToChannel.
    log(
      DRY_RUN
        ? `DRY_RUN — would post to ${target.platform} (no DB write in dry run)`
        : `SOCIAL_PUBLISH_ENABLED!=true — writing dry_run record`,
    );
    if (!DRY_RUN) {
      const { error } = await db.from("social_posts").upsert(
        {
          post_schedule_id: scheduleId,
          social_account_id: target.accountId,
          platform: target.platform,
          platform_post_id: null,
          freshness_token: content.freshness,
          caption,
          media_url: mediaUrl,
          status: "dry_run",
          error: null,
          idempotency_key: idempotencyKey,
          published_at: null,
          created_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: "idempotency_key", ignoreDuplicates: true },
      );
      if (error) {
        log(`social_posts upsert (dry_run) failed: ${error.message}`);
        return "error";
      }
    }
    return "dry_run";
  }

  // PUBLISH_ENABLED=true: call postToChannel and record the result.
  const result = await postToChannel(db, target.userId, {
    platform: target.platform,
    accountId: target.accountId,
    caption,
    media: mediaUrl ? [{ url: mediaUrl, ratio: "1:1" }] : [],
  });

  const { error: insertErr } = await db.from("social_posts").upsert(
    {
      post_schedule_id: scheduleId,
      social_account_id: target.accountId,
      platform: target.platform,
      platform_post_id: result.ok ? (result.platform_post_id ?? null) : null,
      freshness_token: content.freshness,
      caption,
      media_url: mediaUrl,
      status: result.ok ? "published" : "failed",
      error: result.ok ? null : (result.error ?? "unknown error"),
      idempotency_key: idempotencyKey,
      published_at: result.ok ? nowIso : null,
      created_at: nowIso,
      updated_at: nowIso,
    },
    { onConflict: "idempotency_key", ignoreDuplicates: true },
  );
  if (insertErr) {
    log(`social_posts upsert failed: ${insertErr.message}`);
    // The post may have published successfully — don't count as "error" from publish's perspective
  }

  if (result.ok) {
    log(`published to ${target.platform} — post_id=${result.platform_post_id ?? "?"}`);
    return "published";
  } else {
    log(`publish failed on ${target.platform}: ${result.error ?? "unknown"}`);
    return "error";
  }
}

main().catch((err) => {
  // Top-level fatal ONLY: missing env, claim unreachable, client construction.
  // Per-schedule errors are isolated inside processSchedule and never reach here.
  console.error("[social] FATAL", err);
  process.exit(1);
});
