# The Highlighter — in-page "point at a fact → ask or chart it" (design + plan)

> Status: approved 2026-06-07. Phase 1 = ask-in-place (cap off); Phase 2 = "Chart this"; Phase 3 = flip
> enforcement when the pricing talk lands. Source-of-truth design for a fresh builder. Exact free-tier numbers
> are deferred to the separate cross-feature pricing talk (see `checks`).

## Context

The in-chat MCP chart widget is blocked host-side (claude-ai-mcp#61/#165), so `swfl_fetch` is text-only. We
bring rich, grounded interaction back to **our own surface** (`/r/` report pages), where we control rendering.
**The Highlighter** is SWFL Data Gulf's in-page layer: a user points at a specific fact on a report (selects on
desktop, taps a chip on phone) and a popup — anchored to that fact and grounded in the report's dossier — lets
them **ask about it** or **chart it**.

Why this over copy-prompt / claude.ai deep-link buttons: those _leave_ the page to get back to Claude. The
Highlighter brings the answer _to the fact_. It is the **Tier-3 Conversation layer** (THE-GOAL / Goal-2 carry
contract) made visible — the dossier + rules-of-engagement block already ride in every payload; this is the UI
that lets a user talk to that grounded context.

**Decisive architecture call (locked):** the metered actions run **server-side on our Anthropic key**, not as a
handoff to the user's Claude. The business model is freemium with usage caps ("5–10 free/week, then pay"), and
**we can only count and cap what flows through our server.** A handoff is uncappable. Cost is acceptable
(comparable either way) and the in-page feel is better. A free "open in your Claude" link stays as an unmetered
escape valve + MCP-distribution lever.

Written after a 12-agent code audit of the existing chart/CRE/refinery/MCP surfaces; reuses verified seams and
folds in the audit's correction list (see _Reused seams_).

## Locked decisions

| Decision      | Choice                                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| Scope         | **Ask-in-place → then chart.** Phase 1 = ask; Phase 2 = "Chart this".                                       |
| Suggestions   | **Precomputed at build** (2–3 per `key_metric`, shipped in the dossier) → instant, $0/open.                 |
| Engine        | **Server-side, our key** (`/api/converse`), so every use is **meterable**.                                  |
| Grounding     | The **current report's dossier + rules-of-engagement** only. Cite-or-decline.                               |
| Desktop input | Text **selection** (mouseup/keyup, settle timer, suppress inside inputs/the popup).                         |
| Mobile input  | **Tappable chips** — every `key_metric` value + resolved place/ZIP is a tap-target firing the _same_ popup. |
| Chart action  | Deterministic via **`lib/route-chart.ts` → `ChartBlock` → `ChartBlockView`**, rendered in-page (≈$0).       |
| Monetization  | **Meter from day 1, enforcement OFF**. Flip a config to enforce N/week + paywall when pricing lands.        |
| Provenance    | Structural context-restriction: the endpoint sees **only** dossier + rules (no web/tools).                  |

## Architecture / components

New UI under `components/highlighter/**` and `app/api/converse/` — **clean-room, our stack only** (Next +
React 19 + Anthropic SDK + our dossier). No code copied from any other repo.

1. **Fact detection** — `lib/highlighter/use-highlight.ts` (`"use client"`): desktop selection hook (mouseup/
   keyup, 10 ms settle, snapshot `{text, rect, factType}` before mounting; suppress inside inputs/the popup).
   **Mobile chips:** at render time on `/r/` pages wrap each `key_metric` value + recognized place/ZIP token in
   a tappable `<FactChip>` → same snapshot path. **Fact typing:** reuse `refinery/lib/place-resolver.mts`
   (`resolvePlace`) so a place/ZIP carries its corridor/ZIP id; numbers carry their `key_metric` slug.
2. **Popup** — `components/highlighter/HighlightPopup.tsx` (`"use client"`): anchored to the fact's rect,
   smart-positioned (prefer right, flip left, center fallback, 12 px gutter), closes on Esc/outside/X only.
   Three states: **Suggestions** (instant) → **Ask** (composer) → **Answer** (streamed). Footer: "Chart this" +
   free "Open in your Claude ↗".
