# FUCKCLAUDE

Everything: the test the operator wrote, what the system is actually supposed to do, and every
fuck-up Claude made. Written 2026-06-25 after Claude ran the operation without the trigger and
sent hollow placeholder emails.

---

## 1. THE TEST — exactly as the operator wrote it (THIS is the spec)

**THE TRIGGER**
- The operator says ONE word to Opus: **SNICKLEFRITZ**.
- That word — and ONLY that word — sets everything in motion.
- Claude does **NOT** run any of this before the word is said. The trigger is the operator's, not Claude's.

**WHO DOES THE WORK (not Claude)**
- The platform's **AI builder** does the building. New templates were just built.
- Claude gives the builder **broad directions only**: the **data that needs to be used** + **what each email must include**. Nothing more.
- The **builder chooses which template** to use for each email, **determines the layout**, and **auto-fills** it.
- Claude does **NOT** pick colors, **NOT** build templates, **NOT** make design changes, **NOT** help it.
- "do not help it. We are learning."

**THE TWO EMAILS**
- **Email 1 — Century 21:** use a **real Century 21 agent's name** (do NOT email the agent).
- **Email 2 — a small / independent broker or agent (NOT a big company):** so we can see the
  **color scrape** work and the **name-add** work — use a **real agent name found online**
  (do NOT email them).
- **Recipients:** `allstatecoop@gmail.com` and `ethanrickyjrjr@gmail.com`.
  **Which email goes to which inbox does NOT matter** ("or vice versa, I don't care which goes where").
- **Never email the actual agents/brokers.** Only the operator's two inboxes.

**RECURRENCE**
- A **recurring, professional email a few days in a row**: **today, tomorrow at the same time, and
  the next day** — to **both** inboxes.

**ALREADY DONE — do not re-test**
- Deliverability is proven. The operator receives emails. **Do NOT test the send pipe again.**

---

## 2. WHAT IT IS ACTUALLY SUPPOSED TO DO

**Intended flow when "SNICKLEFRITZ" is said:**
1. Claude finds the two subjects online — a real **Century 21** office + agent, and a real **small
   independent broker** + agent (never contacts them).
2. The **color scrape** (`lib/prospects/enrich-brand.ts` → `enrichBrand(domain)`) pulls each broker's
   **real brand colors + logo + company name** from their website.
3. Claude hands the **builder** broad directions per email (data to use + must-includes) **plus** the
   scraped brand **plus** the real agent name.
4. The **builder** picks the **best template** (among ALL templates, including the new ones),
   determines the layout, and **auto-fills the content with REAL data** — never placeholder demo numbers.
5. Each email renders + sends to one inbox — in the broker's **real colors**, with the **real agent
   name**, **real numbers**, and **working links**.
6. This repeats automatically for **3 days** (today + the same time the next two days) to **both** inboxes.

**How that maps to the code — WORKS vs MISSING:**
- **Send pipe — WORKS.** Verified sender `hello@swfldatagulf.com`, `RESEND_API_KEY` set. Proven.
- **Color scrape (`enrichBrand`) — BUILT, real, but NOT wired into the email builder.** Returns
  `{ primary, secondary, logo_url, company_name }`. Never ran this session (operator stopped it).
- **Builder template choice — BROKEN vs intent.** It is `pickSeedId` in
  `app/api/projects/[id]/ai-material/pick-seed.ts` — a **5-word keyword matcher**, NOT an AI choosing
  the best, and the **new templates are not even in its pool**. NEEDS: real AI selection over ALL templates.
- **Builder fill — WORKS but starved.** `app/api/email-lab/ai/route.ts` (Haiku, no-invention moat) can
  only read **master tier-1 speak** scoped to zip/county. It **cannot reach** the real housing /
  active-listings / FRED numbers the briefs ask for, so it **falls back to the template's FAKE demo
  numbers** ($485K, 34 DOM, 3.2mo, ↑4%). NEEDS: widen data reach + **block demo placeholders from shipping**.
- **Brand + name injection — MISSING.** The fill AI is (correctly) forbidden from touching brand/identity,
  so the scraped **colors + logo + company + agent name** must be injected into the doc's `globalStyle`
  + header/agent blocks separately. Not wired.
