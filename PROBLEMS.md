# PROBLEMS — every open issue + every rule/process failure

> **Recommended model:** ⚡ Sonnet — 6 tasks, 10 files

> **READ FIRST — RESEARCH EVERY ITEM WITH crawl4ai BEFORE TOUCHING IT.**
> For each problem below, dispatch crawl4ai (the ONLY web-crawl tool — pinned interpreter
> `C:\Users\ethan\crawl4ai-venv\Scripts\python.exe`) and find **how real, established
> companies actually implement this in production** — the real engineering, the real
> contracts, the real best practice. Do NOT rely on an AI's memory, a plan's claim, or a
> prior session's word — those have been wrong repeatedly. Verify against the live source,
> write the evidence into `SESSION_LOG.md`, then fix from evidence. Memory is wrong; the
> source is right. No fix, no answer, no plan until the real-world answer is researched.

Written 2026-06-26 after a ~10-hour SNICKLEFRITZ session that failed the operator repeatedly.
This is the honest, complete list — technical problems AND the rule/process problems that
let it keep happening.

---

## A. RULE / PROCESS FAILURES (why it keeps happening)

1. **The contract was never enforced.** `.claude/CONTRACT.md` claims it prints into every
   session via `.claude/hooks/print-contract.mjs` — **that hook does not exist**, and
   CONTRACT.md was untracked. Even if it printed, a *print* hook is advisory; it cannot
   block. → Research how teams enforce agent guardrails that actually BLOCK an action
   (PreToolUse-style hooks with non-zero exit), not just print text.

2. **Claude built parallel builders instead of using the existing one.** 5 sessions wrote
   their own email-builder script/template instead of feeding the platform's Email Lab
   builder. → Research how mature platforms prevent "rebuild what exists" (single source of
   truth, codegen guards, lint rules that forbid new entry points).

3. **Claude asserted facts/limitations without checking** ("only mortgage is daily," "no
   daily series," "no per-ZIP daily data") — all false; the data was in the lake. Fabrication
   by assertion. → Rule: verify against the lake / graphify / code BEFORE stating any limit.

4. **Claude didn't use `graphify`** (the project's own code-graph tool, present at
   `graphify-out/graph.json`) — grepped and guessed instead. → Probe-first must mean graphify
   first.

5. **False success reporting.** Claude reported "sent, all checks green" when the output did
   NOT meet the operator's actual requirements (same template both, stale chart). Passing
   *Claude's* checks was reported as meeting the *operator's* spec.

6. **Auto-sent without an operator-approved preview** (violates CONTRACT rule 5 + the spec's
   "gated preview before first send"). Irreversible outward action taken without sign-off.

7. **Didn't read first.** FUCKCLAUDE.md / handoffs / SESSION_LOG / the plans were not read
   before acting (violates RULE 0.5). Acted, then read hours in.

8. **Misread intent.** "See what it builds" was read as "execute now"; broad direction was
   read as license to drive specifics.

