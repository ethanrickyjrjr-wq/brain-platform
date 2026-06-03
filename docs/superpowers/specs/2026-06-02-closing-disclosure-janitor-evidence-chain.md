# Closing-Disclosure Shadow Janitor — Evidence-Chain Contract + De-Identified Term Row

**Status:** SPEC (no code written against this yet). Filed 2026-06-02.
**Proof so far:** 9 real documents run end-to-end, **0 misses, returned byte-for-byte.** That byte-for-byte
property is the product. Everything below exists to protect it while making the output aggregatable.

> **One-line:** the janitor is not a document tool — it is an ingest pipeline. The closing disclosure is the
> first schema-compliant emitter. Each customer gets a private, fully-cited vault of their own deals; a
> de-identified term row crosses into a shared pool that compounds with every customer. The evidence-chain
> rule is the only reason the shared aggregate is trustworthy enough to sell.

---

## 0. The non-negotiable invariant (read first)

**The number handed to a customer about their own deal is EXACT. It is never rounded, never noised, never
fudged.** The span says `$1,800` → the report says `$1,800`. If a "smoothing" or "add a fudge factor" idea
ever lands on a customer-facing extracted value, the evidence chain becomes a lie and the entire moat
("we can prove it to the byte") is gone.

Controlled noise / rounding has exactly ONE legitimate home: the **published cross-customer aggregate**
(Section 4), never the per-customer evidence-chained value.

This mirrors the platform's existing no-smoothing rule (`refinery/lib/smoothing-tokens.mts`,
data-protocol v3 rule 8): deterministic numbers are quantified, not re-encoded into vague English or
perturbed.

---

## 1. Two finding types (the round-trip contract)

A "finding" is never a bare value. It is a value plus a proof. There are exactly two kinds, and **a finding
that fails its round-trip check is DROPPED, not surfaced with a caveat.** No proof → it does not exist.

### 1a. Extracted finding — the value is printed in the document

```
ExtractedFinding {
  term_type:     string        // classified meaning, e.g. "escrow_holdback", "seller_credit", "apr"
  value:         number
  unit:          "usd" | "pct" | "days" | "count" | "date"
  chunk_id:      string        // which chunk of the parsed doc
  page:          number
  verbatim_span: string        // the exact source text the value came from
}
```

**Round-trip check (two conditions, both required):**

1. `verbatim_span` literally contains `value` (exact byte match of the rendered number).
2. The span's _meaning_ grounds the `term_type` — the span is the escrow-holdback clause, not merely a
   paragraph that happens to contain those digits.

Condition (2) is the hard 20%. "Span contains the number" is trivial regex. "Span _means_ this is an escrow
holdback the buyer owes at closing" is a **constrained extraction / classification step with the span as the
leash** — and it is exactly where a careless implementation re-introduces the false positive (a stray
`$1,800` in unrelated prose becoming a phantom holdback). Budget real effort here; this is not regex.

### 1b. Derived finding — the value is COMPUTED from extracted inputs

The most valuable findings are not printed anywhere in the document. In the 9-doc run:

- Prepaid interest: `$57.26 × 16 days = $916.16` — the $916.16 appears nowhere in the source.
- Cash-to-close reconciliation: three pages of math to close the loop.

A naive "find this exact number in this exact span" rule **rejects both of these — the sophisticated findings.**
So derived findings carry their arithmetic instead of a single span:

```
DerivedFinding {
  term_type: string
  value:     number
  unit:      ...
  formula:   string                 // human-readable, e.g. "per_diem * days"
  inputs:    ExtractedFinding[]      // every ingredient, each individually round-tripped
  derived:   true                    // ALWAYS surfaced flagged as derived, with the formula shown
}
```

**Round-trip check (two-sided):**

1. Every element of `inputs` passes the §1a extracted check (each ingredient is real and grounded).
2. `value === evaluate(formula, inputs)` within a defined tolerance (exact for integer cents).

