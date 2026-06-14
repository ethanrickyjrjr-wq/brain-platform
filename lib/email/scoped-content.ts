/**
 * scoped-content — the contract for per-scope email content (Task 02, hybrid:
 * cards now, prose-ready). Pinned in step-01; assembly impl lands in step-02.
 *
 * A scoped `email_schedules` row (scope_kind/scope_value/topic) becomes cited
 * `WelcomeMetric` cards via `buildWelcomeAnswer` (lib/welcome/answer.ts) — zero
 * LLM, $0/send, the SAME no-invention + MOAT-grain guarantees as the welcome
 * path. `scope_kind==NULL && topic==NULL` is the caller's global-digest path;
 * `resolveScope`/`assembleScopedContent` are only invoked when a scope is present.
 */
import type { WelcomeMetric } from "@/lib/welcome/frames";
import type { ScheduleRow } from "@/lib/email/scheduler";
import type { LocationInput } from "@/refinery/lib/location-resolver.mts";

/** Cited cards for one scope, plus the scope identity. Prose-ready (a narrative
 *  layer can later read `cards`), but v1 emits cards only — no LLM. The `cards`
 *  type is `WelcomeMetric[]` from buildWelcomeAnswer — do NOT redefine it. */
export interface ScopedContent {
  cards: WelcomeMetric[];
  scope_kind: string;
  scope_value: string;
  topic: string | null;
}

/**
 * `resolveScope(row)` output. Carries the full `LocationInput` (not a bare zip):
 *   • `assembleLocationDossier(loc)` AND `identityForLocation(loc)` both need it.
 *   • Re-deriving loc from a bare zip would relabel a `scope_kind='place'`
 *     ('cape coral') as "ZIP 33904" — losing the town identity.
 *   • `scope_kind='county'` resolves with NO zip → `zip` is nullable here
 *     (buildWelcomeAnswer takes the coarse path when dossier.zip is empty).
 * `explicitZip` is true ONLY for `scope_kind='zip'` (it gates the flood card;
 * a place/county spans ZIPs → false → flood self-suppresses, per the welcome path).
 */
export interface ResolvedScope {
  loc: LocationInput;
  zip: string | null;
  explicitZip: boolean;
  topic: string | null;
}

/** Signature pinned in step-01; implemented in step-02. Returns null when the
 *  scope is unresolvable / out of the 6-county footprint (caller falls back to
 *  the global digest and logs — never invent below grain). */
export type ResolveScope = (row: ScheduleRow) => ResolvedScope | null;
