# MASTER PROBLEM INVENTORY — SWFL Data Gulf

**Date:** 2026-06-15 · **Status:** living register (append as we find more) · **No fixes in this file — problems only.**

## How to read this

Written from the **END-USER POV**: a person with hands and eyes, trying to impress a client with great data and great visuals. This is NOT a code audit. Where the **code says one thing and the user sees another, the user wins** — the problem goes on the list (the code note is recorded so we know where to look, but it does NOT downgrade the problem). "A button doesn't work" (user) and "the handler fires" (Claude) are two different facts; this file tracks the first.

**Status tags:**
- `USER-SAW` — operator observed it firsthand on the live site (authoritative).
- `LIVE` — confirmed by fetching the live site / DB this session.
- `CODE` — confirmed by reading the code this session.
- `DISPUTED` — code and lived experience disagree → must be reproduced live; listed anyway.
- `MISSING` — never built.

**Sources merged:** operator's live walkthrough (2026-06-15) · this session's audits (email-plan verification, full-site button walk, content/output diagnosis, live WebFetch of master read + pages) · the other instance's map (`docs/superpowers/plans/2026-06-15-site-scope-audit.md`).

**Next step (not in this file):** ULTRA PLAN, section by section. Every item has a stable ID so we can attack them one at a time.

---

## AT A GLANCE — for the ultra plan

**~47 problems + 11 missing features — but they collapse to ~5 root causes. Fix the causes, not the 47 symptoms.**

**Counts by area:** NAV 5 · BRF (AI/Briefcase) 10 · BTN (buttons) 10 · VIZ 5 · FUN 1 · FMT 1 · OUT (output quality) 5 · DAT (data bugs) 6 · ERR 3 · DEP 1 · MISSING 11.

**Root-cause map (the real attack surface):**
- **R1 — Wrong AI bot on the work pages.** The cold-lead funnel pitch-bot (`/api/welcome/chat`) is mounted everywhere except `/r/*`: it can't answer, can't file to a project, hallucinates "what you just saw," and demands a ZIP. → BRF-1, BRF-2, BRF-3, BRF-4, BRF-6, BRF-8, BRF-9, BRF-10, OUT-7.
- **R2 — Output leads with chrome and buries/forbids the answer.** No-invention contract + caveat dumps + synthesis quarantined into footnotes; citations longer than the info. → OUT-1, OUT-2, OUT-3, DAT-1, DAT-4, VIZ-4.
- **R3 — Data correctness, grain & formatting.** → DAT-2 (`400000`), DAT-3 (URL leak), DAT-5 (blank storm name), **DAT-6 (HURRICANE IAN MISSING)**, OUT-4 (ZIP answered with 3-county stats), FMT-1 (MM/DD/YYYY).
- **R4 — Failures are invisible & output isn't print-safe.** → ERR-1, ERR-2, ERR-3, BTN-10 (AI chat prints over the PDF).
- **R5 — Dead/mislabeled controls, no discoverability, no money path.** → BTN-1…BTN-9, NAV-1…NAV-5, VIZ-1…VIZ-3, FUN-1.
- **Caveat — DEP-1:** prod may be running pre-fix code; confirm the deployed commit before treating any `DISPUTED` item as a live code bug.

**Credibility-killers a client would catch (the ones that make it "suck"):** DAT-6 (Ian missing / "zero hurricane-force"), BRF-10 (AI denies the project system from inside it), BRF-8 (pitch instead of an answer), BTN-10 (PDF prints the chat over the deliverable), OUT-1 (thin info / fat citations).

**Good — DO NOT touch, use as the bar:** `/r/cre-swfl`, corridor drill-downs, the Share button, the design system, and the grounded `/api/converse` engine (proof the system CAN answer well — R1 is "use this engine everywhere," not "build a new one").

---

# PART 1 — UI / UX PROBLEMS (what the user sees and touches)

## 1A. Navigation & Discoverability (`NAV`)