You are not proving the number is in the document (it isn't). You are proving **every ingredient is in the
document AND the arithmetic is sound.** This is the platform's `[INFERENCE]` discipline almost verbatim
(data-protocol v3 rule 7): a number beyond the audited facts is tagged, cites the audited values it builds
on, and shows its basis. Same contract, pointed at a PDF instead of a brain payload.

**Both false-positive paths die cleanly:** a stray `$1,800` can't become an extracted holdback (fails the
meaning-grounding in §1a-2) and can't become a derived finding (it isn't the checked output of a formula whose
inputs round-trip). No citation, or a citation that doesn't survive the round-trip → never renders.

---

## 2. Two-layer architecture (where PII lives vs. where the pool lives)

```
                 ┌─────────────────────────────┐
   PDF  ─janitor─►   LAYER A — PRIVATE VAULT     │   per customer, never shared
                 │   • full evidence chain        │   • numbers EXACT, byte-for-byte
                 │   • verbatim spans (may hold   │   • identifiers masked for DISPLAY only
                 │     names / SSN / loan #)       │   • audit any finding → source byte
                 └──────────────┬──────────────────┘
                                │  de-identify (Section 3)
                                ▼
                 ┌─────────────────────────────┐
                 │   LAYER B — SHARED POOL       │   cross-customer benchmark
                 │   • de-identified TERM ROWS   │   • NO identifiers carried at all
                 │   • k-anon + DP on PUBLISHED  │   • this is what compounds → flywheel
                 │     aggregates only            │
                 └─────────────────────────────┘
```

The evidence chain (with potentially-PII spans) **stays in Layer A** so the customer can audit any finding to
the source byte. Only the typed, de-identified term row crosses into Layer B. **The thing that aggregates is
exactly the thing that isn't PII** — this falls straight out of the design, it is not a bolt-on.

**Data-rights gate:** a consent / data-rights line authorizing the de-identified term row to enter the shared
pool must be in the customer agreement **before the first row crosses**, not after.

---

## 3. The de-identified term row (the Layer B schema)

This is the row the janitor emits **alongside** the customer-facing findings. It carries no name and no
identifier — just the structured term, its geography, its timing, and whether it was derived.

```
TermRow {
  row_id:        string        // random surrogate; NOT derivable from any source identifier
  term_type:     string        // controlled vocabulary: apr, note_rate, rate_apr_spread,
                               //   seller_credit, escrow_holdback, hoa_proration,
                               //   prepaid_interest, doc_stamps, cash_to_close, ...
  value:         number        // EXACT — de-identification removes identity, never perturbs the value
  unit:          "usd" | "pct" | "days" | "count"
  derived:       boolean       // true → was a §1b finding (formula shown in Layer A, not here)
  // --- geography (coarsened to the grain we publish at; never a parcel/address) ---
  state:         string
  county:        string
  zip:           string | null
  // --- timing ---
  close_period:  string        // bucketed: "2026-Q2" or "2026-06"; never the exact close date
  // --- provenance (points back to Layer A WITHOUT leaking content) ---
  source_kind:   "closing_disclosure"
  lender_class:  string | null // normalized lender CATEGORY, not the named entity, if even kept
  confidence:    number        // round-trip confidence from §1
  vault_ref:     string        // opaque pointer into the owning customer's Layer A; not dereferenceable
                               //   by anyone but that customer
}
```

**Explicitly NOT in this row:** buyer/seller name, SSN, loan number, account number, MERS MIN, exact street
address, exact parcel/APN, exact close date, verbatim span text. None of it is a data point; none of it
crosses.

---

## 4. Privacy on the aggregate (the home for the "add a number in" instinct)

The operator's intuition — _"add a number in automatically... has to be an algo to figure out the right amount
and at what point"_ — is correct in spirit and maps onto two named techniques. **Both apply ONLY to published
cross-customer statistics, never to a customer's own value.**

**4a. k-anonymity = the "at what point" — but over quasi-identifiers, not just bucket count.** A benchmark
bucket is only published when it contains **≥ k comparable rows** (start k = 5; tune up for small geos). Below
k → **suppress**. But naive "≥5 deals in this geo×term×period" is NOT enough in a small market:

> **The SWFL quasi-identifier problem.** Even after names and IDs are stripped, the market is small enough that
> _combinations of non-identifier fields_ re-identify a household. A $2.3M waterfront deal in a specific ZIP in
> a specific quarter with a specific loan type may be **one family**, no matter what was masked. k-anonymity on
> raw bucket size does not catch this — quasi-identifier _uniqueness_ does.

