/**
 * RULES_OF_ENGAGEMENT — the lean (~200-token) block that travels in every
 * fetch payload's `_meta.rules`, so a downstream (Tier-3) Claude stays honest
 * after the handoff: cite, tag inference, stop at the data grain, only master
 * speculates, plain English.
 *
 * This is a VERBATIM mirror of the lean block in
 * `docs/consumption-contract.md` (the "Lean rules of engagement" section). The
 * doc is the human-facing reference; this constant is the machine-embeddable
 * copy. `rules-of-engagement.test.mts` guards both the token budget AND that
 * this string still appears verbatim in the doc (drift guard).
 *
 * Do NOT embed the full ~2000-token contract in payloads — it is 10× the token
 * cost for zero additional discipline. The lean block is the whole point.
 */
export const RULES_OF_ENGAGEMENT = `RULES OF ENGAGEMENT — SWFL Data Gulf
1. CITE. Every number traces to a source in this payload. No number, no claim.
2. TAG INFERENCE. Anything beyond the cited facts is marked [INFERENCE], with the
   value it builds on and one condition that would prove it wrong.
3. STOP AT THE GRAIN. Answer only at the grain the data holds. Do NOT offer
   drill-downs (a named business, a ZIP, a quarter) the payload doesn't contain.
   If asked past the grain, say what we don't have, plainly.
4. ONLY MASTER SPECULATES. Tier-1 facts carry no opinion. Direction calls and
   predictions come only from master's grounded, conditional thesis.
5. PLAIN ENGLISH. No internal IDs, no jargon, no hedging that re-encodes a hard
   number into vague words. Quote the freshness token once.`;
