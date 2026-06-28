# Issue 04 — Free, Self-Healing Automation

**Parent analysis:** `docs/superpowers/specs/2026-06-28-repo-focus-restructure-analysis.md`
**Status:** SPEC-READY breakdown. NOT built. Build via the protocol at the bottom.
**Priority:** #4 — wires a $0 stack onto existing crons; fixes the daily-rebuild / freshness-probe flappers.
**One line:** Two layers — in-workflow recovery (retry/timeout/concurrency) + an external dead-man's-switch
(Healthchecks.io) — because in-workflow logic can never detect that the schedule silently never fired.

---

## 1. THE PROBLEM (in detail, with evidence)

Pipelines run on GitHub Actions cron + Vercel. They fail and nobody knows until data is stale.
Current flappers (from KICKOFF): **daily-rebuild (10×), freshness-probe-daily (4×)** — "keep
auto-resolving UNTRIAGED." That phrase is the tell: a job that silently doesn't run, or fails and
self-clears, with no durable alert. We already have `log-cron-incident.yml` + cron-incident
auto-capture (issue #44) and `docs/cron-rebuild-failures.md` — this issue makes recovery + alerting
robust and free, extending that, not replacing it.

**Core principle (load-bearing):** in-workflow logic can detect "I ran but failed." It can NEVER
detect "I was supposed to run and didn't" (GitHub drops queued scheduled runs under load; public
scheduled workflows auto-disable after 60 days of no activity). That second class needs an EXTERNAL
watcher. Hence two layers.

### KNOWN root cause — daily-rebuild (do NOT wrap it in retry)
The daily-rebuild flapper's cause is already known and **DETERMINISTIC**: the rebuild bot lost its
main-branch bypass when the branch ruleset tightened, so its push to `main` is rejected and CI reds
(memory `project_data-freeze-rebuild-bot-bypass`; incident `d996fba4`). **Retry cannot fix a
permission rejection — wrapping it just burns minutes and hides the cause.** Fix the bot's
main-branch bypass in the ruleset FIRST. Proven interim workaround: rebuild locally
`bun refinery/cli.mts master --resilient` → stage only `brains/` + SESSION_LOG → `safe-push` as the
operator (who has bypass). Only AFTER permissions are fixed do you wrap the genuinely-transient
remainder (freshness-probe-daily may have a transient component) in retry.

---

## 2. GROUND TRUTH — every figure quoted from vendor docs (fetched 2026-06-28 via crawl4ai)

### GitHub Actions `on: schedule`
- POSIX cron, 5 fields. **Shortest interval = every 5 minutes.** UTC by default; per-cron `timezone:`
  supported.
- *"The `schedule` event can be delayed during periods of high loads… If the load is sufficiently
  high enough, some queued jobs may be dropped. To decrease the chance of delay, schedule your
  workflow to run at a different time of the hour."* → **never use `0 * * * *`; offset (e.g. `17`).**
- *"Scheduled workflows will only run on the default branch."*
- *"In a public repository, scheduled workflows are automatically disabled when no repository activity
  has occurred in 60 days."*
- Free minutes: **public repos = free** (standard runners); private: **GitHub Free 2,000 min/mo**,
  Pro 3,000. Re-runs burn minutes (a failed 5-min run + a successful 10-min re-run = 15 min total).
  Source: docs.github.com (events-that-trigger-workflows#schedule, billing/github-actions).

### Self-healing actions (concrete, named)
- **Retry transient steps — `nick-fields/retry@v3`** (github.com/nick-fields/retry). Inputs:
  `timeout_minutes`/`timeout_seconds`, `max_attempts`, `command`; optional `retry_wait_seconds`
  (default 10), `retry_on` (any|timeout|error), `on_retry_command` (cleanup).
  ```yaml
  - uses: nick-fields/retry@v3
    with: { timeout_minutes: 10, max_attempts: 3, retry_wait_seconds: 30, command: npm run ingest }
  ```
- **`timeout-minutes`** (default 360 — set it LOW, e.g. 30, so a hung job dies instead of eating 6 h).
- **`concurrency`** group to stop overlap/stacking:
  ```yaml
  concurrency: { group: ingest-pipeline, cancel-in-progress: false }
  ```
- **`continue-on-error`** is a failure *suppressor*, not a self-heal — on a critical step it turns the
  job green and your `if: failure()` alerting never fires. Use only on non-critical steps.
- **Auto re-run failed runs — `workflow_run` watchdog + `gh run rerun --failed`** (`--failed` =
  "Rerun only failed jobs, including dependencies"). MUST cap or it loops forever:
  ```yaml
  on: { workflow_run: { workflows: [Ingest Pipeline], types: [completed] } }
  jobs:
    rerun:
      if: ${{ github.event.workflow_run.conclusion == 'failure' && github.event.workflow_run.run_attempt < 3 }}
      permissions: { actions: write }
      steps: [{ run: gh run rerun ${{ github.event.workflow_run.id }} --failed, env: { GH_TOKEN: ${{ secrets.GITHUB_TOKEN }} } }]
  ```
  (`workflow_run` chains at most 3 levels deep.)
- **Auto-file an issue on failure — `JasonEtco/create-an-issue@v2`** with `update_existing: true`
  (updates the open issue with the same title instead of spamming a new one each failure). Needs
  workflow-level `permissions: { issues: write }`.
  ```yaml
  - if: failure()
    uses: JasonEtco/create-an-issue@v2
    env: { GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
    with: { filename: .github/ISSUE_TEMPLATE/pipeline-failure.md, update_existing: true }
  ```

### External dead-man's-switch (the layer we're missing)
- **Healthchecks.io free Hobbyist: $0/mo, 20 checks, 100 log entries/check.** *"It listens for HTTP
  requests ('pings')… keeps silent as long as pings arrive on time… raises an alert as soon as a ping
  does not arrive on time."* Each check has a ping URL `https://hc-ping.com/<uuid>`; the LAST step of
  a SUCCESSFUL run `curl`s it; `/start` and `/fail` suffixes signal start/explicit failure. **This is
  the only thing that catches "the schedule never fired."**
- Alternatives: cron-job.org ("absolutely free", up to 60×/hour, status notifications — can also
  *fire* HTTP jobs, bypassing GitHub's 5-min floor); UptimeRobot free (50 monitors, 5-min interval) —
  but its free-tier heartbeat support is UNCONFIRMED, so **Healthchecks.io is the pick** for the
  dead-man's-switch.

### Vercel Cron (for context, weaker)
- Hobby (free): 100 cron jobs/project, **min interval once/day, ±59-min precision**; sub-daily
  expressions FAIL deployment. It's just an HTTP GET to your function. Use only for a single daily
  trigger; **GitHub Actions is the workhorse.**

### Free dependency self-healing
- **Dependabot security updates: free, all repos**, raises PRs for vulnerable deps AND vulnerable
  GitHub Actions in your workflows. Renovate (free Mend app) adds grouped/scheduled version PRs +
  lockfile maintenance.

---

## 3. THE BUILD — the minimum free self-healing stack ($0)

Wire these onto the existing pipeline workflows:
1. **GitHub Actions `on: schedule` engine**, scheduled **off-the-hour** (`'17 6 * * *'`, never
   `0 * * * *`); add `timeout-minutes: 30` + a `concurrency` group.
2. **`nick-fields/retry@v3`** around the flaky extract/network step (`max_attempts: 3`).
3. **Healthchecks.io check per scheduled pipeline** — successful run's last step pings
   `hc-ping.com/<uuid>`; configure period+grace so a missed run alerts you (email/Slack).
4. **`JasonEtco/create-an-issue@v2`** on `if: failure()` with `update_existing: true` →
   de-duped tracked issue. (Tie into existing `log-cron-incident.yml` / `cron-rebuild-failures.md`.)
5. **Optional** `workflow_run` watchdog with `gh run rerun --failed`, capped at `run_attempt < 3`.
6. **Dependabot security updates** on (zero-config).

Net cost: $0. GitHub Actions (free public / 2,000 min private) + Healthchecks.io Hobbyist + two free
Marketplace actions + Dependabot.

---

## 4. EXECUTION PROTOCOL — do exactly this, in order
1. **Read first (RULE 0.5):** this file, parent analysis, the existing `.github/workflows/*` crons
   (esp. daily-rebuild + freshness-probe), `log-cron-incident.yml`, `docs/cron-rebuild-failures.md`,
   and `docs/standards/pipeline-freshness.md`.
2. **Triage the flappers FIRST — daily-rebuild's cause is KNOWN:** it's the rebuild bot's lost
   main-branch bypass (deterministic — see §1). Fix the ruleset bypass first; retry won't help.
   freshness-probe (4×) — diagnose before wrapping; suspect flake, loop locally (RULE 1).
3. **Verify any action version + free-tier number LIVE (RULE 0.4)** before relying on it. Vendor
   limits drift; the figures in §2 are dated 2026-06-28.
4. **Secrets discipline (pre-push Gate 3):** `gh secret set HEALTHCHECKS_PING_URL …` is step 1;
   wiring it into the workflow `env:` is step 2 — same PR. Keys are in gh repo secrets, don't ask.
5. **Register the build:** `node scripts/new-build.mjs self-healing-automation "Free self-healing cron stack: retry + dead-man's-switch + auto-issue"`.
6. **Roll out to ONE pipeline first** (the worst flapper), prove it, then template the rest.
7. **Verify by injecting failure:** force a transient fail → retry recovers; force a hard fail →
   issue auto-files + de-dupes; disable the schedule → Healthchecks alerts. Evidence before "done."

---

## 5. HARD RULES / GUARDRAILS
- **Triage before you wrap.** A flapper with a real bug must be fixed; retry is for *transient*
  failures only. Wrapping a deterministic failure in retry hides the bug and drains free minutes.
- **Cap every auto-rerun** (`run_attempt < 3`) or you build an infinite loop that empties your 2,000
  free minutes overnight.
- **`continue-on-error` is not self-healing** — never put it on a critical step; it kills your alerting.
- **Two layers, always.** In-workflow retry + external dead-man's-switch. One without the other
  leaves a blind spot.
- **Verify free-tier numbers live** before committing to a vendor — they change.
- **Secrets: set in gh, then wire env — same PR** (Gate 3). Never inline a ping URL/token.

## 6. VERIFICATION (definition of done)
- Forced transient failure recovers via retry within `max_attempts`.
- Forced hard failure auto-files ONE tracked issue (re-failure updates, not spams).
- Schedule disabled / missed → Healthchecks.io alerts within period+grace.
- Crons run off-the-hour; `timeout-minutes` + `concurrency` set; no overlap.
- daily-rebuild + freshness-probe flap causes identified and fixed (not just wrapped).
- Dependabot security updates active.

## 7. ANTI-PATTERNS (what NOT to do)
- Wrapping daily-rebuild in retry — its failure is a deterministic permission rejection (bot lost
  main bypass). Fix the bypass; retry hides it and burns minutes.
- `cron: '0 * * * *'` (top-of-hour — gets dropped under load).
- Uncapped `gh run rerun` (infinite loop, drains minutes).
- Relying on in-workflow `if: failure()` alone to catch a job that never started (it can't).
- Vercel Hobby cron for sub-daily pipelines (fails deployment — once/day max).

## 8. OPEN QUESTIONS for brainstorming
- Is brain-platform's repo public or private (decides free-minute budget + the 60-day auto-disable)?
- One Healthchecks.io check per pipeline, or per logical group (20-check free cap)?
- Do we fold the auto-issue into the existing `log-cron-incident.yml` flow or run it parallel?
- Keep the daily rebuild on GitHub Actions, or move the trigger to cron-job.org to dodge GitHub's drop risk?
