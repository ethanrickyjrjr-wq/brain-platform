# Email Lab AI + Social AI — pipeline/photo wiring audit + build-quality research

Date: 07/01/2026
Scope: read-only code audit (RULE 0.5) + crawl4ai research (RULE 0.4). No code changed for this report —
three agents read the codebase live, two agents ran crawl4ai against live vendor/design sources. Every
claim below cites a file:line or a fetched URL; nothing is from memory.

---

## Executive verdict

**Both AIs already share the same real data spine — that part is set up.** `lib/email/build-doc.ts`'s
`fetchLakeParts()` is the one function both the Email Lab AI (`authorDoc`, `buildContentDoc`) and the
Social AI (`buildWeek`, `authorSocialPost`) call for lake context. It pulls real per-ZIP numbers via
`loadMarketFigures()` (`lib/email/market-context.ts`) and the full site dossier via a real `/api/b/master`
fetch. Not invented, not stubbed.

**But "all the new pipeline information" is only half-true.** The listing-lifecycle pipeline that graduated
to a live daily cron *this morning* (commit `c5eec3ea`, 03:27am) does reach both AIs — but only as
**aggregated ZIP stats** (`listing_count`, `median_list_price`, `avg_days_on_market`) via a Supabase view.
The pipeline's actual product — **event-level data** in `listing_transitions` (status changes, price cuts,
relisting/holding patterns, per-listing DOM) — is referenced **nowhere** in `lib/` (confirmed by grep, not
inferred). Neither AI can say "this listing just went pending after 3 price cuts" — only "this ZIP has 47
active listings, median $410K, 62 days on market."

**Photo access is asymmetric, not absent.** Social AI has the good photo path (real MLS/realtor listing
photos + aerial fallback). Email Lab AI has the weak one (`og:image` scraping, which Zillow/Realtor block).
The fix is cheap: the plumbing Email Lab needs already sits one function-call away in code it already
imports.

**Scheduling/send is not "set up" for either AI — it's a UI button, not agent knowledge.** Neither AI's
system prompt or tool list mentions send or schedule. A user can type "send this every Monday at 8am" to
neither Email Lab AI nor Social AI and have it act — that has to happen through a separate modal
(`ScheduleSendModal`) after the AI is done. For social, the whole publish path is additionally still off in
production (`SOCIAL_PUBLISH_ENABLED` false, cron commented out).

Bottom line: **confirm-with-caveats, not confirm-clean.** Don't rebuild anything — extend what's already
wired. Concrete plan below.

---

## Wiring matrix

**Real lake data (numbers)**
- Email Lab AI: WIRED — `fetchLakeParts()` → `loadMarketFigures()` (`lib/email/market-context.ts`) +
  `/api/b/master` dossier (`lib/email/build-doc.ts:71-95`), called from both `buildContentDoc`
  (`build-doc.ts:402-407`) and `authorDoc` (`build-doc.ts:603-607`).
- Social AI: WIRED — same `fetchLakeParts()` import, called from `buildWeek()`
  (`lib/email/social-calendar/build-week.ts:261-296`) and `authorSocialPost()`
  (`lib/social/design/author.ts:194-232`).

**Listing-lifecycle pipeline — aggregated ZIP stats**
- Email Lab AI: WIRED — `loadMarketFigures` queries `data_lake.active_listings_residential_zip_stats`
  (`market-context.ts:116`), a view fed by the listing-lifecycle pipeline's `listing_state` table
  (`ingest/pipelines/listing_lifecycle/distill.py:69`, `source_name='api_feed'` lane only).
- Social AI: WIRED — same view, same path (both labs share `fetchLakeParts`).

**Listing-lifecycle pipeline — event-level data (`listing_transitions`)**
- Email Lab AI: NOT WIRED — zero references in `lib/` (grep-confirmed).
- Social AI: NOT WIRED — same.
- This is the real gap behind "give them the new pipeline information."

**Real listing/MLS photos**
- Email Lab AI: NOT WIRED — `buildContentDoc` already calls `loadListingContext()`
  (`build-doc.ts:406`) but only reads `.figures` for text (`renderListingsBlock`, `build-doc.ts:456`);
  it never touches `.ranked` / `attachFeaturedAerial`, which is sitting right there in the same return
  value. `authorDoc` doesn't call `loadListingContext` at all.
- Social AI: WIRED — `loadListingContext` → `attachFeaturedAerial()` (`lib/listings/select.ts:164-187`,
  prefers real `photoUrl` from SteadyAPI/rdcpix CDN, falls back to Mapbox aerial only if no photo exists)
  and a second copy of the same logic in `author.ts:161-174` (`attachListingPhoto`) for the canvas author
  path.

**og:image hero photo (brand sites, listing URLs mentioned in a prompt)**
- Email Lab AI: WIRED but weak — `resolveHeroPhoto()` (`build-doc.ts:216-233`) calls `fetchOgImage()`
  (`lib/email/og-image.ts`), which is a **plain `fetch()` + regex meta-tag parse, not crawl4ai** — the
  2026-06-28 design doc's claim that this uses crawl4ai does not match current code. The file's own
  comment admits Zillow returns 403 and Realtor returns 429 against it.