3. **Grounding endpoint** — `app/api/converse/route.ts` (SSE streaming). Input `{report_id, fact, question}`.
   Loads the report dossier (reuse the `buildDossier` path used by `/api/b/[slug]`) + injects
   `refinery/lib/rules-of-engagement.mts`. **No tools, no web.** Streams from Anthropic (**Vendor-First:** model
   id + `messages.create` streaming shape verified live via `claude-api`; do NOT copy `claude-sonnet-4-6` from
   memory). System prompt hard-codes cite-or-decline, quote `freshness_token` once, no sub-ZIP invention,
   `[INFERENCE]` + falsifier. The **meter checkpoint** lives here. Provenance here is "instructed +
   context-starved" rather than lint-enforced — acceptable because the model sees only the dossier.
4. **Chart action** — "Chart this" → `lib/route-chart.ts` (`routeChart`, shipped) → `ChartBlock` → render with
   the **named** `ChartBlockView`. Deterministic, ≈$0, metered (1 use).
5. **Precomputed suggestions** — refinery build step in `refinery/stages/4-output.mts` (after the validator
   gate + `.md` write): 2–3 suggested questions per numeric `key_metric` written into the dossier/brain.

## Discovery

- **First-touch coachmark** (`components/highlighter/FirstTouchHint.tsx`) once per visitor on first `/r/` view:
  _"Tap any figure or place to ask about it or chart it."_ Dismiss flips a `seen` cookie.
- **Visible affordance** — chips styled to look tappable; a one-line desktop hint under "Key metrics".
- **MCP return copy** — one line in `app/api/mcp/server.ts`: _"Open the report and tap any figure to dig in."_
- **"At a glance"** inline report chart stays as a complementary surface; its bars are Highlighter targets.

## Monetization — free now, meter later (mechanism, not final numbers)

- **Metered unit:** one _answer_ (`/api/converse` completion) **or** one _chart generation_ = **1 use**.
  Suggestions + reading are free.
- **Counter:** `usage_events` (Supabase), keyed by signed-cookie client id + ISO week, server-incremented; IP
  secondary. Anonymous rows only, no PII.
- **Enforcement flag:** `HIGHLIGHTER_FREE_WEEKLY_CAP` — **initially unlimited**. When pricing lands, set it
  (hypothesis: 5–10/week) → (N+1)th use returns a **paywall card**.
- **Paywall:** reuse `/#waitlist` and/or the `$39/$79` zip-report gate.
- **Belt:** `HIGHLIGHTER_DAILY_USD_CEILING` repo var → 503 when the day's spend trips it.

## Mobile is first-class

- Input = chips, not selection. Popup fully responsive (max-width, viewport-gutter, flips above/below).
- **Audit fix folded in:** `HBarChart` is fixed-px, NOT responsive (no media/clamp/fluid grid; `148px 1fr 76px`
  - `min-width:320px`). For 375 px readability add `clamp()` font-sizing + a fluid label/value grid — required
    sub-task, not inherited.

## Build sequencing

1. **Phase 1 — Ask-in-place (cap OFF):** fact detection (selection + chips), popup (3 states), precomputed
   suggestions, `/api/converse` (grounded, streamed, model verified live), meter (counting, enforcement off),
   discovery coachmark, free "open in your Claude" link.
2. **Phase 2 — "Chart this":** wire to `route-chart.ts` → `ChartBlockView` inline; HBarChart responsive fix.
3. **Phase 3 — Flip enforcement:** set `HIGHLIGHTER_FREE_WEEKLY_CAP`, wire the paywall card. Config + UI only.

Each phase ends with a top-of-file `SESSION_LOG.md` entry + `node scripts/safe-push.mjs` + `checks` reconcile.

## Verification

- **Desktop:** select "$30,074/yr AAL" → popup anchors; suggestions instant; click one → grounded answer
  streams, cites or declines, quotes freshness token once, no sub-ZIP invention.
- **Mobile (375 px):** tap `[$30,074/yr]` chip → same popup, readable, no h-scroll; chart renders cleanly.
- **Chart:** "Chart this" → real `ChartBlock` inline (no invented values; `lintChartBlock` passes).
- **Meter:** each answer/chart increments `usage_events`; with a test cap, (N+1)th call returns paywall; the
  daily-$ kill-switch trips → 503.
- **Discovery:** first `/r/` visit shows the coachmark once; dismiss persists.
- `bun test` + `npm run refinery:typecheck` (only the ~18 baseline strictness errors; no new ones).

## Reused seams (verified in the audit) + corrections to honor

