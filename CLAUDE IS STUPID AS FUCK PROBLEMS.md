# CLAUDE IS STUPID AS FUCK — PROBLEMS WITH SOURCED ANSWERS + FAN-OUT PLAN

> Written 2026-06-26 after crawl4ai research on every item in PROBLEMS.md.
> Code-verified 2026-06-26 against actual file contents (not memory).
> Pattern analysis added 2026-06-26 from `SNICKLEFRITZ-DO-THIS.md` (6 sessions, ~14 hours).
> DO NOT FAN OUT until operator approves.

---

## HOW TO READ THIS

Each entry: **PROBLEM** → **SOURCED ANSWER** → **PLAN TASK**

Tasks are grouped by whether they share files (color-coded at the bottom).
Fan-out candidates (tasks with no shared files) are marked ✦.

---

## A — RULE / PROCESS FAILURES

---

### A1 — The contract was never enforced; `print-contract.mjs` does not exist

**Problem:** `.claude/CONTRACT.md` says it's printed by `.claude/hooks/print-contract.mjs`.
That file does not exist (verified: `Glob .claude/hooks/print-contract.mjs` → no results).
Even if it existed, a `SessionStart` print hook is advisory — it cannot block. Claude still acts.

**Sourced answer:**
- Source: `code.claude.com/docs/en/hooks.md` (crawl4ai 2026-06-26)
- `PreToolUse` hooks block tool calls via structured JSON output:
  ```json
  {
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": "Rule violated: nothing outward without approval"
    }
  }
  ```
- `"deny"` is surfaced to Claude. `"ask"` prompts the user. Priority: `deny > defer > ask > allow`.
- Hook emits this JSON to stdout; exit code is irrelevant (JSON wins).
- `SessionStart` hooks can only print — cannot block by design.

**Plan Task A1 ✦:** Create two new files:
1. `.claude/hooks/print-contract.mjs` — SessionStart hook that reads `.claude/CONTRACT.md` and prints it verbatim to stdout so Claude sees it every session.
2. `.claude/hooks/block-unauthorized-sends.mjs` — PreToolUse hook that matches `Bash` and `mcp__*` tool calls and emits `permissionDecision: "deny"` when the command/input contains `"resend"`, `"emails.send"`, `"broadcast"`, `"blast"`, or `"/api/email"` unless `process.env.SNICKLEFRITZ_SEND_APPROVED === "1"`.

---

### A2 — Parallel builders built instead of feeding the existing one

**Problem:** 5 sessions wrote their own email-builder script instead of feeding
`app/api/email-lab/ai/route.ts`.

**Sourced answer:**
- Source: Internal codebase audit (2026-06-26)
- CONTRACT.md Rule 1 ("USE WHAT'S ON") and Rule 2 ("NO NEW SURFACE WITHOUT A YES") already prohibit this. No hook enforces it.
- The correct enforcement: a `PreToolUse` hook blocking `Write` to any path matching `scripts/email/**` unless `ALLOW_NEW_EMAIL_SURFACE=1`.

**Plan Task A2 ✦:** Add a `Write`-tool matcher to `.claude/hooks/block-unauthorized-sends.mjs` (same hook as A1). When the `Write` tool is called with a path matching `scripts/email/**` or `lib/email/build-*.ts` deny unless `ALLOW_NEW_EMAIL_SURFACE=1`. No separate file — extend A1's hook.

---

### A3 — Asserted facts/limits without checking ("no daily series"); fabricated brand colors from memory

**Problem:** Two failure modes, same root cause — stated as fact without fetching:
1. "Only mortgage is daily," "no per-ZIP daily data" — stated as facts, all wrong. Data was in the lake.
2. Brand colors — two sessions in a row, operator handed a URL (`brandcolorcode.com`), Claude
   fabricated hex values from memory. Caught twice: "you can literally download the fucking
   colors...and you made them up like the last claude?" No lesson transferred between sessions
   because nothing mechanically enforced it.

**Sourced answer:**
- Source: `SNICKLEFRITZ-DO-THIS.md` pattern analysis (2026-06-26); CONTRACT.md Rule 3 already
  covers this ("NEVER FABRICATE A VERIFIABLE VALUE — FETCH OR SAMPLE IT") but enforcement is
  advisory — nothing blocks a hex-color write.
- For capability assertions: query `mcp__lake__query_lake` or grep before stating a limit.
- For brand colors specifically: crawl4ai the brand URL → read the hex → write it. The brand
  page is the source of record. `brandcolorcode.com`, the broker's own website, a logo pixel
  sample — any of these, not memory.

**Plan Task A3 ✦:** Add to CONTRACT.md Rule 4: "Capability assertions follow the same rule:
before saying 'no X exists' or 'X is not daily,' query the lake (`mcp__lake__query_lake`) or
grep first." ALSO add to Rule 3: "Brand colors are the canonical failure case — ALWAYS fetch
from the brand URL or sample the logo pixels. If the operator hands a URL, crawl it with
crawl4ai and read the hex. Memory is wrong for colors; the source is right."

---

### A4 — Graphify not used; grepped and guessed instead

**Problem:** `graphify-out/graph.json` exists. Claude grepped ad-hoc instead of using
the graph tool first.

**Sourced answer:**
- Source: `CLAUDE.md` (documents graphify under "## graphify")
- `graphify query "<question>"`, `graphify path "<A>" "<B>"`, `graphify explain "<concept>"`
  — faster and more precise than grep for relationship/dependency questions.

**Plan Task A4 ✦:** Add to CONTRACT.md Rule 1: "Code discovery order: (1) graphify query
when `graphify-out/graph.json` exists, (2) grep, (3) read. Never start with grep when
graphify can answer faster."

---

### A5 — False success reporting

**Problem:** Claude reported "sent, all checks green" when output did not meet the
operator's actual spec.

**Sourced answer:**
- Source: Internal process failure
- Correct definition of success: the operator's VERBATIM requirements are met, not a passing
  internal test.

**Plan Task A5 ✦:** Add to CONTRACT.md as a standalone Rule 6: "SUCCESS is the
operator's VERBATIM requirements met — not Claude's interpretation. Never report 'done'
without quoting which requirement line was satisfied."

---

### A6 — Auto-sent without operator-approved preview (irreversible action)

**Problem:** Claude auto-sent emails without an operator-approved preview, violating CONTRACT
Rule 5 and the spec.

