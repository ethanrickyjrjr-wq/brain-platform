# 28 — cron ledger → real postmortem record for recurring classes

**Model: Sonnet.** Ops-tooling only; the change is a small `.mjs` extension + ledger-section additions —
no vendor surface, no type-system churn, no data-path risk. Sonnet is right-sized.
**Priority: P2.** Not a daily red; this is SRE hardening so recurring classes stop being forgotten.

---

## The gap (verified)

`docs/cron-rebuild-failures.md` is a **symptom log, not a postmortem record.** The gap is threefold:

### 1. Root cause is never written down for recurring classes

The ledger today (`docs/cron-rebuild-failures.md` — confirmed open, newest-first table between
`<!-- INCIDENT_TABLE_START -->` and `<!-- INCIDENT_TABLE_END -->`):

- New rows land with `Root Cause = _auto-captured; pending triage_`
  (`.github/workflows/log-cron-incident.yml` → `node .github/scripts/log-cron-incident.mjs
  --mode=record-failure`).
- On the next green scheduled run the same workflow auto-flips the row to
  `RESOLVED (auto — self-healed, untriaged)` (`ledger-flap.mjs: flipMostRecentOpenRow`).
- The root cause is **never written**. The ledger has 5+ rows of the same recurring classes
  (schema drift, DAG drift, secret-not-wired, lockfile drift, flaky test) — all untriaged —
  with no root, no action item, no owner.

`ledger-flap.mjs: chronicFlappers(ledger, { threshold: 3 })` already DETECTS workflows that
auto-resolve without triage ≥3 times — but the signal goes nowhere. No gate surfaces it as a
postmortem obligation.

### 2. Alert fires on every failure, not on significant events

`log-cron-incident.yml` fires on `workflow_run: types: [completed]` — one GHA job comment per
failure, regardless of class. The SRE Workbook chapter "Alerting on SLOs" is explicit:
_"You could receive 144 alerts/day, act on none, and still meet the SLO."_
TRANSIENT flaps (FRED 429, Census timeout) fire the same alert as a deterministic HOLD — maximum
noise, zero precision.

### 3. No class-level postmortem section; the ledger is append-only symptom rows

`classify-cron-failure.mjs` already buckets failures into 7 classes (LOCKFILE, ACTION_VERSION,
MISSING_DEP, MISSING_SECRET, SCHEMA_DRIFT, DATA_EMPTY, TRANSIENT, UNKNOWN). The recurring ones
visible in the ledger today:

| Class | Evidence in ledger | Recurs? |
|---|---|---|
| SCHEMA_DRIFT | Orphan Concept ×2 (2026-06-02, 2026-05-29); `CORRIDOR_ALIASES` (2026-05-27) | yes |
| MISSING_SECRET | FRED_API_KEY (2026-05-27); S3 keys ×6 (2026-05-26) | yes |
| LOCKFILE | bun.lock ×3 (2026-06-01) | yes |
| TRANSIENT | FRED 429 (2026-05-31); Census ×4 (2026-05-29, 05-26) | yes (but not structural) |
| UNKNOWN | freshness-probe ×4 untriaged (2026-06-05/06/02/2026-05-29) | yes — undiagnosed |

Each class needs exactly one postmortem record: root + permanent fix + owner + "how to verify
closed." Today none of them exist. The ledger is append-only rows; there is no section for the
class-level structural record that the SRE book calls a "repository for trend analysis."

---

## Steps

### STEP 1 — Probe first (RULE 0.5)

Open every file below and verify line-level reality before writing a line of code:

1. `docs/cron-rebuild-failures.md` — confirm sentinel comments, header/table shape, and which
   classes have ≥3 RESOLVED-untriaged rows (candidates for postmortem obligation).
2. `.github/workflows/log-cron-incident.yml` — confirm the `record_failure` / `maybe_auto_resolve`
   job split; confirm kill-switch vars (`CRON_INCIDENT_LOGGER_ENABLED`,
   `CRON_INCIDENT_AUTO_RESOLVE_ENABLED`).
3. `.github/scripts/lib/ledger-flap.mjs` — confirm `chronicFlappers(ledger, {threshold})` exists
   and is already exported but unused beyond its own module.
4. `.github/scripts/classify-cron-failure.mjs` — confirm the 7 classes + their `suggestedAction`
   strings; note the TRANSIENT `shouldRetry` and UNKNOWN `needsLlm` guards.