| Surface                                                                    | Status                                                    | Note                                                                                          |
| -------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `lib/route-chart.ts` (`routeChart`)                                        | shipped                                                   | The chart-from-fact seam — reuse, don't reinvent.                                             |
| `refinery/lib/place-resolver.mts` (`resolvePlace`)                         | ok                                                        | Fact typing for places/ZIPs.                                                                  |
| `ChartBlock` + `lintChartBlock` (`refinery/validate/chart-block-lint.mts`) | ok                                                        | Contract + provenance lint (0.05, lenient).                                                   |
| `ChartBlockView` (`components/charts/ChartBlockView.tsx`)                  | ok `"use client"`                                         | Import the **named** export; server-renderable (plain-JSON prop).                             |
| `HBarChart`                                                                | ⚠️ not responsive                                         | Add `clamp()` + fluid grid for 375 px (required).                                             |
| `buildDossier` (`lib/fetch-brain.ts`) + `Dossier.chart?`                   | ok                                                        | Reuse `/api/b/[slug]` dossier path; `chart?` slot exists, unfilled.                           |
| `rules-of-engagement.mts`                                                  | ok                                                        | Inject verbatim into the `/api/converse` system prompt.                                       |
| `getAnthropic` + forced-tool pattern (`refinery/agents/*`)                 | ok                                                        | Mirror SDK shape; **re-verify the model id live**.                                            |
| `app/api/mcp/server.ts` `registerTool` (~:201)                             | ok                                                        | Add the one-line discovery copy; optional `swfl_make_chart` later.                            |
| MCP `auth.ts` no-op stub                                                   | tenancy blocker                                           | Anonymous metering only (signed cookie) until accounts exist.                                 |
| `docs/sql/20260517_personal_vault.sql`                                     | ⚠️ single-tenant                                          | No RLS / no `user_id`; `usage_events` keys on client id, not this template.                   |
| `refinery/stages/4-output.mts`                                             | lines accurate (gate 537–590, write 649, sidecar 658–671) | **Add `rm` to the `node:fs/promises` import**; mind `dryRun`/`HOLD` early returns at 600/638. |
| `brains/*.md` committed (not gitignored)                                   | ok                                                        | Suggestion artifacts are commit-safe.                                                         |

## Engine — verified vendor facts (Vendor-First, 2026-06-07)

Confirmed live via the `claude-api` skill + `platform.claude.com` models page (not memory):

- **Model: `claude-haiku-4-5`** (alias; pinned ID `claude-haiku-4-5-20251001`). Rationale: fastest model,
  near-frontier intelligence, $1/MTok in · $5/MTok out, 200K context (a single report dossier is a few K
  tokens — ample). This is a deliberate cost/latency pick for a high-volume public chat; `claude-sonnet-4-6`
  ($3/$15, 1M ctx) is a one-line upgrade if answer quality needs it. **Do not** use Opus here (too slow/costly
  for this surface). Haiku 4.5 supports extended thinking but **not** adaptive; run it with
  `thinking: {type: "disabled"}` (or omit) for latency — this is a factual lookup, not a reasoning task. Do
  **not** pass `effort` (errors on Haiku).
- **Streaming shape (TS SDK):** `client.messages.stream({ model, max_tokens, system, messages })`, then
  `for await (const text of stream.textStream) { … }` (or handle `content_block_delta` → `text_delta` events);
  pipe each delta to the browser as an SSE `data:` line from the Route Handler. `getAnthropic()` already exists
  (`refinery/agents/anthropic.mts`, env `ANTHROPIC_API_KEY`).
- **Cacheable prefix:** put rules-of-engagement + dossier in a `system` array block with
  `cache_control: {type: "ephemeral"}`; render order is `system` → `messages`, so the volatile user question
  goes last in `messages` (never in the cached prefix). ⚠️ **Haiku's minimum cacheable prefix is 4096 tokens** —
  if rules+dossier fall under that, caching silently no-ops (`cache_creation_input_tokens: 0`). It mainly helps
  multi-turn follow-ups on the same report; a single-turn ask won't benefit. Verify with
  `usage.cache_read_input_tokens`.

**Cost model for the freemium cap** (input ≈ rules ~500 + dossier ~3,000 + question ~50 ≈ 3,550 tok; output
≈ 350 tok):

| Model                   | $/answer (uncached) | $/1,000 conversations (~1.5 turns) |
| ----------------------- | ------------------- | ---------------------------------- |
| **Haiku 4.5 (default)** | ~$0.005             | **~$5–8**                          |
| Sonnet 4.6 (upgrade)    | ~$0.016             | ~$20–25                            |