- **NAV-1** `USER-SAW` — **You can't get to anything easily.** The site's good surfaces are orphaned; there is no coherent path from the front door to the data/visuals.
- **NAV-2** `USER-SAW` — **No one would know the Charts page exists.** `/charts` is not surfaced in primary nav from inside the app; it's effectively hidden.
- **NAV-3** `USER-SAW` — **There are no templates or charts anywhere a user would look.** Templates are not presented as a browsable thing; charts aren't embedded where the user is working.
- **NAV-4** `CODE` — Templates are only reachable via `/showcase` "Preview →" (opens raw `/api/templates/render` in a new tab) — not a gallery, not linked from the product surfaces.
- **NAV-5** `USER-SAW` — No discoverable entry to the AI / Briefcase from where the user is (see Briefcase section).

## 1B. AI & Briefcase (`BRF`) — the biggest cluster

- **BRF-1** `USER-SAW` `CODE` — **The AI and Briefcase are DIFFERENT on every page.** Two separate UIs from one corner button: `/r/*` gets the grounded `AskAiDock` (`/api/converse`), everywhere else gets `BriefcasePanel`/`BriefcaseChat` (`/api/welcome/chat`). Different look, different behavior, different capabilities. (`AiBriefcasePill.tsx:36` fork.)
- **BRF-2** `USER-SAW` — **There is no obvious way to ADD to the Briefcase.** "Maybe if you tell Claude — but how would you know?" The affordance is invisible to a real user; the controls are named "Add to project" / "File this…", never an obvious "Add to Briefcase."
- **BRF-3** `USER-SAW` — **Briefcase → project routing is opaque.** When you add something: Which project does it go to? Is it a new one? How do you add to an *existing/old* project? No visible project picker or destination.
- **BRF-4** `USER-SAW` — **The prompts produce shit.** What the AI returns is not client-grade. (Output quality — see also OUT-1/OUT-7.)
- **BRF-5** `CODE` — **Panel chat cannot file a Q&A**, even though the panel's own copy promises "file the answers." The control exists in the popup but not in `BriefcaseChat.tsx`. (other-map #8)
- **BRF-6** `CODE` — Two backends / two threads / two feature sets behind one button: ungrounded Haiku funnel (no grounding, no saved thread, no charts) vs. grounded per-report converse (thread + charts). On most pages the user is talking to the *ungrounded funnel bot* — a direct cause of "prompts produce shit." (other-map #9)
- **BRF-7** `USER-SAW` — Briefcase state feels unreliable — things added don't clearly "stick." (Possible whole-draft-wipe on load footgun, `lib/briefcase/draft.ts:30-37`; or stale prod. `DISPUTED` — reproduce live.)
- **BRF-8** `USER-SAW` `CODE` — **On the Projects page, the AI is a marketing-funnel PITCH BOT that never answers the prompt — it pitches and asks for a ZIP.** Projects (no `reportId`) routes to `BriefcasePanel → BriefcaseChat → /api/welcome/chat`, whose system prompt (`WELCOME_SYSTEM`, `route.ts:57-80`) is hardcoded for a cold landing-page lead: it asserts the user *"just clicked through from a branded market-data email"* and *"have ALREADY seen what one report looks like"* (→ the false **"you already know the headline from what you just saw"** when you just landed in Projects), is ordered *"Your job is to show them the real magic… auto-emailed to THEIR clients every week… Lead with that hook"* (→ both prompts return the weekly-email lead-gen **sales pitch**, not an answer), and is told to never give a number and bounce to *"give me a ZIP or a place"* (→ "Show me flood risk by ZIP" replies **"what ZIP?"**). It is structurally a conversion funnel, not an analyst — wrong bot on an authenticated workspace.
- **BRF-9** `USER-SAW` `CODE` — **Starter prompts are mismatched to the bot behind them.** The two chips ("What's the bottom line on SWFL right now?", "Show me flood risk by ZIP" — `promptsForPage`, `lib/briefcase/visits.ts`) are answerable questions, but on Projects they're routed to the funnel bot built to deflect → clicking a starter **guarantees** a non-answer. A prompt should answer the prompt; here it spawns more questions/pitches. (The engine that could answer, `/api/converse`, only runs on `/r/*`.)
- **BRF-10** `USER-SAW` `CODE` — **The Projects-page AI cannot add anything to a project, and DENIES the project system exists — while running inside it.** Operator gave the ZIP it demanded → got a genuinely decent grounded flood read → asked "add info into my project" → the bot replied *"I don't have a project system, inbox, or file-sync connection… copy it into your own workflow."* The `/api/welcome/chat` funnel bot has **no briefcase/`fileItem` tool and no awareness that projects/filing exist**, so it denies the one capability the surface is built for and tells the user to **copy-paste by hand**. The product breaks at the exact moment of value capture. This is BRF-2/BRF-3 proven from the AI side: even asked point-blank, the AI can't file to a project. **(Note: the grounded read itself, once a ZIP is given, is decent + cited — the grounded path works; the failure is filing + the funnel framing around it.)**

## 1C. Buttons & Interactions (`BTN`)

- **BTN-1** `USER-SAW` `CODE` — **"Build deliverable" button does nothing.** Hardcoded `disabled` + "Coming soon" + a `TODO`, no `onClick` (`ProjectDetail.tsx:323-330`). The backend `POST /api/projects/[id]/build` is fully built with **zero frontend callers**. The real build trigger is missing from the UI. (And per OUT-2, even wired it would produce thin output — "wouldn't build shit either way.")
- **BTN-2** `USER-SAW` — **The "Open in mail" button opens ~4 tabs including Gmail (browser) AND Outlook (desktop).** Operator-confirmed control: the `mailto:` link at `DeliveryButtons.tsx:82-88` (`<a href="mailto:?subject=…&body=…">` + a `meter` onClick). The code is a single `mailto:` with no `window.open`/loop — so the multi-open is the **OS/browser firing every registered mail handler at once** on a real machine. That's the point: `mailto:` is the wrong mechanism for a "send" button — it behaves unpredictably/badly across real users' mail setups. Real problem, NOT a phantom. (The earlier "phantom in code" verdict only checked the loop, not the lived behavior.)
  - **Share button = WORKS** (operator-confirmed) — leave it. **Copy email** = unconfirmed.
- **BTN-3** `CODE` — **"Save as PDF" is mislabeled.** It calls `window.print()` (browser print dialog), not a PDF download. The server PDF path returns 501 (`/api/templates/render` `format:"pdf"`). (`components/PrintButton.tsx`)
- **BTN-4** `CODE` — **Mobile hamburger has no `onClick`** — mobile nav can never open. (`Header.tsx:147-156`)
- **BTN-5** `CODE` — **TemplateSwitcher chips silently no-op for non-owners** on public `/p/[id]` — a recipient clicking a template chip gets nothing (restyle returns 401/403). (`page.tsx:467`)
- **BTN-6** `CODE` — **"Upload your data · soon"** in the dock is permanently disabled. (`AskAiDock.tsx:508-515`)
- **BTN-7** `CODE` — **"Request this data"** (data-gap popup) records nothing — only calls `onClose()`. (`HighlightPopup.tsx:576-582`)
- **BTN-8** `CODE` — **"File this chart"** works only for `bar-table`; every other chart type is a "coming soon" stub. (`FILABLE_FRAMES`)
- **BTN-9** `CODE` — **Cursor / Windsurf MCP install tabs** look like working tabs but render "Coming soon." (`MCPInstall.tsx:72-86`)
- **BTN-10** `USER-SAW` — **"Save as PDF" produces a RUINED page — the AI + Briefcase chat panel prints OVER the report.** Screenshot-confirmed (2026-06-15 13:34): Save as PDF fires `window.print()` (see BTN-3) with the AI pill panel open, and the panel is **not excluded from print** (`.print-hide` doesn't cover the AI/Briefcase overlay) → the saved PDF has the chat splattered across the client deliverable. Since the real server PDF path is 501 (BTN-3), **print is the only PDF route and it's broken — there is no way to produce a clean client PDF today.** Same screenshot also shows DAT-2 (`400000`) and the citation/source chrome (OUT-1/DAT-4) in the printed output.

## 1D. Visuals / Templates / Charts (`VIZ`) — "great visuals to impress a client"

- **VIZ-1** `USER-SAW` `MISSING` — **No template gallery exists on the site.** The 6 email/report templates (hero, table, compare, ranked, hbar, report) are built but never surfaced to a user.
- **VIZ-2** `USER-SAW` — **Charts are buried and undiscoverable** (see NAV-2). The flagship "Live Data" surface is unreachable in normal use.
- **VIZ-3** `DISPUTED` — **Charts page may render blank** (axis labels + titles but no visible bars/lines). Live audit found data + grants healthy; suspected stale ISR cache (`revalidate=3600`) serving a pre-migration dead page. Retest live. (other-map #10)
- **VIZ-4** `CODE` — **Metric cards bury the value under citation chrome.** No visual hierarchy, no accent color (`--card-accent` is greenfield), no collapse/toggle for sources, no per-card "add to briefcase." The `/p/[id]` card prints `source.citation` verbatim, no truncation — the "800-char wall." (other-map Card; all 7 redesign reqs greenfield)
- **VIZ-5** `USER-SAW` — **Visuals are not embedded where they'd impress a client** — the deliverable/report path doesn't put great charts in front of the user at the moment of building/sharing.

## 1E. Money path / Funnel (`FUN`)

- **FUN-1** `LIVE` — **`/billing` is a dead end.** Free/Starter/Growth/Pro all say "Coming soon," "Full billing under construction." No checkout, no buttons, no Stripe — the only CTA is a `mailto:`. A user who wants to pay can't.

## 1F. Formatting & Conventions (`FMT`)

- **FMT-1** `USER-SAW` — **Dates must be MM/DD/YYYY EVERYWHERE.** Output currently uses ISO `YYYY-MM-DD` (e.g. "2004-08-13"). Operator standard is **MM/DD/YYYY** across every surface — reads, cards, charts, deliverables, emails, MCP. Global render rule.

---

# PART 2 — CODE ISSUES FOR DELIVERING DATA (the output itself)

## 2A. Output quality / the content disease (`OUT`)

- **OUT-1** `LIVE` — **Every output is thin info wrapped in fat chrome.** The live master read measured ~30% information / ~70% caveats + disclaimers + metadata: 6 bare metrics, no narrative, then 11 caveat bullets + "39 more," a "what this can't tell you" block, a freshness token. Source links/caveats are longer than the information. (`/api/b/master?view=speak`)
- **OUT-2** `CODE` — **The deliverable engine is structurally forbidden from making a real call.** `lib/deliverable/build.ts:300`: exec summary + sections are "CITED FACTS only — no forecasts"; every recommendation is quarantined into `inference_notes` tagged `[INFERENCE]` with a falsifier. So the "client-ready deliverable" recites cited facts and never says "so do X" — it builds a technically-correct document, not a compelling one.
- **OUT-3** `CODE` — **The deliverable is only as rich as the items the user filed.** It writes connective prose over filed metrics and introduces nothing new; thin inputs → thin output.
- **OUT-4** `USER-SAW` — **A ZIP question gets answered with county / 3-COUNTY-region stats, mislabeled and confusing.** Ask about 33908 (a Lee-County ZIP) and the read says *"Lee county-wide, which covers 33908: Southwest Florida (Lee + Collier + Charlotte counties combined)…"* — a self-contradictory scope line that hands back a **3-county** number as the answer to a single ZIP. When the underlying data only exists at a coarser grain (storm events), the read must **answer at the ZIP grain first, then show the broader region as a clearly-labeled COMPARISON at the end** — never lead with half-the-region figures dressed as the ZIP. Grain is silently widened and the wider figure isn't distinguished from the ZIP. (Borders on the MOAT rule: never present a county/region figure as a ZIP figure.)
- **OUT-7** `USER-SAW` — **Prompts produce shit** (the lived version of OUT-1/OUT-2/BRF-6): on most pages the ungrounded funnel bot answers; even on grounded pages the output leads with provenance and hedges the substance.

## 2B. Data formatting / leakage bugs (`DAT`)

- **DAT-1** `CODE` — **CRE dossier ships 87,843 chars of citation text** over MCP/`/api/b/cre-swfl?format=json`. Each metric's `source.citation` enumerates every contributing corridor as `"Name (City, County) [url]"` (e.g. `asking_rent_psf_median` = 4,036 chars). Baked into the brain output, not just the render. (`refinery/packs/cre-swfl.mts:189-200`) (other-map #2)
- **DAT-2** `CODE` — **Median price renders `400000`, not `$400,000`.** Harvest stringifies the raw number and drops the currency format/units. (`lib/deliverable/examples.ts:97`) (other-map #3)
- **DAT-3** `CODE` — **A raw source URL is baked into the workforce brain's conclusion prose** (`https://www.bls.gov/oes/tables.htm`), so it leaks as plaintext on MCP/speak/dossier. (`refinery/packs/labor-demand-swfl.mts:255-259,335`) (other-map #4)
- **DAT-4** `CODE` — **`/p/[id]` cards print the full `source.citation` verbatim, no truncation** (the 800-char wall; same root as DAT-1 surfaced on the deliverable page). (other-map Card)
- **DAT-5** `USER-SAW` — **Storm name renders blank: "Hurricane on 2004-08-13"** in the flood read (should be a named storm — Hurricane Charley). A null/empty storm-name field produces an embarrassing "Hurricane on `<date>`" string inside an otherwise-cited answer. Flood/storm read path (the billion-dollar-event line). Find where the storm-name field goes null and why it's not guarded.
- **DAT-6** `USER-SAW` — **THE STORM READ IS FLATLY WRONG — HURRICANE IAN IS MISSING.** For a Fort-Myers-area ZIP in the trailing-10-year window it claims *"76 property-damage events… ZERO reached hurricane-force wind speed (≥74 kt)"* and *"most recent billion-dollar storm event… 2004-08-13"* (Charley). **Ian (2022, Cat 4, ~$112B, devastated Lee County — costliest storm in FL history) is absent.** Likely cause: the NOAA storm-events ingest is missing 2022/Ian, OR the ≥74 kt wind filter reads a null magnitude field (surge/hurricane-type events log no wind speed) so the count is 0, OR the billion-dollar-events list is stale (ends pre-2022). Claiming "zero hurricane-force events" + a 2004 most-recent in Ian country **destroys all credibility instantly.** HIGHEST-PRIORITY data-correctness bug. Storm-events ingest + the wind-speed/billion-dollar query.

## 2C. Error handling / why it LOOKS dead (`ERR`)

- **ERR-1** `CODE` — **Failures are silently swallowed.** Zero App Router error boundaries exist anywhere in `app/`. When anything throws, the user gets a blank or "Data unavailable" with no clue — so real failures are invisible and "all that work" looks like it did nothing. (other-map #1)
- **ERR-2** `CODE` — **The only error boundaries that exist (around charts) render `null` on failure** — they deliberately hide the error. (`ReportChart.tsx`, `FrameRenderer.tsx`, `CREMarketBeatChart.tsx`)
- **ERR-3** `CODE` — **Stale ISR cache can serve a dead page for up to an hour** after a data/view migration (`revalidate=3600`), making a healthy page look broken. (root of VIZ-3)

---

# PART 3 — STATE / DEPLOYMENT (`DEP`)

- **DEP-1** — **Prod is probably running pre-fix code.** Plan A/B/C are "PROD HELD" behind the operator gate (`build-queue.md`). Some symptoms (briefcase stickiness, charts, stale-badge) may already be fixed in committed code but not deployed → ghosts. Confirm the deployed commit before treating any `DISPUTED` item as a code bug.

---

# PART 4 — PER-PAGE END-USER VERDICTS (ground truth, operator 2026-06-15)

| Page | Verdict | Notes |
|---|---|---|
| **Project page** (`/project/[id]`) | **SUCKS** | Dead Build button (BTN-1), opaque briefcase→project routing (BRF-3), ungrounded AI (BRF-6). |
| **ZIPs page** (`/r/zip-report/33908` or `/r/zip-report/33931` Fort Myers Beach) | **SUCKS** | Thin output (OUT-1), card chrome (VIZ-4). |
| **`/r/cre-swfl`** | **PRETTY GOOD** | Keep this as the bar — but note DAT-1 ships 87k citation chars over MCP behind it. |
| **Corridor drill-down pages** | **DECENT** | Acceptable; preserve. |
| AI / Briefcase (all pages) | **INCONSISTENT** | Different everywhere (BRF-1). |

> The good pages (`/r/cre-swfl`, corridor drill-downs) are the reference for what "great" looks like. The example pages we build should match or beat them.

---

# PART 5 — WHAT'S NOT THERE (MISSING → build as example pages later)

- **MIS-1** Template gallery / browsable templates on the site. (VIZ-1)
- **MIS-2** Charts surfaced in navigation and embedded in the work surfaces. (NAV-2, VIZ-2)
- **MIS-3** A discoverable "Add to Briefcase" affordance + a project picker (new vs. existing). (BRF-2, BRF-3)
- **MIS-4** One consistent AI experience across all pages. (BRF-1, BRF-6)
- **MIS-5** "File this answer/Q&A" in the panel chat. (BRF-5)
- **MIS-6** Per-card "Add to Briefcase" + a redesigned metric card (value-first, accent, source toggle) — all 7 redesign reqs are greenfield. (VIZ-4)
- **MIS-7** A working money path (checkout). (FUN-1)
- **MIS-8** Highlighter on `/p/[id]` and `/c/[id]` — only built on `/r/*`. (other-map #6)
- **MIS-9** Visible error states (boundaries) so failures are readable. (ERR-1)
- **MIS-10** Test-to-self email send + an in-site email template preview-with-data. (from the email plan; no such route/page today)
- **MIS-11** Real server-side PDF export (currently 501; "Save as PDF" is just print). (BTN-3)

---

# PART 6 — WHY (what we know NOW, after the list)

1. **The no-invention guarantee ate the product.** The platform's defining architecture — rules-of-engagement, facts-only lints, cite-everything, caveat dumps, inference quarantined into `[INFERENCE]` footnotes — was built so the system can never be wrong. It works. The cost: every surface (master read, /ask, /welcome, the Build deliverable) leads with provenance and caveats and delivers a thin recitation. Optimized to never be wrong → never compelling. **This is the root of OUT-1, OUT-2, OUT-7, BRF-4, VIZ-4, DAT-4.**
2. **"Prompts produce shit" has a concrete, proven cause:** on every page except `/r/*`, the AI is the **ungrounded Haiku marketing-funnel bot** (`/api/welcome/chat`), not the grounded engine (`/api/converse`). That funnel bot's system prompt (`route.ts:57-80`) is written for a cold lead who *just clicked a branded email and saw a sample report*, and its **job is to pitch the weekly auto-email machine and bounce for a ZIP** — so on the authenticated Projects workspace it hallucinates "what you just saw," refuses to answer, and asks more questions. It is the wrong bot, with the wrong premise, doing exactly what it's told. (BRF-1, BRF-6, BRF-8, BRF-9)
3. **The site looks more broken than it is because errors are invisible.** No boundaries + chart boundaries that render `null` = blank screens with no signal. A working-but-throwing page is indistinguishable from a dead one. (ERR-1, ERR-2)
4. **Some "bugs" may be ghosts of a stale deploy.** Plan A/B/C are PROD HELD; committed fixes aren't live. (DEP-1) — confirm deployed commit before trusting any `DISPUTED` item.
5. **Citations bloat is baked into the brain output, not just the render.** Collapsing it at the page layer fixes the page but not the MCP/dossier payload. (DAT-1, DAT-3)
6. **Discoverability was never designed.** Charts, templates, the briefcase, the AI — each shipped as an island. There is no information architecture tying the front door to the data and visuals. (NAV-1..5, VIZ-1..2, BRF-2..3)
7. **The plumbing-vs-output gap is real and it's the meta-lesson:** earlier audits graded "does the click fire an endpoint" (plumbing) and called the site mostly fine. The user grades "what comes back and can I impress a client with it" (output). The output is the disease. **List from the user's eyes, always.** (e.g. BTN-2: code says single mailto, user sees 5 tabs — the user is the spec.)
8. **The Build deliverable button is a double failure:** the UI trigger was never wired (BTN-1) AND the engine behind it can't produce a compelling document (OUT-2). Wiring alone doesn't fix it.

---

*End of inventory. Append new findings with the next free ID in each area. Fixes/sequencing live in the forthcoming ULTRA PLAN, not here.*