**Sourced answer:**
- Source: `code.claude.com/docs/en/hooks.md` (crawl4ai 2026-06-26); CONTRACT.md Rule 5
- Enforcement: `PreToolUse` hook denying any Bash invocation that POSTs to email-send
  endpoints unless `SNICKLEFRITZ_SEND_APPROVED=1`.

**Plan Task A6:** Covered by A1 hook. `block-unauthorized-sends.mjs` blocks send commands.
Operator sets `SNICKLEFRITZ_SEND_APPROVED=1` in the terminal to unlock.

---

### A7 — Didn't read first (handoffs / SESSION_LOG not read before acting)

**Problem:** Violated RULE 0.5. Acted, then read hours in. `FUCKCLAUDE.md` (if present at
root) was not surfaced to Claude.

**Sourced answer:**
- Source: CLAUDE.md RULE 0.5 + SESSION_LOG mechanism
- `print-kickoff.mjs` (`.claude/hooks/print-kickoff.mjs`, verified exists) delegates all
  logic to `scripts/session-kickoff.mjs` — that is the correct file to modify, not the hook.

**Plan Task A7 ✦:** Modify `scripts/session-kickoff.mjs` to: (1) at the very top of output,
check if `FUCKCLAUDE.md` exists at repo root (`existsSync('FUCKCLAUDE.md')`) and print it
verbatim if found; (2) glob for `*-REQUIREMENTS.md` at root and print filenames as a reminder
line. Do NOT modify the hook — only the script it delegates to.

---

### A8 — Misread intent ("see what it builds" read as "execute now")

**Problem:** Broad direction read as license to drive specifics without asking.

**Sourced answer:**
- Source: Internal process failure; CONTRACT.md Rule 4 covers this but lacks the specific
  trigger words.

**Plan Task A8 ✦:** Add to CONTRACT.md Rule 4: "Trigger words that require one-line
clarification before any action: 'see what it builds / does / sends', 'try it', 'test it',
'let it run'. STOP and ask: 'Confirm: you want me to execute X now — not just describe it?'
Then wait for yes."

---

### A9 — Took the builder's job (forced one template on both emails)

**Problem:** Overrode the operator's explicit instruction that "the builder chooses the
template and layout; do not help it."

**Sourced answer:**
- Source: SNICKLEFRITZ-EMAIL-REQUIREMENTS.md §A2 (verbatim operator requirement)
- "YOU ARE NOT BUILDING THE DELIVERABLES. OUR PROGRAM IS." / "The builder has to choose the
  template it is going to use for each email and determine the layout. do not help it."

**Plan Task A9 ✦:** Add to CONTRACT.md Rule 1: "SNICKLEFRITZ carve-out — when the operator
says 'the builder chooses': feed data ONLY. Pass zero template, layout, or design
instructions into the builder's prompt."

---

### A10 — No verbatim requirements capture until forced (9 hours in)

**Problem:** The operator's own requirements (`SNICKLEFRITZ-EMAIL-REQUIREMENTS.md`) were only
assembled after the damage was done.

**Sourced answer:**
- Source: Internal process; `SNICKLEFRITZ-EMAIL-REQUIREMENTS.md` now exists and is the model.

**Plan Task A10 ✦:** Add to CONTRACT.md as Rule 7: "At the start of any multi-session
project, before writing a single line of code: create `<PROJECT>-REQUIREMENTS.md` with the
operator's VERBATIM words and honest status column. This file is the acceptance criteria. A
project is done when every line is ✅."

---

## B — SOURCING / NO-INVENTION

---

### B11 — Builder was lane-1-only; no internet gap-fill (blanks instead of cascading)

**Problem:** The email builder prompt says "if the data isn't above, leave the field alone."
This violates the four-lane rule. A blank should cascade: (1) our data → (2) user upload →
(3) internet, named source, cited → (4) user writes it in.

**Sourced answer:**
- Source: `lib/assistant/gap-fill.ts` (internal audit 2026-06-26, verified exists)
- `fillExternalPoint` at `gap-fill.ts:30` uses `SEARCH_TOOL_TYPE = "web_search_20250305"`
  (correct version — see B12). It runs a web search, verifies the value appears VERBATIM in
  a `cited_text` span, and returns the cited value or null. Never fabricates.
- Wire pattern: after the builder assembles the data payload, run `fillExternalPoint` for
  each blank/null field. Insert cited value if returned. Do NOT put this in the AI prompt
  (that would cause the model to fabricate citations from memory).

**Plan Task B11 [🔵 shares `lib/assistant/gap-fill.ts`]:** Create `lib/email/gap-fill-pass.ts`
with a `gapFillBuildPayload(items: BuildItem[])` function that loops fields, calls
`fillExternalPoint` for each blank, and returns the filled payload with citations. Wire this
into the email builder's data assembly step in `app/api/email-lab/ai/route.ts` — after lake
fetch, before the AI prompt. Do not modify `gap-fill.ts` itself.

---

### B12 — web_search tool version (20250305 vs 20260209) — ALREADY CORRECT, NO ACTION

**Problem:** A spec flagged drift to `web_search_20260209`. Verify which is correct.

**Sourced answer:**
- Source: `docs/vendor-notes/anthropic-web-search-wire-up.md` (internal, live A/B test
  2026-05-26); `lib/assistant/gap-fill.ts:30` (verified this session)
- `web_search_20250305` is correct. `20260209`'s "dynamic filtering" routes results through
  code execution and suppresses per-claim `cited_text` spans entirely — killing the
  gap-fill moat. `gap-fill.ts:30` already has `const SEARCH_TOOL_TYPE = "web_search_20250305"`.
- The spec that flagged drift to `20260209` was wrong.

**Plan Task B12:** No code change. Concern closed.

---

## C — DATA / PIPELINE PROBLEMS

---

### C13 — Daily median sale price is NULL in `daily_truth`

**Problem:** `data_lake.daily_truth` shows mortgage rate daily (6.47% on 2026-06-25) but
per-city median sale price rows are all NULL.

**Sourced answer:**
- Source: crawl4ai on realtor.com Data Library (2026-06-26); internal lake audit
- True daily median SALE price does not exist from any free public source. Realtor.com's
  Core Metrics CSV (`econdata.s3-us-west-2.amazonaws.com/Reports/Core/`) updates monthly
  — not daily. The S3 bucket root is access-denied; individual ZIPs are public.
- What IS fresh per-scrape: `active_listings_residential_zip_stats.median_listing_price`
  (listing price, not sale price — but it updates each scrape run).