Takeaway: cost is **not** the constraint — even a heavy free user (10/week) costs single-digit cents/week on
Haiku. The weekly cap and per-IP limit are **monetization levers**, not cost controls; the daily-$ kill-switch
is cheap insurance against a runaway/abuse spike, not an expected cost.

## Reach Expansion — letting the Highlighter pull BEYOND one report (R0+R1+R4 committed; R2 next)

> Added 2026-06-07 after a live lake-probe + DAG/cadence audit (every fact below verified in-session via
> `mcp__lake__list_views`/`describe_view`, the route inventory, and a refinery-DAG code read — not remembered).
> **Status: DECIDED 2026-06-07** — target = **R0 + R1 + R4 now** (one combined build on top of Phases 1–3),
> with **R2 deferred to its own spec** as the headline follow-up, and **R3 rejected** on the public surface.
> Phases 1–3 above stand as written (one-dossier grounding is the base the reach layer extends). The chosen
> rungs are **[COMMITTED]**, the deferred one **[NEXT SPEC]** in the ladder table below.

### The reframe (what's already true)

Three facts change the question from "can we?" to "how far up the ladder do we go?":

1. **Every `/r/` page is already an API.** `GET /api/b/<slug>?view=speak&format=json` returns a structured
   dossier for any published brain. A server-side engine on the Naples page can already fetch Fort Myers, Cape
   Coral, or `master` by slug. The pages ARE "connected through an api" — that wiring just isn't pointed at the
   converse engine yet.
2. **The page already secretly holds cross-area data.** A housing dossier's `detail_tables` carries **every SWFL
   ZIP** (price, YoY%, DOM, inventory), even though the page only _renders_ the local rows. On a Naples housing
   report the AI is **already holding Fort Myers' numbers** — cross-ZIP comparison in one vertical costs $0 and
   needs no new fetch. We just have to tell the engine it's allowed to read them.
3. **The lake holds FAR more than any report renders, including real time-series.** Verified live: storm events
   1996–2025, USGS water 2000–2026, HURDAT2 1851–2024, ZORI rents, Redfin, BLS OEWS by year, FRED LAUS
   point-in-time vintages, FAF5 freight, LeePA parcels/sales, `news`, search `demand`, and `city_pulse` /
   `city_pulse_corridors` (which hold ~13 columns and 49+ live signals while the brain surfaces only **8**). The
   runtime gap is not data — it's a **read endpoint**. The DuckDB query engine exists, but **dev-side only**:
   there is no `/api/lake` route on the site today (confirmed against the route inventory).

So "give the user access to all our data" is a **reach ladder**, and each rung ships independently:

### The reach ladder (R0 → R4)

| Rung                                                 | What it unlocks                                                                                                                                                                                                  | New build?                                                                                                                                                                                                | Keeps no-invention guarantee?                                                                                                                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R0 — In-dossier reach** `[COMMITTED]`              | Cross-AREA compare within one vertical (Naples vs. any SWFL ZIP) using `detail_tables` already in the payload.                                                                                                   | No — unlock in the converse system prompt + pass `detail_tables`.                                                                                                                                         | ✅ Structural (data is in-context, cited).                                                                                                                                                    |
| **R1 — Cross-report fetch** `[COMMITTED]`            | Pull ANY other brain/area server-side: other verticals on this page (CRE/permits/flood/tourism for Naples), other regions, `master` synthesis.                                                                   | Small–medium: server-side fetch + slug allowlist + `resolvePlace` routing + inject as a second grounded block.                                                                                            | ✅ Each fetched dossier is pre-validated, cited brain output.                                                                                                                                 |
| **R2 — Runtime lake read (bounded)** `[NEXT SPEC]`   | "Columns of recent info" the brains don't surface: monthly/yearly TIME-SERIES (ZORI trend for a ZIP, storm history), the FULL city_pulse signal set (not the capped 8), comp sets, aggregations.                 | Medium–large: new `/api/lake` read route wrapping the existing DuckDB engine, a **whitelist of parameterized reach-queries** (not free-form SQL), per-row citation enforcement, cache + cost/abuse guard. | ⚠️ Conditional — lake rows carry `source_url`; guarantee shifts from "context-starved" to "**every row must carry its citation or it's dropped**." Enforceable, but it's real work, not free. |
| **R3 — Free-form LLM SQL** `[REJECTED]`              | The model authors arbitrary SQL over the whole lake. Max power.                                                                                                                                                  | Large.                                                                                                                                                                                                    | ❌ Breaks the structural guarantee; injection + runaway-cost surface. **Recommend AGAINST on the public surface — keep dev-side only.**                                                       |
| **R4 — "Open in your Claude" handoff** `[COMMITTED]` | The user's OWN Claude takes this report's dossier (via the `swfl_fetch` MCP or a rich deep-link) + its own web reach, and builds whatever — combine our data with outside info, draft a doc, make a chart there. | Small: enrich the existing free link / MCP return so it carries the dossier.                                                                                                                              | N/A — it's their Claude, off our meter. Uncapped power-user lane + distribution lever.                                                                                                        |

