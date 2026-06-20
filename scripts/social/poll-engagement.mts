// scripts/social/poll-engagement.mts
//
// SOCIAL ENGAGEMENT POLLER (build 06). A standalone Bun process the GHA cron
// invokes — NOT a Next route. Social metrics are PULL, not push (no webhook for
// likes/impressions), so we schedule a fetch: for every recently-published
// social_posts row that HAS a platform_post_id, call the platform's read API,
// map the response to SocialEvent rows, and UPSERT into social_events (deduped on
// (social_post_id, metric) — re-polling updates the one row, never duplicates).
//
// SINGLE FAN-OUT (mirrors daily-rebuild, NOT one workflow per platform): one run
// loops every due post across all platforms. A silent/gated platform yields zero
// rows and is skipped — it NEVER fails the whole poll (Operation Dumbo Drop posture).
//
// ARCHITECTURE mirrors run-schedules.mts / outreach-drip-run.mts: the decision
// logic is a pure DI core (`pollEngagement` below, unit-tested in
// lib/social/engagement.test.ts with mocks); this file is the ADAPTER that wires
// the real seams (service-role Supabase client, the per-platform fetchers, the
// token resolver) and owns the exit code.
//
// DRY_RUN-aware: a dry run reads + maps + logs what it WOULD upsert, and never
// writes. (Dry posts never get a platform_post_id, so they're naturally skipped
// from the candidate set regardless.)
//
// EXIT: a clean run (incl. zero due) → 0. A top-level fatal (missing env, client
// construction) → process.exit(1) so a GHA failure is visible. Per-post errors
// are isolated and NEVER change the exit code.

import path from "node:path";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Platform } from "@/lib/social/types";
import { getValidAccessToken } from "@/lib/social/oauth-tokens";
import {
  mapXMetrics,
  mapMetaPostMetrics,
  mapIGMetrics,
  mapLinkedInMetrics,
  mapGBPMetrics,
  type MappedEvent,
} from "@/lib/social/engagement";
import {
  fetchXMetrics,
  fetchMetaPostMetrics,
  fetchIGMetrics,
  fetchLinkedInMetrics,
  fetchGBPMetrics,
} from "@/lib/social/channels/metrics";

const DRY_RUN = process.env.DRY_RUN === "true";

// How far back to poll. Engagement keeps accruing for a while after publish, so
// we re-poll recent posts each run; older posts are left as last-captured.
const LOOKBACK_DAYS = Number(process.env.SOCIAL_POLL_LOOKBACK_DAYS ?? "14");
const BATCH_LIMIT = Number(process.env.SOCIAL_POLL_BATCH_LIMIT ?? "500");

// ─────────────────────────────────────────────────────────────────────────────
// Pure DI core — unit-tested with mocks (no network, no DB)
// ─────────────────────────────────────────────────────────────────────────────

/** A published post we can poll (only rows WITH a platform_post_id qualify). */
export interface PollablePost {
  id: string; // social_posts.id (PK; the social_events dedup key)
  user_id: string; // owner (for token lookup); resolved by the adapter
  platform: Platform;
  platform_post_id: string;
  /** social_accounts.platform_account_id — the connected account/page/org id. */
  account_id: string;
  /** LinkedIn org URN (urn:li:organization:{id}); null for non-LinkedIn. */
  org_urn?: string | null;
}

/** One mapped event bound to its social_post_id, ready to upsert. */
export interface PollEvent extends MappedEvent {
  social_post_id: string;
}

export interface PollDeps {
  /** Resolve a valid (refreshed-if-needed) access token for a post's account. */
  getToken: (post: PollablePost) => Promise<string>;
  /** Per-platform fetch → map. Returns mapped events (possibly empty). NEVER throws. */
  fetchAndMap: (post: PollablePost, token: string) => Promise<MappedEvent[]>;
  /**
   * Upsert events for ONE post, deduped on (social_post_id, metric). Re-polling
   * the same metric updates the existing row's value, never inserts a duplicate.
   * Skipped entirely in dry mode (the core passes dryRun through).
   */
  upsert: (events: PollEvent[]) => Promise<void>;
  log?: (line: string) => void;
  dryRun?: boolean;
}

