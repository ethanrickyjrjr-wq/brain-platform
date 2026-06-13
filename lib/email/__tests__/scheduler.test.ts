import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import type { CadenceSpec } from "../schedule-cadence";
import type { SenderConfigRow } from "../sender-config";
import {
  processSchedule,
  processBatch,
  ensureUnsubscribeToken,
  buildBroadcastPayload,
  rowCadenceSpec,
  UNSUBSCRIBE_TOKEN,
  type ScheduleRow,
  type ProcessDeps,
  type BroadcastRequest,
  type BroadcastResult,
  type AudienceLookup,
} from "../scheduler.ts";

// ---------------------------------------------------------------------------
// Fixtures + a recording-mock dep factory
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date("2026-06-12T12:00:00.000Z"); // a Friday

function makeRow(over: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    id: 1,
    user_id: "user-1",
    project_id: "proj-1",
    status: "active",
    cadence: "daily",
    day_of_week: null,
    day_of_month: null,
    send_hour_et: 7,
    audience_slug: "newsletter",
    template_id: "hero",
    next_run_at: null, // already parked by the claim RPC
    last_run_at: null,
    ...over,
  };
}

interface Recorded {
  posts: BroadcastRequest[];
  recordSent: { userId: string; n: number }[];
  rearms: { id: number; next: string | null }[];
  logs: string[];
}