### Per-option detail (possibilities · risks · build · limits)

**R0 — In-dossier reach.** _Possibilities:_ "How does Naples compare to Cape Coral / the cheapest Lee ZIP /
the county median?" answered instantly from rows already shipped. _Risks:_ none material; bounded to whatever
`detail_tables` the current brain carries. _Build:_ ~0.5 day (prompt + pass the table; the chart path already
renders bar comparisons). _User limit:_ one vertical at a time; only areas that brain tracks. _Speed:_ fastest
possible — zero new infra.

**R1 — Cross-report fetch.** _Possibilities:_ the Naples _housing_ page can now also speak CRE, permits, flood
AAL, tourism for Naples (fetch the sibling brain), or compare to a _different region's_ same-vertical report, or
pull `master` for the one-sentence cross-lake read. This is the "point at a fact on any page and reach any other
page" experience. _Risks:_ latency (1 extra fetch, ~100–300 ms), and an LLM tool-loop if we let the model choose
slugs — mitigate by resolving the target deterministically with `resolvePlace` + a fixed slug allowlist before
the model runs. _Build:_ ~2–3 days. _User limit:_ only **published** brains/areas; if a vertical has no brain
for that area, R1 can't conjure it (→ that's R2 or a new child brain). _Speed:_ fast; reuses the `/api/b` seam
wholesale.

**R2 — Runtime lake read (bounded).** _Possibilities:_ the big unlock — **time-series and not-yet-surfaced
columns.** Monthly ZORI for a ZIP, multi-year storm/flood history, the full city*pulse feed filtered to the
topics a CRE user cares about (transactions/development) rather than the brain's headline 8, ad-hoc comp sets
("Lee ZIPs under $400k with DOM < 45"). This is what makes the chart tool feel bottomless. *Risks:_ (a)
**provenance** — must enforce cite-or-drop per row (doable; lake rows carry `source_url`/`cited_text`); (b)
**cost/abuse** — a query endpoint is a new surface (cap rows, parameterize, rate-limit, daily-$ ceiling like the
converse meter); (c) **RULE 3 discipline** — exposing the lake at runtime is an architecture-shape change; build
it as a \_read view over existing tiers_, not a new mandatory gate, and don't let it become free-form (that's
R3). _Build:_ ~1–1.5 weeks for a solid bounded v1 (route + whitelist of ~6–10 named reach-queries + citation
enforcement + cache). _User limit:_ only the parameterized queries we ship; new shapes = a one-line whitelist
add, not user SQL. _Speed:_ slower to design (each reach-query is a tiny contract), but **the engine already
exists** — we're exposing it, not building DuckDB.

**R3 — Free-form LLM SQL.** Listed for completeness. Strong recommend: **no** on the public surface. Keep the
unrestricted lake query as the internal/dev tool it already is.

**R4 — Open in your Claude.** _Possibilities:_ the uncapped escape hatch. A user whose question we _can't_
answer in-page ("blend our flood AAL with my own insurance quotes and chart it") taps "Open in your Claude ↗";
their Claude pulls this report via the `swfl_fetch` MCP (or a dossier-carrying deep-link) and builds it there,
combining our cited data with anything else it can reach. _Answers the "go back to their Claude and tell it to
add to the /r/ info" question: **yes, this already works** via the MCP — R4 just makes the handoff carry the
full dossier so their Claude starts grounded._ _Risks:_ none to us (off-meter, off-surface); the chart is built
in their Claude, not rendered on our page, and we can't count it. _Build:_ ~0.5 day. _Strategic value:_ every
handoff teaches a user to `claude mcp add` us — distribution, not just escape.

