# 08 — collapse + harden the 11 crawl-job GHA installs (`crawl4ai-setup` + `crawl4ai-doctor`)

**Model: Sonnet.** Mechanical YAML edits across 11 files; the design decision is pinned + vendor-verified.
**Priority: P2.** Subsumes the old "add doctor to the 4 missing jobs" item.

## ⚠️ Premise correction — this is the contradiction the audit got half-wrong
`BRIEF.md` #6 says *"Don't standardize on `crawl4ai-setup` (strips patchright)"* — **that is FALSE and is the
overturned 06-20 belief.** STEP7 is right. **Proof (installed package source, not a log):**
`crawl4ai/install.py` `post_install()` → `install_playwright()` runs **both**
`playwright install --with-deps --force chromium` (98-107) **and** `patchright install --with-deps --force
chromium` (126-135); line 124 prints `"Installing Patchright browsers for undetected mode..."`. PyPI:
`patchright>=1.49.0` + `playwright>=1.49.0` hard deps; 0.9.0 current. So `crawl4ai-setup` installs **both**
browsers **with `--with-deps`** — *stricter* than today's GHA (the live `patchright install chromium` step
**omits `--with-deps`**). **Caveat:** `crawl4ai-setup` skips installs if `CRAWL4AI_MODE=api` (install.py:52-57)
— ensure that env var is unset on these jobs.

## The 11 crawl jobs (verified) + current state
collier-permits-monthly, lee-permits-weekly, ingest-crexi-listings, dbpr-sirs-monthly,
dbpr-public-notices-weekly, dbpr-press-releases-weekly, fgcu-reri-monthly, marketbeat-pdf-ingest,
rsw-airport-monthly, swfl-inc-weekly, news-swfl-ingest. Today: 5 distinct browser-install spellings;
`crawl4ai-doctor` on only 7 (missing on dbpr-press-releases, fgcu, swfl-inc, rsw); only news uses
`crawl4ai-setup`.

## Steps
1. **Probe first.** Open all 11 ymls; note each one's current install step(s) + whether it has doctor.
   Confirm which jobs are stealth (use `Crawl4aiSession`/UndetectedAdapter: lee/collier permits, crexi,
   dbpr_sirs) vs static (`fetch_page_*` only).
2. **Standardize each crawl job to:** `pip install -r ingest/requirements.txt` → `crawl4ai-setup` →
   `crawl4ai-doctor` (advisory: `continue-on-error: true` for one cycle, then flip to hard-fail). Drop the
   bespoke `playwright install` / `patchright install` lines.
   - **Efficiency option (optional):** `crawl4ai-setup` installs patchright on *every* job, including
     static ones that don't need it (an extra Chromium download on monthly/weekly crons). If that runtime
     cost matters, keep the **static** jobs on `playwright install --with-deps chromium` (no patchright)
     and use `crawl4ai-setup` only on the 4 stealth jobs. Default recommendation: uniform `crawl4ai-setup`
     (simplest, the report's intent, vendor-safe). State which you chose.
3. Verify `CRAWL4AI_MODE` is not set to `api` anywhere in these jobs/env.

## Done when
- A `workflow_dispatch` of **≥1 stealth job (e.g. lee-permits) + ≥1 static job (e.g. news/fgcu)** runs the
  setup step, the doctor preflight passes, and the pipeline produces rows. (RULE 1: >5 files → show the diff.)
- This is prod-evidence-gated (`public.checks` rule): close only on the green dispatch, not on "looks right."

## Best-practice fold-in
**Build 09 companion (slim per-cron deps — REPORT DEPS/CI):** once the installs are collapsed, the
next leverage point is locking the Python dep graph per-job (`uv pip compile` or `pip-compile`) so
each cron carries only its own transitive set. Static jobs (fgcu, rsw, press-releases, swfl-inc) carry
`crawl4ai` + `patchright` transitives they never exercise — build 09 addresses this separately.

## Risk
Medium (11 workflow files + a vendor-behavior dependency). The vendor behavior is now package-proven;
the residual risk is GHA-runner specifics → that's why it's dispatch-verified before closing.

## References (added 2026-06-22 — crawl4ai-live + best-practices fold-in)
**crawl4ai-live (tool-usage reference, docs/audit/2026-06-21-crawl4ai-live/):**
- `docs/audit/2026-06-21-crawl4ai-live/round1/02-installation.md` — crawl4ai-setup installs deps for both regular AND undetected modes
- `docs/audit/2026-06-21-crawl4ai-live/round1/06-undetected-browser.md` — why patchright/undetected mode needs its own browser
- `docs/audit/2026-06-21-crawl4ai-live/VERIFICATION.md` (star section + V-6) — package-source proof (install.py) settling the patchright contradiction
**best-practices-research (how to build/operate what we build, docs/audit/2026-06-21-best-practices-research/):**
- `docs/audit/2026-06-21-best-practices-research/round3/q-uv-pip-compile.md` (REPORT DEPS/CI) — minimal reproducible deps per job (companion build 09)
**Verified:** V-6 + the README "one correction" star: crawl4ai-setup installs BOTH browsers --with-deps (install.py:98-135) -> collapse is GO and STRICTER. BRIEF #6 "strips patchright" is WRONG/RESOLVED. CAVEAT: keep CRAWL4AI_MODE=api UNSET on crawl jobs (install.py:52-57 skips installs otherwise). Confirm the build prose carries BOTH the resolution and the CRAWL4AI_MODE=api caveat. — folded into Steps above where applicable.