export interface PollSummary {
  posts: number;
  polled: number; // posts that returned ≥1 mapped event
  empty: number; // posts a (gated/silent) platform returned nothing for
  events: number; // total event rows mapped (would-upsert)
  errors: number; // per-post failures (token/fetch) — never fatal
}

/**
 * Poll engagement for a batch of pollable posts. PURE orchestration over the
 * injected seams — fully deterministic and testable. A per-post failure (token
 * resolve throws, etc.) is isolated: it bumps `errors` and the loop continues.
 * A platform that returns zero events bumps `empty` and is skipped (no upsert).
 */
export async function pollEngagement(posts: PollablePost[], deps: PollDeps): Promise<PollSummary> {
  const log = deps.log ?? (() => {});
  const summary: PollSummary = { posts: posts.length, polled: 0, empty: 0, events: 0, errors: 0 };

  for (const post of posts) {
    try {
      const token = await deps.getToken(post);
      const mapped = await deps.fetchAndMap(post, token);
      if (mapped.length === 0) {
        // Gated / silent platform → treat as empty, never blend blind, never fail.
        summary.empty += 1;
        log(`[poll] ${post.platform} ${post.platform_post_id}: no metrics (gated/empty) — skip.`);
        continue;
      }
      const events: PollEvent[] = mapped.map((m) => ({ ...m, social_post_id: post.id }));
      summary.polled += 1;
      summary.events += events.length;
      if (deps.dryRun) {
        log(
          `[poll] DRY_RUN ${post.platform} ${post.platform_post_id}: would upsert ` +
            events.map((e) => `${e.metric}=${e.value}`).join(" "),
        );
      } else {
        await deps.upsert(events);
        log(
          `[poll] ${post.platform} ${post.platform_post_id}: upserted ${events.length} metric(s).`,
        );
      }
    } catch (err) {
      // Isolated per-post failure — never fatal, never stops the batch.
      summary.errors += 1;
      log(
        `[poll] ${post.platform} ${post.platform_post_id}: ERROR ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return summary;
}

/**
 * Per-platform fetch+map dispatcher. PURE switch over the injected fetchers, so
 * the adapter binds the real ones and tests bind mocks. Each branch is
 * empty-tolerant (the fetchers return null on a gated/errored read → []).
 */
export interface FetchSeams {
  fetchX: typeof fetchXMetrics;
  fetchMetaPost: typeof fetchMetaPostMetrics;
  fetchIG: typeof fetchIGMetrics;
  fetchLinkedIn: typeof fetchLinkedInMetrics;
  fetchGBP: typeof fetchGBPMetrics;
}

export async function fetchAndMapFor(
  post: PollablePost,
  token: string,
  seams: FetchSeams,
): Promise<MappedEvent[]> {
  switch (post.platform) {
    case "x": {
      const r = await seams.fetchX(post.platform_post_id, token);
      return mapXMetrics(post.platform_post_id, r);
    }
    case "facebook": {
      const r = await seams.fetchMetaPost(post.platform_post_id, token);
      return mapMetaPostMetrics(post.platform_post_id, r);
    }
    case "instagram": {
      const r = await seams.fetchIG(post.platform_post_id, token);
      return mapIGMetrics(post.platform_post_id, r);
    }
    case "linkedin": {
      const r = await seams.fetchLinkedIn(post.platform_post_id, token, post.org_urn);
      return mapLinkedInMetrics(post.platform_post_id, r);
    }
    case "google_business": {
      const r = await seams.fetchGBP(post.platform_post_id, token);
      return mapGBPMetrics(post.platform_post_id, r);
    }
    default: {
      const _never: never = post.platform;
      throw new Error(`Unknown platform: ${String(_never)}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Adapter — real seams (DB, tokens, fetchers) + exit code
// ─────────────────────────────────────────────────────────────────────────────

/** Joined social_posts ⋈ social_accounts row the candidate query selects. */
interface PostRow {
  id: string;
  platform: Platform;
  platform_post_id: string | null;
  social_accounts: {
    user_id: string;
    platform_account_id: string;
  } | null;
}

/**
 * Upsert mapped events for one post, deduped on (social_post_id, metric).
 * The composite UNIQUE index social_events_dedup_post_metric_uidx makes
 * onConflict update the existing row's value + captured_at rather than insert a
 * duplicate — so re-polling the same metric never grows the ledger.
 */
async function upsertEvents(db: SupabaseClient, events: PollEvent[]): Promise<void> {
  if (events.length === 0) return;
  const nowIso = new Date().toISOString();
  const rows = events.map((e) => ({
    social_post_id: e.social_post_id,
    platform_post_id: e.platform_post_id,
    metric: e.metric,
    value: e.value,
    source: e.source,
    captured_at: nowIso,
  }));
  const { error } = await db
    .from("social_events")
    .upsert(rows, { onConflict: "social_post_id,metric" });
  if (error) throw new Error(`social_events upsert failed: ${error.message}`);
}

async function main(): Promise<void> {
  const db = createServiceRoleClient(); // throws → fatal (caught below)
  const now = new Date();
  const sinceIso = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Candidate posts: published, WITH a platform_post_id (dry_run rows have none →
  // naturally excluded), recent enough to still be accruing engagement. Join the
  // owning account for the token lookup.
  const { data, error } = await db
    .from("social_posts")
    .select(
      "id, platform, platform_post_id, social_accounts:social_account_id ( user_id, platform_account_id )",
    )
    .eq("status", "published")
    .not("platform_post_id", "is", null)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(BATCH_LIMIT);
  if (error) throw new Error(`select pollable posts failed: ${error.message}`);

  const rows = (data ?? []) as unknown as PostRow[];
  const posts: PollablePost[] = rows
    .filter((r) => r.platform_post_id && r.social_accounts) // defensive: skip orphans
    .map((r) => ({
      id: r.id,
      user_id: r.social_accounts!.user_id,
      platform: r.platform,
      platform_post_id: r.platform_post_id!,
      account_id: r.social_accounts!.platform_account_id,
      // LinkedIn org URN: the connected account id IS the org URN for org pages.
      org_urn: r.platform === "linkedin" ? r.social_accounts!.platform_account_id : null,
    }));

  console.log(
    `[poll-engagement] ${DRY_RUN ? "DRY_RUN " : ""}${posts.length} pollable post(s) ` +
      `(published, with platform_post_id, since ${sinceIso}).`,
  );
  if (posts.length === 0) {
    console.log("[poll-engagement] nothing to poll; exiting clean.");
    return;
  }

  const seams: FetchSeams = {
    fetchX: fetchXMetrics,
    fetchMetaPost: fetchMetaPostMetrics,
    fetchIG: fetchIGMetrics,
    fetchLinkedIn: fetchLinkedInMetrics,
    fetchGBP: fetchGBPMetrics,
  };

  const summary = await pollEngagement(posts, {
    getToken: (post) => getValidAccessToken(db, post.user_id, post.platform, post.account_id),
    fetchAndMap: (post, token) => fetchAndMapFor(post, token, seams),
    upsert: (events) => upsertEvents(db, events),
    log: (line) => console.log(line),
    dryRun: DRY_RUN,
  });

  console.log(
    `[poll-engagement] done — posts=${summary.posts} polled=${summary.polled} ` +
      `empty=${summary.empty} events=${summary.events} errors=${summary.errors}.`,
  );
}

// Only run as a script when invoked directly (e.g. `bun scripts/social/poll-engagement.mts`).
// When imported (by the test, which exercises the pure core), DON'T run main() —
// importing must not construct a DB client or perform any I/O. CLI-detect idiom is
// the repo standard (works under both `bun` and `node`; see refinery/sources/*.mts).
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => {
    // Top-level fatal ONLY (missing env, client construction). Per-post errors are
    // isolated inside pollEngagement and never reach here.
    console.error("[poll-engagement] FATAL", err);
    process.exit(1);
  });
}