### "Does it need to be a brain, or just columns of recent info?"

**Two different questions with two different answers — this is the key lever:**

- **To appear as a `/r/` REPORT** (a cited, governed, master-consumable voice): **yes, it needs a brain** — a
  full `PackDefinition` (~250+ lines for a leaf: `id`, `domain`, `scope`, `ttl_seconds`, `sources[]`,
  `input_brains[]`, `fitScore`, `corpusSummary`, `outputProducer`) + a cadence entry + vocab slugs + the
  validator gate. There is **no lightweight "just publish columns" path into the report/brain system** today.
- **For the converse/chart engine to GRAB fresh columns at runtime** (no report page, just data for a chart):
  **no brain required** — that's exactly R2. The columns already live in the lake; R2 exposes them through a
  bounded read. **So: brain = a governed opinion with a page; R2 = raw cited columns for charting.** Pick brain
  when master should _reason_ over it; pick R2 when the user just needs to _plot_ it.

### Child brains: "more important data that updates with the parent at the same time"

How the DAG actually behaves (verified in `refinery/lib/dag.mts` + `cli.mts` + `cadence_registry.yaml`):

- A child brain declares its parent via `input_brains: [{ id: "<parent>", edge_type: "input" }]` and registers
  in `refinery/packs/index.mts`. From then on it **auto-joins the nightly build order** — the resolver
  topologically sorts so parents build before children **in the same pass**.
- "At the same instant" — **no**, and that's by design: it's a dependency-ordered walk, not a simultaneous
  write. If the parent is fresh, the child reads its last-good output; if the parent went stale, the child still
  builds but **inherits a stale-caveat + `min(self, parent)` confidence** (CLAUDE.md Brain Factory rule 5). So
  the data stays consistent and _honest about staleness_ rather than silently mismatched.
- Edge types matter: `input` (feeds synthesis), `constraint`, `veto` (e.g. flood barrier), `modifier`. A child
  can carry "more important data" up to the parent as a thin-pipe metric (the parent reads only the child's
  `--- OUTPUT ---`, never its internals — Brain Factory rule 1).
- _Cost to add a child brain:_ ~2–4 days for a leaf (pack + cadence + vocab + validators); more if it needs a
  **new ingest source**. If the data already lands in the lake, the pack is the bulk of it.

### "Do city_pulse / corridor pulse get re-hit so the dossier and a CRE pull share data?"

- `city_pulse` rebuilds **daily** (`cadence_days: 1`), `city_pulse_corridors` **weekly** (`cron 0 10 * * 0`).
  Both distill into `data_lake.*` (Tier-2). The brain's report snapshots the **top 8** signals at its last
  build; the **table holds the full 49+** with topic (`breaking`/`transactions`/`development`/`business`/
  `structural`), per-row `source_url` + `cited_text`, and TTL-based expiry.
- **So yes:** via R2 a CRE user on a corridor page could pull a _different slice_ of city_pulse than the report
  renders — e.g. all `development` + `transactions` signals for their corridor over the last 30 days — fresher
  and richer than the dossier's 8, every row still carrying its citation. That is precisely the "assemble what
  they want" experience, and it is an R2 capability, not available from the dossier alone.

### Recommended sequence (partner-in-crime read)

Ship **R0 + R1 + R4 first** — together they're ~1 week, reuse seams we've already built, and _keep the
no-invention guarantee structural_. That alone makes the Highlighter feel like it can reach the whole platform
(every area, every vertical, master, plus the uncapped Claude handoff). **Then R2** as the headline "blow minds"
follow-up — bounded time-series + ad-hoc columns + full pulse — because it's where the real differentiation and
the real engineering (citation enforcement, cost guard) live; it deserves its own spec. **Skip R3** on the
public surface. Net: we get a game-changing tool fast, and we don't bet the no-hallucination guarantee — the one
thing that makes this product trustworthy enough to charge for — on the hardest rung.

## Out of scope (next talk)

- The **full cross-feature pricing matrix** (which features wall when; exact free counts for charts, searches,
  Highlighter; tiers). This plan sets only the Highlighter meter _mechanism_ + a 5–10/week hypothesis.
- Composed boards + PDF export ("save" target) — deferred.
- Persisting Highlighter conversations to an account — needs auth/tenancy (parked tripwire check).
- **R3 free-form LLM SQL** on the public surface (above) — explicitly rejected; dev-side lake query only.