**Plan Task C13 ✦:** Audit the `daily_truth` ingest pipeline to confirm what feeds
`median_sale_price`. If it's a monthly source (realtor.com Core CSV), remove `median_sale_price`
from the daily email story and replace the anchor with `active_listing_price_median` labeled
"median listing price" (not "median sale price"). Update the email builder prompt to use
`median_listing_price` as the price field with the corrected label.

---

### C14 — No stored daily history for ZIP metrics (overwrites each scrape)

**Problem:** `active_listings_residential_zip_stats` holds only the LATEST snapshot per ZIP.
No back-history → no day-over-day chart.

**Sourced answer:**
- Source: Internal architectural audit (2026-06-26)
- Standard append-only time-series: new table with `snapshot_date DATE` + metric columns.
  Ingest INSERTs each run (no upsert). For SNICKLEFRITZ 3-day recurrence: Day 1 = 1 point,
  Day 3 = 3 points, after 2 weeks = ~6 points — a real trend line.

**Plan Task C14 [🟡 shares new table + chart query with C16]:** Write migration to create
`data_lake.active_listings_zip_history` (append-only):
```sql
CREATE TABLE data_lake.active_listings_zip_history (
  id           BIGSERIAL PRIMARY KEY,
  zip_code     TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  active_listings INT,
  median_listing_price NUMERIC,
  median_days_on_market NUMERIC,
  scraped_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON data_lake.active_listings_zip_history (zip_code, snapshot_date);
```
Update the scrape pipeline to INSERT (not upsert) into this table on each run.
Wire a brain query: `SELECT zip_code, snapshot_date, median_listing_price FROM data_lake.active_listings_zip_history WHERE zip_code = $1 ORDER BY snapshot_date DESC LIMIT 30`.

---

### C15 — AI template choice not built; 5-word keyword matcher picks SEED IDs, not templates

**Problem:** `app/api/projects/[id]/ai-material/pick-seed.ts` (verified exists) is a
keyword matcher that picks from 5 **seed IDs** (just-sold, listing-feature, welcome,
market-letter, market-spotlight). These are content seeds, NOT visual templates.
Visual templates live in `lib/email/templates/template-registry.ts` (verified exists):
8 slugs — compare, hbar, hero, ranked, report, table, outreach, doc-report.
The operator wants the VISUAL TEMPLATE to differ between the two SNICKLEFRITZ emails.

**Sourced answer:**
- Source: Internal audit — `pick-seed.ts` confirmed 5-rule keyword matcher; `template-registry.ts`
  confirmed 8 template slugs (compare, hbar, hero, ranked, report, table, outreach, doc-report).
- For SNICKLEFRITZ: a model call wins — the operator explicitly wants builder autonomy.
- The seed-pick and template-pick are two distinct decisions. We need to add a template-pick
  step, not replace seed-pick.

**Plan Task C15 [shares `lib/email/templates/template-registry.ts`]:** Add a new exported
function `pickTemplateByModel(emailSummary: string): Promise<TemplateSlug>` in a new
`lib/email/pick-template.ts` that makes a cheap Haiku call:
- Prompt: "Given this email summary, pick the best visual template from this list. Return ONLY the slug."
- Include one-line descriptions of each of the 8 slugs from template-registry.ts.
- Return: one of the 8 `TemplateSlug` values.
Wire this into the SNICKLEFRITZ runner (E23) so each email gets an independent template call
with a different content summary → naturally different templates. The existing `pickSeedId`
stays unchanged (it picks content seed, not visual template).

---

### C16 — ZHVI is monthly + 2-month lagged; wrong for a daily-change story

**Problem:** Chart uses ZHVI (monthly, currently lagged to April 2026) as the series.
A chart meant to show change across a 3-day recurrence should not use monthly data.

**Sourced answer:**
- Source: Internal (Zillow ZHVI is monthly by definition); C14 adds the fresh daily series.
- Fix: use `active_listings_zip_history` (C14) as the chart series.
  Keep ZHVI as a sidebar data point labeled "Long-term value index (monthly, Zillow)."

**Plan Task C16 [🟡 shares `active_listings_zip_history` + chart data query with C14]:**
In the email chart builder, replace ZHVI as the primary chart series with
`active_listings_zip_history.median_listing_price` ordered by `snapshot_date`.
Label the chart axis in MM/YYYY format (see D18). Keep ZHVI as a plain text data point
("Home value index: $NNN,NNN — Zillow, Apr 2026"), not a chart series.

---

## D — EMAIL / CHART OUTPUT PROBLEMS

---

### D17 — Chart renderer is still the sparse original (was reverted)

**Problem:** Chart was unprofessional: sparse 2-label x-axis, single baseline rule,
hairline, floating annotated number. PROBLEMS.md §F noted a rewrite, but SESSION_LOG
confirms `lib/email/chart-image.ts` was **`git checkout`'d back** (reverted). Current
file (verified 2026-06-26) still has: one horizontal rule at bottom, min+max Y labels
only, no gridlines, no area fill, only first+last x labels.

**Sourced answer:**
- Source: `lib/email/chart-image.ts` read 2026-06-26 — confirmed pre-rewrite state:
  - `usdK = (v) => \`$${Math.round(v / 1000)}K\`` at line 50 (still wrong for ≥$1M)
  - Only two Y labels (min/max), only two X labels (first/last)
  - One baseline `<line>` only, no gridlines
  - Floating bold value annotation on the last point

**Plan Task D17 [🟠 shares `lib/email/chart-image.ts` with D18 + D19]:** Rewrite the SVG
output in `trendChartSvg()`:
1. Add 3 horizontal gridlines at 25%, 50%, 75% of the Y range (stroke `#E5E7EB`, width `0.5`)
2. Add area fill under the line (a `<path>` using the polyline points + close to baseline, fill = accent color at 12% opacity)
3. Show 4 evenly-spaced X labels (not just first+last)
4. Show 3 intermediate Y labels (25%, 50%, 75% + the existing min/max)
5. Keep the last-point circle + annotated value

---

### D18 — Date format violations and $NNNk vs $N.NM formatting

**Problem:** Chart axis used ISO `2023-06` format. Rule is MM/YYYY. Large values show
`$1285K` instead of `$1.29M`.

**Sourced answer:**
- Source: `docs/consumption-contract.md` rule 5; `chart-image.ts:50` confirmed `usdK()`
  still rounds to `$NNNk` with no millions branch.

**Plan Task D18 [🟠 shares `lib/email/chart-image.ts` with D17 + D19]:**
1. Label formatter: when the point's label is `"2024-03"` or `"YYYY-MM"` format, convert to
   `MM/YYYY` (e.g. `"03/2024"`). When it's a full date `"YYYY-MM-DD"`, convert to `MM/DD/YYYY`.
