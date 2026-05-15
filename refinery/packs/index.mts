import type { PackDefinition } from "../types/pack.mts";

/**
 * Per-pack registry (Brain Factory Decision E).
 *
 * Every pack scaffolded after Phase A/B lives in its own file at
 * `refinery/packs/{id}.mts`. The scaffold CLI (`refinery/scaffold.mts`) writes
 * the new pack file AND appends to this index — atomic on success, manual
 * cleanup on partial failure.
 *
 * The three v1 packs (`franchise-outcomes`, `cre-swfl`, `master`) currently
 * live in `refinery/config/packs.mts` and are merged into the unified `PACKS`
 * record there. New packs go HERE.
 *
 * Discovery is sync (one static import per pack) — no glob, no async startup
 * cost. The scaffold edits this file deterministically.
 */

// SCAFFOLD INSERTS IMPORTS BELOW THIS LINE — do not move or remove this marker
// scaffold:imports
import { macroSwfl } from "./macro-swfl.mts";

// SCAFFOLD INSERTS REGISTRY ENTRIES BELOW THIS LINE — do not move or remove this marker
export const PER_PACK_REGISTRY: Record<string, PackDefinition> = {
  // scaffold:entries
  [macroSwfl.id]: macroSwfl,
};
