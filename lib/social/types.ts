/**
 * lib/social/types.ts
 *
 * Channel-agnostic social backbone — shared interface everyone downstream codes against.
 * Mirrors the email/outreach engine; swaps the email seam for a platform seam.
 *
 * Platform scope (v1): x | facebook | instagram | linkedin | google_business
 * Instagram/Facebook share the Meta Graph API; google_business = GBP.
 * Phase-2 additions (TikTok, Threads, Bluesky, Pinterest, YouTube) slot in here.
 *
 * Published FIRST (build 01). All other social builds import from here — changing
 * this file is a breaking-change event requiring all social imports to be updated.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CadenceSpec } from "@/lib/email/schedule-cadence";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Platform union (v1 scope + Phase-2 extension points)
// ─────────────────────────────────────────────────────────────────────────────

export type Platform = "x" | "facebook" | "instagram" | "linkedin" | "google_business";

export type PostStatus = "queued" | "dry_run" | "published" | "failed";
export type SocialAccountStatus = "connected" | "expired" | "revoked";
export type ScheduleStatus = "active" | "paused" | "stopped";

// ─────────────────────────────────────────────────────────────────────────────
// 2. Row types — mirror the SQL table shapes
// ─────────────────────────────────────────────────────────────────────────────

/** social_accounts row — token store for a connected platform account. */
export interface SocialAccount {
  id: string;
  user_id: string;
  platform: Platform;
  platform_account_id: string;
  access_token: string; // encrypted at rest
  refresh_token: string | null; // encrypted at rest
  token_type: string | null;
  expires_at: string | null; // ISO timestamptz
  scopes: string[];
  account_name: string | null;
  status: SocialAccountStatus;
  created_at: string;
  updated_at: string;
}

/** social_schedules row — recipe / cadence spec per user + platform. */
export interface SocialSchedule {
  id: number;
  user_id: string;
  social_account_id: string;
  platform: Platform;
  status: ScheduleStatus;
  // Cadence cols (mirrors email_schedules)
  cadence: CadenceSpec["cadence"];
  day_of_week: number | null; // 0=Sun … 6=Sat (weekly only)
  day_of_month: number | null; // 1–28 (monthly only)
  send_hour_et: number; // Eastern wall-clock hour 0–23
  // Scope
  scope_kind: string | null; // zip | place | county
  scope_value: string | null; // canonical lowercase
  content_template: string | null; // e.g. "stat_card"
  hashtags: string[];
  media_kind: string | null; // e.g. "image" | "carousel"
  freshness_gate: boolean; // skip if freshness_token unchanged
  signature: string | null; // idempotent-upsert fingerprint
  // Timestamps
  next_run_at: string | null; // NULL while claimed (park-on-claim)
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

/** social_posts row — published-post identity + status record. */
export interface SocialPost {
  id: string;
  post_schedule_id: number | null; // null for one-off posts
  social_account_id: string;
  platform: Platform;
  platform_post_id: string | null; // null while dry_run/queued; set on publish
  freshness_token: string | null; // snapshot of brain freshness at publish time
  caption: string;
  media_url: string | null;
  status: PostStatus;
  error: string | null;
  idempotency_key: string; // 'post:<schedule_id>:<YYYY-MM-DD>'
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/** social_events row — append-only engagement ledger (polled, not webhooks). */
export interface SocialEvent {
  id: number;
  social_post_id: string;
  platform_post_id: string;
  metric: "like" | "comment" | "share" | "impression" | "click";
  value: number;
  captured_at: string;
  source: "poll";
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Compose-layer types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SocialTarget — what the compose engine receives per schedule fire.
 * Mirrors OutreachTarget but is platform-scoped rather than email-scoped.
 */
export interface SocialTarget {
  scheduleId: number;
  userId: string;
  platform: Platform;
  accountId: string;
  /** Scope from the schedule row — place/county/ZIP. null = whole region. */
  scopeKind: string | null;
  scopeValue: string | null;
  /** Free-text topic override (e.g. "luxury condo market"). */
  topic: string | null;
  cadence: CadenceSpec["cadence"];
  hashtags: string[];
  contentTemplate: string | null;
  freshnessGate: boolean;
  /** The last freshness_token we posted (used by the freshness gate). */
  lastFreshnessToken: string | null;
}

/** Content returned by the build-content step. */
export interface SocialContent {
  caption: string;
  hashtags: string[];
  freshness: string;
  image?: { url: string; ratio: string };
}

/** One fully-composed post ready for publish (one per platform). */
export interface ComposedPost {
  caption: string;
  hashtags: string[];
  media: { url: string; ratio: string }[];
  freshness: string;
}

/** Result of the compose step for one target. */
export type ComposedStatus = "ready" | "out_of_scope" | "error";

export interface ComposedSocialPost {
  scheduleId: number;
  platform: Platform;
  accountId: string;
  status: ComposedStatus;
  post?: ComposedPost;
  /** Why out_of_scope / error. */
  reason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Publisher interface (injected from build 03's platform adapters)
// ─────────────────────────────────────────────────────────────────────────────

export interface PublishInput {
  platform: Platform;
  accountId: string;
  caption: string;
  media: { url: string; ratio: string }[];
}

export interface PublishResult {
  ok: boolean;
  platform_post_id?: string;
  error?: string;
}

/**
 * SocialPublisher — the injectable platform-call seam.
 * Build 03 provides the real implementation; build 01 + tests use a stub.
 * DRY mode: the worker wraps this with a short-circuit (never calls it when
 * SOCIAL_PUBLISH_ENABLED=false); the publisher itself is always "live."
 */
export interface SocialPublisher {
  post: (input: PublishInput) => Promise<PublishResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Runner DI Deps (mirrors email scheduler's ProcessDeps pattern)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deps injected into the publish pipeline.
 * All I/O is injected so the core is unit-testable with zero network/DB.
 */
export interface SocialDeps {
  /** Supabase service-role client (cron worker). */
  db: SupabaseClient;
  /** Injectable platform publisher (real from build 03; stub in tests). */
  publisher: SocialPublisher;
  /**
   * Build content for a target. Returns null when there is no in-scope data
   * (target is then skipped — never posts empty/invented content).
   */
  buildContent: (target: SocialTarget) => Promise<SocialContent | null>;
  /** UTC "now" — injectable for deterministic tests. */
  now?: Date;
  /** If true, short-circuit postToChannel and write status="dry_run". */
  dryRun?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Publish batch types (mirrors send.ts buildBatchMessages)
// ─────────────────────────────────────────────────────────────────────────────

export interface SocialBatch {
  target: SocialTarget;
  post: ComposedPost;
}

export interface BatchPublishResult {
  published: number;
  dryRun: number;
  failed: number;
  errors: string[];
}
