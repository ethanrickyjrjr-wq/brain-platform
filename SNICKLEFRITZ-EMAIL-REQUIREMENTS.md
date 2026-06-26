# SNICKLEFRITZ — WHAT THE EMAILS MUST BE (the tracked list)

> **Recommended model:** ⚡ Sonnet — 8 tasks, 9 files

The single source of truth for what the operator asked for, pulled **verbatim** from his own
messages across the 9-hour arc (sessions `79d3ade4`, `2316fd85`, `1c28934c`, `21870d1b`,
`e8b3c0f2`, `1d377f9e`, 2026-06-25). Each line carries: the requirement, the operator's own
words, and an HONEST status against the live code. **This supersedes `SNICKLEFRITZ-DO-THIS.md`.**

Status key: ✅ exists & works · 🔶 exists but not wired/partial · ❌ missing · ⚙ setup (not code)

---

## A. THE NON-NEGOTIABLES (who, what, where)

- **A1 — One word fires everything.** ❌ (operator-manual by design; nothing auto-fires yet)
  > "I can say 'SNICKLEFRITZ' and everything will be set off … emails will be built and sent."
  > "make sure it is wired correctly. no cheating."
  > "The whole reason you were here is to make sure it was automatic."

- **A2 — THE PLATFORM'S BUILDER builds. Claude does NOT.** 🔶 (builder exists; not driven by this flow)
  > "YOU ARE NOT BUILDING THE DELIVERABLES. OUR PROGRAM IS."
  > "The fucking builder builds it!!!!! You don't tell it exactly."
  > "you can have ai choose which is best and auto fill … The builder has to choose the template
  >  it is going to use for each email and determine the layout. do not help it. We are learning."
  - The builder = the **email-lab AI** (`app/api/email-lab/ai/route.ts`, picks/fills) +
    `assembleDeliverable` (`lib/deliverable/assemble.ts`). Claude only **feeds** it.

- **A3 — Claude FEEDS information only; never adds/builds.** 🔶
  > "WIRE IN ALL INFORMATION ONLY. IT IS CURRENTLY STARVING."
  > "You're not adding anything you stupid fuck!!!!"
  > "Only tell it the data that needs to be used and what each email must include. Nothing more."

- **A4 — Two emails, two real brokers.** ✅ (targets found & curated, see §D)
  > "find broker colors or century 21 and one random small agent"
  - Email 1 = a real **Century 21** agent. Email 2 = a real **small independent** broker.

- **A5 — Sent ONLY to the operator's two inboxes; NEVER the brokers.** ⚙
  > "i get an email … at both of my emails" · brokers are "DEMO SUBJECT — never emailed or contacted."
  - `allstatecoop@gmail.com` + `ethanrickyjrjr@gmail.com` (either order). They must exist as
    `contacts` rows (the `blast` route only sends to owned contacts).

- **A6 — Deliverability is proven. Do NOT re-test the send pipe.** ✅
  > "I RECIEVE FUCKING EMAILS SO WE DON'T NEED TO TEST IT"

---

## B. WHAT GOES INSIDE EACH EMAIL (the content — this is the part that kept getting missed)

- **B1 — ALL the data types, a MIX weighted to FRESH DAILY data.** 🔶 (data feed exists; full daily-weighted mix not assembled)
  > "We need the information from everywhere!!!! How could it build??!!"
  > "Did you get all the types of data I had asked for?"
  - The mix (spec §7, operator-confirmed): daily-moving figures lead — daily median price
    (`daily_truth`), 30-yr mortgage, active-listings count + DOM, new permits, a city-pulse event
    — **so day-over-day change is visible** — plus 1–2 slower anchors (ZHVI value, rent, census).
    Filed as project `items` (each with source + freshness token).

- **B2 — A CHART. The builder must HAVE charts.** 🔶 (chart infra exists: `chart_block`/`saved_charts`; chart-in-email not wired into this flow)
  > "Where is the fucking chart!!!!?????"
  > "Why does the fucking builder have no access to fucking charts??????"

- **B3 — REAL numbers, no placeholders, no invention.** ✅ (the moat: `gateNarrative` strips any number not in filed items)
  > "Your Company???????????? WHAT THE FUCK IS THIS?????" (the demo $485K / "Your Company" skeleton — forbidden)
  - Never the seed demo numbers ($485K / 34 DOM / 3.2mo / ↑4%).

- **B4 — DETAILED, professional email — multiple sections, a real market read.** 🔶 (depends on template pick + fill)
  > "I fucking asked for a fucking detailed email and you send this shit?????"
  - NOT a one-headline-plus-three-stats snapshot.

- **B5 — Working links / clickable. No dead buttons.** ❌
  > "I CAN'T EVEN CLICK ON ANYTHING!!!! WHERE IS EVERYTHING??????"

---

## C. BRAND PER EMAIL (real colors + real logo + real agent name)

- **C1 — The broker's REAL brand colors.** 🔶 — *exist on file, but NOT rendered into the email (the core bug).*
  > "Are these the fucking colors you have for century 21 even??? I see one fucking color and our fucking colors"
  > "you can literally download the fucking colors … and you made them up like the last claude?"
  - **THE BUG:** `app/api/deliverables/[id]/blast/route.ts:138-140` calls
    `renderGroundedReport(model, { skin: "email" })` and **omits the `brand` argument** — even
    though the renderer fully supports `primary/accent/logo/companyName`. That one missing argument
    is why "add the colors" never showed colors. `extractBrandTheme()` (`lib/deliverable/brand-theme.ts`)
    already maps `deliverable.branding` → the brand object. **Wire it into the blast + `/p/[id]` render.**