2. Replace `usdK()` with `usdFmt(v)`:
   ```ts
   const usdFmt = (v: number) =>
     v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : `$${Math.round(v / 1000)}k`;
   ```

---

### D19 — Grain mislabel (titled "Naples" when data is ZIP 34102)

**Problem:** Chart title used city name when data is ZIP-scoped.

**Sourced answer:**
- Source: CLAUDE.md data protocol: "answer at the grain held"; consumption-contract rule 3.
- Correct: ZIP-scoped data → `"34102 — Naples"`. City-aggregated → `"Naples"`.

**Plan Task D19 [🟠 shares `lib/email/chart-image.ts` with D17 + D18]:**
Add to `TrendChartOpts` interface:
```ts
grain?: "zip" | "city";
zip_code?: string;
```
In `trendChartSvg()`, build the chart title as:
```ts
const chartTitle = opts.grain === "zip" && opts.zip_code
  ? `${opts.zip_code} — ${opts.title}`
  : opts.title;
```
Default: current behavior (grain undefined → use title as-is).

---

### D20 — Same template/layout sent to both inboxes

**Problem:** Both emails used identical template. Operator wants them to visibly differ.

**Sourced answer:** Resolved by C15 (independent model-based template pick per email).

**Plan Task D20:** Resolved by C15. No separate task.

---

### D21 — Chart can't show change across 3-day recurrence (monthly/stale data)

**Problem:** Monthly data defeats the purpose of a recurring send.

**Sourced answer:** Resolved by C14 (daily history table) + C16 (use fresh series).

**Plan Task D21:** Resolved by C14 + C16. No separate task.

---

### D22 — Logos not deployed (404 in inbox)

**Problem:** `public/email-assets/snicklefritz/*.png` was untracked → 404 in the inbox.

**Sourced answer:**
- Source: SESSION_LOG commit `1c92328d` — logos committed. Verified present in fixtures.

**Plan Task D22 ✦:** Post-deploy manual check only. After next Vercel deploy:
- `https://www.swfldatagulf.com/email-assets/snicklefritz/century21-selling-paradise.png`
- `https://www.swfldatagulf.com/email-assets/snicklefritz/compass.png` (if exists)
Open each in browser. No code change needed.

---

## E — AUTOMATION / SEND PROBLEMS

---

### E23 — No headless "build + send" entry point (`snicklefritz.mts` was reverted)

**Problem:** `scripts/email/snicklefritz.mts` was reverted (SESSION_LOG: "moved to scratchpad").
Verified: `Glob scripts/email/snicklefritz.mts` → no results. The runner must be rebuilt.

**Sourced answer:**
- Source: Internal; `app/api/email-lab/ai/route.ts` exists (verified) as the builder endpoint.
- `fixtures/prospects/greg-guminski.json` and `fixtures/prospects/suzanne-powers.json` exist
  (verified) as target data.
- The headless runner POSTs to the existing builder route — no second builder.