5. Scan `log-cron-incident.mjs` (same scripts dir) for where `chronicFlappers` is (or isn't)
   called — that's the wiring gap.

**Do not trust this spec's line numbers or path assumptions — verify against the actual files.**

### STEP 2 — RULE 3.5 brainstorm (short, required)

Before writing any code, answer these design questions (short decision, not a long essay):

1. **Where does the postmortem section live?** Option A: a second markdown section below the
   incident table in `cron-rebuild-failures.md` (extend the existing file — one source of truth).
   Option B: a separate `cron-postmortem-registry.md`. Recommendation: Option A (extend the seam;
   RULE 3 C2; one file to read).

2. **What triggers the postmortem obligation?** Option A: `chronicFlappers` threshold (≥3
   RESOLVED-untriaged rows for a workflow). Option B: a new class-keyed section always present,
   manually maintained. Recommendation: surface the `chronicFlappers` signal from `log-cron-incident.mjs`
   as a GHA step warning — it already does the math; just surface it and add the class-keyed
   postmortem sections manually the first time.

3. **What does "alert only on significant events" mean for us?** Define significant: (a) a real
   HOLD (classify class != TRANSIENT), (b) a stale master past TTL (separate from the incident
   logger), or (c) `chronicFlappers` threshold crossed (a workflow that keeps self-healing without
   triage). Transient class rows stay in the ledger but do NOT require a postmortem section.

4. **Postmortem section schema.** Minimal per-class record: `Class`, `Root` (the permanent defect,
   not the symptom), `Fix` (the action item — what resolves the class forever), `Owner` (who is
   responsible for verifying), `Verified` (date + evidence). No more fields — keep it lean.

Confirm these decisions in the Step 3 implementation; do not invent alternatives mid-build.

### STEP 3 — Add the postmortem registry section to `cron-rebuild-failures.md`

Extend `docs/cron-rebuild-failures.md` (do NOT create a parallel file) by adding:

1. **A new sentinel-bounded section** after the incident table (a new `<!-- POSTMORTEM_REGISTRY_START -->` / `<!-- POSTMORTEM_REGISTRY_END -->` pair) containing a **class-keyed postmortem table**:

   ```markdown
   ## Postmortem Registry — recurring class records

   One row per recurring failure *class* (not per incident). A class earns a row when it has
   ≥3 RESOLVED-untriaged incidents in the ledger above. Each row carries a permanent root +
   action item + owner. "Verified closed" = the class has not recurred since the fix landed.

   <!-- POSTMORTEM_REGISTRY_START -->
   | Class | Root (permanent defect) | Fix / Action item | Owner | Verified closed |
   |---|---|---|---|---|
   | SCHEMA_DRIFT | ... | ... | operator | ⬜ |
   | MISSING_SECRET | ... | ... | operator | ⬜ |
   | LOCKFILE | bun.lock not committed after dep change | `bun install` + `git add bun.lock` in same push; Gate 1 enforces | pre-push hook (Gate 1) | ✅ 2026-06-01 — Gate 1 ships |
   | UNKNOWN / freshness-probe | ... | ... | operator | ⬜ |
   <!-- POSTMORTEM_REGISTRY_END -->
   ```

   Populate as much as the probe step reveals (the LOCKFILE class is essentially already documented
   in the ledger's "Recurring Patterns" section — mirror it; others need triage).

2. **Surface `chronicFlappers` in `log-cron-incident.mjs`.** In the `record_failure` path (after
   the new row is appended), call `chronicFlappers(updatedLedger, { threshold: 3 })`. If the result
   is non-empty, append a GHA step summary warning (not a new issue, not a page):
   `⚠️ Chronic flappers (≥3 untriaged self-heals): <workflow list>. Add a postmortem row.`
   This surfaces the obligation without creating noise — it fires only when a workflow has crossed
   the threshold, not on every failure.

3. **Suppress TRANSIENT from the GHA issue comment.** In `log-cron-incident.mjs`, if
   `classify(logTail).klass === "TRANSIENT"`, write the ledger row as normal (record-keeping) but
   skip the sticky-issue comment. Transient blips stay auditable in the ledger; they don't page.
   Confirm the `shouldRetry` guard in `classify-cron-failure.mjs` already marks TRANSIENT for
   L0-retry — this is additive, not a replacement.

### STEP 4 — Populate the first round of postmortem rows

For each class with ≥3 RESOLVED-untriaged rows in the ledger, write the postmortem record into the
new registry section. Use the `suggestedAction` strings from `classify-cron-failure.mjs` as the
starting draft for the `Fix / Action item` column. The LOCKFILE row is already fully known; the
others require reading the ledger rows for patterns.

**Do not invent roots you can't verify from the ledger.** If the class is undiagnosed (UNKNOWN /
freshness-probe), set `Root = "undiagnosed — see incident rows above"` and `Verified closed = ⬜`.

---

## Done when

1. `docs/cron-rebuild-failures.md` contains a `<!-- POSTMORTEM_REGISTRY_START -->` /
   `<!-- POSTMORTEM_REGISTRY_END -->` section with ≥4 class rows (SCHEMA_DRIFT, MISSING_SECRET,
   LOCKFILE, UNKNOWN/freshness-probe) — each with a Root and Fix column populated (✅ or ⬜
   per actual triage state).

2. `log-cron-incident.mjs --mode=record-failure` now logs a GHA step summary warning when
   `chronicFlappers` returns ≥1 entry. Verify by running:
   ```
   node .github/scripts/log-cron-incident.mjs --dry-run --mode=record-failure
   ```
   (or by reading the script path and confirming the `chronicFlappers` call is wired + the
   TRANSIENT comment-suppression guard is present).

3. A simulated TRANSIENT row (local unit test or dry-run) does NOT trigger the sticky-issue
   comment path — only the ledger append.

4. **No new mandatory pre-materialization gate created.** This is pure ops-tooling: a new ledger
   section + a wiring change in an existing `.mjs` script. The materialization path (build pipeline,
   Stage 2–4 validators, Gate 4 ingest guard) is untouched.

---

## Risk

Low. Two changes:

1. A new markdown section in `cron-rebuild-failures.md` — append-only, bounded by new sentinels;
   existing sentinel pairs (`<!-- INCIDENT_TABLE_START -->` / `<!-- INCIDENT_TABLE_END -->`) are
   untouched. `ledger-flap.mjs` only reads between those two sentinels; the new section is outside
   that range and invisible to it.

2. Two small wiring changes to `log-cron-incident.mjs` (the `chronicFlappers` call + TRANSIENT
   comment guard). Both are additive. The `record_failure` job logic is unchanged; only the
   post-write side-effects are extended.

No vendor surface. No data-pipeline path. No GHA cron schedule changes.

**Architecture guardrail (explicit):** This is an OPS-TOOLING build, NOT a data-pipeline gate.
RULE 3 C2 ("never erect a new mandatory pre-materialization gate") does not constrain it — it
gates the agent/ops record, not the materialization path. It EXTENDS the existing cron-incident
ledger (`log-cron-incident.mjs` / `ledger-flap.mjs`) rather than building a parallel system.

**Dependencies:** Run AFTER build 02 (which makes daily-rebuild echo its real failure reason before
exit — that reason is what populates the Root column) and build 04 (which adds classifier rules for
`DatatypeMismatch` and `deterministic HOLD` + widens the log tail from 30 lines). Both feed the
root causes this postmortem record captures. Builds 02 + 04 are not required to land first — this
build can proceed in parallel — but the postmortem rows for `SCHEMA_DRIFT` and `UNKNOWN` will be
incomplete until the real reason is echoed (build 02) and classified (build 04).

---

## References

**best-practices-research (docs/audit/2026-06-21-best-practices-research/):**
- `docs/audit/2026-06-21-best-practices-research/round1/rootcause-sre-postmortem-culture.md` — blameless postmortem = root + action + owned bug at right priority; "No Postmortem Left Unreviewed"; repository for trend analysis; standard template fields
- `docs/audit/2026-06-21-best-practices-research/round3/q-sre-postmortem-example.md` — a concrete postmortem template
- `docs/audit/2026-06-21-best-practices-research/round2/rootcause-sre-managing-incidents.md` — incident roles + record
- `docs/audit/2026-06-21-best-practices-research/round2/rootcause-sre-monitoring-workbook.md` — alert only on significant events ("you could receive 144 alerts/day, act on none, and still meet the SLO")

**crawl4ai-live (docs/audit/2026-06-21-crawl4ai-live/):**
- (n/a — ops-tooling build)

**Ties to existing builds:**
- Build 02 (echo the real reason) — feeds the Root column; postmortem rows are incomplete without it
- Build 04 (classifier rules + wider log tail) — feeds the class signal; `DatatypeMismatch` and `deterministic HOLD` rules land here
- The existing `log-cron-incident.mjs` / `ledger-flap.mjs` system — extended by this build, not replaced
