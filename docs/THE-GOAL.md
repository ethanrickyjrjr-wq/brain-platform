# THE GOAL

> The single source of truth for **what we are building and how it must work.**
> This file carries **no status** — nothing about what is shipped, what exists, or what is left. Status lives only in /ops. This is the goal and the mechanics, nothing else.

**The proof is in the data.** ChatGPT answers from vibes. We answer from the lake — current facts, one grounded thesis, and a citation chain — and we force the model the user is talking to to stand on that data instead of guessing.

---

## The three tiers

Everything we build is one of three tiers. Each has a name and one job. Keeping them separate is the whole architecture.

### Tier 1 — Reporters

Leaf brains and corridor voices. They **report current, cited facts and numbers** — cap rate, home values, rent, traffic, permits, new construction, whatever was asked. Data in, data out. **No opinions, no predictions.** A reporter that speculates is a reporter doing the wrong job.

### Tier 2 — Synthesizer (master)

Master is the **only** tier that speculates. It reads the whole lake — every reporter, plus history and decay — and produces **one grounded, conditional, falsifiable direction call.** Its value is what you could never get by reading the reporters yourself: weighting, contradiction-surfacing, and cross-domain signal. A voice with two local stories can't do this; master sitting on the whole lake can.

### Tier 3 — Conversation

The user's AI. It reasons over the **dossier** master hands it (plus the lean rules-of-engagement block) and answers follow-ups **without fetching again** — unless the question needs data the dossier doesn't hold. Everyone has Tier 3. The moat is that **we force Tier 3 to stand on Tiers 1+2.** The better Tiers 1+2 are, the less Tier 3 has to guess.

---

## How Tier 2 talks to Tier 3 — two principles

### Dossier, not essay

Master hands the user's AI a **context bundle**, not a finished answer: the facts, the grounded conditional thesis, the citations, and an explicit **"here is what we do NOT have"** boundary (the data-grain ceiling). An essay answers one question. A dossier survives twenty follow-ups.

### Conditional, not flat

Speculation is authored as **IF / THEN with a falsifier**, never a flat prediction:

> "IF a Walmart goes in at this corridor, THEN based on N comparable builds expect ~X — here is what's different about THIS corridor vs. the median, and here is the condition that would prove it wrong."

When the user changes the premise ("we're not building there"), the same conditional **inverts from the loaded dossier** — no re-fetch. Flat predictions break on the first follow-up; conditional ones bend.

---

## The rules of engagement (the block that travels in every payload)

> **~200 tokens. This lean block — not the full contract — rides inside every response so Tier 3 stays honest on every turn.** The full reference is `docs/consumption-contract.md`.

```text
RULES OF ENGAGEMENT — SWFL Data Gulf
1. CITE. Every number traces to a source in this payload. No number, no claim.
2. TAG INFERENCE. Anything beyond the cited facts is marked [INFERENCE], with the
   value it builds on and one condition that would prove it wrong.
3. STOP AT THE GRAIN. Answer only at the grain the data holds. Do NOT offer
   drill-downs (a named business, a ZIP, a quarter) the payload doesn't contain.
   If asked past the grain, say what we don't have, plainly.
4. ONLY MASTER SPECULATES. Tier-1 facts carry no opinion. Direction calls and
   predictions come only from master's grounded, conditional thesis.
5. PLAIN ENGLISH. No internal IDs, no jargon, no hedging that re-encodes a hard
   number into vague words. Quote the freshness token once.
```

---

## The end state — the compounding flywheel

The three tiers are the static machine. The **flywheel** is why it gets better on its own, and it is the destination the whole build serves.

The hook is already in the architecture: because every master call is **conditional and falsifiable** (IF/THEN + a written falsifier), every call can later be **graded against what actually happened.** That turns the lake from a snapshot into a learning loop:

1. **Observe** a real-world event — a Walmart opens, an interchange goes in, a flood hits, rates move — against the area's already-known starting conditions (population, traffic, income, demographics, permits, rents). The reporters were watching the whole time.
2. **Predict** — master makes a falsifiable call about the surrounding radius.
3. **Measure** — months later the reporters report what actually moved: rents, traffic, permits, business formation, at what radius, by how much.
4. **Score & bank** — the prediction is graded, and the pairing _"these starting conditions + this event → this actual outcome"_ becomes a row of ground truth.

One event teaches almost nothing. Fifty of the same event across **varied** starting conditions build a real distribution — so by the 51st the system answers from **matched cohorts** ("in the 8 prior cases most like this one, rents within 1 mile moved +X%, the effect died past 2 miles, and here's why THIS one differs") instead of from theory. **Walmart is just the legible example** — every observable event becomes a graded natural experiment.

**Why this is the moat, not the cited-facts layer.** Cited pipelines are copyable; anyone with capital can build them. The scored history cannot be — it is made of **time and territory.** Whoever has watched SWFL longest, with the most reporters running, holds the most graded predictions, and that lead can only be outlived, not bought. This also corrects the framing "when we have all the data": we never _finish_ gathering data — every month of operation makes every future answer sharper, because every event becomes one more graded prediction in the bank. The data is not the destination. The scored history is.

The build steps for this live as **Goal 7** (outcomes loop → causal layer) and **Goal 8** (autonomy + fine-tuned synthesis) on the `/ops/goals` ladder; the flywheel itself is **Goal 9 — the end state they unlock.**
