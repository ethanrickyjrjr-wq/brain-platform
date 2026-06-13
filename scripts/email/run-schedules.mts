// scripts/email/run-schedules.mts
//
// Unit F — the multi-tenant email cron WORKER (the runner half). A standalone Bun
// process (NOT a Next route): the GHA cron invokes it every 15 min. It claims the
// batch of due schedules, processes each through the pure DI core in
// `lib/email/scheduler.ts`, and owns top-level fatal handling + the exit code.
//
// ARCHITECTURE: all decision logic lives in `lib/email/scheduler.ts`
// (dependency-injected, unit-tested with mocks). This file is the ADAPTER — it
// builds the real seams (service-role Supabase client, the claim RPC, a real
// fetch to /api/email/broadcast, env reads, the brain-data fetch + render) and
// loops `processSchedule(row, deps)` over the claimed batch. Same split as
// audience-sync.ts (lib core) + contacts/sync route (adapter).
//
// IDEMPOTENCY is the claim RPC's `FOR UPDATE SKIP LOCKED` (real run only). In
// DRY_RUN we DON'T call the claiming RPC at all — we do a plain read-only SELECT
// of due rows so a dry run never parks/mutates prod and never sends. See the
// `claimDue` dep below.
//
// EXIT CODES: a clean run (incl. zero due) → 0. A top-level fatal (missing env,
// claim unreachable, can't construct the client) → process.exit(1) (loud — a GHA
// failure must be visible). Per-schedule errors NEVER change the exit code.

import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { computeNextRunAt } from "@/lib/email/schedule-cadence";
import { renderEmailTemplate } from "@/lib/email/templates/render-template";
import { EMAIL_TEMPLATES, type TemplateSlug } from "@/lib/email/templates/template-registry";
import { checkUsageLimit, recordEmailSent } from "@/lib/email/usage";
import type { SenderConfigRow } from "@/lib/email/sender-config";
import {
  processBatch,
  reapOrphans,
  type ScheduleRow,
  type AudienceLookup,
  type BroadcastRequest,
  type BroadcastResult,
  type ProcessDeps,
  type ScheduleOutcome,
} from "@/lib/email/scheduler";
import { fetchDigestData } from "./fetch-digest-data.mts";
import { buildSubjectLine } from "./build-digest.mts";

const DRY_RUN = process.env.DRY_RUN === "true";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
const CLAIM_LIMIT = 50;
const DEFAULT_TEMPLATE: TemplateSlug = "hero";

// Per-broadcast-POST timeout. The batch is processed sequentially, so ONE hung
// request would stall the entire 15-min cron — we cap each POST and surface a
// timeout as a normal per-row {ok:false} failure (NOT batch-fatal).
const BROADCAST_TIMEOUT_MS = 30_000;

// Crash-orphan reaper window: a parked row (next_run_at=NULL) whose last_run_at is
// older than this is a genuine crash-orphan, safe to re-arm. A freshly-claimed row
// has last_run_at=now, so it is NOT stale and won't be reaped mid-flight by a
// concurrent run.
const ORPHAN_STALE_MS = 60 * 60 * 1000; // 1 hour

// Platform fallback identity — the SAME env the single-tenant digest + broadcast
// route use (DIGEST_SENDER_NAME / DIGEST_SENDER_ADDRESS), never RESEND_FROM_EMAIL.
const PLATFORM = {
  fromName: process.env.DIGEST_SENDER_NAME ?? "SWFL Data Gulf",
  fromEmail: process.env.DIGEST_SENDER_ADDRESS ?? "hello@swfldatagulf.com",
};

// ── content seam ─────────────────────────────────────────────────────────────
// v1: reuse the existing brain-fetch (`fetchDigestData`) as the brain-data seam
// and build a SIMPLE faithful summary body. Rich templating is the template
// lane's job — the orchestration + guards are this unit's deliverable, not
// template polish. We fetch once per run (the lake snapshot is the same for every
// tenant this cycle) and reuse it across schedules.
let digestCache: Awaited<ReturnType<typeof fetchDigestData>> | null = null;
async function getDigest() {
  if (!digestCache) digestCache = await fetchDigestData();
  return digestCache;
}

/** A minimal, faithful plain-text body from the master pulse + top city voices. */
function buildBody(digest: Awaited<ReturnType<typeof fetchDigestData>>): string {
  const lines: string[] = [];
  if (digest.top_line) lines.push(digest.top_line);
  const voices = digest.city_voices.slice(0, 3);
  if (voices.length) {
    lines.push("");
    for (const v of voices) lines.push(`• ${v.city}: ${v.title}`);
  }
  return lines.join("\n");
}