So the threshold lives on the **bucket definition itself**, not just its row count: a bucket only publishes
when **no combination of {price-band, ZIP, quarter, loan-type} identifies fewer than k rows.** Coarsen the
quasi-identifiers (widen the price band, roll ZIP→county, quarter→half-year) until the tuple clears k, or
suppress. This is l-diversity-style discipline on the quasi-identifier tuple, applied before any noise.

**4b. Calibrated noise = the "number you add in."** When a bucket _is_ published, add noise to the **published
statistic** (the median/mean), scaled by an algorithm — Laplace/Gaussian noise ∝ sensitivity ÷ ε — **not a
flat constant, and not to the raw values.** Magnitude is computed, not guessed.

> A flat "+33.3 on every raw value" is explicitly rejected: it corrupts the byte-for-byte guarantee, is
> trivially removable (so provides no real privacy), and noises the wrong layer. The correct construction
> leaves every underlying value exact and perturbs only the aggregate that leaves the building.

**ε is a POLICY decision, not a technical one — someone has to own the number.** The formula is mechanical;
the value is a business judgment with a real tradeoff: ε ≈ 0.1 = high privacy, high noise, possibly-useless
signal; ε ≈ 1.0 = weaker privacy, useful benchmarks. There is no "correct" ε to compute — it is chosen and
owned. **Decide and record the ε (and who owns it) before the first benchmark publishes.**

**4c. Composition — the production gotcha that breaks naive DP.** ε is spent **per published statistic, not
once total.** Publishing seller-credit _and_ doc-stamp _and_ days-to-close benchmarks off the same pool spends
**3× the budget** — an attacker combines all three reads. Most naive DP ships ignoring this until it's already
leaking. Decide the regime **upfront**:

- **Global ε budget** — track cumulative ε across _every_ statistic published from the pool; once the budget is
  exhausted, no new statistic publishes without a refresh policy. Simple, conservative.
- **Advanced composition (Rényi DP)** — composes many queries with a tighter cumulative bound than naive
  summation; the right tool once the number of published statistics is more than a handful.

Pick one and write it down here before publishing the _second_ statistic — retrofitting a budget after
multiple benchmarks are live means recalling numbers already shipped.

**Masking inside Layer A (display + safety net):**

- Classify every number first: dollar value, rate, date, count, or **identifier** (SSN, loan #, account #).
  **Only identifiers are masked.** Masking by digit-length alone is wrong — it clobbers an 8-digit sale price
  and misses an SSN written `123-45-6789`.
- Identifier masking: show **last 4 only** (`loan ending …6789`), like a credit card. "X the last two of a
  9-digit SSN" leaves 7 of 9 digits = still re-identifiable — insufficient.
- Belt-and-suspenders fallback for _unclassified_ pure-digit runs ≥ 9: mask all but a short prefix, flag for
  review. This is a backstop, not the primary rule.

---

## 5. What you get (why this is the moat, not the regex)

One company's stack of closings → typed, cited term rows → a structured ledger of **what real closings
actually cost at the term level** (credits, holdbacks, rate/APR spreads, doc stamps) — the data that lives in
a thousand inboxes and dies there. Per customer: a private "where you got squeezed" read. Across customers: a
benchmark that _only exists because you structured everyone's_, and that gets sharper with every new book —
the data network effect and the on-ramp to the scored-history flywheel (`docs/THE-GOAL.md`; terms-at-signing +
what-happened-next is exactly "starting conditions + event → outcome," cohort-matched by the 51st case).

Dirty data doesn't aggregate (a million regex guesses = a swamp; you can't trust the median). Falsifiable data
does: every row round-tripped before it rendered, so the published benchmark is defensible to the byte.
**The structural guarantee built for the output is what makes the acquisition trustworthy.** Anyone can write
regex; the discipline is refusing a finding it can't prove **while still surfacing the one it can only prove by
arithmetic** — because that derived finding is the whole value, and the naive version of the rule throws it
away.

---

## 6. The three-layer reasoning surface (the data-product vision)

The janitor is not the product. It is the straw. The product is **one AI reasoning surface grounded in three
layers a customer cannot get behind any other single pane of glass** — none of it fabricable, all of it
compounding.

