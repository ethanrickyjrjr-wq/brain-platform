# Highlighter / Project AI — MASTER ISSUE LIST (2026-06-22)

> **Recommended model:** ⚡ Sonnet

> **STATUS: SMOKE FAILED, PUSH HELD.** HEAD = L1 + L2 + F2-attempt, ahead of origin — nothing ships until this list clears.
> Every item carries **Problem / Your concern / Severity / Status.** Severity: **P0** blocker · **P1** major · **P2** minor · **P3** nice-to-have.

---

## 🔬 RESEARCH-FIRST MANDATE — DO THIS BEFORE ANY MORE FIXING (operator decree 2026-06-22)

**STOP GUESSING. Send crawl4ai out, bring back real answers, take notes, write a REAL plan — THEN fix.** No more guess-and-poke. Exact order:

1. **crawl4ai → how Claude works with the NEW updates** (Claude Code editor integration: knows current file + selection, proposes changes in-editor, autonomously explores the codebase, runs Terminal with permission). Bring it back → **update everyone in the logs (`SESSION_LOG.md`)** → then **write down how WE can use it** (in this doc / a research note).
2. **crawl4ai → better engineering for the Projects page** — actually using the templates + building (why templates go unused; how build should really work).
3. **crawl4ai → how to turn that build into a deliverable AND an embedded email.** Take notes the whole way.
4. **Then take EACH issue below and send crawl4ai out on it** — note what was already found + exactly how it will be fixed.
5. **Run crawl4ai until there is a REAL plan on ALL of it.**

> Operator: "WHY DOES EVERYONE FUCKING GUESS? WHERE IS CRAWL4AI TO FIND ANSWERS?" — the answer is: research first, every issue, before touching code.

---

## ★ THE LAW — how filing MUST work (operator spec, 2026-06-22)

> **OUTSIDE the briefcase:** files get added to it. **As they're added, they load into the project you're on.**
> **INSIDE a project:** anything added is added to **that project** — never a new one, never just the tray.

**Restated:** when a project is active, ALL filing (answer / figure / chart / summary, from the highlighter OR the pill OR the outside briefcase) targets **that project**. The anonymous tray is ONLY for when no project is active (logged-out / no project open). "File" must never silently dead-end, and must never spawn a new project.

---

## 1. FILING — briefcase ↔ project (THE core failure)

- **[A1] (P0)** **Problem:** "File this answer" in a project does nothing visible / lands in the tray. **Your concern:** it should file the answer (and its chart) into the project I'm in. **Status:** 🔴 STILL BROKEN — F2 fix `761f2b82` shipped but not routing in test.
- **[A2] (P0)** **Problem:** filing + "Open project & build" spawns a **brand-new project** instead of using the one I'm in. **Your concern:** "it's going to make me build a whole new project!! highlighter adds to the project you are on inside projects, not the briefcase." **Status:** 🔴 STILL BROKEN.
- **[A3] (P0)** **Problem:** the new (unwanted) project doesn't even carry the chart. **Your concern:** the chart I made must come with it. **Status:** 🔴 STILL BROKEN.
- **[A4] (P1)** **Problem:** "Add chart to files" regenerates a NEW, different chart in chat instead of filing the one already on screen. **Your concern:** file the EXACT chart I made, not a new one. **Status:** 🔴 open.
- **[A5] (P0)** **Problem:** "Summarize → to project" adds to the chat, not the project. **Your concern:** summary belongs in the project. **Status:** 🔴 STILL BROKEN.
- **[A6] (P0)** **Problem:** a chart made by OUTSIDE AI files to the briefcase even while I'm on a project page. **Your concern:** "OUTSIDE BRIEFCASE GETS FILES ADDED TO IT… AS THEY ARE ADDED THEY ARE LOADED INTO THE PROJECT YOU ARE ON." **Status:** 🔴 STILL BROKEN.
- **[A7] (P0)** **Problem:** filed item stays in chat/tray; I only wanted it in the project I was working on. **Your concern:** inside a project, everything I add goes to the project. **Status:** 🔴 STILL BROKEN.

> **Root found:** the briefcase was project-blind (`BriefcasePanel.onBuild` → `/project` new; filing → `fileItem` tray; `useAiContext().projectId` ignored). F2 fix `761f2b82` routed filing via `dispatchAddItem` when `projectId` set — but it kept failing because it read the **async `useAiContext()` store, which is null mid-load → fell back to the tray.**
> **🔧 FIX 2 — `a24d9e09`:** `useFiler()` now reads **`projectIdFromPath(usePathname())`** — the URL, synchronous, can't be null on `/project/[id]`, and matches the URL-derived id the workspace listens for. **Awaiting retest on the fresh server (hard-refresh).** If it STILL fails: add a click-time `console.log(projectId)` to see what the filer actually sees.

## 2. CHARTS — carry, freeze, regeneration, scope

