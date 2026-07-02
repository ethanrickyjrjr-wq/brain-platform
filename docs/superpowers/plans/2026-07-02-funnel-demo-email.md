# Funnel Demo Email — Two-Track Prospect Sequence + Cadence Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Recommended model:** 🧠 Opus — 12 tasks, 20 files, keywords: migration, refactor, schema

**Spec:** `docs/superpowers/specs/2026-07-02-funnel-demo-email-design.md` · slug `funnel-demo-email` · check `funnel_demo_email_live_verify`

**Goal:** Marry the shipped-but-idle funnel (enroll → branded arrival → claim) to the shipped-but-paused cold-outreach engine: a two-track (agent/broker) proof-of-work demo email with a 4-touch cold cadence, click-earned daily trial, cooldown → one re-engagement → permanent retire — every email operator-previewed before send.

**Architecture:** The outreach engine is the send spine (`lib/email/outreach/*`, `outreach_recipients`/`outreach_events`, Resend batch + `rid` tag + webhook suppression — all live). This build adds a second axis to the recipient row: `stage` (cadence position) alongside the existing `status` (suppression). New pure cores (`demo-cadence`, `demo-subjects`, `demo-content`, `demo-gates`) + two thin CLI adapters (enroll, run) + three small live-surface touches (arrival `prompt`/`ref`, claim attribution, webhook stage transitions). NO new email builder — the demo payload extends `renderDripEmail` and the `email-outreach.html` shell additively.

**Tech Stack:** TypeScript (Bun), bun:test, Supabase (service-role PostgREST), Resend batch API, existing chart pipeline (resvg → `email-media` bucket).

## Global Constraints

- **Consume, NEVER edit (spec §9):** `lib/email/build-doc.ts`, `lib/email/market-context.ts`, `lib/deliverable/build.ts` (`gateNarrative`), `lib/deliverable/url-lint.ts`, `lib/email/chart-image.ts` (incl. `hostEmailMedia`), `lib/email/spec-to-png.ts`, listing photo/link roots. Brand seams used AS-IS (`brand-tokens-one-root` wave has NOT landed — only its spec/plan are committed).
- **No LLM in this pipeline.** Every subject and body line is deterministic template copy + code-computed figures. Numbers come from `assembleActivationReport` / `loadMarketFigures` / `computeReportDelta` — an email never carries a number those didn't produce (four-lane rule; INVENTED is the only hard block).
- **As-of display:** MM/DD/YYYY once, via `asOfFromToken` (`lib/project/as-of.ts:25`). NEVER render the raw `SWFL-…-YYYYMMDD` token to a prospect. (The legacy drip's `Live data token: …` line is a known pre-existing leak — do not copy it; do not fix it here either, it's out of scope.)
- **Subjects (spec §6):** 6–10 words / ~36–50 chars; a REAL lake number where the shape calls for one; truthful about the body; banned: "quick question", "just checking in". Two T1 variants per track (A/B); winner judged on reply/click, never opens.
- **Cadence (spec §5):** T1 day 0 · T2 day 3–4 · T3 ~day 10 · T4 day 18–21 (varied spacing, deterministic per-recipient jitter) · click → daily trial (13:00 UTC ≈ 9 AM ET, capped 30) · no engagement after T4 → 30-day cooldown → exactly ONE re-engagement → retired forever. Unsubscribe/complaint → immediate permanent suppression (engine already does status; this build adds stage `retired`).
- **Safety (spec §8):** `DRY_RUN` default everywhere (outreach convention: `process.env.DRY_RUN !== "false"`). Previews ALWAYS written to `outreach-runs/<stamp>/` (gitignored). Live send additionally requires `OUTREACH_DEMO_APPROVED=1` + `OUTREACH_POSTAL_ADDRESS` + a from identity. The agent never sends; live runs are operator commands.
- **Complaint ceiling:** Gmail hard limit 0.3%; at cycle-1 volume (~15–30 recipients) ONE complaint ≈ 3% — cycle-2 gate is ZERO complaints (scorecard view).
- **Volume:** cycle 1 ≈ 10–20 agents + 5–10 brokers. Runner `OUTREACH_DEMO_BATCH_LIMIT` defaults 30.
- **RULE 1 push discipline:** every task commits locally with explicit paths; NOTHING is pushed autonomously. Tasks 9, 10, 11 touch live surfaces (`/welcome`, claim path, webhook) — those commits are flagged for operator diff-review before push.
- **Verification bar:** `bun test lib/email scripts/email` green per task; `bunx next build` (never bare `npx tsc`) in the wrap-up task.
- **Brand truth:** prospect brand hexes/logos come from the operator CSV (verified from the brokerages' own sites, spec §3 — BHHS cabernet `#670038`, NEVER parent-conglomerate `#2E3192`; Premier Sotheby's black wordmark + gold `#ab8f40`) or from `enrichBrand`. Low-confidence scrape (<0.5) with no CSV override → recipient is SKIPPED with a review flag (a demo email in the WRONG brand is worse than none; the house-brand fallback of the legacy drip does not apply here).
- **Competitor mentions:** broker T3/coexist copy names MoxiWorks / BoldTrail / Follow Up Boss as coexistence, no pricing, no trash-talk.

## Operator-owned prerequisites (block LIVE SEND only — never the build)

1. Buy the separate outreach domain; verify in Resend; SPF + DKIM + DMARC. Confirm `List-Unsubscribe` + `List-Unsubscribe-Post` arrive intact on a test send FROM the new domain (the engine already emits them; spec §2 requires re-verifying on this domain). (Arrival links still point at swfldatagulf.com.)
2. Confirm From identity (real person name + monitored reply-to inbox) and `OUTREACH_POSTAL_ADDRESS` value.
3. Provide the cycle-1 CSV (targets + verified brand overrides).
4. Preview approval before every send; live commands are operator-run.

## Verified seams (probed 07/02/2026 — signatures are real, do not re-derive)

- `renderDripEmail(input: DripEmailInput): Promise<{html, subject}>` + `appendPostalAddress(html, addr)` — `lib/email/outreach/drip-email.ts`
- `renderEmailTemplate(slug, tokens, data?: {chart?, body?, delta?, repeats?})` — fills `{{TOKEN}}` then `[ CHART ]`/`[ BODY TEXT ]`/`[ DELTA ]`; THROWS on any leftover `{{UPPER}}` (so body HTML must contain no `{{…}}`) — `lib/email/templates/render-template.ts`
- `buildBatchMessages` / `sendBatches` (chunks of 100; sets `List-Unsubscribe` headers + `rid` tag; replaces `{{{RESEND_UNSUBSCRIBE_URL}}}` per recipient) — `lib/email/outreach/send.ts`
- `shouldSend`, `mapResendOutbound`, `extractOutreachAction`, `OutreachEvent` — `lib/email/outreach/lifecycle.ts`
- `assembleActivationReport({zip})` → `{in_scope, zip, primaryPlace, freshness_token, metrics, lines, snapshot: ActivationSnapshot}` — `lib/email/activation/snapshot.ts`
- `computeReportDelta(prev, current): ReportDelta` · `MetricChange {key, label, from, to, delta, direction, favorable, unit?}` — `lib/email/activation/{delta,types}.ts`
- `loadMarketFigures(scope?): Promise<MarketFigure[]>` — zip scope emits keys `active` / `median_list` / `dom` from `data_lake.listing_active_stats`, source label "SWFL Data Gulf" — `lib/email/market-context.ts`
- `buildArrivalUrl({name?, brand?, zip?, base?})` → `/welcome?name=&primary=&secondary=&logo=&zip=` — `lib/prospects/build-arrival-url.ts`
- `enrichBrand(domain)` → `{primary, secondary, logo_url, confidence, source, company_name?}`; never throws, falls back to all-null confidence 0 — `lib/prospects/enrich-brand.ts`
- `svgToPng(svg, opts?)` + `hostEmailMedia(key, buf, contentType)` (public `email-media` bucket, idempotent upsert) — `lib/email/chart-image.ts`
- `collectAllowedUrls(...roots)` + `lintCompiledHtml(html, allowed)` — `lib/deliverable/url-lint.ts`
- `asOfFromToken(token)` → `"MM/DD/YYYY" | null` — `lib/project/as-of.ts`
- `ensureUnsubscribeToken(html)` — `lib/email/scheduler.ts`
- Preview-writing pattern (timestamp dir + `<email>.html` under `outreach-runs/`) — `scripts/email/outreach-campaign.mts:208-226`
- Claim spine: `mintClaimToken(items, title?, opts?: {brand?, seed?})` / `consumeClaimToken` / `peekClaimToken` — `lib/claim/claim-store.ts`; `/api/prospect/open-project` body `{zip, brand}` → `{url: "/claim?t=…"}`.
- `/welcome` params today: `name, primary, secondary, logo, zip, demo` via `first(v)`; chat auto-fire seam is `ask(text)` in `app/welcome/_components/ConversationalChat.tsx` (no prompt param exists yet).

---

### Task 1: Migration — cadence columns, claim ref, funnel view

**Files:**
- Create: `docs/sql/20260702_outreach_demo.sql`
- Modify: (none — DB only)

**Interfaces:**
- Consumes: existing `outreach_recipients`, `outreach_events`, `claim_tokens` tables.
- Produces: columns `outreach_recipients.{track, stage, subject_variant, snapshot, trial_sends}`, `claim_tokens.ref`, view `public.outreach_demo_funnel`. Later tasks read/write these exact names.

- [ ] **Step 1: Write the idempotent migration**