/** Validate the row's template_id against the registry; fall back for v1. */
function resolveTemplateSlug(templateId: string | null): TemplateSlug {
  if (templateId && templateId in EMAIL_TEMPLATES) return templateId as TemplateSlug;
  return DEFAULT_TEMPLATE;
}

// ── runner ───────────────────────────────────────────────────────────────────

function requireEnv(): void {
  // The service-role client throws on missing SUPABASE_*; surface the broadcast
  // secret here too so a misconfigured cron fails loud and early (not mid-batch).
  if (!process.env.DIGEST_BROADCAST_SECRET) {
    throw new Error("DIGEST_BROADCAST_SECRET is required to POST the broadcast.");
  }
  // On a REAL run, NEXT_PUBLIC_SITE_URL must be set: the localhost fallback would
  // make every broadcast POST hit http://localhost:3000 and fail per-row while the
  // run still exits 0 — a silent no-send. Fail loud here instead. The fallback
  // stays usable for local DRY_RUN only (a dry run never POSTs).
  if (!DRY_RUN && !process.env.NEXT_PUBLIC_SITE_URL) {
    throw new Error(
      "NEXT_PUBLIC_SITE_URL is required for a real send (the localhost fallback is DRY_RUN-only; " +
        "a real broadcast POST to localhost is never correct).",
    );
  }
}