- **[B1] (P1)** **Problem:** filed charts re-spend money / aren't frozen. **Your concern:** "WANT IT TO FREEZE so we aren't wasting money" — a STATIC, dated chart with an **Update button** for on-demand refresh. **Status:** 🔴 open.
- **[CH-SCOPE] (P1)** **Problem:** asked for "33908 CRE," got a region-wide "seasonal index by corridor" chart. **Your concern:** the chart must match the scope I asked for. **Status:** 🔴 open. *(was K2)*
- **[CH-DUP] (P1)** **Problem:** the project chart differs from the OUTSIDE-AI chart that was actually made. **Your concern:** same chart, end to end — don't silently make a different one. **Status:** 🔴 open. *(part of A4)*

## 3. SUGGESTIONS / PROMPTS — generic, stuck, un-answerable

- **[C1] (P1)** **Problem:** every highlight's suggestion is "chart home values over time." **Your concern:** suggestions must fit what I highlighted. **Status:** 🔴 open.
- **[C2] (P1)** **Problem:** after giving me a home-values chart, the next prompt is *still* "chart home values over time." **Your concern:** "if the chart was in the build, it should know that" — don't re-offer what already exists. **Status:** 🔴 open.
- **[C3] (P1)** **Problem:** it suggests its own prompt ("How does it compare across our areas?") then can't answer it ("I need to know what you're comparing"). **Your concern:** if you suggest it, you must be able to answer it. **Status:** 🔴 open.

## 4. UPLOADS / PDF — the AI can't read what I give it

- **[I1] (P0)** **Problem:** "What does my uploaded PDF tell us?" → "I don't see an uploaded PDF." **Your concern:** "how would we ever chart anything from a pdf if it can't even see it???" **Status:** 🔴 open.
- **[I2] (P0)** **Problem:** built deliverable just **links** the PDF instead of reading it. **Your concern:** "what happened to claude vision???" — read it, don't link it. **Status:** 🔴 open.
- **[I3] (P1)** **Problem:** attaching a PDF opens it in a website / new tab. **Your concern:** attach it so I can work on it. **Status:** 🔴 open.
- **[I4] (P1)** **Problem:** highlighting gives a bad/deflecting response, tied to the PDF-not-seen failure. **Your concern:** highlights should work even with an upload in play. **Status:** 🔴 open (need exact text).

## 5. CAPABILITY / HOLDINGS — the AI denies what we actually have

- **[K1] (P1)** **Problem:** "build an email… send Monday 8am" → "I can't send email or schedule delivery." **Your concern:** we HAVE scheduled email sends — don't refuse, route to the build+schedule flow. **Status:** 🔴 open.
- **[K3] (P1)** **Problem:** "chart 33908 traffic" → "I don't have traffic data." **Your concern:** we hold FDOT traffic (`brains/traffic-swfl.md`) — don't deny it (it's by corridor, not ZIP, so say that). **Status:** 🔴 open.

## 6. DISPLAY — dates, numbers, sources

- **[D1] (P1)** **Problem:** dates render backwards / wrong: `2026-01-01`, `2026-06-23` (tomorrow), "provided on 2026-06-23." **Your concern:** "DATE IS STILL FUCKING BACKWARDS" — must be MM/DD/YYYY, and the right day. **Note:** token dates (`06/16/2026`) are correct; only the NON-token paths (chart `asOf`, file-provenance, feed) are broken. **Status:** 🔴 open.
- **[D2] (P2)** **Problem:** numbers lack separators: `400000`, `299000`. **Your concern:** `400,000` / `299,000`. **Status:** 🔴 open.
- **[D3] (P1)** **Problem:** sources (e.g. `gulfshorebusiness.com`) print inline in prose. **Your concern:** "THIS SHOULD BE IN A COLLAPSE AT BOTTOM" — collapsed sources box, never inline. **Status:** 🔴 open.

## 7. NAVIGATION / CONTEXT

- **[E1] (P1)** **Problem:** inside a project, hitting Explore/Search loses the project — it doesn't follow you. **Your concern:** the project I'm in must stay active as I navigate. **Status:** 🔴 open. **(Likely also the cause of F2 not working — if `projectId` drops, filing falls back to the tray.)**

## 8. LAYER 2 — select-to-edit inside a built deliverable

- **[G1] (P0)** **Problem:** the highlighter popup **does not appear at all** in a built deliverable. **Your concern:** select text in the deliverable → AI proposes a change (the whole L2 point). **Status:** 🔴 BROKEN — verified dead in browser.

## 9. DELIVERABLE — build / render / share / PDF / email