### 6a. The three layers (different in kind, not just in source)

1. **Their own cleaned data** — the Layer A vault (§2). Ground truth about _their_ deals: exact,
   evidence-chained, byte-for-byte. The only layer that is _theirs_ and about _them specifically._
2. **Our SWFL lake** — the cited market _around_ their deals (flood AAL on the ZIP, corridor asking rents,
   permit velocity, labor demand, parcel sale history). The context the deal sits inside.
3. **The data we're going to get** — the de-identified term-row pool (§3) + the scored outcome history (the
   flywheel, `docs/THE-GOAL.md`). What happened to _everyone who started where this customer is standing._

Ask one question — _"is this deal good?"_ — and three independent groundings converge: their actual terms
(layer 1, exact) vs. the corridor benchmark (layer 3, k-anon'd) vs. the market the property lives in (layer 2,
cited). No single dataset produces _"you paid 40% above the corridor median on seller credits, in a ZIP where
flood AAL is rising 60bps, and the last 50 deals that started this way softened."_ The **join** produces it.

### 6b. Why the join is the moat (not any single layer)

Each layer alone is copyable — a clean ledger of your own deals, cited market facts, a benchmark pool. **The
three held together behind one AI that structurally cannot fabricate across any of them is not.** A competitor
needs the customer's private corpus _and_ the territory lake _and_ the scored outcome history _and_ the
discipline to keep all three honest. Any one is replicable; the four-way join, per customer, is not — and it
worsens to compete with every month (more closings deepen layer 1, more customers deepen layer 3, time deepens
the scored history). This is "time + territory," now stacked three deep and reasoned over at once. It is the
carry-contract (Goal 2) generalized: hand the AI a grounded dossier from each layer, it reasons, it does not
re-fetch, it cannot invent.

### 6c. Quantified impact — answered with the contract's own discipline

> Only one hard number exists: **9 docs, 0 misses, byte-for-byte; 6/6 on the demo doc** (n=9, own run).
> Everything else here is a _model_, tagged `[INFERENCE]` with a falsifier — deliberately, because faking a
> number inside the one project built to not fake numbers would be self-refuting.

- **It is a change in error _type_, not a speed multiplier.** Ungrounded output is confident, complete-looking,
  and quietly missing the buried finding (the page-5 prose holdback) — the error is _invisible_ until the
  closing table. The grounded system _drops_ what it can't prove, so the residual is a _visible_ omission
  ("verified X; couldn't close gap Y") you can act on. `[INFERENCE: the dollar value of invisible-false-positive
→ visible-omission is large but unmeasured; falsifier — run 30 real disclosures through a human reviewer AND
the janitor, count which errors each consumer could catch before closing.]`
- **The mechanical 70–80% of the analyst's per-deal work collapses toward zero.** Read/total/reconcile and
  pull-comparables are exactly what extraction (9/9) + an attached benchmark replace; the judgment ~20%
  (decide, negotiate, relationship) is what remains. The lever is _not_ "each analyst 20% faster" — it is "one
  analyst covers the deal flow that used to need a team, spending hours on the call instead of the cross-check."
  `[INFERENCE: 70–80% split needs a real time-study; falsifier — shadow one analyst for a week.]`
- **Pattern recognition is a signal-to-noise problem, and grounding flips it.** On dirty/thin data Claude
  pattern-matches _noise_ (the hallucination risk). Three things make it an asset: (1) clean schema-identical
  rows make patterns _statistically visible_ (50 clean rows show what 50 dirty ones smudge); (2) cross-layer
  correlation no human holds at once — terms × lake × benchmark _simultaneously_, surfacing the _interaction_
  a serial human reviewer drops; (3) it pattern-matches only on what it was handed, so a gap reads as a gap,
  never an invented trend — which is the only reason a surfaced pattern is worth acting on.

**External anchors (verified in-session 2026-06-02; grade noted, soft ones flagged soft):**