async function main(): Promise<void> {
  requireEnv();
  const db = createServiceRoleClient(); // throws → fatal (caught below)
  const now = new Date();
  const nowIso = now.toISOString();

  // ── claimDue: real run claims+parks via the RPC; DRY_RUN does a read-only
  //    SELECT so it never mutates prod and never sends. ──
  async function claimDue(): Promise<ScheduleRow[]> {
    if (DRY_RUN) {
      const { data, error } = await db
        .from("email_schedules")
        .select("*")
        .eq("status", "active")
        .not("next_run_at", "is", null)
        .lte("next_run_at", nowIso)
        .order("next_run_at", { ascending: true })
        .limit(CLAIM_LIMIT);
      if (error) throw new Error(`dry-run select due schedules failed: ${error.message}`);
      return (data ?? []) as ScheduleRow[];
    }
    const { data, error } = await db.rpc("claim_due_email_schedules", {
      p_now: nowIso,
      p_limit: CLAIM_LIMIT,
    });
    if (error) throw new Error(`claim_due_email_schedules failed: ${error.message}`);
    return (data ?? []) as ScheduleRow[];
  }

  // ── SELF-HEALING REAPER (real run only, BEFORE the claim) ──
  // If a prior worker died AFTER the claim parked rows (next_run_at=NULL) but
  // BEFORE it re-armed them, those rows stay parked forever. Re-arm genuine
  // crash-orphans: active, parked, and last touched > ORPHAN_STALE_MS ago (the
  // staleness guard means a freshly-claimed row — last_run_at=now — is NOT reaped
  // mid-flight by a concurrent run). Read-only in DRY_RUN: skip it entirely.
  async function reapCrashOrphans(): Promise<void> {
    if (DRY_RUN) return; // must stay read-only; never mutate in a dry run.
    const staleBeforeIso = new Date(now.getTime() - ORPHAN_STALE_MS).toISOString();
    const { data, error } = await db
      .from("email_schedules")
      .select("*")
      .is("next_run_at", null)
      .eq("status", "active")
      .lt("last_run_at", staleBeforeIso)
      .limit(CLAIM_LIMIT);
    if (error) throw new Error(`reaper select crash-orphans failed: ${error.message}`);
    const orphans = (data ?? []) as ScheduleRow[];
    if (orphans.length === 0) return;
    const reaped = await reapOrphans(
      orphans,
      {
        computeNext: computeNextRunAt,
        async rearm(scheduleId: number, nextRunAt: string | null): Promise<void> {
          const { error: upErr } = await db
            .from("email_schedules")
            .update({ next_run_at: nextRunAt, updated_at: new Date().toISOString() })
            .eq("id", scheduleId);
          if (upErr) throw new Error(`reaper re-arm schedule ${scheduleId}: ${upErr.message}`);
        },
        log: (line: string) => console.log(line),
      },
      now,
    );
    const n = reaped.filter((r) => r.kind === "reaped").length;
    console.log(
      `[run-schedules] reaper re-armed ${n} crash-orphaned schedule(s) (of ${orphans.length} stale parked, threshold=${staleBeforeIso}).`,
    );
  }

  await reapCrashOrphans();

  const rows = await claimDue();
  console.log(
    `[run-schedules] ${DRY_RUN ? "DRY_RUN " : ""}claimed ${rows.length} due schedule(s) at ${nowIso}.`,
  );
  if (rows.length === 0) {
    console.log("[run-schedules] nothing due; exiting clean.");
    return;
  }

  const deps: ProcessDeps = {
    dryRun: DRY_RUN,
    platform: PLATFORM,
    checkUsage: checkUsageLimit,
    recordSent: recordEmailSent,

    async readSenderConfig(userId: string): Promise<SenderConfigRow | null> {
      const { data, error } = await db
        .from("email_sender_config")
        .select("domain, resend_domain_id, from_name, from_email, reply_to, domain_verified")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(`read email_sender_config: ${error.message}`);
      return (data as SenderConfigRow | null) ?? null;
    },

    async readAudience(userId: string, slug: string): Promise<AudienceLookup | null> {
      const { data, error } = await db
        .from("email_audiences")
        .select("resend_audience_id, contact_count")
        .eq("user_id", userId)
        .eq("audience_slug", slug)
        .maybeSingle();
      if (error) throw new Error(`read email_audiences: ${error.message}`);
      return (data as AudienceLookup | null) ?? null;
    },

    async buildContent(_row: ScheduleRow) {
      // v1: the lake snapshot is identical for every tenant this cycle, so the
      // per-row `row` isn't read yet (per-tenant content is a later lane).
      const digest = await getDigest();
      return { subject: buildSubjectLine(digest, []), body: buildBody(digest) };
    },

    async renderHtml(row: ScheduleRow, body: string, chart?: string): Promise<string> {
      const slug = resolveTemplateSlug(row.template_id);
      return renderEmailTemplate(slug, undefined, { body, ...(chart ? { chart } : {}) });
    },

    async postBroadcast(req: BroadcastRequest): Promise<BroadcastResult> {
      // Per-request timeout: a hung broadcast must NOT stall the sequential batch.
      // On timeout, AbortSignal.timeout fires an AbortError → caught below and
      // returned as a normal {ok:false} per-row failure (never batch-fatal).
      let res: Response;
      try {
        res = await fetch(`${SITE_URL}/api/email/broadcast`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.DIGEST_BROADCAST_SECRET}`,
          },
          body: JSON.stringify(req),
          signal: AbortSignal.timeout(BROADCAST_TIMEOUT_MS),
        });
      } catch (err) {
        // AbortError (timeout) OR any network/fetch rejection → per-row failure.
        const isTimeout = err instanceof Error && err.name === "TimeoutError";
        const reason = isTimeout
          ? `timed out after ${BROADCAST_TIMEOUT_MS}ms`
          : err instanceof Error
            ? err.message
            : String(err);
        console.error(`[run-schedules] broadcast fetch failed: ${reason}`);
        return { ok: false, status: isTimeout ? "timeout" : "network_error", error: reason };
      }
      // Non-2xx → not ok; the core treats this as a per-row send failure (it does
      // NOT throw past the row boundary).
      if (!res.ok) {
        let detail = "";
        try {
          detail = JSON.stringify(await res.json());
        } catch {
          /* body not JSON */
        }
        console.error(`[run-schedules] broadcast ${res.status}: ${detail}`);
        return { ok: false, status: String(res.status) };
      }
      return (await res.json()) as BroadcastResult;
    },

    async rearm(scheduleId: number, nextRunAt: string | null): Promise<void> {
      // DRY_RUN: do NOT write back — leave the DB untouched (the dry select never
      // parked the row, so there is nothing to re-arm; we already logged the
      // computed next_run_at inside the core). A true read-only dry run.
      if (DRY_RUN) return;
      const { error } = await db
        .from("email_schedules")
        .update({ next_run_at: nextRunAt, updated_at: new Date().toISOString() })
        .eq("id", scheduleId);
      if (error) throw new Error(`re-arm schedule ${scheduleId}: ${error.message}`);
    },

    computeNext: computeNextRunAt,
    log: (line: string) => console.log(line),
  };

  const outcomes = await processBatch(rows, deps, now);
  summarize(outcomes);
}

function summarize(outcomes: readonly ScheduleOutcome[]): void {
  const tally = { sent: 0, "dry-run": 0, skipped: 0, error: 0 } as Record<string, number>;
  for (const o of outcomes) tally[o.kind] = (tally[o.kind] ?? 0) + 1;
  console.log(
    `[run-schedules] done — sent=${tally.sent} dry-run=${tally["dry-run"]} ` +
      `skipped=${tally.skipped} error=${tally.error} (total=${outcomes.length}).`,
  );
}

main().catch((err) => {
  // Top-level fatal ONLY (missing env, claim unreachable, client construction).
  // Per-schedule errors are isolated inside processSchedule and never reach here.
  console.error("[run-schedules] FATAL", err);
  process.exit(1);
});
