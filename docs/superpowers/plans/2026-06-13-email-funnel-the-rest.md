# Email funnel — the rest (lean, VERIFIED)

> **State map VERIFIED against code on 2026-06-13** — every BUILT row and every gap below was checked at file:line in this session (not trusted from the prior plan). **One correction the prior plan got wrong:** the "THIS SLICE (shipped 2026-06-13)" it claimed is **NOT in the tree** — `grep -r scope_kind|scope_value|20260613_email_schedule_scope` returns zero matches; `schedule-command.ts` / `ScheduleRow` carry no scope fields; no scope migration exists. That work is **specified, not shipped** (see SCOPE SLICE below). The send rails ARE done; what is missing is a reason to pay.

## BUILT — DO NOT REBUILD

| Surface | File | What it is |
|---|---|---|
| Cron worker core | `lib/email/scheduler.ts` | `processSchedule` / `processBatch` / `reapOrphans` / `ScheduleRow` — pure DI core, usage-gate=skip, per-row isolation, re-arm in `finally`, crash-orphan reaper |
| Worker runner | `scripts/email/run-schedules.mts` | Bun adapter: builds real seams, claims batch, loops core. `buildContent(_row)` at L223 ignores the row (gap 2) |
| Reusable claim lock | `docs/sql/20260612_email_schedule_claim_fn.sql` | `claim_due_email_schedules` — `FOR UPDATE SKIP LOCKED` + park-on-claim, service-role only |
| Sender gating | `lib/email/sender-config.ts` `resolveSender` | tenant `from_email` only when `domain_verified`; reply_to always carried |
| Usage meter + billing | `lib/email/usage.ts` + `app/billing/page.tsx` | `checkUsageLimit` / `recordEmailSent` (fail-open skip); billing page |
| AI schedule commands | `lib/email/schedule-command.ts` | forced-tool parse + defense-in-depth validate + confirm summary (6 actions, NO scope params yet) |
| Broadcast send | `app/api/email/broadcast/route.ts` | the real Resend send rail (overrides, reply_to, unsubscribe-token 400 gate) |
| Prospect arrival | `lib/prospects/*` (`enrich-brand`, `build-arrival-url`) + `app/api/welcome/chat/route.ts` | branded arrival URL + un-grounded welcome chat that leads with the auto-email-to-clients hook |
| THE MOAT | `lib/deliverable/assemble.ts` | the one forced-tool, linted narrative build path — the cited deliverable engine |
| Product schema | `docs/sql/20260612_email_product.sql` | `email_schedules` (+ contacts/audiences/usage/sender_config), `auth.uid()=user_id` RLS |
| Cron wrapper | `.github/workflows/email-scheduler.yml` | scheduler GHA — **cron commented out**, `workflow_dispatch` open for DRY_RUN |

## THE 7 REAL GAPS (verified)

1. **No scope on `email_schedules`** — table stops at `template_id` (`20260612_email_product.sql` L21–36); no scope_kind / scope_value / topic columns.
2. **Global digest to every tenant** — `run-schedules.mts:223` `async buildContent(_row)` ignores the row and returns one shared lake snapshot; every tenant gets the identical email.
3. **`SCHEDULE_COMMAND_TOOL` has no scope params** — `schedule-command.ts` L33–64: cadence / hour / audience / template only; no way for a tenant to say "Bonita / 34134 / flood."
4. **Zero inbound/webhook routes** — `app/api/` has no `email/inbound`, no Resend-Inbound handler, no reply route.
5. **No `/welcome` free build** — `app/welcome/page.tsx` chat is a stub; prompts link to `/pricing`; no free cited deliverable on arrival.
6. **Zero Stripe code in repo** — every `stripe` hit is docs/markdown; no route, SDK, or webhook in `app/api/`.
7. **Go-live not flipped** — cron commented (`email-scheduler.yml` L12–13); `DIGEST_BROADCAST_SECRET` unset → worker exits 1 on a real run.

## CRITICAL PATH

1. **Scope → grounded-body seam** (gaps 1 + 3 → 2) FIRST — the differentiator. No paid feature without it.
2. **Stripe** second (gap 6) — the actual charge.
3. **Flip the global digest live** (gap 7) third / parallel — proves the send rails end-to-end.

> **Operator-call inversion:** ship Stripe + go-live the *global* digest first for a faster revenue signal — weaker wedge (everyone gets the same email) but real money sooner. The grounded-scope seam is the stronger moat; sequence is the operator's call.

## LANDMINES (in no tracker)

- **CAN-SPAM legal-initiator** — the email is sent on the *agent's* behalf; the footer physical address must be the **agent's**, not ours. This IS the build-queue "CAN-SPAM address swap" hard gate. Don't ship bulk with our address.
- **Shared-domain reputation collapse** — bulk sends from one shared domain torch deliverability for all tenants. Gate bulk-CSV sends behind own-domain verify.
- **Freshness gate** — send only when the brain `freshness_token` has advanced; never re-blast a stale snapshot.
- **Scope-dedupe cost control** — one grounded build per *unique* scope, branded N ways (don't pay for N identical builds). Add a builds meter.
- **Inbound plus-address routing token** — `reply+{scheduleId|token}@…` so a reply maps back to its schedule/tenant.

## SCOPE SLICE — specified, NOT yet shipped

> Additive, cron-paused-worker design so it carries **zero live-send risk** when built. Nothing below is in the tree as of 2026-06-13.

- **Migration** `docs/sql/20260613_email_schedule_scope.sql` — 3 nullable cols (`scope_kind`, `scope_value`, `topic`) + re-emit grant + `NOTIFY pgrst`.
- **NL scope params** in `schedule-command.ts` — `scope_kind` enum `zip | place | county`, `scope_value` + `topic` free-text; all normalized lowercase + trimmed.
- **`ScheduleRow`** gains optional scope fields.
- **Create-insert route** persists scope.
- **Bun tests** for parse + validate.

### LOCKED DESIGN DECISIONS

- **(a)** `scope_kind IS NULL AND topic IS NULL` ⇒ today's global digest (no `'general'` magic value).
- **(b)** store `place` as-said; ZIP expansion deferred to build-time.
- **(c)** `topic` is free-text, lowercase, **no enum** — consumer owns topic→brain-slug mapping.
- **(d)** canonical form = **lowercase + trimmed** — the parser↔consumer contract.

## DEFERRED (operator-triggered; vendor / live-path — specified, not built blind)

| Item | Gap | Blocker |
|---|---|---|
| `buildContent` grounded-scoped wiring + scope-dedupe + freshness gate | 2 | needs claim-RPC to return scope |
| Inbound reply routing | 4 | needs **LIVE Resend-Inbound vendor verify** |
| Stripe checkout + webhook | 6 | vendor re-verify in-session |
| Go-live flip (uncomment cron, set `DIGEST_BROADCAST_SECRET`) | 7 | operator call |
