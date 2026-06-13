/**
 * Pure, dependency-injected orchestration core for the multi-tenant email
 * scheduler (Unit F — the cron worker). ALL per-schedule decision logic lives
 * here, injected through `ProcessDeps`, so it is unit-testable with NO live DB
 * and NO network — same shape as `audience-sync.ts` (injected `AudienceStore`)
 * and `broadcast-overrides.ts` (pure resolvers).
 *
 * The thin runner `scripts/email/run-schedules.mts` builds the real deps
 * (service-role client, the claim RPC, a real `fetch` to /api/email/broadcast)
 * and loops `processSchedule(row, deps)` over the claimed batch. This file imports
 * NO Supabase client and NO `fetch` directly.
 *
 * The hard guards (each honored here, not re-derived):
 *  - USAGE GATE = SKIP + NOTIFY, NEVER THROW. checkUsageLimit reports
 *    {allowed:false} → we skip the send, log a notify line, re-arm. We do NOT call
 *    recordEmailSent and do NOT POST. Over-limit never crashes a run.
 *  - SENDER VERIFIED-GATING is owned by `resolveSender` (Unit D) — we READ the
 *    config row, pass it + platform defaults, and feed the result straight into
 *    the payload. We never re-derive "tenant from_email only when verified".
 *  - SEGMENT must be a tenant segment. No audience_slug / no row / null id → SKIP
 *    (never fall through to the SWFL digest list).
 *  - UNSUBSCRIBE TOKEN is enforced, not aspirational. ensureUnsubscribeToken()
 *    injects the literal `{{{RESEND_UNSUBSCRIBE_URL}}}` the broadcast route 400s
 *    without; the real-send path ASSERTS it is present before POST and throws loud
 *    if absent.
 *  - DRY_RUN performs ZERO external sends. It renders + resolves + gates, logs the
 *    would-send payload, and never POSTs (a true dry run never sends).
 *  - CADENCE/DST is the SHARED `computeNextRunAt` (Unit's schedule-cadence) —
 *    injected as `computeNext` so create-time and advance-time math are identical.
 *  - PER-SCHEDULE ERROR ISOLATION: processSchedule catches everything; one
 *    tenant's render/send failure never sinks the batch, and the row is STILL
 *    re-armed in a `finally`.
 */

import type { CadenceSpec } from "./schedule-cadence";
import type { ResolvedSender, SenderConfigRow, PlatformSenderDefaults } from "./sender-config";
import { resolveSender } from "./sender-config";

/** The literal Resend managed-unsubscribe token the broadcast route requires. */
export const UNSUBSCRIBE_TOKEN = "{{{RESEND_UNSUBSCRIBE_URL}}}";

/**
 * A claimed `public.email_schedules` row (the fields the worker reads). Matches
 * the schema in 20260612_email_product.sql; the claim RPC returns the full row.
 */
export interface ScheduleRow {
  id: number;
  user_id: string;
  project_id: string | null;
  status: string;
  cadence: string | null;
  day_of_week: number | null;
  day_of_month: number | null;
  send_hour_et: number | null;
  audience_slug: string | null;
  template_id: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
}

/** The minimal audience lookup the worker needs (subset of `email_audiences`). */
export interface AudienceLookup {
  resend_audience_id: string | null;
  contact_count: number | null;
}

/** The broadcast-route request body (Unit B). `send: true` for a real cron send. */
export interface BroadcastRequest {
  subject: string;
  html: string;
  send: true;
  segmentId: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
}

/** The broadcast-route success response. */
export interface BroadcastResult {
  ok: boolean;
  broadcast_id?: string;
  status?: string;
}

/** The terminal outcome of processing one schedule — for the runner's summary. */
export type ScheduleOutcome =
  | { kind: "sent"; scheduleId: number; broadcastId?: string; recipients: number }
  | { kind: "dry-run"; scheduleId: number }
  | { kind: "skipped"; scheduleId: number; reason: string }
  | { kind: "error"; scheduleId: number; error: string };

/**
 * Injected dependencies — every I/O seam the core touches, so the core is pure.
 * The runner supplies the real implementations; tests supply mocks.
 */
export interface ProcessDeps {
  /** True → never POST; log the would-send payload only. */
  dryRun: boolean;

  /** Platform fallback identity (env DIGEST_SENDER_NAME / DIGEST_SENDER_ADDRESS). */
  platform: PlatformSenderDefaults;

  /** Usage gate (Unit E). Never throws; fails OPEN. */
  checkUsage: (
    userId: string,
  ) => Promise<{ allowed: boolean; tier: string; sent: number; limit: number }>;

  /** Record a successful send against the meter (Unit E). Never throws. */
  recordSent: (userId: string, n: number) => Promise<void>;

  /** Read this user's verified-sender config row (Unit D). */
  readSenderConfig: (userId: string) => Promise<SenderConfigRow | null>;

  /** Resolve a user's audience_slug → segment id (Unit C). null when absent. */
  readAudience: (userId: string, slug: string) => Promise<AudienceLookup | null>;