- **[H1] (P1)** **Problem:** built Market Overview has NO chart, but the prose says "the chart on screen shows…". **Your concern:** if it references a chart, the chart must be there. **Status:** 🔴 open.
- **[H2] (P1)** **Problem:** a SHARED `/p/[id]` link shows owner nav ("back to my projects"). **Your concern:** a shared viewer needs a link to swfldatagulf.com — or the broker's own site if branded — not my project nav. (Incognito block is correct.) **Status:** 🔴 open.
- **[H3] (P2)** **Problem:** PDF spills onto a 2nd page with little on it. **Your concern:** collapse to one page when the 2nd is nearly empty. **Status:** 🔴 open.
- **[H4] (P2)** **Problem:** email deliverable renders poorly in Gmail. **Your concern:** must look right in Gmail. **Status:** 🔴 open (need detail).

## 10. PILL / FEED MISFIRES

- **[J1] (P1)** **Problem:** the pill still shows "Show examples" when a project is open. **Your concern:** in a project, show project context, not cold-start examples. **Status:** 🔴 open.
- **[J2] (P1)** **Problem:** after I manually add a PDF, it asks "New data landed… want it in your report?" with a garbled future date, then a generic non-answer. **Your concern:** I just added it — don't ask, and don't garble the date. **Status:** 🔴 open.

## 11. DISCOVERABILITY / MISC

- **[M1] (P1)** **Problem:** filing shows "Filed ✓" but you can't see where it went. **Your concern:** "no idea where it is… can't see the fucking thing" — every file must show its destination (toast + link). **Status:** 🔴 open. *(bumped to P1 — recurring pain.)*
- **[F1] (P3)** **Problem:** snap grabs a fragment. **Your concern:** prefer snapping to a complete thought/sentence; "not a huge deal if difficult." **Status:** 🔴 open.

## ❌ NOT working (I wrongly marked these green — corrected)
- **Charts:** one chart rendered **two different ways** + **one flat denial** when asked. NOT reliable (see A4 / CH-DUP / CH-SCOPE / K3). I had NO business calling this confirmed.
- **Snap / highlighter selection:** **DOES NOT FIRE.** Couldn't even highlight a number on `https://www.swfldatagulf.com/r/zip-report/34135`, and it didn't snap to YoY on a percentage. → **[SNAP-0] (P0)** below.
- **Only** thing actually confirmed: incognito blocks a shared link (RLS).

## 0. HIGHLIGHTER SELECTION — the foundation is broken
- **[SNAP-0] (P0)** **Problem:** selecting a number on a report (`/r/zip-report/34135`) **does not bring up the highlighter / doesn't snap** (e.g. a YoY %). **Your concern:** if I can't even highlight, nothing else matters. **Status:** 🔴 BROKEN — research + fix BEFORE the rest. `(was mislabeled "snap fires"; verify the highlighter actually mounts + use-highlight fires on /r/*)`

## N. DATA FRESHNESS + /charts → project
- **[N1] (P0)** **Problem:** data is "**as of 06/04/2026**" — ~3 weeks stale; the pipeline is shut down. **Your concern:** "until we have real data piped in, no one will be able to use this ever" — do a **quick crawl4ai sourced refresh** of key sources to get current, surface the **big points that shifted**, and update the whole system. **Status:** 🔴 open.
- **[N2] (P1)** **Problem:** charts on `/charts` can't be added to a project. **Your concern:** "any chart in /charts should be able to be added to a project as **static, without our brand**." **Status:** 🔴 open.

## ⚠ WHAT I TRIED, FAILED, AND WHY (no spin)
- **F2 attempt 1 (`761f2b82`):** routed filing into the open project via `dispatchAddItem`, keyed on `useAiContext().projectId`. **FAILED** — that store is **null mid-load**, so filing silently fell back to the tray. Still spawned new projects.
- **F2 attempt 2 (`a24d9e09`):** re-keyed to the **URL** (`projectIdFromPath(usePathname())`). **UNVERIFIED** — not yet retested live.
- **Called "charts render / snap fires" CONFIRMED — WRONG.** I trusted a green `bunx next build` + passing unit tests. There is **no DOM/browser test env**, so build-green ≠ working. I should have researched/verified in a real browser, not assumed.
- **Ran `next build` twice while the dev server was up** → it shares `.next` → **crashed the dev server**, which produced phantom "nothing works" symptoms you then chased. Fixed via a clean kill + `.next` wipe + restart; now using `tsc` (not `next build`) while dev runs.
- **Kept asking you to re-test** instead of sending crawl4ai to find the right answer → exactly the guessing you called out. Correcting via the research-first mandate above.

---

## What I'm doing next (in order)
1. **Fix the filing law (Section 1 + E1) for real** — make `projectId` reliably reach the file-click and confirm `dispatchAddItem` lands in the open project; unify so the briefcase ↔ open project is one place. This is THE one.
2. Visible "Filed → here" (M1) so filing never dead-ends again.
3. Then: charts (carry/freeze/scope), uploads (I), dates (D1), suggestions (C), L2 (G1), capability denials (K), deliverable/share (H), pill/feed (J).
