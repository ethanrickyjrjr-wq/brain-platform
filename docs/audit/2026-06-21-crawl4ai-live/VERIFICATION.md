# VERIFICATION — independent re-check of the 2026-06-21 audit (2026-06-22)

**Method.** Every load-bearing claim in `STEP7-FINAL-REPORT.md`, `../2026-06-21-full-platform-audit/NOTES.md`,
and `../2026-06-21-supercrawl4ai/BRIEF.md` was re-checked by an **8-cluster read-only verification** (one
agent per claim-cluster, each opening the actual files + grep, no memory, returning fresh `file:line`
evidence) **plus two Vendor-First checks** (the installed `crawl4ai` package source + live PyPI metadata).
This is the "REVIEW ALL OF THIS AND MAKE SURE IT IS CORRECT" record. The build plan that acts on it is
`../2026-06-21-full-platform-audit/PLAN/`.

## Verdict
**The audit is overwhelmingly correct.** ~40 claims checked; the great majority **CONFIRMED verbatim**. The
hard, easy-to-get-wrong parts (UndetectedAdapter assembly, `MemoryAdaptiveDispatcher`+`RateLimiter` exact
signatures, the 5-stage pipeline + orphan-slug throw, master's zero-LLM deterministic path, `deriveExitCode`
0/2/1, the converse-deleted resolution, the `links[]`/`edges[]` split) are all **right**. Below are the only
deltas — corrections that the plan bakes in.

## ⭐ The one contradiction — resolved with package-source proof
`STEP7` and `BRIEF.md` **disagree** on `crawl4ai-setup`:
- **STEP7** (lines 38-43): `crawl4ai-setup` installs Patchright too; the 06-20 "skips it" note is outdated;
  collapse the installs to it. ✅ **CORRECT.**
- **BRIEF.md #6** (line 63): "Don't standardize on `crawl4ai-setup` (**strips patchright**)." ❌ **WRONG** —
  repeats the overturned 06-20 belief.

**Proof (offline, authoritative — the installed package, not a runtime log):** `crawl4ai/install.py`
`post_install()` → `install_playwright()` runs **both** `playwright install --with-deps --force chromium`
(install.py:98-107) **and** `patchright install --with-deps --force chromium` (install.py:126-135), with
line 124 printing the exact string `"Installing Patchright browsers for undetected mode..."`. PyPI confirms
`patchright>=1.49.0` + `playwright>=1.49.0` are hard deps and **0.9.0 is the current latest**. So
`crawl4ai-setup` installs **both** browsers **with `--with-deps`** — *stricter* than the current GHA
spelling (`patchright install chromium` omits `--with-deps`). **Collapse (PLAN build 08) is GO.**
**Caveat:** `crawl4ai-setup` skips installs entirely if `CRAWL4AI_MODE=api` (install.py:52-57) — keep that
env unset on crawl jobs. (Note: the captured docs `round1/02-installation.md:117` + `06-undetected:440` say
"both regular AND undetected modes" but never use the word "Patchright" — the *docs* support the substance,
the *package source* settles the specific claim.)