- Social AI: NOT WIRED — no og:image call found in `lib/social/` or `lib/email/social-calendar/`.

**User-uploaded project photos (PhotosPanel)**
- Email Lab AI: NOT WIRED — `components/email-lab/PhotosPanel.tsx` is manual-pick-only UI; never referenced
  by any AI context builder.
- Social AI: NOT WIRED — same gap, shared across both surfaces.

**Scheduling/send — AI awareness**
- Email Lab AI: NOT WIRED — `authorSystem()` / `contentPatchSystem()` (`author-doc.ts`, `build-doc.ts`)
  contain no mention of send/schedule. `ScheduleSendModal.tsx` → `/api/email/schedule-command` is a fully
  separate button path the AI has no knowledge of.
- Social AI: NOT WIRED (same gap) — and the underlying publish engine is additionally **disabled in
  production**: `SOCIAL_PUBLISH_ENABLED` gates every channel adapter (`lib/social/channels/{x,meta,
  linkedin,gbp}.ts`) and defaults off; `.github/workflows/social-scheduler.yml`'s cron trigger is commented
  out ("SCHEDULE PAUSED until go-live"). The scheduling code (`freezePost`, `social_schedules`,
  `run-schedules.mts`) is real and complete, just not live.

**Live-verify status**
- `social_ai_author_live_verify`, `social_canvas_composer_live_verify`, `social_u1_connect_live_verify` are
  all still open checks as of today — the 2026-06-30 social-author design has landed in code but hasn't
  cleared its own verification gate yet.

---

## Gap list, ranked by cost/value

**1. Email Lab AI ignores real listing photos it already has access to (cheapest, highest value).**
`buildContentDoc` calls `loadListingContext(scope, ...)` and discards everything except `.figures`.
Wiring `.ranked` / `attachFeaturedAerial` into the email photo-resolution path (the same call Social AI
already makes) is a small, additive change against infrastructure that's already imported and tested. No
new pipeline, no new API, no new photo source — just use what's already in scope.

**2. Neither AI can see listing-lifecycle's event-level signal.**
`listing_transitions` (status changes, price cuts, holding patterns, per-listing DOM) never reaches either
AI's context. This is the actual "new pipeline information" the pipeline was built to produce, and it's
currently invisible above the aggregate-stats layer. Needs: (a) a query/summarizer that turns raw
transition rows into a short cited digest (e.g. "3 price cuts in ZIP 33928 this week, 2 relistings") the
same way `loadMarketFigures` turns raw rows into `MarketFigure[]`, (b) fold that into `fetchLakeParts` (or
a sibling function) so both labs pick it up through the one shared spine, no per-surface duplication.

**3. Neither AI has PhotosPanel (user-uploaded project photos) wired in.**
Shared gap across both surfaces. Lower priority than #1/#2 since real listing photos + og:image already
cover the common case; user-uploaded photos matter for brand assets / non-listing content.