  /** Fetch the brain data and build the email body string for this schedule. */
  buildContent: (row: ScheduleRow) => Promise<{ subject: string; body: string; chart?: string }>;

  /** Render the template HTML (Unit's template lane). */
  renderHtml: (row: ScheduleRow, body: string, chart?: string) => Promise<string>;

  /** POST the broadcast (Unit B). Only called on a real send. */
  postBroadcast: (req: BroadcastRequest) => Promise<BroadcastResult>;

  /** Re-arm next_run_at for a processed row. null → leave parked (invalid spec). */
  rearm: (scheduleId: number, nextRunAt: string | null) => Promise<void>;

  /** Shared cadence/DST math (Unit's computeNextRunAt). Injected so the test is
   *  deterministic and the worker shares ONE implementation with create-time. */
  computeNext: (spec: CadenceSpec, fromUtc: Date) => Date | null;

  /** Structured logger (defaults to console in the runner). */
  log: (line: string) => void;
}

// ---------------------------------------------------------------------------
// Pure helpers (no I/O — exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Idempotently inject a minimal unsubscribe footer carrying the literal
 * `{{{RESEND_UNSUBSCRIBE_URL}}}` token. The render-template lane deliberately
 * excludes the token (it can't appear in a transactional render), but the
 * broadcast route 400s `missing_unsubscribe_token` without it — so the worker
 * appends it just before send.
 *
 * JUDGMENT CALL (flagged in the report): token PLACEMENT. We inject a single
 * centered <a> footer just before </body> (or at the end if no </body>), the
 * least-intrusive spot that still renders a working per-recipient unsubscribe.
 * Idempotent: a no-op if the token is already present.
 */
export function ensureUnsubscribeToken(html: string): string {
  if (html.includes(UNSUBSCRIBE_TOKEN)) return html;
  const footer =
    `<p style="font-size:12px;color:#888;text-align:center;margin:24px 0 8px">` +
    `<a href="${UNSUBSCRIBE_TOKEN}" style="color:#888">Unsubscribe</a></p>`;
  const closeBody = html.lastIndexOf("</body>");
  if (closeBody !== -1) {
    return html.slice(0, closeBody) + footer + html.slice(closeBody);
  }
  return html + footer;
}

/** The cadence spec a row carries, in the shape `computeNextRunAt` expects. */
export function rowCadenceSpec(row: ScheduleRow): CadenceSpec | null {
  if (row.cadence == null || row.send_hour_et == null) return null;
  return {
    cadence: row.cadence as CadenceSpec["cadence"],
    day_of_week: row.day_of_week,
    day_of_month: row.day_of_month,
    send_hour_et: row.send_hour_et,
  };
}

/**
 * Build the broadcast request body from the resolved sender + segment + html.
 * Pure: feeds resolveSender's output straight through (replyTo only when present).
 */
export function buildBroadcastPayload(args: {
  subject: string;
  html: string;
  segmentId: string;
  sender: ResolvedSender;
}): BroadcastRequest {
  const { subject, html, segmentId, sender } = args;
  return {
    subject,
    html,
    send: true,
    segmentId,
    fromName: sender.fromName,
    fromEmail: sender.fromEmail,
    ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
  };
}

// ---------------------------------------------------------------------------
// The orchestration core
// ---------------------------------------------------------------------------

/**
 * Process one claimed schedule end-to-end. NEVER throws past its own boundary —
 * every error is caught, logged with the schedule id + user, and turned into an
 * `error` outcome so the batch loop continues. The row is ALWAYS re-armed in the
 * `finally` (v1 policy: a failed send waits for the next cadence occurrence — NO
 * retry, NO double-send). A row whose `computeNext` returns null (invalid spec)
 * stays parked, which is correct — it shouldn't fire.
 *
 * The claim RPC already parked this row (next_run_at = NULL) before we see it, so
 * the re-arm is what makes it active again at its next occurrence.
 *
 * @param fromUtc  the `p_now` the batch was claimed at — re-arm math is relative
 *                 to it so a whole batch advances from one consistent instant.
 */
export async function processSchedule(
  row: ScheduleRow,
  deps: ProcessDeps,
  fromUtc: Date,
): Promise<ScheduleOutcome> {
  const tag = `schedule=${row.id} user=${row.user_id}`;
  let outcome: ScheduleOutcome = { kind: "error", scheduleId: row.id, error: "unprocessed" };

  try {
    // 1. USAGE GATE — skip + notify, never throw. Over-limit must not crash.
    const usage = await deps.checkUsage(row.user_id);
    if (!usage.allowed) {
      deps.log(
        `[scheduler] SKIP ${tag} — usage limit reached (${usage.sent}/${usage.limit}, tier=${usage.tier}); not sending this cycle.`,
      );
      return (outcome = { kind: "skipped", scheduleId: row.id, reason: "usage_limit" });
    }

    // 2. SEGMENT — a tenant schedule MUST resolve to a tenant segment. No slug /
    //    no row / null id → skip (never fall through to the SWFL digest list).
    const slug = row.audience_slug?.trim() || null;
    if (!slug) {
      deps.log(`[scheduler] SKIP ${tag} — no audience_slug; can't target a send.`);
      return (outcome = { kind: "skipped", scheduleId: row.id, reason: "no_audience_slug" });
    }
    const audience = await deps.readAudience(row.user_id, slug);
    const segmentId = audience?.resend_audience_id?.trim() || null;
    if (!segmentId) {
      deps.log(
        `[scheduler] SKIP ${tag} — audience "${slug}" has no Resend segment id; not sending.`,
      );
      return (outcome = { kind: "skipped", scheduleId: row.id, reason: "no_segment" });
    }

    // 3. SENDER — Unit D owns the verified-gating rule. We only read + feed it.
    const senderConfig = await deps.readSenderConfig(row.user_id);
    const sender = resolveSender(senderConfig, deps.platform);

    // 4. CONTENT + RENDER + token injection.
    const { subject, body, chart } = await deps.buildContent(row);
    const rendered = await deps.renderHtml(row, body, chart);
    const html = ensureUnsubscribeToken(rendered);

    // 5. PAYLOAD.
    const payload = buildBroadcastPayload({ subject, html, segmentId, sender });

    // 6. DRY_RUN — log the would-send, NEVER POST, NEVER record.
    if (deps.dryRun) {
      deps.log(
        `[scheduler] DRY_RUN ${tag} — would send: subject=${JSON.stringify(subject)} ` +
          `htmlBytes=${html.length} from="${sender.fromName} <${sender.fromEmail}>" ` +
          `replyTo=${sender.replyTo ?? "(none)"} segmentId=${segmentId} ` +
          `usingTenantDomain=${sender.usingTenantDomain} gate=allowed(${usage.sent}/${usage.limit}).`,
      );
      return (outcome = { kind: "dry-run", scheduleId: row.id });
    }

    // 7. REAL SEND — assert the token is present before POST; fail loud if absent.
    if (!html.includes(UNSUBSCRIBE_TOKEN)) {
      throw new Error(
        `unsubscribe token absent after injection — refusing to POST (broadcast route would 400)`,
      );
    }
    const result = await deps.postBroadcast(payload);
    if (!result || result.ok !== true) {
      // Treat non-ok as a per-row send failure: log, re-arm (finally), continue.
      deps.log(
        `[scheduler] SEND FAILED ${tag} — broadcast not ok (status=${result?.status ?? "?"}); will retry next cadence occurrence.`,
      );
      return (outcome = {
        kind: "error",
        scheduleId: row.id,
        error: "broadcast_not_ok",
      });
    }

    // 8. SUCCESS — record usage (recipients when known, else 1) AFTER the send.
    const recipients = audience?.contact_count ?? 1;
    await deps.recordSent(row.user_id, recipients);
    deps.log(
      `[scheduler] SENT ${tag} — broadcast_id=${result.broadcast_id ?? "?"} recipients=${recipients}.`,
    );
    return (outcome = {
      kind: "sent",
      scheduleId: row.id,
      broadcastId: result.broadcast_id,
      recipients,
    });
  } catch (err) {
    // PER-SCHEDULE ISOLATION — one tenant's failure never sinks the batch.
    deps.log(`[scheduler] ERROR ${tag} — ${err instanceof Error ? err.message : String(err)}`);
    return (outcome = {
      kind: "error",
      scheduleId: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    // RE-ARM — always, even on skip/error. A row was parked (next_run_at=NULL) by
    // the claim RPC; compute its next occurrence and write it back so it fires
    // again at the right time. Invalid spec → null → stays parked (correct).
    // The re-arm itself is best-effort: a re-arm failure is logged but never
    // re-thrown, so it can't crash the batch (the row simply stays parked until
    // the next successful run touches it).
    try {
      const spec = rowCadenceSpec(row);
      const next = spec ? deps.computeNext(spec, fromUtc) : null;
      await deps.rearm(row.id, next ? next.toISOString() : null);
      if (!next) {
        deps.log(`[scheduler] PARKED ${tag} — invalid/empty cadence spec; next_run_at stays NULL.`);
      }
    } catch (rearmErr) {
      deps.log(
        `[scheduler] RE-ARM FAILED ${tag} — ${rearmErr instanceof Error ? rearmErr.message : String(rearmErr)}; row stays parked.`,
      );
    }
  }

  // Unreachable (every path returns inside try/catch), but satisfies the type.
  return outcome;
}

/**
 * Process a whole claimed batch, isolating each row. Returns the per-row outcomes
 * for the runner to summarize. Never throws — `processSchedule` swallows per-row
 * errors, and this loop only orchestrates.
 */
export async function processBatch(
  rows: readonly ScheduleRow[],
  deps: ProcessDeps,
  fromUtc: Date,
): Promise<ScheduleOutcome[]> {
  const outcomes: ScheduleOutcome[] = [];
  for (const row of rows) {
    outcomes.push(await processSchedule(row, deps, fromUtc));
  }
  return outcomes;
}
