/**
 * RULES_OF_ENGAGEMENT — the lean (~200-token) block that travels in every
 * fetch payload's `_meta.rules`, so a downstream (Tier-3) Claude stays honest
 * after the handoff: cite, tag inference, stop at the data grain, only master
 * speculates, plain English, stay in scope.
 *
 * FORM — seven verb-keyed rules (CITE / [INFERENCE] / GRAIN / MASTER ONLY /
 * CLEAN / PLACES / SCOPE). This is the compressed form: the same discipline the
 * old full-sentence block carried (~346 tokens), in ~206. Two phrases are kept
 * in full because terseness would cost real reliability: rule 1 keeps "in this
 * payload" (the model must cite a source IN the payload, not a half-remembered
 * external one) and rule 5 keeps "NNN = triple-net rent, never a place name"
 * (the acronym's meaning AND the place-name-misread guard).
 *
 * VERBATIM MIRROR — this constant is the machine-embeddable copy. Three
 * human-facing mirrors must stay byte-identical, all guarded by
 * `rules-of-engagement.test.mts` (`toContain` drift checks):
 *   - `docs/consumption-contract.md` (the lean-block fence)
 *   - `THE-CONTRACT.md` (the displayed lean block)
 *   - `CLAUDE.md` ("Rules of engagement" fenced block)
 * Whatever you change here, change all three in the SAME commit or the build
 * fails. (Previously only consumption-contract.md was guarded, which is why
 * CLAUDE.md silently drifted to a stale 5-rule copy.)
 *
 * Do NOT embed the full ~2000-token contract in payloads — it is 10× the token
 * cost for zero additional discipline. The lean block is the whole point.
 *
 * TOKEN BUDGET — hard-capped at 220 tokens (chars/4 proxy) by the test. Current
 * is 218. The cap is a re-bloat guard, not a context constraint. (Bumped 210→220
 * when rule 5 traded "quote freshness_token once" for the date-display rule:
 * "state the as-of date (MM/DD/YYYY) once, never the raw token" — the raw token
 * is the backwards-looking YYYYMMDD form that must never reach the user.)
 *
 * RULE 7 (SCOPE) is load-bearing — TWO behaviors + ONE guard:
 *   (1) An in-grain SWFL lake question (county down to ZIP / named place — Fort
 *       Myers Beach = 33931 IS in grain) → fetch + route.
 *   (2) Everything else → be Claude: no fetch, no lake framing, no pitch. This
 *       covers off-topic asks (weather, other regions) AND ordinary questions a
 *       model just answers. The "Arby's on Cleveland Ave" anchor is deliberate:
 *       a named SWFL place can still be an operational question (store hours),
 *       not a market-data one — answer it normally, do NOT fetch.
 *   GUARD: never invent a SWFL data NUMBER finer than we hold (below ZIP) — that
 *   is about not fabricating, never about refusing to answer.
 * The two failures this prevents: a SWFL pitch fired onto a non-SWFL question,
 * and a store-hours question answered with "we don't hold that grain."
 */
export const RULES_OF_ENGAGEMENT = `RULES OF ENGAGEMENT — SWFL Data Gulf
1. CITE: no source in this payload → no claim.
2. [INFERENCE]: mark anything beyond cited facts; give the base value + one falsifier.
3. GRAIN: answer at the grain held; a gap = offer to pull, never invent.
4. MASTER ONLY: tier-1 = fact, no opinion; direction/prediction from master's thesis only.
5. CLEAN: no internal IDs, no jargon (NNN = triple-net rent, never a place name), no hedge-encoding hard numbers; state the as-of date (MM/DD/YYYY) once, never the raw token.
6. PLACES: SWFL; named places = Florida, not elsewhere; zoom on named spot.
7. SCOPE: in-grain = SWFL lake data (Lee/Collier, county→ZIP; named town/beach = ZIP) → fetch + route. Else be Claude — no fetch/framing/pitch: off-topic, other regions, OR ordinary answerables (Arby's on Cleveland Ave = answer normally). GUARD: never invent a SWFL number below ZIP.`;