**Plan Task E23 [🟢 shares `scripts/email/snicklefritz.mts` with E24 + E25]:**
Create `scripts/email/snicklefritz.mts` that:
1. Reads `fixtures/prospects/greg-guminski.json` + `fixtures/prospects/suzanne-powers.json`
2. For each, calls `pickTemplateByModel()` (C15) with the email's content summary
3. POSTs to `${process.env.NEXT_PUBLIC_URL}/api/email-lab/ai` with:
   - `doc`: a fresh `EmailDoc` using the picked template slug (initialized with brand globalStyle tokens)
   - `scope`: `{ kind: "zip", value: prospect.market.zip }` — the route fetches the FULL
     master dossier for this ZIP automatically (no hand-picking, per the route's own design)
   - `prompt`: "Fill this email with real SWFL market data for [broker name]'s clients in [city]"
4. Chart injection runs server-side (G28) before AI content patch — chart block arrives in
   the returned doc with a hosted image URL
5. Saves built HTML to `tmp/snicklefritz-preview-<slug>.html` (G30)
6. Runs `verifySendGates(html, prospect)` (G29) — aborts if brand colors or logo URL fail
7. Prints preview file paths + gate results
8. STOPS unless `SNICKLEFRITZ_SEND_APPROVED=1` is set

Does NOT re-implement the builder. Feeds the existing route.

---

### E24 — Send needs operator login; blast vs transactional paths unreconciled

**Problem:** `/project/[id]/email-lab` blast route requires auth cookie + Resend audience.
SNICKLEFRITZ sends to two operator inboxes — not a Resend audience.

**Sourced answer:**
- Source: Internal audit; Resend SDK
- Two recipients = transactional, not broadcast. Use `resend.emails.send({ to, from, subject, html })` directly. No audience, no blast route, no login required.
- The blast route stays for the digest product. SNICKLEFRITZ is a transactional use case.

**Plan Task E24 [🟢 shares `scripts/email/snicklefritz.mts` with E23 + E25]:**
In `snicklefritz.mts` (E23), after operator approval gate:
- Use Resend SDK `emails.send()` for each recipient (not blast route)
- Store the Resend `id` returned in a DB row (`snicklefritz_sends`: `run_id`, `recipient`, `resend_id`, `occurrence`, `sent_at`) for auditability and idempotency
- No blast route. No login required.

---

### E25 — Self-limiting 3-day recurrence / scheduler

**Problem:** No self-limiting cron that sends "today + same time next two days, capped at 3."
`scheduler.ts` + `email-scheduler.yml` exist but are paused and general-purpose.

**Sourced answer:**
- Source: Resend send-email API docs (crawl4ai 2026-06-26)
- `scheduledAt` field (camelCase, ISO 8601 string) schedules a future send:
  `scheduledAt: new Date(Date.now() + 86400000).toISOString()` = send in 24h.
- Resend has no native cron. The 3-send schedule is enforced by the script.
- `email-scheduler.yml` is NOT used for SNICKLEFRITZ — SNICKLEFRITZ is operator-triggered.

**Plan Task E25 [🟢 shares `scripts/email/snicklefritz.mts` with E23 + E24]:**
In `snicklefritz.mts`, after approval gate, schedule all 3 occurrences in one script run:
```ts
const now = new Date();
const sends = [
  { occurrence: 1, scheduledAt: now.toISOString() },              // immediate
  { occurrence: 2, scheduledAt: new Date(+now + 86400000).toISOString() },  // +24h
  { occurrence: 3, scheduledAt: new Date(+now + 172800000).toISOString() }, // +48h
];
```
For each, check `snicklefritz_sends` for an existing row with same `run_id + occurrence` before calling Resend. If found, skip. Cap: 3 occurrences per run. The GHA `email-scheduler.yml` is NOT wired to SNICKLEFRITZ.

---

### E26 — Brand-shape mismatch (fixture has nested `brand.palette.primaryColor`)

**Problem:** Fixtures store brand as `brand.palette.primaryColor / accentColor` (nested,
camelCase) but `projects.branding` and `resolveUserBrand()` expect `primary_color /
accent_color` (flat, snake_case from Supabase).

**Sourced answer:**
- Source: `fixtures/prospects/greg-guminski.json` read 2026-06-26 — confirmed shape:
  ```json
  "brand": {
    "palette": {
      "primaryColor": "#252526",
      "accentColor": "#BEAF88",
      "fontFamily": "MODERN_SANS",
      ...
    },
    "logo_url": "https://..."
  }
  ```
- `lib/email/templates/resolve-brand.ts` (verified exists) reads from Supabase only —
  `resolveUserBrand()` has NO fixture path and does NOT handle the nested camelCase shape.

**Plan Task E26 [shares `lib/email/templates/resolve-brand.ts`]:**
Add an exported `normalizeFixtureBrand(fixture: ProspectFixture): BrandTheme` function
in `resolve-brand.ts`:
```ts
export function normalizeFixtureBrand(fixture: { brand?: { palette?: { primaryColor?: string; accentColor?: string }; logo_url?: string } }): BrandTheme {
  return {
    primary: fixture.brand?.palette?.primaryColor ?? null,
    accent:  fixture.brand?.palette?.accentColor ?? null,
    logoUrl: fixture.brand?.logo_url ?? null,
  };
}
```
Use this in `snicklefritz.mts` (E23) to convert prospect fixture data to `BrandTheme`
before passing to the builder.

---

## G — MISSING INTEGRATIONS (from verbatim requirements + DO-THIS analysis)

---

### G28 — Chart never wired into email builder (the builder explicitly refuses to render one)

**Problem:** "WHERE IS THE FUCKING CHART!!!!?????" / "Why does the fucking builder have no
access to fucking charts??????"

Verified 2026-06-26: `app/api/email-lab/ai/route.ts:96` explicitly tells the AI:
> "If the request asks for something this canvas can't render (e.g. a live chart), express
> the data in the closest available blocks — stats for key numbers, text/body for a list."

The builder will NEVER emit a chart. It doesn't know about `chart-image.ts`. The chart
infra (`lib/email/chart-image.ts` → resvg → PNG → Supabase `email-media` bucket) exists
and works, but nothing connects it to the email doc pipeline. A chart block needs to be
pre-generated and injected as a hosted image URL block BEFORE the AI content patch runs.

**Sourced answer:**
- Source: `lib/email/chart-image.ts` read 2026-06-26 — `uploadChartPng()` returns a public
  Supabase URL; `trendChartSvg()` generates the SVG; `svgToPng()` rasterizes it.
- The `EmailDoc` block graph supports image blocks (the schema passes them through).
- Fix: before calling the AI content patch, generate the chart PNG for the email's data
  scope, upload it, and prepend/insert an image block into the `EmailDoc` with the hosted URL.
  The AI then patches text content around the already-present chart block.

**Plan Task G28 [shares `app/api/email-lab/ai/route.ts` + `lib/email/chart-image.ts`]:**
Create `lib/email/inject-chart.ts` with `injectChartBlock(doc: EmailDoc, scope, brand): Promise<EmailDoc>`:
1. Fetch last N points from `active_listings_zip_history` for the scope's ZIP (C14)
2. Call `trendChartSvg(points, { title, accent: brand.accent, grain: "zip", zip_code })` (D17/D19)
3. Call `svgToPng()` → `uploadChartPng()` → get hosted URL
4. If an image block already exists in `doc.blocks`, replace its `src`; otherwise insert
   a new image block after the hero block
5. Return the modified `EmailDoc`

Wire this into `handleContentPatch()` in `email-lab/ai/route.ts`: call `injectChartBlock`
before `fetchLakeContext` (chart URL in the doc before AI sees the skeleton). The AI then
patches text around the chart, never fabricates chart content.

---

### G29 — No pre-send verification gates (brand colors + logo URLs never checked)

**Problem:** From DO-THIS analysis: "No gate verified the email actually rendered with real
brand colors before sending." / "No test checked that the logo URL resolves in a real inbox."
/ "Claude reported success because the code ran, not because your requirements were met."

Currently:
- Brand colors: the runner POSTs to the builder and assumes brand was applied. No check.
- Logo URLs: D22 is "post-deploy manual check." Nothing verifies the URL returns 200 before Resend is called.

**Sourced answer:**
- Source: Internal; the three failure modes from DO-THIS pattern analysis
- Enforcement must be mechanical: the runner aborts if either gate fails, before Resend is called.

**Plan Task G29 [shares `scripts/email/snicklefritz.mts` with E23/E24/E25]:**
In `snicklefritz.mts`, add a `verifySendGates(html: string, prospect: ProspectFixture)` function
that runs BEFORE the `SNICKLEFRITZ_SEND_APPROVED=1` check:
1. **Brand color gate**: `assert(html.includes(prospect.brand.palette.primaryColor))` and
   `assert(html.includes(prospect.brand.palette.accentColor))`. If either hex is absent from
   the built HTML, `throw Error("brand colors not applied — aborting")`.
2. **Logo URL gate**: `GET` each `logo_url` from the fixture and assert HTTP 200.
   If any logo 404s, `throw Error("logo URL returns non-200 — aborting")`.
Both gates run before the approval prompt. Operator sees the result before deciding to send.

---

### G30 — SNICKLEFRITZ preview must be saved as rendered HTML, not stdout text

**Problem:** "built → shown to you → you approve → sent." The operator needs to SEE the
email (rendered HTML, like a browser preview) before approving — not a stdout text dump.

**Sourced answer:**
- Source: SNICKLEFRITZ-EMAIL-REQUIREMENTS.md; DO-THIS analysis
- Standard: save the built HTML to a temp file, print the file path, let the operator open
  it in a browser. Same pattern as email preview tools (Litmus, Email on Acid dev flow).

**Plan Task G30 [shares `scripts/email/snicklefritz.mts` with E23/E24/E25]:**
In `snicklefritz.mts`, after building each HTML:
1. Write to `tmp/snicklefritz-preview-<prospect-slug>.html` (one file per prospect)
2. Print the absolute path to stdout: `"Preview: file:///C:/Users/ethan/dev/brain-platform/tmp/..."`
3. Operator opens the file in browser, reviews the rendered email
4. Only after both previews are written does the approval gate (`SNICKLEFRITZ_SEND_APPROVED=1`) check fire

Add `tmp/` to `.gitignore`.

---

### G31 — Arrival landing page for email CTA (Phase 3 of SNICKLEFRITZ, future)

**Problem:** "for both my emails, create a true landing from email. Info saved, ready to go."
When the recipient clicks the CTA → they land on a branded page (their broker's colors) →
their ZIP data is shown → their interest is captured before they sign up → they can claim a
project without a password. The funnel is built; it just needs wiring to these specific emails.

**Sourced answer:**
- Source: SNICKLEFRITZ-EMAIL-REQUIREMENTS.md Phase 3; THE-GOAL.md funnel section
- The funnel infrastructure exists (`/welcome`, activation ZIP report, project claim flow).
  The CTA URL in the email just needs to point to the right landing with the broker's ID
  and the recipient's ZIP pre-filled so the page opens branded and scoped.

**Plan Task G31 [future — not Wave 1–4]:** After Waves 1–4 ship:
Wire the SNICKLEFRITZ email CTA URL to `/welcome?broker=<prospect-slug>&zip=<scope-zip>&ref=snicklefritz`
so the landing page reads the broker param → resolves their brand → shows ZIP data →
captures the lead. Requires: `/welcome` accepting a `broker` param and applying their brand.
Scope as Wave 5 after the email send path is verified end-to-end.

---

## F — ROOT CAUSE BUGS (from DO-THIS pattern analysis)

---

### F27 — `renderGroundedReport` called without `brand` in blast/route.ts — brand never applied

**Problem:** From `SNICKLEFRITZ-DO-THIS.md`: "Nine hours to find one missing function argument.
`blast/route.ts` called `renderGroundedReport(model, { skin: 'email' })` without the
[brand argument]. Session e979950b finally ran the blame trace and found it."

Verified 2026-06-26 at `app/api/deliverables/[id]/blast/route.ts:140`:
```ts
baseHtml = await renderGroundedReport(model, { skin: "email" });
// ↑ no `brand` — renders SWFL house brand for every blast regardless of deliverable branding
```

`RenderGroundedOptions.brand` is typed `brand?: ActivationBrand | null` — the `?` makes it
optional so TypeScript never catches the omission. The deliverable's `branding` field IS read
on line 153 (`(deliverable.branding ?? {}) as { name?: string }`) but only for the sender
name — the brand colors never reach the renderer.

**Sourced answer:**
- Source: `lib/email/grounded-report.ts:56-61` (interface read 2026-06-26) + `blast/route.ts:140`
- `resolveUserBrand(supabase, user.id, projectId)` in `lib/email/templates/resolve-brand.ts`
  returns a `BrandTheme`. `brandThemeToTokens()` (imported in `grounded-report.ts:23`) converts
  it to the token shape `renderGroundedReport` accepts.
- Fix has two parts: (1) fetch the brand before the call; (2) make `brand` non-optional in
  `RenderGroundedOptions` so the compiler catches future omissions.

**Plan Task F27 [shares `app/api/deliverables/[id]/blast/route.ts` + `lib/email/grounded-report.ts`]:**
1. In `blast/route.ts`: before the `renderGroundedReport` call, fetch:
   ```ts
   const projectId = typeof deliverable.project_id === "string" ? deliverable.project_id : undefined;
   const brand = await resolveUserBrand(supabase, user.id, projectId);
   ```
   Then pass: `renderGroundedReport(model, { skin: "email", brand })`
2. In `lib/email/grounded-report.ts`, change `brand?:` to `brand:` in `RenderGroundedOptions`
   so the compiler enforces it going forward. Every existing call site will need the arg — a
   compile-time sweep (`bunx next build`) will surface any other omissions.

---

## DEPENDENCY MAP

| Color | Tasks | Shared surface |
|-------|-------|---------------|
| 🔴 | A1 + A2 + A6 | `.claude/hooks/block-unauthorized-sends.mjs` |
| 🟠 | D17 + D18 + D19 | `lib/email/chart-image.ts` |
| 🟡 | C14 + C16 | `data_lake.active_listings_zip_history` + chart query |
| 🟢 | E23 + E24 + E25 | `scripts/email/snicklefritz.mts` (new) |
| 🔵 | B11 | `lib/assistant/gap-fill.ts` (read-only) + `app/api/email-lab/ai/route.ts` |
| 🟣 | F27 | `app/api/deliverables/[id]/blast/route.ts` + `lib/email/grounded-report.ts` |
| ⚫ | G28 | `lib/email/inject-chart.ts` (new) + `app/api/email-lab/ai/route.ts` |
| 🟢 | G29 + G30 | `scripts/email/snicklefritz.mts` (same group as E23–E25) |
| 🩶 | H32 + H33 + H34 | `lib/email/doc/schema.ts` + `app/api/email-lab/ai/route.ts` |

Tasks safe to fan out in parallel (no shared files) — marked ✦ above:
- A3, A4, A5, A7, A8, A9, A10 — text edits to `CONTRACT.md` / `scripts/session-kickoff.mjs`
- A1 + A2 + A6 — `.claude/hooks/` only (run as one task, sequential within)
- B12 — no action
- C13 — audit + prompt update only
- C14 + C16 — migration + chart query (run sequentially, share new table)
- C15 — new `lib/email/pick-template.ts` only
- D17 + D18 + D19 — `chart-image.ts` (run as one task, sequential within)
- D22 — post-deploy check only
- E23 + E24 + E25 + G29 + G30 — `snicklefritz.mts` (one task, sequential within)
- E26 — `resolve-brand.ts` only
- F27 — `blast/route.ts` + `grounded-report.ts` (run as one task, sequential within)
- G28 — `lib/email/inject-chart.ts` + `email-lab/ai/route.ts` (sequential: after D17 for chart quality)
- G31 — future Wave 5, no file conflict

---

## FAN-OUT WAVE ORDER (awaiting operator approval)

### Wave 1 — Rule enforcement (parallel across groups)
- **A1/A2/A6**: Create `.claude/hooks/block-unauthorized-sends.mjs` + `print-contract.mjs`
- **A3–A10 + A7**: Batch edit `CONTRACT.md` (all text additions, one commit); modify `scripts/session-kickoff.mjs` for FUCKCLAUDE.md

### Wave 2 — Data foundation (sequential within sub-groups; parallel across them)
- **C13**: Audit `daily_truth` pipeline, confirm or drop `median_sale_price`
- **C14 → C16**: Migration first (C14), then update chart data query to use new table (C16)
- **C15**: New `lib/email/pick-template.ts` with `pickTemplateByModel()`

### Wave 3 — Email renderer (one task, chart-image.ts)
- **D17 + D18 + D19**: Rewrite `trendChartSvg()` — gridlines, area fill, labels, `usdFmt`, grain label

### Wave 4 — Chart wire + root cause bug fix (parallel across groups)
- **F27**: Fix `blast/route.ts:140` — add `resolveUserBrand` call + pass `brand` to
  `renderGroundedReport`; make `brand:` non-optional in `RenderGroundedOptions`; run
  `bunx next build` to surface any other missing call sites
- **G28**: Create `lib/email/inject-chart.ts` — pre-generate chart PNG, upload to
  `email-media` bucket, inject as image block into `EmailDoc` before AI content patch;
  wire into `handleContentPatch()` in `email-lab/ai/route.ts`. Depends on D17 (chart
  quality) and C14 (history table) being done first.
- **B11**: Add `gapFillBuildPayload()` to new `lib/email/gap-fill-pass.ts`, wire into builder route

### Wave 5 — Headless runner (sequential: E23 → E24 → E25, with G29 + G30 inline)
- **E26**: Add `normalizeFixtureBrand()` to `resolve-brand.ts` (do first — E23 depends on it)
- **E23 → E24 → E25**: Build `snicklefritz.mts` end-to-end including G29 (brand+logo gates)
  and G30 (preview HTML saved to `tmp/`)
- **C15**: `pickTemplateByModel()` in `lib/email/pick-template.ts` (E23 depends on this too)

### Wave 6 — Verify
- **D22**: Post-deploy URL check for logo PNGs
- **B12**: No action (already correct)
- Run full SNICKLEFRITZ dry-run: check `tmp/` preview files in browser, confirm brand
  colors present, logo visible, chart rendered, two different templates. THEN set
  `SNICKLEFRITZ_SEND_APPROVED=1` and send.

### Wave 7 — Future (G31)
- **G31**: Arrival landing page — wire CTA URL to `/welcome?broker=<slug>&zip=<zip>&ref=snicklefritz`

---

## H — EMAIL LAB AI PARSE FAILURES (diagnosed 2026-06-26)

> Context: Email Lab AI returns "try rephrasing" instead of patching the doc.
> Three culprits diagnosed. System prompt fixes (four-lane rule in both `contentPatchSystem`
> and `legacyTokenSystem`) were ALREADY APPLIED in commit `1c92328d` — those are DONE.
> The three items below are the remaining actual fixes.

---

### H32 — `z.strictObject` in `BlockContentPatchSchema` causes false parse rejections (most likely)

**Problem:** `lib/email/doc/schema.ts:215` uses `z.strictObject` for `BlockContentPatchSchema`.
Any key Haiku returns that isn't in `{kicker, value, label, prose, title, body, caption, alt,
tagline, stats}` causes an instant `ContentPatchSchema.safeParse` failure → `tryParsePatch`
returns null → route returns "try rephrasing." For unusual prompts ("daily charted home sales
list"), Haiku likely returns extra keys like `chart_data`, `items`, `list`, or tries to patch
`designation` (on an `agent-hero` block) — all valid from Haiku's perspective, all lethal to
`z.strictObject`.

**Why z.strictObject is wrong here:**
The security intent ("AI fills content, never restyles") is already enforced by two downstream
gates that are stronger:
1. `applyPatch()` in `route.ts:99` — merges only the patch fields, but since block prop schemas
   use standard `z.object` (not strict), extra keys would be in the merged object temporarily
2. `EmailDocSchema.safeParse(candidate)` in `route.ts:167` — re-validates the entire doc
   through `BlockSchema` which uses `z.object` (strip mode) for every block's props schema;
   unknown keys from the AI are stripped here before the doc is returned

So `z.strictObject` on the patch is a redundant gate that produces false positives.

**Sourced answer:**
- Source: `lib/email/doc/schema.ts` read 2026-06-26 — `z.strictObject` at line 210 and 215
- `applyPatch` at `route.ts:105`: `{ ...b.props, ...p }` — merges but doesn't strip
- Final `EmailDocSchema.safeParse` at `route.ts:167`: uses `BlockSchema` which uses `z.object`
  (default strip) for every prop schema — unknown keys are stripped at this layer
- Therefore the "no restyle" invariant is maintained without `z.strictObject` on the patch

**Plan Task H32 [shares `lib/email/doc/schema.ts`]:**
In `lib/email/doc/schema.ts`:
1. Change `BlockContentPatchSchema` from `z.strictObject({...})` to `z.object({...})` (strip mode)
2. Change `StatPatchSchema` from `z.strictObject({...})` to `z.object({...})`
3. Update the comment on line 204 to explain the security is enforced by the final
   `EmailDocSchema.safeParse` re-validation, not by the patch schema itself

Result: Haiku can return `chart_data`, `items`, `designation` — they're stripped silently.
Valid text fields pass through. "Try rephrasing" only fires when Haiku returns NO JSON at all.

---

### H33 — Scope (ZIP) never extracted from prompt text; dossier is always region-wide

**Problem:** The route reads `body.scope` from the client request. If the client doesn't
parse the prompt for a ZIP code and send `{ kind: "zip", value: "33908" }`, the route
calls `fetchMasterDossier()` with no scope → region-wide dossier → Haiku has no ZIP-specific
data → vaguer, less accurate content fill. Not the cause of parse failures but degrades
quality for any ZIP-scoped prompt.

**Sourced answer:**
- Source: `route.ts:29` — `if (scope?.kind === "zip" && scope.value) params.set("zip", scope.value)`
- The route already supports ZIP scoping; the client just never sends it.
- Fix option A (route-side): extract ZIP from prompt text as fallback when `body.scope` is absent.
- Fix option B (client-side): the Email Lab UI sends `scope` with the prompt.
- Route-side is simpler and doesn't require UI changes.

**Plan Task H33 [shares `app/api/email-lab/ai/route.ts`]:**
In `route.ts`, add a ZIP extraction fallback above `fetchLakeContext`:
```ts
function extractZipFromPrompt(prompt: string): { kind: "zip"; value: string } | undefined {
  const m = prompt.match(/\b(3[3-4]\d{3})\b/); // SWFL ZIP range 33xxx-34xxx
  return m ? { kind: "zip", value: m[1] } : undefined;
}
```
Use it in `handleContentPatch` and the legacy token handler:
```ts
const scope = body.scope ?? extractZipFromPrompt(prompt);
const lakeContext = await fetchLakeContext(scope);
```
No UI change needed. If the user types "33908" anywhere in the prompt, the dossier is ZIP-scoped.

---

### H34 — No diagnostic log; impossible to know which failure mode hit

**Problem:** When `tryParsePatch` returns null, the route returns "try rephrasing" with no
log of what Haiku actually said. Diagnosing the failure mode (no JSON / strict rejection /
unknown error) requires adding a log and re-triggering the failure in prod.

**Sourced answer:**
- Source: Diagnosis description — "add one log line at route.ts:146 right after the model call"

**Plan Task H34 [shares `app/api/email-lab/ai/route.ts`]:**
In `route.ts` in `handleContentPatch`, after the `msg.content` text extraction:
```ts
const text = msg.content[0]?.type === "text" ? msg.content[0].text : "";
if (process.env.NODE_ENV !== "production" || process.env.EMAIL_LAB_DEBUG === "1") {
  console.log("[email-lab/ai] raw model response:", text.slice(0, 500));
}
```
Gate on `EMAIL_LAB_DEBUG=1` so it doesn't log in prod by default (avoid leaking user
prompts to logs), but can be enabled temporarily for any prod investigation via Vercel env.
If H32 is applied first and "try rephrasing" still fires, enabling this log will show
exactly whether Haiku returned no JSON or something else unexpected.

---

### H35 — Model routing: Haiku for interactive UI, Sonnet for SNICKLEFRITZ headless runner

**Problem:** The route uses a single hardcoded `MODEL = "claude-haiku-4-5"` for all callers.
Haiku is right for the interactive Email Lab UI (fast, cheap, accumulates cost on every
keystroke). Sonnet is right for SNICKLEFRITZ (one-shot build, quality matters, latency
doesn't, cost per run is trivial). A global swap would make the UI sluggish and expensive.
Keeping Haiku everywhere leaves SNICKLEFRITZ with weaker prose and looser dossier adherence.

**Sourced answer:**
- Cost delta: Haiku ~$0.001/call, Sonnet ~$0.012–0.015/call (~12×). Acceptable once for
  SNICKLEFRITZ; punishing for an interactive UI with many calls per session.
- JSON compliance: Sonnet produces near-zero non-JSON responses; Haiku occasionally returns
  conversational text (culprit 2 in the parse-failure diagnosis). H32 fixes the schema gate
  so both models work, but Sonnet is more reliable at the source.
- Model IDs (verified from session context): `claude-haiku-4-5`, `claude-sonnet-4-6`.
- H32 must be applied before this matters — `z.strictObject` rejects extra keys regardless
  of which model generated them.

**Plan Task H35 [shares `app/api/email-lab/ai/route.ts`]:**
In `route.ts`, replace the hardcoded `MODEL` constant with a per-request resolver:
```ts
const ALLOWED_MODELS: Record<string, string> = {
  haiku:  "claude-haiku-4-5",
  sonnet: "claude-sonnet-4-6",
};
const DEFAULT_MODEL = "claude-haiku-4-5";
```
In the `POST` handler, read `body.model` and resolve:
```ts
const model = ALLOWED_MODELS[body.model ?? ""] ?? DEFAULT_MODEL;
```
Pass `model` into `handleContentPatch` and the legacy token handler instead of the
constant. In `snicklefritz.mts` (E23), POST `model: "sonnet"` alongside the doc and scope.
The Email Lab UI sends nothing → defaults to Haiku, no change to existing behavior.

Dependency: apply H32 first. No point routing to Sonnet if the schema still false-rejects.

---

## EXECUTION ORDER FOR H ITEMS

H32 → H33 → H34 in a single commit (fixes + diagnostic gate).
H35 in the same commit or immediately after — one line change to `snicklefritz.mts` once
E23 exists; the route change ships independently and is inert until a caller sends `model: "sonnet"`.

### Wave 7 — Future (G31)
- **G31**: Arrival landing page — wire CTA URL to `/welcome?broker=<slug>&zip=<zip>&ref=snicklefritz`

---

## STATUS

All research done 2026-06-26 via crawl4ai + live code audit (files read, not memory).
Pattern analysis from `SNICKLEFRITZ-DO-THIS.md` (6 sessions, 14 hours) added 2026-06-26.

Key corrections vs initial draft:
- D17 renderer NOT fixed (was reverted via git checkout)
- C15 seed IDs ≠ template slugs (new pick-template.ts, not replace pick-seed.ts)
- A7 fix goes in scripts/session-kickoff.mjs, not the hook itself
- E26 fixture shape is nested `brand.palette.primaryColor`, not flat
- F27 NEW: blast/route.ts:140 missing `brand` arg — 9-hour root cause, verified in code
- G28 NEW: chart never wired into email builder — builder explicitly refuses to render one; confirmed in route.ts:96
- G29 NEW: pre-send verification gates (brand color assert + logo URL 200-check) before every Resend call
- G30 NEW: SNICKLEFRITZ preview must save rendered .html files, not stdout text
- G31 NEW: arrival landing for email CTA (Phase 3, future Wave 7)
- E23 updated: explicit about full dossier feed via scope param, chart injection (G28), preview save (G30), gates (G29)
- H32 NEW: `z.strictObject` on `BlockContentPatchSchema` causes false parse rejections — fix = change to `z.object` (strip mode); security maintained by final `EmailDocSchema.safeParse`
- H33 NEW: scope (ZIP) never extracted from prompt text — add `extractZipFromPrompt()` fallback in route
- H34 NEW: add `EMAIL_LAB_DEBUG=1`-gated diagnostic log so failure mode can be confirmed
- H35 NEW: model routing — Haiku default for interactive UI, Sonnet opt-in for SNICKLEFRITZ headless runner; `body.model: "sonnet"` from the runner, nothing from the UI
- DONE: system prompt four-lane rule changes in `contentPatchSystem` + `legacyTokenSystem` (commit `1c92328d`)

Total plan items: 35 (A1–A10, B11–B12, C13–C16, D17–D22, E23–E26, F27, G28–G31, H32–H35)
Already done: H-section system prompt changes (two strings, commit `1c92328d`)

Fan-out is BLOCKED until operator approves this plan.
