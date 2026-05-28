# SWFL Data Gulf — Sectioned Build Tracker

> **Live tracker. Delete this file when all three sections are done.** Source plan approved 2026-05-28.
> Do Section 1, then Section 2. Section 3 is not planned until the ledger is live.

## Tracker status (update as sections complete)

- 🟡 **Section 1 — Stamp the goal** — in progress
- 🔴 **Section 2 — Build /ops ledger** — not started
- 🔴 **Section 3 — Plan the real work** — blocked until ledger is live

---

## The goal

Three tiers — name + what each does:

- **Tier 1 — Reporters** (leaf brains + corridor voices): report current, cited facts and numbers. No opinions.
- **Tier 2 — Synthesizer** (master): the only speculator. Reads the whole lake, forms one grounded, conditional, falsifiable direction call.
- **Tier 3 — Conversation** (the user's AI): reasons over a dossier from Tier 2 + a lean rules-of-engagement block, answers follow-ups without re-fetching, stays honest.

ChatGPT answers from Tier 3 alone (vibes). We force Tier 3 to stand on Tiers 1+2 (proof). **The proof is in the data.**

---

## SECTION 1 — Stamp the goal (first)

Write **`docs/THE-GOAL.md`** containing ONLY:

- The three named tiers above (name + what they do).
- **Dossier principle:** Tier 2 hands the user's AI a context bundle (facts + grounded conditional thesis + citations + an explicit "what we do NOT have" boundary), not a finished essay.
- **Conditional-claim principle:** speculation is authored IF/THEN with a falsifier, so it inverts when the user changes the premise — no re-fetch.
- **The lean rules-of-engagement block (~200 tokens, NOT the 2000-token contract):** cite, tag inference, stop at the data grain, no opinions below Tier 2. This is the block that travels in every payload. The full `docs/consumption-contract.md` stays a reference doc.

**Hard rule:** no current state, no inventory, no "what we have," no shipped/not-shipped, no corridor counts. Pure goal + mechanics. Status lives ONLY in /ops.

**Stamp onto:** `CLAUDE.md` (tight pointer to `THE-GOAL.md` + the lean block; keep locked Rule 0/Rule 1 intact) and the top of `docs/consumption-contract.md`.

Doc-only → commit and push.

---

## SECTION 2 — Build /ops (the ledger; everything, categorized, multi-page)

A private operations dashboard, **its own Vercel project** (NOT swfldatagulf.com). Single env-var auth gate. Brand-styled: `#080E11` bg, teal accents, IBM Plex, wave favicon. ISR revalidate every 5 min.

**Build EVERYTHING into it — do not hand-pick.** So:

**Step 1 — Inventory sweep.** Enumerate the _entire_ project from real signals: every GHA workflow, every brain, every pipeline (`cadence_registry.yaml`), every data source, every doc-ledger, every external service (Supabase, Notion, MCP, Vercel), every log. The inventory — not a guess — determines the rows and the categories.

**Step 2 — Categorize into separate pages/sections.** Each category is its own page/section (the inventory names them; e.g. brains, pipelines/cron, data sources, services/health, logs, incidents — confirmed against the sweep, not pre-decided).

**Step 3 — The read (fixed format, per section + overall, short and sweet, always updated):**

> **last 2 GREENS** (just-completed) · **next 3–6 REDS** (up next) · **any YELLOWS** (currently being built)

**Step 4 — What's derived vs. the one human input (resolves the ordering tension).**

- **Derived from signals (never hand-typed):** what exists, and done-or-not. Green = done is a boolean computed live from GHA runs, freshness tokens, Supabase, repo state.
- **The ONE acknowledged human input:** _which_ reds are "up next" (priority order) and which items are YELLOW (currently being built) is a planning decision — it cannot come from a signal. So one small editable file (`_AUDIT_AND_ROADMAP/build-queue.md`, on the GitHub bus) holds the ordered priority + in-progress marks. /ops reads it to sort the reds and flag yellows. This is the single hand-maintained input; everything else is derived. Operator edits it directly.
- Click a row → its detail (what it ingests, source, cron schedule + how cron is handled, consuming brain, last incident).

**Step 5 — The build-queue page.** One dedicated /ops page renders `build-queue.md` as the "what needs built next" view, fed by Steps 1–4. The operator can see it and change it (edit the file). It is the canonical answer to "what's next."

**Mechanics:** one `/api/ledger` endpoint does exactly **one fetch cycle per revalidation** (all GitHub API + Supabase reads, cached); pages render that cached payload, never fetch independently.

**Design reference (operator-provided, captured so it survives).** Operator shared a static reference page (`C:/Users/ethan/Downloads/premise-data-sources.html`, a prior project by another AI) showing the look one category page can take. **Ours will be better and realtime — this is a reference, not a spec to copy.** Execution step copies that HTML into the /ops repo (`/ops/design-reference/premise-data-sources.html`) so it can't be lost. The design language to carry forward:

- Dark theme (our brand `#080E11` bg + teal accents + IBM Plex), one color-coded dot per category, category = its own section.
- Per-category table columns: **Source · What We Get · Method · Auth · Edge Function/EF · Cadence · Status · Notes**.
- Status pills (color-coded): we use **GREEN / YELLOW / RED** (done / building / to-do) instead of their LIVE/CACHED/STUB/DEFERRED.
- Tag chips for **Method** (REST/CSV/ArcGIS/Scrape/SFTP/MCP) and **Auth** (key/open/paid/jwt).
- Top legend explaining pills + tags; footer naming the source-of-truth.
- Difference from the reference: theirs is a generated static snapshot; **ours is live (ISR 5-min), derived-only, click-through, and carries the greens/reds/yellows read at the top of every section.**

**NOT in scope:** workflow builder, webhook receiver, user-facing charts. n8n/Docker decided later, as we go.

**Done when:** the project deploys (gated), every category has its own page rendering live green/red/yellow from real signals, and every section shows the last-2-greens / next-3-6-reds / yellows read.

---

## SECTION 3 — Plan the real work (NOT NOW)

After the ledger is live, planning **starts from the /ops build-queue page** (Section 2, Step 5) — the one specific page that shows what needs built, fed by how we handle status above. The operator can see it and change it. Plan master + the rest **from what that page shows** — not from memory, not from CLAUDE.md prose.

When Claude needs to know whether something is done, he **confirms it** — checks GitHub and the relevant /ops section — rather than assuming or guessing. Nothing else is specified here on purpose.

---

## Guardrails

- Goal/aspiration docs carry no status; status lives only in /ops.
- /ops covers everything (inventory-driven), separated into categorized pages; it is a separate Vercel project.
- Rules-of-engagement block is lean (~200 tokens).
- Do not plan or build Section 3 before the ledger is live.
- Stage only files we create/modify; SESSION_LOG entry on every push; never `--no-verify`.
- This tracker lives in `_AUDIT_AND_ROADMAP/` until complete, then deleted.