function makeDeps(opts: {
  dryRun?: boolean;
  usageAllowed?: boolean;
  usage?: { tier: string; sent: number; limit: number };
  senderConfig?: SenderConfigRow | null;
  audience?: AudienceLookup | null;
  broadcastResult?: BroadcastResult;
  throwIn?: "buildContent" | "renderHtml" | "postBroadcast";
  // a deterministic next-run; default just adds a day
  computeNext?: (spec: CadenceSpec, fromUtc: Date) => Date | null;
}): { deps: ProcessDeps; rec: Recorded } {
  const rec: Recorded = { posts: [], recordSent: [], rearms: [], logs: [] };

  const deps: ProcessDeps = {
    dryRun: opts.dryRun ?? false,
    platform: { fromName: "SWFL Data Gulf", fromEmail: "hello@swfldatagulf.com" },

    async checkUsage() {
      return {
        allowed: opts.usageAllowed ?? true,
        tier: opts.usage?.tier ?? "starter",
        sent: opts.usage?.sent ?? 0,
        limit: opts.usage?.limit ?? 500,
      };
    },
    async recordSent(userId, n) {
      rec.recordSent.push({ userId, n });
    },
    async readSenderConfig() {
      return opts.senderConfig ?? null;
    },
    async readAudience() {
      // default: a real segment with 42 contacts
      return opts.audience === undefined
        ? { resend_audience_id: "seg_news", contact_count: 42 }
        : opts.audience;
    },
    async buildContent() {
      if (opts.throwIn === "buildContent") throw new Error("boom-content");
      return { subject: "Test Subject", body: "Hello body" };
    },
    async renderHtml() {
      if (opts.throwIn === "renderHtml") throw new Error("boom-render");
      // render-template lane produces HTML WITHOUT the unsubscribe token
      return "<html><body><p>Hello body</p></body></html>";
    },
    async postBroadcast(req) {
      if (opts.throwIn === "postBroadcast") throw new Error("boom-post");
      rec.posts.push(req);
      return opts.broadcastResult ?? { ok: true, broadcast_id: "bc_1", status: "sent" };
    },
    async rearm(id, next) {
      rec.rearms.push({ id, next });
    },
    computeNext: opts.computeNext ?? ((_spec, from) => new Date(from.getTime() + 86_400_000)),
    log: (line) => rec.logs.push(line),
  };

  return { deps, rec };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("ensureUnsubscribeToken", () => {
  test("injects the literal token before </body> when absent", () => {
    const out = ensureUnsubscribeToken("<html><body><p>hi</p></body></html>");
    assert.ok(out.includes(UNSUBSCRIBE_TOKEN), "token present after injection");
    // injected BEFORE </body>
    assert.ok(out.indexOf(UNSUBSCRIBE_TOKEN) < out.lastIndexOf("</body>"));
  });

  test("appends to the end when there is no </body>", () => {
    const out = ensureUnsubscribeToken("<p>no body tag</p>");
    assert.ok(out.includes(UNSUBSCRIBE_TOKEN));
    assert.ok(out.startsWith("<p>no body tag</p>"));
  });

  test("is idempotent: no double-append when the token is already present", () => {
    const html = `<html><body><a href="${UNSUBSCRIBE_TOKEN}">x</a></body></html>`;
    const out = ensureUnsubscribeToken(html);
    assert.equal(out, html);
    // exactly one occurrence
    assert.equal(out.split(UNSUBSCRIBE_TOKEN).length - 1, 1);
  });
});

describe("rowCadenceSpec", () => {
  test("maps a valid row to a CadenceSpec", () => {
    const spec = rowCadenceSpec(makeRow({ cadence: "weekly", day_of_week: 2, send_hour_et: 9 }));
    assert.deepEqual(spec, {
      cadence: "weekly",
      day_of_week: 2,
      day_of_month: null,
      send_hour_et: 9,
    });
  });

  test("returns null when cadence or send_hour_et is missing", () => {
    assert.equal(rowCadenceSpec(makeRow({ cadence: null })), null);
    assert.equal(rowCadenceSpec(makeRow({ send_hour_et: null })), null);
  });
});

describe("buildBroadcastPayload", () => {
  test("feeds resolved sender through; omits replyTo when null", () => {
    const p = buildBroadcastPayload({
      subject: "S",
      html: "H",
      segmentId: "seg_x",
      sender: { fromName: "N", fromEmail: "e@x.com", replyTo: null, usingTenantDomain: false },
    });
    assert.deepEqual(p, {
      subject: "S",
      html: "H",
      send: true,
      segmentId: "seg_x",
      fromName: "N",
      fromEmail: "e@x.com",
    });
    assert.ok(!("replyTo" in p));
  });

  test("includes replyTo when present", () => {
    const p = buildBroadcastPayload({
      subject: "S",
      html: "H",
      segmentId: "seg_x",
      sender: {
        fromName: "N",
        fromEmail: "e@x.com",
        replyTo: "reply@x.com",
        usingTenantDomain: true,
      },
    });
    assert.equal(p.replyTo, "reply@x.com");
  });
});

// ---------------------------------------------------------------------------
// processSchedule — orchestration
// ---------------------------------------------------------------------------

describe("processSchedule — usage gate", () => {
  test("over-limit → skip + notify, NO post, NO recordSent, row re-armed", async () => {
    const { deps, rec } = makeDeps({
      usageAllowed: false,
      usage: { tier: "free", sent: 50, limit: 50 },
    });
    const outcome = await processSchedule(makeRow(), deps, FIXED_NOW);

    assert.equal(outcome.kind, "skipped");
    assert.equal(rec.posts.length, 0, "no broadcast POST");
    assert.equal(rec.recordSent.length, 0, "no recordEmailSent");
    assert.equal(rec.rearms.length, 1, "row re-armed");
    assert.ok(
      rec.logs.some((l) => l.includes("usage limit reached")),
      "notify line logged",
    );
  });
});

describe("processSchedule — DRY_RUN", () => {
  test("never POSTs, logs the would-send, no recordSent, still re-arms", async () => {
    const { deps, rec } = makeDeps({ dryRun: true });
    const outcome = await processSchedule(makeRow(), deps, FIXED_NOW);

    assert.equal(outcome.kind, "dry-run");
    assert.equal(rec.posts.length, 0, "dry run never POSTs");
    assert.equal(rec.recordSent.length, 0, "dry run never records a send");
    assert.equal(
      rec.rearms.length,
      1,
      "dry run still computes + re-arms (caller no-ops the write)",
    );
    assert.ok(
      rec.logs.some((l) => l.includes("DRY_RUN")),
      "would-send payload logged",
    );
  });
});

describe("processSchedule — real send path", () => {
  test("token injected then asserted; payload POSTed with send:true; usage recorded with recipients", async () => {
    const { deps, rec } = makeDeps({});
    const outcome = await processSchedule(makeRow(), deps, FIXED_NOW);

    assert.equal(outcome.kind, "sent");
    assert.equal(rec.posts.length, 1);
    const post = rec.posts[0];
    assert.equal(post.send, true);
    assert.ok(post.html.includes(UNSUBSCRIBE_TOKEN), "POSTed html carries the token");
    assert.equal(post.subject, "Test Subject");
    assert.equal(post.segmentId, "seg_news");
    // recipients = audience.contact_count (42), not 1
    assert.deepEqual(rec.recordSent, [{ userId: "user-1", n: 42 }]);
  });

  test("recordSent falls back to 1 when contact_count is null", async () => {
    const { deps, rec } = makeDeps({
      audience: { resend_audience_id: "seg_news", contact_count: null },
    });
    const outcome = await processSchedule(makeRow(), deps, FIXED_NOW);
    assert.equal(outcome.kind, "sent");
    assert.deepEqual(rec.recordSent, [{ userId: "user-1", n: 1 }]);
  });

  test("non-ok broadcast → error outcome, NO recordSent, row still re-armed (no retry)", async () => {
    const { deps, rec } = makeDeps({ broadcastResult: { ok: false, status: "502" } });
    const outcome = await processSchedule(makeRow(), deps, FIXED_NOW);
    assert.equal(outcome.kind, "error");
    assert.equal(rec.recordSent.length, 0, "no usage recorded on a failed send");
    assert.equal(rec.rearms.length, 1, "failed send still re-arms for next occurrence");
  });
});

describe("processSchedule — sender wiring (we fed resolveSender correctly)", () => {
  const verified: SenderConfigRow = {
    domain: "tenant.com",
    resend_domain_id: "dom_1",
    from_name: "Tenant Co",
    from_email: "news@tenant.com",
    reply_to: "hi@tenant.com",
    domain_verified: true,
  };
  const unverified: SenderConfigRow = { ...verified, domain_verified: false };

  test("verified config → tenant fromEmail is used in the POST payload", async () => {
    const { deps, rec } = makeDeps({ senderConfig: verified });
    await processSchedule(makeRow(), deps, FIXED_NOW);
    const post = rec.posts[0];
    assert.equal(post.fromEmail, "news@tenant.com");
    assert.equal(post.fromName, "Tenant Co");
    assert.equal(post.replyTo, "hi@tenant.com");
  });

  test("unverified config → platform default sender + tenant reply-to", async () => {
    const { deps, rec } = makeDeps({ senderConfig: unverified });
    await processSchedule(makeRow(), deps, FIXED_NOW);
    const post = rec.posts[0];
    assert.equal(post.fromEmail, "hello@swfldatagulf.com", "platform default address");
    assert.equal(post.fromName, "SWFL Data Gulf", "platform default name");
    assert.equal(post.replyTo, "hi@tenant.com", "tenant reply-to still carried");
  });
});

describe("processSchedule — segment skip", () => {
  test("null audience_slug → skip + re-arm, no POST", async () => {
    const { deps, rec } = makeDeps({});
    const outcome = await processSchedule(makeRow({ audience_slug: null }), deps, FIXED_NOW);
    assert.equal(outcome.kind, "skipped");
    assert.equal(rec.posts.length, 0);
    assert.equal(rec.rearms.length, 1);
  });

  test("no audience row → skip + re-arm, no POST (never falls through to the digest list)", async () => {
    const { deps, rec } = makeDeps({ audience: null });
    const outcome = await processSchedule(makeRow(), deps, FIXED_NOW);
    assert.equal(outcome.kind, "skipped");
    assert.equal(rec.posts.length, 0);
    assert.equal(rec.rearms.length, 1);
  });

  test("audience row with null segment id → skip + re-arm, no POST", async () => {
    const { deps, rec } = makeDeps({
      audience: { resend_audience_id: null, contact_count: 5 },
    });
    const outcome = await processSchedule(makeRow(), deps, FIXED_NOW);
    assert.equal(outcome.kind, "skipped");
    assert.equal(rec.posts.length, 0);
  });
});

describe("processSchedule — re-arm uses the injected cadence math", () => {
  test("re-arm writes the ISO of computeNext(spec, fixedNow)", async () => {
    const expected = new Date("2026-06-13T11:00:00.000Z");
    const { deps, rec } = makeDeps({ computeNext: () => expected });
    await processSchedule(makeRow(), deps, FIXED_NOW);
    assert.deepEqual(rec.rearms, [{ id: 1, next: expected.toISOString() }]);
  });

  test("invalid spec (computeNext → null) leaves the row parked (next=null)", async () => {
    const { deps, rec } = makeDeps({ computeNext: () => null });
    await processSchedule(makeRow({ cadence: "weekly", day_of_week: null }), deps, FIXED_NOW);
    assert.deepEqual(rec.rearms, [{ id: 1, next: null }]);
    assert.ok(rec.logs.some((l) => l.includes("PARKED")));
  });
});

describe("processSchedule — per-row error isolation", () => {
  test("a render throw → error outcome, NOT a thrown exception, row still re-armed", async () => {
    const { deps, rec } = makeDeps({ throwIn: "renderHtml" });
    const outcome = await processSchedule(makeRow(), deps, FIXED_NOW);
    assert.equal(outcome.kind, "error");
    assert.equal(rec.posts.length, 0);
    assert.equal(rec.rearms.length, 1, "even a thrown row re-arms");
    assert.ok(rec.logs.some((l) => l.includes("ERROR")));
  });

  test("processBatch: one row throwing does not prevent the next from processing", async () => {
    // Build a deps whose first row's render throws but the second sends fine. We
    // drive this by template_id: row 2 renders normally. Use one deps instance and
    // vary behavior by row id via a custom renderHtml.
    const rec: Recorded = { posts: [], recordSent: [], rearms: [], logs: [] };
    const base = makeDeps({}).deps;
    const deps: ProcessDeps = {
      ...base,
      async recordSent(userId, n) {
        rec.recordSent.push({ userId, n });
      },
      async postBroadcast(req) {
        rec.posts.push(req);
        return { ok: true, broadcast_id: "bc", status: "sent" };
      },
      async rearm(id, next) {
        rec.rearms.push({ id, next });
      },
      async renderHtml(row) {
        if (row.id === 1) throw new Error("row-1 render boom");
        return "<html><body><p>ok</p></body></html>";
      },
      log: (l) => rec.logs.push(l),
    };

    const rows = [makeRow({ id: 1 }), makeRow({ id: 2 })];
    const outcomes = await processBatch(rows, deps, FIXED_NOW);

    assert.equal(outcomes[0].kind, "error");
    assert.equal(outcomes[1].kind, "sent");
    assert.equal(rec.posts.length, 1, "second row still sent despite first row throwing");
    assert.equal(rec.rearms.length, 2, "both rows re-armed");
  });
});