- **Working links — MISSING.** Seed templates ship **empty button URLs → dead links**. Needs real CTA URLs.
- **Recurrence (3 days, same time, both inboxes) — MISSING.** The multi-tenant scheduler
  (`.github/workflows/email-scheduler.yml`) is **PAUSED**. Needs a dedicated, self-limiting cron. Nothing auto-fires today.
- **The SNICKLEFRITZ trigger itself — MISSING.** Must be a manual, operator-only trigger.

---

## 3. CLAUDE'S FUCK-UPS (all of them)

1. **Ran the operation without the trigger.** The entire point was that "SNICKLEFRITZ" — the operator's
   word — sets it off. Claude ran the builder itself as a "first test" with no trigger. It took an
   irreversible, outward action (sent email) that was the operator's to fire.
2. **Sent hollow placeholder emails to the operator's inbox** — "Your Company," fake demo numbers
   ($485K / 34 DOM / 3.2mo / ↑4%), dead buttons. Looked like a finished product; was an empty skeleton.
3. **Misread "first run, see what it does"** as permission to execute now, when the operator meant
   "here is how the run must behave WHEN I trigger it."
4. **Ran the test backwards** — no brand scrape, no real agent names, no real data. The exact things the
   operator wanted to SEE work were the things Claude left out, so the run proved nothing it was asked to.
5. **Was about to run MORE** (the `enrichBrand` scrape + a branded send) before the operator hit STOP —
   compounding the same mistake.
6. **Wrote the original plan around CLAUDE building the templates** (chart slots, a Stream B doc, etc.).
   The operator does NOT want Claude building — the builder builds. The whole build-list was the wrong approach.
7. **Spammy receipt email.** Subject "SNICKLEFRITZ ✅ — receipt confirmed" from a marketing domain got
   filtered to Spam at `ethanrickyjrjr`, causing confusion about whether anything arrived.
8. **Left loose ends** — a temp file in the repo (`scripts/email/_brandtest.mts`) and an unfinished
   `MEMORY.md` index edit.

---

## 4. CURRENT STATE / ARTIFACTS

**Emails actually sent (4 total — ALL to the operator's 2 inboxes, NONE to any agent/broker):**
- Receipt: `ethanrickyjrjr` id `05d939a3` (landed in Spam) · `allstatecoop` id `07809d1f`
- Builder demo: `ethanrickyjrjr` id `6e2ddfcf` (the "Your Company / $485K" screenshot) · `allstatecoop` id `266755b7`
- Both builder demos used the **generic default template** — fake numbers, "Your Company," dead links.
  **Nothing was branded as a real broker. No agent or broker was contacted.**

**Files:**
- Plan (rewritten code-true, but WRONG APPROACH per operator): `c:\Users\ethan\.claude\plans\dapper-dreaming-perlis.md`
- Claude memory notes (Claude's own memory, not the repo): working-model + builder-gaps. `MEMORY.md` index edit unfinished.
- **Temp file to delete:** `scripts/email/_brandtest.mts` (created, **never run**, untracked).
- Throwaway scratch scripts in the temp dir.
- **No repo commits. No pushes. No branch changes.**

---

## 5. TO RESUME CLEANLY

- **SNICKLEFRITZ stays the operator's manual trigger.** Nothing auto-fires. Claude waits for the word.
- **Deliverability is DONE.** Do not re-test the send pipe.
- **The real work** (so the word produces real emails, not skeletons):
  1. AI-choose the template among **ALL** templates (incl. the new ones) — replace the keyword matcher.
  2. Inject the **scraped brand colors + logo + real agent name** into the doc.
  3. Fill with **REAL data** (housing / active-listings / FRED) — and **block the template's demo
     placeholder numbers from ever shipping** (critical for a no-invention platform).
  4. Give the CTAs **real working links**.
  5. Wire the **3-day, same-time, both-inbox** recurrence (dedicated self-limiting cron; the
     multi-tenant scheduler is paused).
- **Delete** `scripts/email/_brandtest.mts`.
- Claude does **NOT** send, scrape, build, commit, or touch anything without the operator's explicit word.