**4. Scheduling/send has zero presence in either AI's system prompt or tool list.**
This is the literal ask ("send functions set with scheduling"). The fix isn't a redesign — `schedule-
command.ts` already has a well-typed, validated tool (`SCHEDULE_COMMAND_TOOL`, `cadence` enum +
`day_of_week`/`day_of_month` + `send_hour_et`). The gap is that this tool is never offered to the same
model call that authors the deliverable — scheduling only happens after the fact, through a separate UI
modal the AI never sees. Making the AI aware of it (even just able to *propose* "want me to schedule this
weekly?") requires exposing the existing tool in the author call, not building a new one.

**5. Social publish path is code-complete but off.**
Separate from AI awareness — even if Social AI could call the schedule tool, the underlying cron is
commented out and `SOCIAL_PUBLISH_ENABLED` is false. This is an operator go-live decision, not a build gap;
flagging it so it isn't confused with #4.

---

## Concrete plan per gap (mapped to the research)

### Gap 1 — wire real listing photos into Email Lab AI
Change `buildContentDoc`/`authorDoc` to call the same `attachFeaturedAerial` step Social AI already uses
against the `.ranked` listings `loadListingContext` returns, instead of stopping at `.figures`. No new
research needed — this is reusing code, not adopting a new pattern.

### Gap 2 — surface listing-lifecycle's event-level signal
Design-quality research (§2.1, chart-type-by-data-shape) is directly relevant here for anything that turns
transitions into a chart (e.g. a small multiples / stacked bar of status changes per ZIP per week). For the
text-digest side, the tool-awareness research's **Tool Use Examples** finding (§1.3 — Anthropic's own
measured 72%→90% accuracy lift from attaching 3-5 concrete example payloads to a tool) is the right fix
once this becomes a tool call rather than baked-in prose: show the model 2-3 example "transition digest"
payloads so it learns the summarization convention instead of improvising it per request.

### Gap 3 — PhotosPanel → AI
Lower priority; when tackled, the design-quality research's closed-token-schema finding (§1.3, "remove LLM
footguns from the schema itself") applies directly — expose photo selection as a constrained enum/ID
reference into the project's uploaded set, not a freeform URL field the model could hallucinate.

### Gap 4 — scheduling/send awareness (the literal ask)
This is where the tool-awareness research pays off most directly:
- **Add `strict: true`** to `SCHEDULE_COMMAND_TOOL`'s definition (now GA on the Claude API, not beta) —
  grammar-constrained sampling guarantees `cadence`/`send_hour_et` conform to schema before the existing
  zod layer ever runs, a low-risk additive change to a feature whose entire job is firing recurring sends.
- **Add 3-4 `input_examples`** to the schedule tool (one weekly, one monthly, one bare-hour clarify case) —
  this is the vendor-recommended fix for exactly the "convert '7am' → 7, '5pm' → 17" convention-ambiguity
  the system prompt currently handles as an ever-growing paragraph of prose rules.
- **Keep the typed-field design** (`cadence` enum + day-of-week/month + hour), don't switch to raw cron —
  both a live production scheduler (Hermes Agent) and a popular MCP scheduler (PhialsBasement/scheduler-mcp)
  converge on typed fields over exposing cron syntax to the LLM; this validates the current design rather
  than asking for a change.
- **Do NOT reach for Tool Search Tool / tool-catalog deferral yet.** Both AIs currently make isolated,
  single-forced-tool calls per API route — nowhere near the 10-tool/10K-token threshold where deferred
  loading pays off. This becomes relevant only if/when Email Lab AI and Social AI get consolidated into one
  agent loop holding data-lake + photo + chart + send + schedule tools together at once — flag it as
  forward-looking, not a near-term action item.

### Gap 5 — social publish go-live
Not a build task — an operator decision to flip `SOCIAL_PUBLISH_ENABLED` and un-comment the cron once
`social_ai_author_live_verify` and siblings close. No research dependency.

---

## Research appendix

Two crawl4ai passes ran against live vendor/design sources (RULE 0.4 — no Firecrawl, no memory). Full
detail with verbatim quotes and every source URL:

- `_ASSISTANT/research/2026-07-01-ai-tool-awareness-scheduling-research.md` — tool-use best practices,
  scheduling/recurring-task patterns, and grounding an agent's knowledge of a large tool catalog. 8 sources,
  all Anthropic Engineering / Claude Platform Docs / two live MCP scheduler implementations, fetched live.
- `_ASSISTANT/research/2026-07-01-ai-deliverable-design-quality-research.md` — layout/grid rules an LLM can
  mechanically follow, chart-type-by-data-shape decision rules, accessible data-viz palettes + WCAG
  contrast minimums, and current (March 2026) social platform dimensions/safe zones. 9 sources: Material
  Design 3, Atlassian, WebAIM/WCAG, US federal data-design standard, Canva, and a March-2026 Meta safe-zone
  update (confirms Meta shifted its own guidance this year — square is no longer the recommended default
  for Instagram feed).

Headline facts worth knowing without opening the appendix files:
- `strict: true` structured tool use is GA on the Claude API today (not beta) — grammar-constrained
  sampling, no retries needed for schema violations.
- Tool Use Examples (1-5 example payloads attached to a tool definition) measured 72%→90% accuracy on
  convention ambiguity in Anthropic's own testing.
- Tool Search Tool (deferred tool loading) cuts token overhead ~85% and lifts accuracy on large tool
  catalogs (Opus 4: 49%→74%) — not relevant to our current single-tool-per-call architecture, but the right
  answer if/when the AIs consolidate into one multi-tool agent loop.
- 8pt spacing grid + "external spacing ≥ internal spacing" is a mechanically self-checkable design rule, not
  a vibe — the single most codeable layout instruction found.
- Chart type should be picked from a literal data-shape decision table (time series → line, categorical →
  bar, two numeric vars → scatter, distribution → histogram, part-to-whole ≤5 slices → pie else bar) —
  removes the most common AI chart-selection failure mode.
- WCAG 1.4.11 (3:1 contrast between adjacent chart elements) and 1.4.3 (4.5:1 for text) are cheap,
  deterministic gates a chart-generation pipeline can enforce automatically before a chart ships.
- Meta unified its Stories/Reels safe zone in March 2026 (top 14%, bottom 20-35% danger zone, sides 6%) and
  now recommends 4:5 over 1:1 for feed images — a genuinely current spec change worth reflecting in Social
  AI's default output format, exactly the kind of drift RULE 0.4 exists to catch.

---

## What this report does NOT do

Per instruction, nothing in the codebase was changed to produce this report. All findings above are read-
only observations with file:line citations; the "concrete plan" sections are recommendations for a future
build, not work already done. The two research files are new, untracked files under `_ASSISTANT/research/`
alongside this one — nothing else in the repo was touched by any of the five agents that produced this
report (verified via `git status` before and after).