```sql
-- docs/sql/20260702_outreach_demo.sql
-- Funnel demo email: cadence stage axis on outreach_recipients + claim attribution + scorecard.
-- Idempotent. Additive only — legacy drip rows keep track/stage NULL and are untouched.

alter table public.outreach_recipients
  add column if not exists track text,
  add column if not exists stage text,
  add column if not exists subject_variant text,
  add column if not exists snapshot jsonb,
  add column if not exists trial_sends int not null default 0;

comment on column public.outreach_recipients.track is 'demo track: agent | broker (NULL = legacy drip row)';
comment on column public.outreach_recipients.stage is
  'demo cadence: cold_t1|cold_t2|cold_t3|cold_t4|trial_active|cooldown|reengaged|retired|converted';
comment on column public.outreach_recipients.snapshot is 'ActivationSnapshot frozen at T1 send (delta left-operand)';

create index if not exists outreach_recipients_demo_due_idx
  on public.outreach_recipients (stage, next_send_at) where track is not null;

-- Claim attribution: the arrival ref (<recipient uuid>-<touch>) rides the claim token
-- across the OTP boundary so /api/claim can log 'claimed' + flip stage to 'converted'.
alter table public.claim_tokens add column if not exists ref text;

-- Cycle-1 scorecard: one SQL read = delivered -> opened -> clicked -> arrived -> claimed (+ complaints).
-- 'arrived'/'claimed' are written by app code (Tasks 9/10); 'complained' becomes a distinct
-- event in Task 8 (today complaints log as 'unsubscribed').
create or replace view public.outreach_demo_funnel as
select
  r.campaign_id,
  r.track,
  r.subject_variant,
  count(distinct r.id)                                                  as recipients,
  count(distinct e.recipient_id) filter (where e.event = 'delivered')   as delivered,
  count(distinct e.recipient_id) filter (where e.event = 'opened')      as opened,
  count(distinct e.recipient_id) filter (where e.event = 'clicked')     as clicked,
  count(distinct e.recipient_id) filter (where e.event = 'arrived')     as arrived,
  count(distinct e.recipient_id) filter (where e.event = 'claimed')     as claimed,
  count(*)                       filter (where e.event = 'complained')  as complaints,
  count(*)                       filter (where e.event = 'unsubscribed') as unsubscribed
from public.outreach_recipients r
left join public.outreach_events e on e.recipient_id = r.id
where r.track is not null
group by 1, 2, 3;

revoke all on public.outreach_demo_funnel from anon, authenticated;
```

- [ ] **Step 2: Run it against prod via Bun.SQL** (psql is NOT installed — follow memory `reference_run-migrations-via-bun-sql.md`: connection string from `.dlt/secrets.toml`, `sslmode=require`). RULE 1: SQL migrations run directly; always idempotent; verify after.

- [ ] **Step 3: Verify**

Run (same Bun.SQL session):
```sql
select column_name from information_schema.columns
 where table_name = 'outreach_recipients'
   and column_name in ('track','stage','subject_variant','snapshot','trial_sends');
select column_name from information_schema.columns
 where table_name = 'claim_tokens' and column_name = 'ref';
select count(*) from public.outreach_demo_funnel;
```
Expected: 5 rows, 1 row, `0` (no demo recipients yet — the view compiles).

- [ ] **Step 4: Commit**

```bash
git add docs/sql/20260702_outreach_demo.sql
git commit -m "feat(outreach): demo cadence columns + claim ref + funnel scorecard view"
```

---

### Task 2: `demo-cadence.ts` — the pure state machine

**Files:**
- Create: `lib/email/outreach/demo-cadence.ts`
- Test: `lib/email/outreach/demo-cadence.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces (used by Tasks 5, 10, 11, 13):
  - `type DemoStage = "cold_t1"|"cold_t2"|"cold_t3"|"cold_t4"|"trial_active"|"cooldown"|"reengaged"|"retired"|"converted"`
  - `type DemoTouch = "t1"|"t2"|"t3"|"t4"|"trial"|"reengage"`
  - `touchForStage(stage: DemoStage): DemoTouch | null`
  - `afterSend(cur: DemoCursor, recipientId: string, now: Date): DemoCursor` where `DemoCursor = {stage: DemoStage; next_send_at: string|null; trial_sends: number}`
  - `onDemoEvent(stage: DemoStage, event: "clicked"|"bounced"|"unsubscribed"|"complained"|"claimed", now: Date): {stage: DemoStage; next_send_at: string|null} | null`
  - `jitterDays(recipientId: string, min: number, max: number): number`
  - `nextTrialSendAt(now: Date): string` · consts `TRIAL_CAP = 30`, `COOLDOWN_DAYS = 30`, `TRIAL_SEND_HOUR_UTC = 13`
  - `retireIfStale(stage: DemoStage, lastActivityIso: string, now: Date): boolean` — `reengaged` older than 30d → retire.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/email/outreach/demo-cadence.test.ts
import { describe, expect, test } from "bun:test";
import {
  afterSend, jitterDays, nextTrialSendAt, onDemoEvent, retireIfStale,
  touchForStage, TRIAL_CAP,
} from "./demo-cadence";

const RID = "3f6c2a1e-9b4d-4e6f-8a2b-1c5d7e9f0a1b";
const NOW = new Date("2026-07-06T15:30:00.000Z"); // a Monday, after 13:00 UTC

describe("touchForStage", () => {
  test("cold stages map to their touch; cooldown due = the one re-engagement", () => {
    expect(touchForStage("cold_t1")).toBe("t1");
    expect(touchForStage("cold_t4")).toBe("t4");
    expect(touchForStage("trial_active")).toBe("trial");
    expect(touchForStage("cooldown")).toBe("reengage");
  });
  test("terminal stages never send", () => {
    for (const s of ["reengaged", "retired", "converted"] as const)
      expect(touchForStage(s)).toBeNull();
  });
});

describe("cold spacing (spec: T2 d3-4, T3 ~d10, T4 d18-21, varied not identical)", () => {
  test("jitter is deterministic and in range", () => {
    const d = jitterDays(RID, 3, 4);
    expect(d).toBe(jitterDays(RID, 3, 4));
    expect(d === 3 || d === 4).toBe(true);
  });
  test("full cold path lands inside the spec windows", () => {
    let cur = { stage: "cold_t1" as const, next_send_at: null, trial_sends: 0 };
    let clock = NOW;
    let elapsed = 0;
    const windows: Record<string, [number, number]> = {
      cold_t2: [3, 4], cold_t3: [9, 11], cold_t4: [18, 21],
    };
    for (const expectStage of ["cold_t2", "cold_t3", "cold_t4"] as const) {
      const next = afterSend(cur, RID, clock);
      expect(next.stage).toBe(expectStage);
      const days = (new Date(next.next_send_at!).getTime() - clock.getTime()) / 86_400_000;
      elapsed += days;
      expect(elapsed).toBeGreaterThanOrEqual(windows[expectStage][0]);
      expect(elapsed).toBeLessThanOrEqual(windows[expectStage][1]);
      clock = new Date(next.next_send_at!);
      cur = { ...next, stage: expectStage } as never;
    }
  });
  test("T4 send parks in cooldown 30 days out; cooldown send -> reengaged terminal", () => {
    const cooled = afterSend({ stage: "cold_t4", next_send_at: null, trial_sends: 0 }, RID, NOW);
    expect(cooled.stage).toBe("cooldown");
    expect((new Date(cooled.next_send_at!).getTime() - NOW.getTime()) / 86_400_000).toBe(30);
    const done = afterSend(cooled, RID, NOW);
    expect(done).toEqual({ stage: "reengaged", next_send_at: null, trial_sends: 0 });
  });
});

describe("daily trial", () => {
  test("next trial send is the next 13:00 UTC strictly after now", () => {
    expect(nextTrialSendAt(new Date("2026-07-06T15:30:00Z"))).toBe("2026-07-07T13:00:00.000Z");
    expect(nextTrialSendAt(new Date("2026-07-06T09:00:00Z"))).toBe("2026-07-06T13:00:00.000Z");
  });
  test("trial advances daily and retires at the 30-send cap", () => {
    let cur = { stage: "trial_active" as const, next_send_at: null, trial_sends: TRIAL_CAP - 2 };
    cur = afterSend(cur, RID, NOW) as never;
    expect(cur.stage).toBe("trial_active");
    expect(cur.trial_sends).toBe(TRIAL_CAP - 1);
    const capped = afterSend(cur, RID, NOW);
    expect(capped).toEqual({ stage: "retired", next_send_at: null, trial_sends: TRIAL_CAP });
  });
});

describe("onDemoEvent", () => {
  test("click earns the trial from any pre-conversion cold/cooldown/reengaged stage", () => {
    for (const s of ["cold_t1", "cold_t3", "cooldown", "reengaged"] as const) {
      const r = onDemoEvent(s, "clicked", NOW);
      expect(r?.stage).toBe("trial_active");
      expect(r?.next_send_at).toBe(nextTrialSendAt(NOW));
    }
  });
  test("click is a no-op on trial_active / converted / retired", () => {
    for (const s of ["trial_active", "converted", "retired"] as const)
      expect(onDemoEvent(s, "clicked", NOW)).toBeNull();
  });
  test("complaint / unsubscribe / bounce retire permanently; claimed converts", () => {
    expect(onDemoEvent("cold_t2", "complained", NOW)).toEqual({ stage: "retired", next_send_at: null });
    expect(onDemoEvent("trial_active", "unsubscribed", NOW)).toEqual({ stage: "retired", next_send_at: null });
    expect(onDemoEvent("cold_t1", "bounced", NOW)).toEqual({ stage: "retired", next_send_at: null });
    expect(onDemoEvent("trial_active", "claimed", NOW)).toEqual({ stage: "converted", next_send_at: null });
  });
});

describe("retireIfStale", () => {
  test("reengaged goes retired after 30 quiet days; other stages never", () => {
    expect(retireIfStale("reengaged", "2026-06-01T00:00:00Z", NOW)).toBe(true);
    expect(retireIfStale("reengaged", "2026-07-01T00:00:00Z", NOW)).toBe(false);
    expect(retireIfStale("trial_active", "2026-01-01T00:00:00Z", NOW)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/email/outreach/demo-cadence.test.ts`
