# The flywheel bootstrap, in plain English (for Ricky)

Companion to `2026-06-07-flywheel-bootstrap-grades-from-history.md` (the plan) and
`2026-06-07-flywheel-bootstrap-REVIEW-knobs.md` (the dials you review). This file is just the _why_.

---

## The one-sentence version

We already log every prediction the master makes — but we have nothing to check those predictions
against yet, so we can't tell if our confidence numbers mean anything. Instead of waiting years for
real predictions to come true, we replay history: ask the engine "what would you have called back in
2015?", then check it against what actually happened. That gives us a stack of graded calls **today**.

## Why this matters (the thing Tariq put his finger on)

Right now we're building the machinery that decides _how much each signal counts_ (the "weighting").
But we're tuning those weights against gut feel, because we have no scorecard. That's backwards. You
can't know if your weighting is good until you've graded the calls it produces.

The fix is to get a scorecard **first**. And the only honest way to get one fast is to grade against
the past — because the past already happened, so we know who was right.

## What we have already (better than expected)

- Every time the master runs, it writes its prediction to a `predictions` table — the call, its
  confidence, the date it should be checked, and the exact number that would prove it wrong. That's live.
- There's an empty `outcomes` table waiting to record "here's what actually happened."
- The grading math is **already written and tested** — it just has only ever been run **once** (a
  Hurricane Ian dry-run). Nobody has run it across a lot of history.

So this isn't "build a flywheel." It's "we built the engine, it idles at one rotation — now run it at speed."

## What we're actually doing

1. **Pick the signals we can replay honestly.** Some data lets us see "what did this number look like
   back then, before anyone revised it" (unemployment is like this — we keep 19 years of snapshots).
   Some doesn't (rent data gets quietly re-written by Zillow, so replaying it would be cheating —
   we'd be peeking at the answer). We only replay the honest ones.
2. **Replay across history.** For each signal, step through time — say, every quarter back to 2007 —
   make the call as of that date, then check it against what really happened a year or so later.
3. **Write down the grades** in their own table, clearly stamped "this is a replay, not a live call."
4. **Read the scorecard.** Two questions: (a) Are our calls better than just guessing "it'll stay the
   same"? (b) When we say "high confidence," are we actually right more often? That second one is the
   gold — it's what turns "confidence" from a decoration into a real number.
5. **Tune the weighting against the scorecard** instead of against gut. That's the whole point.

## The four lines I won't let us cross

1. **Only replay data we can see honestly as-of-then.** No peeking at revised numbers. The cheating
   ones get _listed and excluded_, never quietly skipped.
2. **Replay grades stay in their own table, stamped "replay."** They never get mixed in with real
   live grades.
3. **A replay score is never a number we show the public.** It's internal tuning fuel only. The day we
   tell a customer "we're 78% accurate," that number comes from _live_ calls coming true — never from
   replays. Replays tune the engine; the real track record is the thing we sell, and it has to be real.
4. **Always say how many.** "68% over 31 calls," never a lonely "68%."

## How this connects to the Tariq conversation

This is the exact workstream the message to him describes — "turn the logging on and bootstrap real
grades out of history." It's also clean to hand him: it's self-contained, it's his lane (spend effort
where it earns calibration), and Phase 0–1 could be his to own. It's the highest-value place for a
second brain, because everything the weighting does downstream stands on whether these grades are good.