- **C2 — A REAL logo (not a favicon, not a broken `?` box).** ❌ — *assets exist on disk, not deployed.*
  > "Are favicons typically logos? … I can't see anything" (favicon path explored, rejected as broken)
  - Logos are self-hosted PNGs at `https://www.swfldatagulf.com/email-assets/snicklefritz/*.png`,
    but `public/email-assets/snicklefritz/` is **untracked → never deployed → 404 in the inbox.**
    Commit it.

- **C3 — The real agent's NAME added (the "name-add").** 🔶 (rides on C1 — `companyName`/name flows through the brand arg)

- **C4 — NEVER the SWFL house teal `#3DC9C0` for a named broker.** ✅ (curated palettes are explicit; only the unbranded fallback uses teal — fixing C1 removes that path)

---

## D. THE TWO TARGETS (curated, verified, committed at `fixtures/prospects/`)

- **Email 1 — Greg Guminski**, CENTURY 21 Selling Paradise · Cape Coral, **Lee 33904** · `c21sellingparadise.com`
  - Colors: primary `#252526`, accent **Relentless Gold `#BEAF88`** (verbatim from brandcolorcode.com/century-21), font MODERN_SANS
  - Logo: `…/century21-selling-paradise.png` (real gold wordmark, transparent PNG)

- **Email 2 — Suzanne Powers**, Powers Realty Group ("Florida's Boutique Broker®") · Naples, **Collier 34102** · `powersrealtyfl.com`
  - Colors: primary navy `#002D62`, accent periwinkle `#8B8BBC` (pixel-sampled from the real logo), font BOOK_SERIF
  - Logo: `…/powers-realty-group.png` (real navy shield lockup, transparent PNG)

> Both are DEMO SUBJECTS. Never contacted. The contrast (franchise gold vs. boutique navy) is the
> whole point — "so the brand scrape + name-add visibly differ."

---

## E. THE TRUE LANDING / FUNNEL (Phase 3 — the piece the prior file dropped entirely)

- **E1 — Each email's CTA → a real BRANDED arrival page that SAVES the visit and shows their data.** 🔶 (funnel exists; not wired to these two emails)
  > "for both my emails, create a true landing from email. Info saved, ready to go."
  > "reproduce similar structure acting as the user."
  - The funnel is already built: `lib/prospects/build-arrival-url.ts` → `/welcome?name=&primary=&secondary=&logo=`
    (branded, no signup), `prospect_activation` (email-keyed identity before signup),
    arrival/claim bridge (`mintClaimToken` → `/api/claim`). Walk it as the recipient (Chrome) for both inboxes.

---

## F. PRE-STAGE EVERYTHING (built upfront, not on the fly)

- **F1 — Discover + scrape + build + SAVE in PREP; the word only SENDS.** 🔶
  > "Set up initial system and emails so we aren't creating on the fly."
  > "Simple crawls and we build folders on everyone."
- **F2 — Current projects are disposable.** ✅
  > "Don't worry about anything in my current projects. All garbage. Set it up how you have to so it works."
- **F3 — Gated preview before the first send.** ⚙
  > "Dry run can send me an emails saying SNICKLEFRITZ to confirm receipt" (a receipt-confirm dry run is allowed)
  - Show the rendered email + chosen template + scrape, get sign-off, THEN send.

---

## G. RECURRENCE (after the first approved send works)

- **G1 — Today + the same time the next two days = 3 sends, both inboxes.** ❌ (scheduler paused)
  > "i get an email today, tomorrow at the same time and the next day at both of my emails."
  - `lib/email/scheduler.ts` + `.github/workflows/email-scheduler.yml` are PAUSED. A self-limiting
    trigger calls the SAME `blast` core 3×, idempotency key `snicklefritz/<slug>/<isoDate>`. Do not write a new sender.

---

## H. WHY THIS KEPT FAILING — and the enforcement that actually stops it

- **The contract was never wired.** `.claude/CONTRACT.md` claims it prints "every session" via
  `.claude/hooks/print-contract.mjs` — that hook **does not exist**, and CONTRACT.md is untracked.
  The operator already wrote the install (`docs/contracts/MAKE-CONTRACT-FOLLOW.md`), but it was never applied.
  > "HOW CAN WE HAVE A CONTRACT FOLLOW ON OUR MCP BUT WE CAN'T HERE?????"
- **A print hook is advisory — it can't BLOCK.** Every session read the rules and ignored them. The
  only thing with teeth is a PreToolUse hook that **refuses** creation of a parallel builder
  (`scripts/email/*snicklefritz*`, `lib/email/snicklefritz/*`) and points back to `assembleDeliverable` + `blast`.

---

## THE FIX LIST (smallest path to "say the word, get the emails")

1. **Wire the brand into the render** (C1) — pass `extractBrandTheme(deliverable.branding)` into
   `renderGroundedReport` in `blast/route.ts` + the `/p/[id]` page. *(the one real bug)*
2. **Commit `public/email-assets/snicklefritz/` + `fixtures/prospects/`** (C2) so logos deploy.
3. **Assemble the daily-weighted data + chart** (B1/B2) as project `items`.
4. **Add the two inboxes as `contacts`** (A5).
5. **Wire each CTA → branded arrival** (E1).
6. **Un-pause / point the 3-day self-limiting trigger** at the `blast` core (G1).
7. **Install the blocking hook + commit the contract** (H) so a future session can't re-offend.

> Run order on "SNICKLEFRITZ": (1) project per broker, branding set, daily-weighted items filed →
> (2) build template `email` → (3) PREVIEW `/p/[id]`, operator approves → (4) blast to one inbox →
> (5) recurrence repeats 2 more days. Claude feeds; the builder builds; the operator fires the word.