## Correction table (every delta, in one place)
| ID | Where | Said | Truth | Baked into |
|---|---|---|---|---|
| V-1 | STEP7 §"what's wrong" + NOTES + STEP5 | Crexi at `crexi/extract.py:42,83` | `ingest/pipelines/**crexi_listings**/extract.py` — `_SCROLL_JS` def L42, applied L76, `[:28000]` L83, `delay_after` L70=5.0/L77=4.0. Substance 100% confirmed. | PLAN 11; STEP7 edit |
| V-2 | NOTES §3 | master `sources[]`(31) ⇆ `input_brains[]`(31) | Both **30**, not 31; identical/mirrored (diff empty). | PLAN 05/18 |
| V-3 | NOTES §0/§5 | freshness probe at `ingest/pipelines/.../check_freshness.py`; "`check_tier1_entry`/`run_probe` unguarded" | File is `ingest/scripts/check_freshness.py`. Tier-2 (`_fetch_max_freshness` ~228-266) **is** guarded; only **tier-1** (`check_tier1_entry` ~273-319) + `main()`'s try-with-no-`except` (~794) crash. Guard only those. | PLAN 03 |
| V-4 | NOTES §5 | news_swfl "fixed 10-article cap" | Per-source `MAX_ARTICLES_PER_SOURCE=10` × **4 sources ≈ 40 total**; listing caps at 20/source. | PLAN 14 |
| V-5 | NOTES/STEP7 P0 | news fix = "ALTER COLUMN TYPE (or normalizer→date)" | Pipeline already commits to **text** (`pipeline.py:12-14` `columns={"published_date":{"data_type":"text"}}`, normalizer emits ISO string); live column is legacy `date`. Correct idempotent ALTER is **`date → text`**, not text→date. | PLAN 01 |
| V-6 | STEP7/BRIEF #6 | `crawl4ai-setup` strips/installs patchright (contradiction) | Installs BOTH browsers `--with-deps` (install.py:98-135). See ⭐ above. | PLAN 08; STEP7 edit |
| V-7 | NOTES §0 masking chain | every fail → `_auto-captured; pending triage_` | That Root-Cause string is written **only for `classify()==UNKNOWN`** (`log-cron-incident.mjs:79`); recognized classes write `KLASS — signal`. The `RESOLVED (auto…)` flip is in `lib/ledger-flap.mjs`. Narrative still holds (the 3 roots all bucket UNKNOWN today). | PLAN 02/04 |
| V-8 | NOTES §1 | client-flip hooks at `hooks/use-chat-stream.ts`, `hooks/useWelcomeStream.ts` | No `hooks/` dir. Real: `lib/chat/use-chat-stream.ts:55`, `app/welcome/_components/useWelcomeStream.ts:25` (routes `/api/welcome/demo` in demo mode, `/api/assistant` otherwise). Endpoints all `/api/assistant`. | PLAN 18 |
| V-9 | build-queue/SESSION_LOG/kickoff | `/api/converse` + `/api/welcome/chat` = "thin deprecated forwarders" | **Both FULLY DELETED from disk.** NOTES.md ("fully DELETED") is right. The stale comment at `app/api/assistant/route.ts:3-4` and build-queue/SESSION_LOG are wrong. | PLAN 18 |
| V-10 | NOTES §1 | chart fix proof `fixed_with_chart_bad_rate:0` | Confirmed. Nuance: top-level `"worked": false` because the no-chart fallback still deflected 12/12 — fix works *when a chart is shown*; chartless path is the open gap. | PLAN 20 |
| V-11 | STEP7 P0 #2 | "echo the build-report reason before exit" | Exact site: `refinery/cli.mts` `:459` deriveExitCode, `:470` writes `_build-report.json`, `:476` exit. Echo in `cli.mts` (TS), not `daily-rebuild.yml`. | PLAN 02 |
| V-12 | NOTES §4 | grounded-answer.ts `/api/converse` ref | All 4 refs (L3/9/30/80) are **comments**, now dangling (route deleted). | PLAN 18 |

## Confirmed-as-written (spot list — no change needed)
crawl4ai client wiring A1-A7 (incl. `RateLimiter(base_delay=(1.0,3.0), max_delay=60.0, max_retries=3,
rate_limit_codes=[429,503])`); the 8-min `page_timeout` unit bug end-to-end (`480×1000=480000ms`,
`extract_client.py:195`); `unclecode-litellm==1.81.13` transitive dep (installed metadata, `Required-by:
Crawl4AI`); `supercrawl4ai` imported by zero pipelines; 11 crawl jobs + the 4 missing-doctor jobs +
`heal-cron-failure.yml` excludes daily-rebuild & retries transient-only; the 5-stage pipeline +
`2.5-normalize.mts:446` orphan throw; master `master.mts:327` skip flags + `deterministic`; `dag.mts:49`
input_brains-only; `packs.mts:389` load-time invariant; `brain-vocabulary.json` 277 concepts / 304
slug_index / mojibake; graphify `links`(27,321)/`edges`(27,437) split + 2 orphaned `.py`; verbatim 0.9.0
CHANGELOG line ("breaking changes for the self-hosted HTTP server only").

## Could not verify offline (honest gaps)
- The "live-verified twice (local + GHA)" half of the Patchright claim — the GHA stdout — is not
  reproducible from the working tree. **Mooted** by the package-source proof above (install.py is decisive).
- All Phase-3 *outcomes* (Crexi virtualized-vs-accumulating, GHA-IP reachability, Qlik `<table>` shape,
  news BestFirst yield) — these need live browser/GHA probes by design; the PLAN gates each on its probe.
