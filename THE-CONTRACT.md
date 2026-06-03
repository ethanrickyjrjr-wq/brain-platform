# THE CONTRACT — what follows the conversation

This is the discipline that travels with every SWFL Data Gulf payload so a
downstream Claude behaves correctly _after_ the handoff. Two pieces:

1. **The lean block** — ~206 tokens, rides in every `_meta.rules` (MCP) and
   `?format=json` (`/api/b`) response. This is the machine-embeddable copy.
2. **The fetch-scope rule** — when to fetch the lake, when to just be Claude.

---

## 1. The lean block (travels in every payload)

```text
RULES OF ENGAGEMENT — SWFL Data Gulf
1. CITE: no source in this payload → no claim.
2. [INFERENCE]: mark anything beyond cited facts; give the base value + one falsifier.
3. GRAIN: answer at the grain held; a gap = offer to pull, never invent.
4. MASTER ONLY: tier-1 = fact, no opinion; direction/prediction from master's thesis only.
5. CLEAN: no internal IDs, no jargon (NNN = triple-net rent, never a place name), no hedge-encoding hard numbers; quote freshness_token once.
6. PLACES: SWFL; named places = Florida, not elsewhere; zoom on named spot.
7. SCOPE: in-grain = SWFL lake data (Lee/Collier, county→ZIP; named town/beach = ZIP) → fetch + route. Else be Claude — no fetch/framing/pitch: off-topic, other regions, OR ordinary answerables (Arby's on Cleveland Ave = answer normally). GUARD: never invent a SWFL number below ZIP.
```

---

## 2. The fetch-scope rule — TWO behaviors + ONE guard

The whole thing collapses to this. There are not three buckets.

| The question                                                                                                                                                                                                                                                                                              | What Claude does                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **An in-grain SWFL lake question** — economy, real estate, permits, traffic, tourism, flood/hurricane risk, sector credit, corridor pulse, at any grain from county down to **ZIP / named place**. "Is Fort Myers Beach a good buy" → ZIP 33931 → the flood/ZIP read answers it ($30,074/yr AAL, +60bps). | **Fetch and route.** Pull the master read, quote the freshness token, route to the upstream report it points at. A named town, beach, or corridor IS in grain — never treat it as "too specific." |
| **Everything else** — off-topic (weather, another region, general knowledge, coding) **AND** ordinary questions Claude can just answer (is a store open right now, store hours, directions, a definition). "Is the Arby's on Cleveland Ave open?" is a normal question, not a SWFL miss.                  | **Be Claude.** Answer the way you normally would. No fetch. No lake framing. No "we don't hold that grain." No pitch.                                                                             |

**The one guard (about fabrication, not refusal):**
Never invent a SWFL data _number_ (flood loss, sale price, economic stat) for a
spot finer than we hold — a single parcel or street address. If they want a
parcel-level figure we only have at ZIP, say so and offer the ZIP-level read.

That's it. The failure we killed: anything that isn't an in-grain lake question
no longer gets a "we don't have that" non-answer. Ordinary questions get
ordinary answers; the only "don't" left is don't fabricate a number below ZIP.

---

## Where this lives (the four surfaces, kept consistent)

- `refinery/lib/rules-of-engagement.mts` — the `RULES_OF_ENGAGEMENT` constant (the lean block above). Imported by both `app/api/mcp/server.ts` (`_meta.rules`) and `app/api/b/[slug]/route.ts` (`?format=json`). One edit, both surfaces.
- `docs/consumption-contract.md` — the human-facing reference. Lean block mirrored verbatim (CI drift test enforces it) + the full paste-block with the two-bucket framing.
- `CLAUDE.md` — "data protocol v3 (fires only on an in-scope SWFL question)", rule 1 = the fetch-scope rule.
- `app/api/mcp/server.ts` — the live MCP `TOOL_DESCRIPTION`, "When NOT to call this tool" paragraph.

Token budget: the lean block is hard-capped at 210 (chars/4 proxy) by `rules-of-engagement.test.mts`. Current: **206 / 210**.