Expected: FAIL — cannot resolve `./demo-cadence`.

- [ ] **Step 3: Implement**

```ts
// lib/email/outreach/demo-cadence.ts
//
// Funnel-demo cadence state machine — pure, no I/O. Two-axis model: the existing
// `status` (lifecycle.ts) stays authoritative for CAN-send (suppression); `stage`
// (this module) says WHERE in the demo sequence a recipient is. The runner + webhook
// apply these decisions against outreach_recipients; this module just decides.
// Spec: docs/superpowers/specs/2026-07-02-funnel-demo-email-design.md §5.

export type DemoStage =
  | "cold_t1" | "cold_t2" | "cold_t3" | "cold_t4"
  | "trial_active" | "cooldown" | "reengaged" | "retired" | "converted";

export type DemoTouch = "t1" | "t2" | "t3" | "t4" | "trial" | "reengage";

export const TRIAL_CAP = 30;
export const COOLDOWN_DAYS = 30;
/** Daily-trial send hour. 13:00 UTC ≈ 9 AM Eastern (EDT); acceptable DST drift to 8 AM. */
export const TRIAL_SEND_HOUR_UTC = 13;
/** A reengaged recipient quiet this long is retired permanently (spec: no second cycle). */
export const REENGAGE_QUIET_DAYS = 30;

export interface DemoCursor {
  stage: DemoStage;
  next_send_at: string | null;
  trial_sends: number;
}

/** Which email a DUE recipient at this stage receives. null = this stage never sends. */
export function touchForStage(stage: DemoStage): DemoTouch | null {
  switch (stage) {
    case "cold_t1": return "t1";
    case "cold_t2": return "t2";
    case "cold_t3": return "t3";
    case "cold_t4": return "t4";
    case "trial_active": return "trial";
    case "cooldown": return "reengage"; // due = the 30-day park expired
    default: return null; // reengaged | retired | converted
  }
}

/** Deterministic per-recipient jitter — varied spacing reads human; identical intervals read robotic. */
export function jitterDays(recipientId: string, min: number, max: number): number {
  let h = 0;
  for (const c of recipientId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return min + (h % (max - min + 1));
}

function daysFromNow(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}

/** Next TRIAL_SEND_HOUR_UTC strictly after `now`. */
export function nextTrialSendAt(now: Date): string {
  const next = new Date(now);
  next.setUTCHours(TRIAL_SEND_HOUR_UTC, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

/**
 * Advance the cursor after a successful send at the current stage.
 * Windows (cumulative from T1): T2 = +3–4d, T3 = day 9–11, T4 = day 18–21.
 */
export function afterSend(cur: DemoCursor, recipientId: string, now: Date): DemoCursor {
  switch (cur.stage) {
    case "cold_t1":
      return { stage: "cold_t2", next_send_at: daysFromNow(now, jitterDays(recipientId, 3, 4)), trial_sends: 0 };
    case "cold_t2":
      return { stage: "cold_t3", next_send_at: daysFromNow(now, jitterDays(recipientId, 6, 7)), trial_sends: 0 };
    case "cold_t3":
      return { stage: "cold_t4", next_send_at: daysFromNow(now, jitterDays(recipientId, 9, 10)), trial_sends: 0 };
    case "cold_t4":
      return { stage: "cooldown", next_send_at: daysFromNow(now, COOLDOWN_DAYS), trial_sends: 0 };
    case "cooldown":
      // The single re-engagement email just went out. Terminal unless it earns a click.
      return { stage: "reengaged", next_send_at: null, trial_sends: 0 };
    case "trial_active": {
      const sends = cur.trial_sends + 1;
      return sends >= TRIAL_CAP
        ? { stage: "retired", next_send_at: null, trial_sends: sends }
        : { stage: "trial_active", next_send_at: nextTrialSendAt(now), trial_sends: sends };
    }
    default:
      return cur; // terminal stages never send
  }
}

/** Apply an engagement/suppression event to the stage. null = no stage change. */
export function onDemoEvent(
  stage: DemoStage,
  event: "clicked" | "bounced" | "unsubscribed" | "complained" | "claimed",
  now: Date,
): { stage: DemoStage; next_send_at: string | null } | null {
  if (event === "claimed") {
    return stage === "converted" ? null : { stage: "converted", next_send_at: null };
  }
  if (event === "bounced" || event === "unsubscribed" || event === "complained") {
    return stage === "retired" ? null : { stage: "retired", next_send_at: null };
  }
  // clicked → daily trial is EARNED by engagement, never sent cold.
  if (stage === "trial_active" || stage === "converted" || stage === "retired") return null;
  return { stage: "trial_active", next_send_at: nextTrialSendAt(now) };
}

/** Spec: reengaged + still nothing → retire the address permanently. */
export function retireIfStale(stage: DemoStage, lastActivityIso: string, now: Date): boolean {
  if (stage !== "reengaged") return false;
  return now.getTime() - new Date(lastActivityIso).getTime() > REENGAGE_QUIET_DAYS * 86_400_000;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test lib/email/outreach/demo-cadence.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add lib/email/outreach/demo-cadence.ts lib/email/outreach/demo-cadence.test.ts
git commit -m "feat(outreach): demo cadence state machine (4 cold touches, earned trial, cooldown->one reengage->retire)"
```

---

### Task 3: `demo-subjects.ts` — deterministic subject system

**Files:**
- Create: `lib/email/outreach/demo-subjects.ts`
- Test: `lib/email/outreach/demo-subjects.test.ts`

