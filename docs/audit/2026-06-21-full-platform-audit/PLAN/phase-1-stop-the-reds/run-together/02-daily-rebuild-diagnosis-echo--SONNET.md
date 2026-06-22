# 02 — daily-rebuild: echo the master HOLD reason before exit (so the cause gets recorded)

**Model: Sonnet.** A few lines in one TS file. **Priority: P0.**

## The defect (verified)
When master deterministic-HOLDs, `daily-rebuild` exits 1 (correct, loud) but the cron-incident logger only
sees a 30-line tail + "exit code 1" → classifies `UNKNOWN` → ledger writes `_auto-captured; pending
triage_` → next green run auto-flips to RESOLVED. **The real reason exists in `_build-report.json`
(`failureClass: deterministic`, `reason: <brain>.md not found`) but is never surfaced to the log tail.**

## Where (verified, exact)
`refinery/cli.mts`: `:459` `const exitCode = deriveExitCode(...)`; `:470` writes
`brains/_build-report.json`; `:476` `if (exitCode !== 0) process.exit(exitCode)`. Echo goes **between 470
and 476**, while the report object is in hand. (TS — NOT `daily-rebuild.yml`, so this never collides with
build 09's gate-install edit.)

## Steps
1. **Probe first.** Read `refinery/cli.mts` ~440–490 and the `_build-report.json` shape (the master
   outcome carries `failureClass` + `reason`; confirm field names).
2. When `exitCode !== 0`, before `process.exit`, `console.error` a single line per the Phase-1 `_CONTRACT.md`
   **Contract A**: `CRON-DIAG failureClass=<master.failureClass> reason=<master.reason>` (plus any held
   brain id). Use `console.error`/stdout so `gh run view --log-failed` captures it in the tail.
3. Keep it dependency-free and guard against missing fields (echo `unknown` rather than throw).

## Done when
- A forced HOLD (or a dry-run that simulates one) prints the `CRON-DIAG …` line to the run log, and a
  30-line failed-log tail now contains the real reason. Pairs with build 04's classifier rule (Contract A).

## Best-practice fold-in
SRE postmortem culture (see References) distinguishes *symptom* ("exit 1") from *cause* ("brain X not found").
This echo writes the cause into the log tail — the raw material build 28 (cron-ledger postmortem-record restructure,
REPORT HEADLINE #2) consumes to populate structured `failureClass`/`reason` fields in the incident record.

## Risk
Low. Pure observability; cannot change exit codes or the build path (`deriveExitCode` is untouched).

## References (added 2026-06-22 — crawl4ai-live + best-practices fold-in)
**crawl4ai-live (tool-usage reference, docs/audit/2026-06-21-crawl4ai-live/):**
- (n/a — not a crawl4ai build)
**best-practices-research (how to build/operate what we build, docs/audit/2026-06-21-best-practices-research/):**
- `docs/audit/2026-06-21-best-practices-research/round1/rootcause-sre-monitoring.md` (REPORT HEADLINE) — "symptom != cause"; a root cause = a defect whose repair instills confidence it won't recur. Echoing the real failureClass/reason IS recording the cause.
- `docs/audit/2026-06-21-best-practices-research/round1/rootcause-sre-postmortem-culture.md` — the postmortem record this echo feeds
- `docs/audit/2026-06-21-best-practices-research/round3/q-sre-postmortem-example.md` — concrete template/fields
**Verified:** V-11 — echo site is refinery/cli.mts, and the CRON-DIAG line contract (Phase-1 _CONTRACT A) feeds build 04 — folded into Steps above where applicable.