- _Baseline problem._ On the **FailSafeQA** financial benchmark, even the most robust frontier model tested
  (OpenAI o3-mini) **hallucinated in 41% of cases** ([ajithp.com summary](https://ajithp.com/2025/02/15/failsafeqa-evaluating-ai-hallucinations-robustness-and-compliance-in-financial-llms/)).
  A 172B-token, 35-model study found **models good at _locating_ the right info still fabricate at high rates**
  — "retrieval-focused benchmarks are insufficient for assessing trustworthiness"
  ([arXiv 2603.08274](https://arxiv.org/pdf/2603.08274)). This is the thesis, peer-reviewed: finding the number
  ≠ telling the truth about it. (Avoid the loose _"up to 41% of finance queries"_ 2024 stat — no traceable
  primary cite; use the benchmark figure.)
- _Grounding helps but never reaches zero._ GroundSight cut hallucination **65.79% → 13.88%** (vision QA, flag
  domain; [arXiv 2509.25669](https://arxiv.org/abs/2509.25669)); peer-reviewed text studies land **>40%**
  (MEGA-RAG) and **39.3%** (binary RA reward) reductions. The **"70–80% fewer after RAG"** figure is
  _industry-reported, not peer-reviewed_ — color, not proof. **The differentiator:** RAG _reduces_ the
  residual; the §1 round-trip rule _refuses_ it (drop, don't caveat). That gap is the moat sentence.
- _Productivity floor._ **+33% more productive per hour of generative-AI use** — Federal Reserve Bank of
  St. Louis (Bick/Blandin/Deming, 2025-02-27; [HR Dive](https://www.hrdive.com/news/workers-productivity-increases-every-hour-they-use-generative-ai/741598/)).
  A professional-writing RCT showed **~40% faster + double-digit quality gains** (generic writing, not vertical
  analysis). Present the Fed number as the **floor, not the claim** — a grounded vertical case should plausibly
  exceed generic lift, but that delta stays `[INFERENCE]` until a real broker/analyst is time-studied.

### 6d. Three boundaries that keep it honest (violate any and it collapses)

- **The groundings will disagree — surface it, don't smooth it.** Their closing, the benchmark, and the lake
  can give three different reads. CLAUDE.md's discrepancy rule governs: _"X verified, Y needs review."_ The
  disagreement is _where the insight lives_; an AI that smooths three groundings into one confident number is
  the exact failure the evidence-chain rule exists to prevent.
- **Cross-customer benefit flows ONLY through the de-identified term row.** The per-customer AI reasons over
  _their_ vault + the lake + the benchmark. The moment "reason over all three" quietly means "reason over other
  customers' raw vaults," the §2/§4 privacy architecture is dead. Layer 3 is powerful _because_ it is the
  k-anon'd distillation, not the raw pool.
- **Two layers are real today; one is a promise.** The lake exists; the janitor works (n=9). The **pool and
  scored history are empty until customers onboard.** Sell the _day-one read_ (their clean deals vs. our
  market) — that standalone value earns the right to accumulate layer 3. Do not pitch the flywheel as already
  spinning; it is what makes year-two uncatchable, not what closes year-one.

---

## 7. Open questions / validation backlog

- **n is still small.** 9 docs, 0 misses, byte-for-byte — excellent proof, but n=9. Format diversity (APR in
  header vs. footnote vs. rider, doc-stamp variants by state) is best hardened against **CFPB published TRID
  sample/blank Closing Disclosures + lender specimen forms** (no PII swamp), reserving a real-disclosure
  corpus for _validating the evidence-chain rule_ where n matters.
- **Controlled vocabulary for `term_type`** needs to be pinned (the published list in §3 is a starting set).
- **k, ε, and composition regime** (§4): set a starting k and quasi-identifier coarsening ladder (§4a); **ε is
  an owned policy number, not a computed one** — assign an owner and record the value (§4b); **pick the
  composition regime — global ε budget vs Rényi DP — before the second statistic publishes** (§4c).
- **`lender_class` normalization** — decide whether lender category is kept at all in Layer B, or dropped.
- **Repo home** — if the shadow janitor becomes its own product/repo (cf. the premise ↔ brain-platform
  separation), this spec should move with it. Filed here for now because here is git-tracked and safe.
- **The write script per company** (the operator's immediate next ask) implements: parse → §1 findings →
  Layer A vault write (exact + masked-for-display) → §3 term-row emit → §4 k-anon/DP gate on publish.