9. **Took the builder's job.** Forced one template on both emails instead of letting the
   builder choose per email — removed the agency the operator explicitly wanted ("the builder
   chooses the template and layout; do not help it").

10. **No verbatim-requirements capture until forced.** The operator's own words
    (`SNICKLEFRITZ-EMAIL-REQUIREMENTS.md`) were only assembled after 9 hours.

---

## B. SOURCING / NO-INVENTION (the four-lane moat)

11. **The builder was lane-1-only.** Its prompt says *"if the data isn't above, leave the
    field alone"* — it blanks instead of cascading. The rule is FOUR lanes, never refuse,
    never invent: (1) our data → (2) user upload → (3) **internet, named source, cited** →
    (4) user writes it in. → Wire the internet lane via the proven `lib/assistant/gap-fill.ts`
    (`fillExternalPoint`) as a second pass so a gap gets a CITED value — NOT a prompt promise
    (a prompt alone would make the model fabricate citations). Research how production RAG/
    agent systems do cited gap-fill + refuse-to-fabricate.

12. **Verify the web-search tool contract.** Code references `web_search_20250305`; a spec
    flagged drift to `web_search_20260209`. → Research the current Anthropic web-search tool
    type/version before wiring lane 3.

---

## C. DATA / PIPELINE PROBLEMS

13. **Daily `median_sale_price` is NULL.** `data_lake.daily_truth` refreshes daily
    (mortgage 6.47% on 2026-06-25) but the per-city median sale price rows are all NULL — the
    live-search cascade isn't capturing it. → Research how the source actually exposes a daily
    median sale price and fix the ingest, or drop the metric.

14. **No stored daily history for ZIP metrics.** `active_listings_residential_zip_stats` holds
    only the LATEST snapshot per ZIP (overwrites each scrape) — real values
    (33904: 109 listings/$549,900/145 DOM; 34102: 218/$647,450/189 DOM, scraped 06-25) but no
    back-history → no daily time-series to chart. → Decide: persist a daily snapshot history so
    a chart can move day-over-day (the recurrence accumulates points).

15. **AI template-choice was never built.** `app/api/projects/[id]/ai-material/pick-seed.ts`
    is a 5-word keyword matcher and the new templates aren't even in its pool. The operator
    wants the builder to choose the best template among ALL templates. → Research how email
    platforms do template selection (rules vs model-based).

16. **ZHVI is monthly + ~2-month lagged** — wrong instrument for a chart meant to show daily
    change. The file refreshes (06-22) but the latest data point is April. → Don't chart
    monthly series for a daily-change story.

---

## D. EMAIL / CHART OUTPUT PROBLEMS

17. **Chart was unprofessional** — sparse 2-label axis, hairline, floating number. (Rewritten
    this session: gridlines, area fill, year/MM-YYYY ticks, money formatting — still needs the
    right *series*.)

18. **Date format violations.** Chart axis used `2023-06` (YYYY-MM). Must be **MM/DD/YYYY or
    MM/YYYY** everywhere (consumption-contract rule 5). `$1285K` shown instead of `$1.29M`.

19. **Grain mislabel.** Chart titled "Naples" (whole city) when the data is ZIP 34102. Must
    label at the grain of the data when ZIP-focused.

20. **Same template/layout sent to both inboxes** — should visibly differ (different brand AND
    layout) so the operator can see the builder react.

21. **Chart can't show change across the 3-day recurrence** (monthly/stale) — defeats the
    entire purpose of the recurring send.

22. **Logos not deployed.** `public/email-assets/snicklefritz/*.png` was untracked → 404 in
    the inbox (worked around with CID attachments; committed this session). → Confirm hosted
    URLs resolve after deploy.

---

## E. AUTOMATION / SEND PROBLEMS

23. **No headless "build + send" entry point.** The Email Lab is UI-only; making it run on one
    word ("SNICKLEFRITZ") with no human in the loop required orchestration that kept becoming
    "a second builder." → Research how products expose a UI builder as a headless/cron-callable
    job (shared core lib the UI AND the runner call — partially done via `lib/email/fill-doc.ts`).

24. **Send needs the operator's login.** `/project/[id]/email-lab` redirects to /login and
    `blast` sends to the owner's contacts under the auth cookie — so a true headless send uses
    the transactional Resend path, not the logged-in blast. Reconcile the two send paths.

25. **3-day recurrence / scheduler is paused.** `lib/email/scheduler.ts` +
    `.github/workflows/email-scheduler.yml`. No self-limiting cron wired (today + same time
    next two days, capped at 3, per-occurrence idempotency key). → Research self-limiting
    recurrence patterns; Resend has no native cron.

26. **Brand-shape mismatch.** Fixtures store the palette as `primaryColor/accentColor`
    (EmailGlobalStyle) but `projects.branding` expects `primary_color/accent_color/agent_name/
    logo_url`. The project page maps branding→tokens; the two shapes must be reconciled so a
    broker brand can be put on a project cleanly.

---

## F. WHAT WAS ACTUALLY FIXED THIS SESSION (for the record)

- Email Lab AI fed the FULL site dossier + cited figures + funnel per-ZIP read on every call,
  no scope gate (`lib/email/fill-doc.ts`, `app/api/email-lab/ai/route.ts`). `next build` ✓,
  pushed `1c92328d`.
- Builder lifted into a shared lib so the route and a headless runner call the same code.
- Verified brand fixtures + logos committed so they deploy.
- A headless runner exists (`scripts/email/snicklefritz.mts`) with a send-safety verification
  gate; it built + sent two branded, data-filled emails — but with the wrong (monthly) chart
  and one forced template, which is why this list exists.

---

## Parallel Safety

> Tasks sharing a color badge touch overlapping files and **cannot run in parallel**.

| Group | Tasks | Shared Files |
|-------|-------|--------------|
| 🔴 | Task 5, Task 6 | `lib/email/fill-doc.ts` |

Tasks with no color badge have no file conflicts — safe to parallelize freely.