**Interfaces:**
- Consumes: `DemoTouch` from `./demo-cadence`.
- Produces (used by Task 5's content builder):
  - `interface SubjectArgs { track: "agent"|"broker"; touch: DemoTouch; variant: "a"|"b"; name: string|null; brokerage: string|null; place: string; headlineFigure: string|null; medianDeltaK: number|null; sinceLabel: string|null }`
  - `demoSubject(a: SubjectArgs): string`

Shapes (spec §6 — numbers filled from real figures at build time, never invented):
- T1 agent a: `{Name?, }the {Place} email your clients didn't get this morning`
- T1 agent b: `{Place}: {headlineFigure} — your clients could've had this by 9 AM` (only when `headlineFigure` real; else falls back to shape a)
- T1 broker a: `{Brokerage}'s {Place} agents, powered by one data engine`
- T1 broker b: `{headlineFigure} in {Place} — one engine for every {Brokerage} agent` (falls back to a without a figure)
- T2 with delta: `{Place}'s median moved ${X}K since {sinceLabel}` — ONLY when `medianDeltaK` is a real non-zero computed move; otherwise the re-verified variant `{Place} re-checked {sinceLabel ?? "today"} — your numbers held`
- T3 agent: `Your {Place} social calendar, already written` · T3 broker: `Which {Brokerage} listings emails get opened? You'd know`
- T4: `Last one from us{, Name} — your {Place} setup stays live`
- trial: `{Place} today: {headlineFigure}` (falls back to `{Place} today — your daily market read`)
- reengage: `What changed in {Place} since we last wrote`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/email/outreach/demo-subjects.test.ts
import { describe, expect, test } from "bun:test";
import { demoSubject } from "./demo-subjects";

const base = {
  track: "agent" as const, variant: "a" as const, name: "Dana", brokerage: null,
  place: "Park Shore", headlineFigure: null, medianDeltaK: null, sinceLabel: null,
};

describe("T1", () => {
  test("agent a carries name + place", () => {
    expect(demoSubject({ ...base, touch: "t1" }))
      .toBe("Dana, the Park Shore email your clients didn't get this morning");
  });
  test("agent b uses a REAL figure; without one it falls back to shape a", () => {
    expect(demoSubject({ ...base, touch: "t1", variant: "b", headlineFigure: "214 active listings" }))
      .toBe("Park Shore: 214 active listings — your clients could've had this by 9 AM");
    expect(demoSubject({ ...base, touch: "t1", variant: "b" }))
      .toBe("Dana, the Park Shore email your clients didn't get this morning");
  });
  test("broker shapes speak fleet", () => {
    expect(demoSubject({ ...base, touch: "t1", track: "broker", brokerage: "Premier Sotheby's" }))
      .toBe("Premier Sotheby's's Park Shore agents, powered by one data engine".replace("'s's", "'s"));
  });
});

describe("T2 truthfulness", () => {
  test("delta shape ONLY with a real non-zero move", () => {
    expect(demoSubject({ ...base, touch: "t2", medianDeltaK: 12, sinceLabel: "Tuesday" }))
      .toBe("Park Shore's median moved $12K since Tuesday");
    expect(demoSubject({ ...base, touch: "t2", medianDeltaK: 0, sinceLabel: "Tuesday" }))
      .toBe("Park Shore re-checked Tuesday — your numbers held");
    expect(demoSubject({ ...base, touch: "t2" }))
      .toBe("Park Shore re-checked today — your numbers held");
  });
  test("negative move renders as a real signed figure", () => {
    expect(demoSubject({ ...base, touch: "t2", medianDeltaK: -8, sinceLabel: "Monday" }))
      .toBe("Park Shore's median moved -$8K since Monday");
  });
});

describe("later touches", () => {
  test("t4 breakup + place stays-live", () => {
    expect(demoSubject({ ...base, touch: "t4" }))
      .toBe("Last one from us, Dana — your Park Shore setup stays live");
  });
  test("trial daily uses a real figure or the honest fallback", () => {
    expect(demoSubject({ ...base, touch: "trial", headlineFigure: "3 new listings" }))
      .toBe("Park Shore today: 3 new listings");
    expect(demoSubject({ ...base, touch: "trial" }))
      .toBe("Park Shore today — your daily market read");
  });
  test("reengage", () => {
    expect(demoSubject({ ...base, touch: "reengage" }))
      .toBe("What changed in Park Shore since we last wrote");
  });
});

describe("hygiene", () => {
  test("no banned cold-email phrases in any shape", () => {
    const all: string[] = [];
    for (const touch of ["t1", "t2", "t3", "t4", "trial", "reengage"] as const)
      for (const track of ["agent", "broker"] as const)
        for (const variant of ["a", "b"] as const)
          all.push(demoSubject({ ...base, touch, track, variant, brokerage: "BHHS",
            headlineFigure: "214 active listings", medianDeltaK: 12, sinceLabel: "Tuesday" }));
    for (const s of all) {
      expect(s.toLowerCase()).not.toContain("quick question");
      expect(s.toLowerCase()).not.toContain("just checking in");
      expect(s).not.toMatch(/SWFL-\d+-v\d+-\d{8}/); // never the raw token
    }
  });
});
```

- [ ] **Step 2: Run to verify failure** — `bun test lib/email/outreach/demo-subjects.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// lib/email/outreach/demo-subjects.ts
//
// Deterministic subject lines for the funnel demo cadence — pure, no LLM.
// Every dynamic figure is passed IN (computed from lake data upstream); a shape
// that calls for a number falls back to a numberless truthful shape when the
// figure isn't held — never an invented value. Spec §6.

import type { DemoTouch } from "./demo-cadence";

export interface SubjectArgs {
  track: "agent" | "broker";
  touch: DemoTouch;
  variant: "a" | "b";
  name: string | null;
  brokerage: string | null;
  place: string;
  /** A real lake figure, already formatted (e.g. "214 active listings"), or null. */
  headlineFigure: string | null;
  /** T2: whole-$K move of the median vs the frozen T1 snapshot. null/0 = no real move. */
  medianDeltaK: number | null;
  /** T2: truthful timing label, e.g. "Tuesday" (T1 send weekday). */
  sinceLabel: string | null;
}

function possessive(s: string): string {
  return s.endsWith("'s") || s.endsWith("’s") ? s : `${s}'s`;
}

export function demoSubject(a: SubjectArgs): string {
  const namePrefix = a.name ? `${a.name}, ` : "";
  const nameSuffix = a.name ? `, ${a.name}` : "";
  switch (a.touch) {
    case "t1": {
      if (a.track === "broker") {
        const who = a.brokerage ?? "Your";
        if (a.variant === "b" && a.headlineFigure)
          return `${a.headlineFigure} in ${a.place} — one engine for every ${who} agent`;
        return `${possessive(who)} ${a.place} agents, powered by one data engine`;
      }
      if (a.variant === "b" && a.headlineFigure)
        return `${a.place}: ${a.headlineFigure} — your clients could've had this by 9 AM`;
      return `${namePrefix}the ${a.place} email your clients didn't get this morning`;
    }
    case "t2": {
      if (a.medianDeltaK != null && a.medianDeltaK !== 0) {
        const k = a.medianDeltaK;
        const money = k < 0 ? `-$${Math.abs(k)}K` : `$${k}K`;
        return `${possessive(a.place)} median moved ${money} since ${a.sinceLabel ?? "our last note"}`;
      }
      return `${a.place} re-checked ${a.sinceLabel ?? "today"} — your numbers held`;
    }
    case "t3":
      return a.track === "broker"
        ? `Which ${a.brokerage ?? "your"} listings emails get opened? You'd know`
        : `Your ${a.place} social calendar, already written`;
    case "t4":
      return `Last one from us${nameSuffix} — your ${a.place} setup stays live`;
    case "trial":
      return a.headlineFigure
        ? `${a.place} today: ${a.headlineFigure}`
        : `${a.place} today — your daily market read`;
    case "reengage":
      return `What changed in ${a.place} since we last wrote`;
  }
}
```

- [ ] **Step 4: Run tests** — `bun test lib/email/outreach/demo-subjects.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/email/outreach/demo-subjects.ts lib/email/outreach/demo-subjects.test.ts
git commit -m "feat(outreach): deterministic demo subject system (A/B, truth-gated delta shape)"
```

---

### Task 4: Extract `chartFromReport` from `build-content.ts`

The demo content builder (Task 5) needs the same "largest same-unit metric group → honest bar" chart the drip already builds, but with an MM/DD/YYYY subtitle instead of the raw-token subtitle. Extract the chart logic into an exported helper with the subtitle passed in; `buildContent` keeps byte-identical output.

**Files:**
- Modify: `lib/email/outreach/build-content.ts`
- Test: existing suite (`bun test lib/email/outreach`) must stay green; add one new test file `lib/email/outreach/build-content.chart.test.ts`

**Interfaces:**
- Produces: `chartFromReport(report: AssembledReport, subtitle?: string): EmailChartSpec | null` (exported from `build-content.ts`). Returns null when no finite metric exists.

- [ ] **Step 1: Write the failing test**

```ts
// lib/email/outreach/build-content.chart.test.ts
import { describe, expect, test } from "bun:test";
import { chartFromReport } from "./build-content";
import type { AssembledReport } from "@/lib/email/activation/snapshot";

const report = {
  in_scope: true, zip: "34103", primaryPlace: "Park Shore",
  freshness_token: "SWFL-7421-v5-20260702",
  metrics: [
    { key: "housing.median_sale_price", label: "Median sale price", value: 912000, unit: "$" },
    { key: "housing.median_dom", label: "Median days on market", value: 41, unit: " days" },
    { key: "housing.homes_sold", label: "Homes sold", value: 58, unit: "" },
    { key: "housing.inventory", label: "Inventory", value: 402, unit: "" },
  ],
  lines: [], snapshot: { zip: "34103", freshness_token: null, captured_at: "", metrics: [], lines: [] },
} as unknown as AssembledReport;

describe("chartFromReport", () => {
  test("largest same-unit group, custom subtitle, no raw token", () => {
    const chart = chartFromReport(report, "as of 07/02/2026");
    expect(chart?.type).toBe("bar");
    expect(chart?.subtitle).toBe("as of 07/02/2026");
    expect(chart?.data.map((d) => d.label)).toEqual(["Homes sold", "Inventory"]);
    expect(JSON.stringify(chart)).not.toContain("SWFL-7421");
  });
  test("null when no finite metrics", () => {
    expect(chartFromReport({ ...report, metrics: [] } as never)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `bun test lib/email/outreach/build-content.chart.test.ts` → FAIL (`chartFromReport` not exported).

- [ ] **Step 3: Refactor `build-content.ts`** — lift lines 21–39 into the helper; `buildContent` calls it with its CURRENT subtitle string so legacy output is unchanged:

```ts
// add to lib/email/outreach/build-content.ts (below imports; AssembledReport type
// imported from "@/lib/email/activation/snapshot")

/**
 * Largest group of finite metrics sharing one unit → an honest comparable bar
 * (never mixes $/%/days in one chart). Subtitle is caller-supplied: the legacy
 * drip passes its token line (unchanged); the demo email passes "as of MM/DD/YYYY".
 */
export function chartFromReport(report: AssembledReport, subtitle?: string): EmailChartSpec | null {
  const finite = report.metrics.filter((m) => m.value !== null && Number.isFinite(m.value));
  if (finite.length === 0) return null;
  const byUnit = new Map<string, typeof finite>();
  for (const m of finite) {
    const u = m.unit ?? "";
    byUnit.set(u, [...(byUnit.get(u) ?? []), m]);
  }
  const group = [...byUnit.values()].sort((a, b) => b.length - a.length)[0].slice(0, 5);
  return {
    type: "bar",
    title: `${report.primaryPlace ?? `ZIP ${report.zip}`} — key figures`,
    subtitle,
    unit: group[0].unit || undefined,
    data: group.map((m) => ({ label: m.label, value: m.value as number })),
  };
}
```

and inside `buildContent`, replace the inlined block with:

```ts
  const chart = chartFromReport(
    report,
    report.freshness_token ? `as of token ${report.freshness_token}` : undefined,
  );
  if (!chart) return null;
```

(Delete the now-dead `finite`/`byUnit`/`group` locals and the old `chart` literal.)

- [ ] **Step 4: Run the whole outreach suite** — `bun test lib/email/outreach` → PASS, including all pre-existing `build-content`/`campaign` tests (byte-parity for legacy drip).

- [ ] **Step 5: Commit**

```bash
git add lib/email/outreach/build-content.ts lib/email/outreach/build-content.chart.test.ts
git commit -m "refactor(outreach): extract chartFromReport (subtitle injectable; legacy byte-identical)"
```

---### Task 5: `demo-content.ts` — per-touch payload assembly

**Files:**
- Create: `lib/email/outreach/demo-content.ts`
- Test: `lib/email/outreach/demo-content.test.ts`

**Interfaces:**
- Consumes: `assembleActivationReport` (injectable), `loadMarketFigures` (injectable), `computeReportDelta`, `chartFromReport` (Task 4), `asOfFromToken`, `buildArrivalUrl`, `demoSubject` (Task 3), `DemoTouch` (Task 2).
- Produces (used by Tasks 6, 12):

```ts
export interface DemoStat { label: string; value: string; source: string }
export interface DemoButton { label: string; url: string }
export interface DemoTouchContent {
  subject: string;
  preheader: string;
  kicker: string;
  title: string;
  chart: EmailChartSpec | null;
  bodyHtml: string;               // framing + track/touch lens copy (fixed strings, escaped interpolations)
  deltaLine: string | null;       // T2: computed "what moved" line
  stats: DemoStat[];              // ≤3 cited stats — never padded, never invented
  promptButtons: DemoButton[];    // 3 deep links (prompt+ref on the arrival URL)
  ctaLabel: string;
  ctaUrl: string;                 // arrival URL with ref (no prompt)
  asOf: string | null;            // "MM/DD/YYYY" via asOfFromToken
  freshnessLine: string;          // human line for the shell's FRESHNESS slot (no raw token)
  sources: string[];              // deduped source names of every figure shown (spec §3: collapsed list)
  snapshot: ActivationSnapshot | null; // T1 only — the runner freezes it
  anchors: Array<string | number>;     // every figure shown (feeds the anchored-numbers gate)
}
export interface DemoRecipientRow {
  id: string; email: string; name: string | null; zip: string | null;
  track: "agent" | "broker"; subject_variant: "a" | "b";
  brand: ActivationBrand | null; snapshot: ActivationSnapshot | null;
}
export interface DemoContentDeps {
  assembleReport?: typeof assembleActivationReport;
  loadFigures?: typeof loadMarketFigures;
  now?: () => Date;
}
export async function buildDemoTouch(
  rec: DemoRecipientRow, touch: DemoTouch, siteOrigin: string, deps?: DemoContentDeps,
): Promise<DemoTouchContent | null>
```

Behavior contract (all testable with injected deps):
1. `rec.zip` missing or report `in_scope === false` → `null` (MOAT gate, same as `buildContent`).
2. `stats` = `loadMarketFigures({kind:"zip", value: zip})` filtered to keys `active`/`median_list`/`dom`, mapped `{label, value, source}` — missing keys just drop (fill-from-next-lane happens upstream at CSV/operator level, never by padding).
3. `asOf = asOfFromToken(report.freshness_token)`; `freshnessLine` = `Live Southwest Florida data — as of {asOf}` (or `"Live Southwest Florida market data"` when token absent); chart subtitle = `as of {asOf}` when present. The raw token NEVER appears in any output field (test asserts).
4. `promptButtons` (on `t1`, `t3`, `trial`, `reengage`): the three spec questions with `{place}` interpolated — `What changed in {place} this week?`, `Which price band is moving in {place}?`, `Draft my Tuesday client email` (t3 agent swaps Q3 for `Draft this week's social posts for {place}`). Each URL = `buildArrivalUrl({name, brand: mapped, zip, base: siteOrigin, prompt: question, ref: `${rec.id}-${touch}`})` (Task 9 adds those params; until it lands this module passes them and the URL builder ignores unknown keys — Task 9 MUST land before Task 12 wires sends. Task-order note below).
5. `ctaUrl` = same arrival URL without `prompt`; `ctaLabel`: t1/t2/t3/trial `See your whole week — already built`, t4/reengage `Everything we built for you, one link`.
6. T2: requires `rec.snapshot`; `computeReportDelta(rec.snapshot, report.snapshot)`; `deltaLine` from the top ≤2 `metric_changes` formatted `"{label}: {fmt(from)} → {fmt(to)}"` with `fmt` unit-aware (`"$"` → `$912,000`; `" days"` → `41 days`; `"%"` → `3.2%`; `""` → `toLocaleString`); `medianDeltaK` for the subject = `Math.round(delta/1000)` of the `housing.median_sale_price` change when present, else null; `sinceLabel` = weekday name of `rec.snapshot.captured_at` (UTC). `has_change === false` → `deltaLine = "We re-checked every number we showed you — where it stands today:"` (honest no-change framing; subject system independently falls back).
7. Track copy (fixed strings in a `COPY` const, HTML-escaped interpolations):
   - t1 agent body: `We built this from live Southwest Florida data — this is what your clients could get from you every week.`
   - t1 broker body: `Every agent in your office could have sent this at 9 AM — one data engine, each email in your brand.`
   - t3 agent: social-calendar angle; t3 broker: coexist line `Works alongside MoxiWorks, BoldTrail, or Follow Up Boss — we're the data-and-content engine, not a CRM replacement.` + plug-in offer `Send us any export of your data and it's in your agents' emails this week.`
   - t4: breakup `Last one from us — here's everything we built for you in one link. Your setup stays live if you ever want it.`
   - reengage: `Here's what changed in {place} since we last wrote.`
8. `anchors` = every stat value + every chart data value + delta from/to values + `asOf` + zip + any digit-bearing figure interpolated into copy (feeds Task 6's gate).
9. `subject` = `demoSubject({track, touch, variant: rec.subject_variant, name, brokerage: rec.brand?.companyName ?? null, place, headlineFigure, medianDeltaK, sinceLabel})` where `headlineFigure` = `"{active} active listings"` when the `active` stat exists, else null.
10. `snapshot` = `report.snapshot` on `t1` only (else null). `preheader` = first body sentence.
11. `sources` = deduped source names of every figure shown (each stat's `source` + `"SWFL Data Gulf"` for the chart/delta figures) — the email's collapsed source list (spec §3 item 6). Never internal table/view names.

- [ ] **Step 1: Write failing tests** — cover: out-of-scope → null; t1 assembles subject/stats/buttons/snapshot + no raw token anywhere (`JSON.stringify(content)` must not match `/SWFL-\d+-v\d+-\d{8}/`); t2 with a moved median produces deltaLine + $K subject + weekday sinceLabel; t2 with identical snapshots produces the re-verified subject + honest deltaLine; t3 broker body names the three CRMs; buttons carry `prompt=` + `ref={id}-{touch}`; anchors contain every displayed number. Use injected `assembleReport`/`loadFigures` fixtures (no network) — model them on the fixture shapes in Task 4's test.
- [ ] **Step 2: Run to verify failure** — `bun test lib/email/outreach/demo-content.test.ts` → FAIL.
- [ ] **Step 3: Implement `demo-content.ts`** to the behavior contract above. Brand mapping for `buildArrivalUrl`: `ActivationBrand {primary, accent, logoUrl, companyName}` → `BrandEnrichment`-shaped `{primary, secondary: accent, logo_url: logoUrl, company_name: companyName, confidence: 1, source: "fallback"}` (only the four value fields are read by the URL builder — confirm against `lib/prospects/build-arrival-url.ts` when wiring).
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit**

```bash
git add lib/email/outreach/demo-content.ts lib/email/outreach/demo-content.test.ts
git commit -m "feat(outreach): demo touch content builder (two tracks, computed deltas, no-token display)"
```

---

### Task 6: Render — extend `renderDripEmail` + shell (preheader, stats, prompt buttons, CTA label)

**Files:**
- Modify: `lib/email/outreach/drip-email.ts`, `templates/html/email/email-outreach.html`, `lib/email/templates/token-defaults.ts`
- Test: extend `lib/email/outreach/drip-email.test.ts`

**Interfaces:**
- `DripEmailInput` gains OPTIONAL fields: `preheader?: string`, `stats?: Array<{label: string; value: string}>`, `promptButtons?: Array<{label: string; url: string}>`, `deltaLine?: string | null`, `ctaLabel?: string`, `sources?: string[]`. Legacy callers unchanged.
- `token-defaults.ts`: add `"PREHEADER"` to `TokenKey` + `PREHEADER: ""` to `SWFL_TOKEN_DEFAULTS`. (`CTA_LABEL` already exists with default `"View Listing"` — the drip must now ALWAYS pass it, see below.)

- [ ] **Step 1: Write the failing tests** (add to the existing drip-email test file)

```ts
// appended to lib/email/outreach/drip-email.test.ts
import { renderDripEmail } from "./drip-email";

const demoInput = {
  brand: { primary: "#670038", accent: "#ab8f40", logoUrl: "https://cdn.example.com/logo.png", companyName: "BHHS Florida Realty" },
  kicker: "PARK SHORE · MARKET PULSE",
  title: "Your Park Shore market snapshot",
  chart: { type: "bar" as const, title: "Park Shore — key figures", data: [{ label: "Homes sold", value: 58 }] },
  explanation: "We built this from live Southwest Florida data.",
  ctaUrl: "https://www.swfldatagulf.com/welcome?zip=34103&ref=rid-t1",
  freshness: "Live Southwest Florida data — as of 07/02/2026",
  subject: "Dana, the Park Shore email your clients didn't get this morning",
  preheader: "This is what your clients could get from you every week.",
  stats: [
    { label: "Active listings", value: "214" },
    { label: "Median list price", value: "$1,240,000" },
    { label: "Days on market", value: "63" },
  ],
  promptButtons: [
    { label: "What changed in Park Shore this week?", url: "https://www.swfldatagulf.com/welcome?zip=34103&prompt=x&ref=rid-t1" },
  ],
  deltaLine: "Median sale price: $899,000 → $912,000",
  ctaLabel: "See your whole week — already built",
};

test("demo fields render: preheader, stats, buttons, delta, custom CTA label", async () => {
  const { html } = await renderDripEmail(demoInput);
  expect(html).toContain("This is what your clients could get from you every week.");
  expect(html).toContain("$1,240,000");
  expect(html).toContain("What changed in Park Shore this week?");
  expect(html).toContain("https://www.swfldatagulf.com/welcome?zip=34103&amp;prompt=x&amp;ref=rid-t1");
  expect(html).toContain("Median sale price: $899,000 → $912,000");
  expect(html).toContain("See your whole week — already built");
  expect(html).toContain("#670038"); // brand primary present (Task 7's gate relies on this)
});

test("legacy input renders the legacy CTA label and an empty preheader", async () => {
  const { preheader, stats, promptButtons, deltaLine, ctaLabel, ...legacy } = demoInput;
  const { html } = await renderDripEmail(legacy);
  expect(html).toContain("Create your own report");
  expect(html).not.toContain("View Listing"); // token default must not leak
});
```

- [ ] **Step 2: Run to verify failure** — `bun test lib/email/outreach/drip-email.test.ts` → FAIL.

- [ ] **Step 3: Shell edits** (`templates/html/email/email-outreach.html`):
  - Directly after `<body …>` add the hidden preheader:
    ```html
    <div style="display:none; font-size:1px; color:#f4f5f7; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">{{PREHEADER}}</div>
    ```
  - Replace the hardcoded CTA anchor text `Create your own report &rarr;` with `{{CTA_LABEL}}`.
  - `token-defaults.ts`: add `| "PREHEADER"` to `TokenKey` and `PREHEADER: "",` to the defaults object.

- [ ] **Step 4: `drip-email.ts` edits** — add the optional fields to `DripEmailInput`; in `renderDripEmail`:

```ts
  const tokens: Record<string, string | number> = {
    ...brandTokens,
    KICKER: input.kicker,
    TITLE: input.title,
    CTA_URL: input.ctaUrl,
    CTA_LABEL: input.ctaLabel ?? "Create your own report &rarr;", // ALWAYS passed — the registry default is "View Listing"
    PREHEADER: escapeHtml(input.preheader ?? ""),
    FRESHNESS: input.freshness,
    ...(input.brand.companyName ? { COMPANY_NAME: input.brand.companyName } : {}),
  };
```

and compose the body slot (remember: NO `{{…}}` inside body HTML — the unfilled-token assert runs after body injection; use a literal font stack):

```ts
const FONT = "Arial, Helvetica, sans-serif";

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function statsHtml(stats: NonNullable<DripEmailInput["stats"]>, accent: string): string {
  const cells = stats.map((s) => `
    <td align="center" width="${Math.floor(100 / stats.length)}%" style="padding:10px 6px;">
      <div style="font-family:${FONT}; font-size:20px; font-weight:bold; color:#111827;">${escapeHtml(s.value)}</div>
      <div style="font-family:${FONT}; font-size:12px; color:#6b7280; margin-top:2px;">${escapeHtml(s.label)}</div>
    </td>`).join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
    style="margin:12px 0 4px; border-top:1px solid #e5e7eb; border-bottom:1px solid #e5e7eb;"><tr>${cells}</tr></table>`;
}

function promptButtonsHtml(buttons: NonNullable<DripEmailInput["promptButtons"]>, accent: string): string {
  const rows = buttons.map((b) => `
    <tr><td align="center" style="padding:4px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td align="center" style="border:2px solid ${accent}; border-radius:8px;">
          <a href="${escapeAttr(b.url)}" style="display:block; padding:11px 16px; font-family:${FONT}; font-size:14px; font-weight:bold; color:${accent}; text-decoration:none;">${escapeHtml(b.label)}</a>
        </td></tr></table>
    </td></tr>`).join("");
  return `<div style="font-family:${FONT}; font-size:12px; letter-spacing:1px; text-transform:uppercase; color:#6b7280; margin:16px 0 6px;">Ask the AI — it answers live</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table>`;
}
```

Body assembly inside `renderDripEmail` (the accent for section chrome falls back to the shell's SWFL accent behavior — use `input.brand.accent ?? "#3DC9C0"` is WRONG here; use the same resolution the tokens use: `input.brand.accent` when present, else omit styling color and let `#111827` text carry it — concretely pass `input.brand.accent ?? SWFL_THEME.accent` imported from `@/scripts/email/types`, the same source token-defaults uses):

```ts
  const accent = input.brand.accent ?? SWFL_THEME.accent;
  const body = [
    input.explanation,
    input.deltaLine ? `<p style="font-family:${FONT}; font-size:15px; line-height:1.55; color:#374151; margin:10px 0 0;"><strong>${escapeHtml(input.deltaLine)}</strong></p>` : "",
    input.stats?.length ? statsHtml(input.stats, accent) : "",
    input.promptButtons?.length ? promptButtonsHtml(input.promptButtons, accent) : "",
    input.sources?.length
      ? `<p style="font-family:${FONT}; font-size:11px; line-height:1.5; color:#9ca3af; margin:14px 0 0;">Sources: ${input.sources.map(escapeHtml).join(" &middot; ")}</p>`
      : "",
  ].filter(Boolean).join("");

  const rendered = await renderEmailTemplate("outreach", tokens, {
    chart: chartHtml,
    body,
  });
```

- [ ] **Step 5: Run tests** — `bun test lib/email/outreach/drip-email.test.ts` AND the full `bun test lib/email` (other templates render through the same token defaults; the new `PREHEADER` default must not break any). Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/email/outreach/drip-email.ts templates/html/email/email-outreach.html lib/email/templates/token-defaults.ts lib/email/outreach/drip-email.test.ts
git commit -m "feat(outreach): demo email sections — preheader, cited stats row, AI prompt buttons, CTA label"
```

---

### Task 7: `demo-gates.ts` — mechanical pre-send gates

**Files:**
- Create: `lib/email/outreach/demo-gates.ts`
- Test: `lib/email/outreach/demo-gates.test.ts`

**Interfaces:**
- Consumes: `collectAllowedUrls`, `lintCompiledHtml` (`lib/deliverable/url-lint.ts` — consume only), `DemoTouchContent` (Task 5).
- Produces (used by Task 12): 

```ts
export interface GateResult { ok: boolean; failures: string[] }
export function brandHexGate(html: string, brand: { primary?: string|null; accent?: string|null }): GateResult
export async function logoGate(logoUrl: string | null | undefined, fetchImpl?: typeof fetch): Promise<GateResult>
export function urlGate(html: string, content: DemoTouchContent, extraRoots?: unknown[]): GateResult
export function anchoredNumbersGate(html: string, anchors: ReadonlyArray<string | number>): GateResult
export async function preSendGates(html: string, content: DemoTouchContent,
  brand: { primary?: string|null; accent?: string|null; logoUrl?: string|null },
  opts?: { fetchImpl?: typeof fetch; extraAnchors?: Array<string|number> }): Promise<GateResult>
```

Gate semantics (spec §8, all abort = the recipient is SKIPPED and reported, never "fixed" silently):
1. `brandHexGate` — brand primary AND accent (each, when defined on the row) appear case-insensitively in the HTML; a demo recipient with NO primary at all is a failure (`"no brand primary on row"`) — the demo's whole pitch is their brand.
2. `logoGate` — null/undefined → fail; otherwise `fetchImpl(logoUrl, {method:"GET"})` must return `ok` with `content-type` starting `image/`.
3. `urlGate` — `lintCompiledHtml(html, collectAllowedUrls(content, ...extraRoots))` — deep-links with `prompt`/`ref` params are platform URLs (swfldatagulf.com is host-allowed by the lint) so they pass; any OTHER minted URL fails.
4. `anchoredNumbersGate` — strip `<style>` blocks and all tags/attributes to visible text; drop URLs; extract digit tokens of 2+ digits (`/\d[\d,.$]{1,}/g` normalized by removing `$ , %`); each must appear among normalized anchors (same normalization). Copy numbers like "9 AM" are single-digit → exempt by the 2+ rule.

- [ ] **Step 1: Write failing tests** — happy path passes all 4; missing accent hex fails gate 1; 404 logo (injected fetch) fails gate 2; a foreign `<a href="https://evil.example.com">` fails gate 3; an HTML edit inserting `$999,999` (not in anchors) fails gate 4; style-attribute numbers (`font-size:15px`, hex colors) do NOT false-positive.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** Keep every gate pure/DI (fetch injected). `preSendGates` runs all four, concatenates failures.
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit**

```bash
git add lib/email/outreach/demo-gates.ts lib/email/outreach/demo-gates.test.ts
git commit -m "feat(outreach): mechanical pre-send gates (brand hex, logo 200, URL allowlist, anchored numbers)"
```

---

### Task 8: Distinct `complained` event (lifecycle + metrics view)

Today `mapResendOutbound` logs `email.complained` as event `"unsubscribed"` — the cycle-2 gate (ZERO complaints) can't be read. Make `complained` first-class; suppression behavior unchanged.

**Files:**
- Modify: `lib/email/outreach/lifecycle.ts`, `docs/sql/20260620_outreach_metrics_view.sql` (view gets a `complaints` column — `create or replace`, additive)
- Test: `lib/email/outreach/lifecycle.test.ts` (update the pinned mapping)

- [ ] **Step 1: Update the failing test** — change the `email.complained` expectation to `{ event: "complained", suppressTo: "unsubscribed" }`; add `"complained"` to any event-union assertions. Run: FAIL.
- [ ] **Step 2: Implement** — `OutreachEvent` union gains `"complained"`; `mapResendOutbound` case `email.complained` returns `{ event: "complained", suppressTo: "unsubscribed" }`. Grep for other spots that pin the old mapping (`Grep "unsubscribed" lib/email/outreach app/api/webhooks`) — the webhook route logs whatever `action.event` says, so no route change needed for logging.
- [ ] **Step 3: View update** — re-run the amended `20260620_outreach_metrics_view.sql` (add `count(*) filter (where e.event = 'complained') as complaints`; keep the existing columns) via Bun.SQL. Verify: `select * from outreach_campaign_metrics limit 1` has the new column.
- [ ] **Step 4: Run** `bun test lib/email/outreach` + `bun test app/api/webhooks` (if a route test exists there, it may pin the mapping — update it in the same commit). PASS.
- [ ] **Step 5: Commit**

```bash
git add lib/email/outreach/lifecycle.ts lib/email/outreach/lifecycle.test.ts docs/sql/20260620_outreach_metrics_view.sql
git commit -m "feat(outreach): complaints become a first-class event (cycle-2 zero-complaint gate readable)"
```

---

### Task 9: Arrival `prompt` + `ref` — URL builder, /welcome, chat seeding, arrived event ⚠ RULE-1 diff-review

**Files:**
- Modify: `lib/prospects/build-arrival-url.ts` (+ its test), `app/welcome/page.tsx`, `app/welcome/WelcomeChat.tsx`, `app/welcome/_components/ConversationalChat.tsx`
- Create: `lib/prospects/arrival-event.ts` (+ test)

**Interfaces:**
- `buildArrivalUrl` input gains `prompt?: string` (trimmed, ≤200 chars — longer is dropped, not truncated silently: drop + the caller's gate report notes it) and `ref?: string` (must match `REF_RE` below; invalid dropped).
- `export const REF_RE = /^[0-9a-f-]{36}-(t[1-4]|trial|reengage)$/i` (export from `build-arrival-url.ts`; Tasks 10, 12 consume).
- `ConversationalChat` gains prop `initialPrompt?: string`.
- `arrival-event.ts`: `export function parseArrivalRef(ref: string | undefined): { rid: string; touch: string } | null` (pure) — the page uses it, then fire-and-forgets an `outreach_events` insert `{recipient_id: rid, event: "arrived", meta: {ref}}`.

- [ ] **Step 1: Failing tests** — `build-arrival-url.test.ts`: prompt+ref emitted URL-encoded; >200-char prompt dropped; malformed ref dropped; existing cases untouched. `arrival-event.test.ts`: `parseArrivalRef` round-trips a valid ref, rejects garbage.
- [ ] **Step 2: Implement `buildArrivalUrl`** — two `params.set` calls behind the validators, mirroring the existing zip/hex pattern in the file.
- [ ] **Step 3: `/welcome` page** — parse `prompt` (via `first`, trim, ≤200, strip control chars) and `ref` (via `REF_RE`); when `ref` parses, `void logArrival(rid, ref)` — `logArrival` lives in `lib/prospects/arrival-event.ts` and uses THE SAME service-role Supabase helper `app/api/webhooks/resend/route.ts` uses for its `outreach_events` insert (open that route first and import identically; do not mint a new client pattern). Errors swallowed — arrival logging must never break the page. Pass `prompt` down: `<WelcomeChat demo={demo} initialPrompt={prompt} />`.
- [ ] **Step 4: Chat seeding** — `WelcomeChat` forwards the prop; `ConversationalChat` fires it ONCE with the `ClaimOnLogin` ref-guard precedent (this repo's `react-hooks/set-state-in-effect` is a hard error — the one-shot `useRef` + `useEffect` calling the existing `ask()` matches the established `ClaimOnLogin` pattern and does not set state directly in the effect body):

```tsx
const seeded = useRef(false);
useEffect(() => {
  if (!initialPrompt || seeded.current || busy) return;
  seeded.current = true;
  ask(initialPrompt);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [initialPrompt]);
```

- [ ] **Step 5: Verify** — `bun test lib/prospects` PASS; `bunx eslint app/welcome lib/prospects` clean; manual smoke `bun run dev` → `/welcome?zip=33931&prompt=What+changed+this+week%3F` auto-asks and streams an answer.
- [ ] **Step 6: Commit (⚠ hold for operator diff-review — live public page)**

```bash
git add lib/prospects/build-arrival-url.ts lib/prospects/build-arrival-url.test.ts lib/prospects/arrival-event.ts lib/prospects/arrival-event.test.ts app/welcome/page.tsx app/welcome/WelcomeChat.tsx app/welcome/_components/ConversationalChat.tsx
git commit -m "feat(funnel): arrival prompt seeding + ref click-attribution (arrived event)"
```

---

### Task 10: Claimed attribution → `converted` ⚠ RULE-1 diff-review (live claim path)

**Files:**
- Modify: `app/welcome/_components/OpenProjectCta.tsx` (carry `ref` in the POST body), `app/api/prospect/open-project/route.ts`, `lib/prospects/open-project.ts` (+ test), `lib/claim/claim-store.ts` (+ test), `app/api/claim/route.ts`

**Interfaces:**
- `/api/prospect/open-project` body gains optional `ref` (validated by `REF_RE`; invalid → ignored, not 400).
- `mintClaimToken(items, title?, opts?: { brand?; seed?; ref?: string })` — persists to the Task-1 `claim_tokens.ref` column; `consumeClaimToken` returns it.
- `/api/claim` winner path: when `token.ref` parses via `parseArrivalRef`, insert `outreach_events {recipient_id, event: "claimed", meta: {ref}}` AND `update outreach_recipients set stage='converted', next_send_at=null where id=<rid> and track is not null` — both best-effort (failure logged, never blocks the claim).

- [ ] **Step 1: Failing tests** — `claim-store.test.ts`: ref round-trips mint→consume (mirror the existing brand/seed round-trip test); `open-project.test.ts`: plan carries ref through to the token input.
- [ ] **Step 2: Implement** the thread: page already has `ref` (Task 9) → `OpenProjectCta` prop → POST body → route validates → `mintClaimToken` opts → `/api/claim` winner block (place it right after the existing best-effort brand persistence — same error-swallowing style).
- [ ] **Step 3: Run** `bun test lib/claim lib/prospects app/api/claim` → PASS.
- [ ] **Step 4: Commit (⚠ hold for operator diff-review — live claim/auth path)**

```bash
git add app/welcome/_components/OpenProjectCta.tsx app/api/prospect/open-project/route.ts lib/prospects/open-project.ts lib/prospects/open-project.test.ts lib/claim/claim-store.ts lib/claim/claim-store.test.ts app/api/claim/route.ts
git commit -m "feat(funnel): claim carries arrival ref — claimed event + demo stage converted"
```

---

### Task 11: Webhook demo stage transitions ⚠ RULE-1 diff-review (live webhook)

**Files:**
- Modify: `app/api/webhooks/resend/route.ts`
- Test: extend the route's existing test file (locate with `Glob app/api/webhooks/resend/*test*`; if route tests don't exist, the pure logic is already covered by `demo-cadence.test.ts` and this task adds only the thin apply block — then verify by the manual DRY smoke in Task 12).

- [ ] **Step 1: Implement** — directly after the existing `suppressTo` status update block, add:

```ts
// Demo cadence: the same rid drives stage transitions (click earns the daily trial;
// complaint/bounce/unsub retire; legacy drip rows have track NULL and skip this).
const { data: demoRec } = await db
  .from("outreach_recipients")
  .select("stage, track")
  .eq("id", action.rid)
  .maybeSingle();
if (demoRec?.track && demoRec.stage) {
  const evt =
    action.event === "clicked" || action.event === "bounced" ||
    action.event === "complained" || action.event === "unsubscribed"
      ? action.event
      : null;
  const change = evt ? onDemoEvent(demoRec.stage as DemoStage, evt, new Date()) : null;
  if (change) {
    await db
      .from("outreach_recipients")
      .update({ stage: change.stage, next_send_at: change.next_send_at, updated_at: new Date().toISOString() })
      .eq("id", action.rid);
  }
}
```

(`db` = whatever the route already calls its service client; import `onDemoEvent`, `DemoStage` from `@/lib/email/outreach/demo-cadence`.)

- [ ] **Step 2: Test** — if the route has a test harness, add: clicked webhook on a `track='agent', stage='cold_t2'` fixture row → stage `trial_active` + next_send_at at 13:00 UTC; complained → stage `retired` + status `unsubscribed`. Run `bun test app/api/webhooks` → PASS.
- [ ] **Step 3: Commit (⚠ hold for operator diff-review — live webhook)**

```bash
git add app/api/webhooks/resend/route.ts
git commit -m "feat(outreach): webhook applies demo cadence stage transitions off rid events"
```

---

### Task 12: Targets extension + enroll script (brand overrides, SVG logo rasterize)

**Files:**
- Modify: `lib/email/outreach/targets.ts` (+ existing test file)
- Create: `lib/email/outreach/logo-raster.ts` (+ test), `scripts/email/outreach-demo-enroll.mts`

**Interfaces:**
- `OutreachTarget` gains optional `track?: "agent" | "broker"`, `primary?: string`, `accent?: string`, `logo?: string`. `KNOWN_COLS` gains `track, primary, accent, logo`. Validation: bad track/hex/logo-URL → per-line error (same error-report pattern); `track` defaults `"agent"` when the column is absent entirely (header-less legacy CSVs keep parsing 4-column).
- `logo-raster.ts`: `export async function ensureRasterLogo(logoUrl: string, key: string, deps?: { fetchImpl?: typeof fetch }): Promise<string>` — non-SVG URLs pass through unchanged; `.svg`/`image/svg+xml` responses are fetched → `svgToPng(svg, {scale: 2, background: "#ffffff"})` → `hostEmailMedia(`logos/${key}.png`, buf, "image/png")` → hosted URL. Throws on fetch failure (enroll reports + skips the row — a broken logo would fail Task 7's gate anyway; fail fast at enroll).
- Enroll CLI: `bun scripts/email/outreach-demo-enroll.mts --csv <path> --campaign <id>` env `DRY_RUN` (default true — parse/enrich/report only, no DB writes).

Enroll behavior per CSV row: brand = CSV overrides (`primary`/`accent`/`logo`) merged over `enrichBrand(domain)` (CSV wins field-wise); effective confidence = 1 when ALL of primary+accent+logo come from CSV, else scrape confidence. Effective confidence < 0.5 → row SKIPPED with `REVIEW` flag in the run report (never house-branded — Global Constraints). Logo through `ensureRasterLogo(logo, domain)`. Insert row: `{campaign_id, email, name, domain, zip, brand: {primary, accent: <secondary/accent>, logoUrl, companyName}, brand_source, brand_confidence, track, stage: "cold_t1", subject_variant: index-within-track % 2 ? "b" : "a", status: "active", next_send_at: null, trial_sends: 0}` — upsert on the existing `(campaign_id, lower(email))` unique index. Writes a run report (JSON) under `outreach-runs/<stamp>/enroll-report.json` mirroring `outreach-campaign.mts`'s pattern.

- [ ] **Step 1: Failing tests** — targets: 8-column header CSV parses track/hex/logo; invalid track errors; legacy 4-column CSV unchanged. logo-raster: png URL passes through untouched; svg content-type triggers rasterize+host (inject fetch + spy the `hostEmailMedia` seam via DI — add `deps.host?: typeof hostEmailMedia`).
- [ ] **Step 2: Run to verify failure.** 
- [ ] **Step 3: Implement** targets extension + `logo-raster.ts` + the enroll script (model env/arg/report handling on `scripts/email/outreach-campaign.mts` — read it first; reuse its Supabase client wiring verbatim).
- [ ] **Step 4: Run** `bun test lib/email/outreach` → PASS. DRY smoke: a 2-row fixture CSV → report lists both rows with resolved brands, no DB writes.
- [ ] **Step 5: Commit**

```bash
git add lib/email/outreach/targets.ts lib/email/outreach/targets.test.ts lib/email/outreach/logo-raster.ts lib/email/outreach/logo-raster.test.ts scripts/email/outreach-demo-enroll.mts
git commit -m "feat(outreach): demo enroll — track/brand-override CSV, SVG logo rasterize, variant assignment"
```

---

### Task 13: The runner + GHA wrapper + scorecard

**Files:**
- Create: `scripts/email/outreach-demo-run.mts`, `scripts/email/outreach-demo-scorecard.mts`, `.github/workflows/outreach-demo.yml`
- Test: pure pieces are already covered (Tasks 2–7); the runner is a thin adapter — verify by DRY runs.

**Interfaces:**
- Consumes everything: `touchForStage`/`afterSend`/`retireIfStale`/`shouldSend`, `buildDemoTouch`, `renderDripEmail`, `preSendGates`, `buildBatchMessages`/`sendBatches`, `appendPostalAddress` (via renderDripEmail's `postalAddress`), preview pattern.
- CLI: `bun scripts/email/outreach-demo-run.mts --campaign <id>` · env: `DRY_RUN` (default true), `OUTREACH_DEMO_APPROVED` (required `=1` for live), `OUTREACH_POSTAL_ADDRESS`, `OUTREACH_FROM_EMAIL`/`OUTREACH_FROM_NAME`, `OUTREACH_DEMO_BATCH_LIMIT` (default 30), `SITE_ORIGIN`.

- [ ] **Step 0: RULE 0.4 — re-verify the Resend surfaces via crawl4ai before wiring** (batch send limits/shape, webhook event type names incl. `email.complained`, `scheduledAt` availability on batch). Findings → `SESSION_LOG.md`. The engine's existing seams are live-proven, so expect confirmation — but verbatim event names gate the webhook task above; if drift is found, reconcile Task 8/11 code BEFORE first live send. crawl4ai interpreter: `C:\Users\ethan\crawl4ai-venv\Scripts\python.exe`. Nothing crawl4ai-produced gets committed.
- [ ] **Step 1: Read `scripts/email/outreach-drip-run.mts` end-to-end** — the runner below mirrors its structure (env block, Supabase client, `getMarketingResend`, `outreachFrom`, postal refusal, summary logging). Reconcile every seam name against it before writing.
- [ ] **Step 2: Implement the runner.** Flow:
  1. Select due: `campaign_id` match, `track not is null`, `status = 'active'`, `stage in (cold_t1..cold_t4, trial_active, cooldown)`, `next_send_at` null-or-due, order `next_send_at asc nullsFirst`, `limit BATCH_LIMIT`; filter `shouldSend` + stale-reengage sweep (`retireIfStale` over `reengaged` rows selected separately → update to `retired`, report count).
  2. Per recipient: `touch = touchForStage(stage)`; `content = await buildDemoTouch(rec, touch, SITE_ORIGIN)`; null → report `out_of_scope`, skip; `content.chart === null` → report `no_chart`, skip (`DripEmailInput.chart` is required — an honest demo needs the chart; a chartless send is never improvised). Render via `renderDripEmail({brand: rec.brand, kicker, title, chart, explanation: bodyHtml, deltaLine, stats, promptButtons, preheader, ctaLabel, ctaUrl, sources, freshness: freshnessLine, subject, postalAddress})`.
  3. Gates: `await preSendGates(html, content, rec.brand)` — failures → report + skip (NEVER auto-fix).
  4. ALWAYS write `outreach-runs/<stamp>/<email>.html` + a `run-report.json` (recipient, touch, stage, subject, gate results, would-send). **No preview, no send — the preview write comes before the live block unconditionally.**
  5. `DRY_RUN` (default) stops here with a would-send summary.
  6. Live block — refuse loudly unless `OUTREACH_DEMO_APPROVED === "1"` AND postal AND from resolve (exit 1, mirroring the drip's postal refusal): `buildBatchMessages` + `sendBatches` (rid = recipient id, exactly as the drip runner does) → per sent recipient: T1 → `update {snapshot: content.snapshot}`; then `afterSend` cursor → `update {stage, next_send_at, trial_sends, updated_at}`; insert `outreach_events {recipient_id, event: 'sent', campaign_id}`.
- [ ] **Step 3: GHA wrapper `.github/workflows/outreach-demo.yml`** — copy `outreach-drip.yml`'s shape: `workflow_dispatch` only; the daily cron line PRESENT BUT COMMENTED (`# - cron: "0 13 * * *"` — flipped only after cycle-1's zero-complaint gate); same env plumbing + `OUTREACH_DEMO_APPROVED` deliberately NOT provided by the workflow (live sends stay operator-local for cycle 1); `DRY_RUN: "true"` hardcoded for dispatch runs.
- [ ] **Step 4: Scorecard** — `scripts/email/outreach-demo-scorecard.mts`: `select * from outreach_demo_funnel where campaign_id = $1` printed as aligned rows per track/variant + a hard verdict line: `complaints = 0 → cycle-2 gate OPEN` / `complaints > 0 → cycle-2 gate CLOSED`.
- [ ] **Step 5: Verify** — `bun test lib/email scripts/email` all green; `bunx next build` clean (app-route tasks 9–11 compile); DRY smoke end-to-end: enroll 2 fixture rows (operator's own addresses) → runner DRY → previews render in a browser, gates green, run-report sane.
- [ ] **Step 6: Commit**

```bash
git add scripts/email/outreach-demo-run.mts scripts/email/outreach-demo-scorecard.mts .github/workflows/outreach-demo.yml
git commit -m "feat(outreach): demo cadence runner (preview-first, gate-enforced, approval-locked) + scorecard"
```

- [ ] **Step 7: Wrap-up (same session as the last commit)** — SESSION_LOG.md entry (what shipped, DRY evidence, what's operator-gated); `_AUDIT_AND_ROADMAP/build-queue.md` sync; do NOT push — present the commit list and flag Tasks 9/10/11 for diff-review (RULE 1 + memory `feedback_no-autonomous-push`). `funnel_demo_email_live_verify` stays OPEN — it closes only on operator-run live evidence (cycle-1 send + a real prospect click-through with the seeded prompt answering live).

---

## Task-order constraint

Task 9 (arrival params) must land before Task 12/13 produce non-DRY output, because `buildDemoTouch` (Task 5) emits `prompt`/`ref` through `buildArrivalUrl`. Tasks 1–8 are order-free among themselves except 4→5 (helper before consumer) and 2→3 (types). Recommended execution order: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13.

## Explicitly out of scope (spec §1)

Roster crawler to complete the agent list · MLS/RESO feed integration (sales-cycle formalization AFTER a broker signs — the broker email only states the coexist/plug-in position) · cockpit changes · paid list vendors · fixing the legacy drip's raw-token freshness line (pre-existing; note for a follow-up check).

## Success criteria (spec §10 → verifiable artifacts)

1. Two rendered demo emails (agent + broker) in real brokerage brands pass all 4 gates → `outreach-runs/<stamp>/*.html` + operator eyeball.
2. First live cycle from the separate domain, zero complaints → `outreach_demo_funnel.complaints = 0`.
3. ≥1 prospect clicks → branded arrival with seeded prompt answering live → `arrived` event present.
4. Cadence advances/suppresses off real webhook events → `outreach_recipients.stage` history + `outreach_events` rows.
5. Operator closes `funnel_demo_email_live_verify` on prod evidence.
