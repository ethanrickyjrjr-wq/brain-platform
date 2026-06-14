# Step 02 — Scope resolver + fact assembly (Opus; the no-invention spine)

**Check:** `email_scoped_content` · **Owner:** Opus · **Risk:** medium (MOAT/grain correctness)

## Goal

Turn a scoped `ScheduleRow` into cited `WelcomeMetric` cards via `buildWelcomeAnswer`, gated to the 6-county
grain, filtered by topic. Pure + DI-seamed so it unit-tests with no DB/network.

## Confirmed signatures (step-01 audit — RULE 3 C1; do not re-guess)

Audited live in-session 2026-06-14. These REPLACE the draft placeholders below where they conflict.

- **`resolveLocation(input: string): Promise<LocationInput>`** — `@/refinery/lib/location-resolver.mts`.
  Resolves a 5-digit ZIP → `kind:"zip"` AND a place name → `kind:"place"` (gazetteer → `resolveZip(gaz.zip)`).
  `LocationInput` is a discriminated union: zip/place/address carry `resolution: ZipResolution` (`.zip`,
  `.in_scope`); `county`/`region` carry NO zip. **This is the place→zip primitive — NOT `buildPlaceContext`.**
- **`assembleLocationDossier(loc: LocationInput, opts?: { loadBrain?; origin? }): Promise<LocationDossier>`** —
  `@/lib/zip-dossier`. There is NO `assembleDossier(zip)`; the draft seam name was a placeholder. (The welcome
  ROUTE wraps it in the cache/ceiling-guarded `assembleGuardedDossier(loc,{origin})` from
  `@/lib/welcome/dossier-cache`; the cron worker may call `assembleLocationDossier` directly.)
- **`identityForLocation(loc: LocationInput): IdentityModel`** — `@/lib/location-surface.ts`;
  `IdentityModel = { headline: string; subline: string }`. Returns an IdentityModel, **NOT a PlaceEcho.**
  The route composes the echo: `place: PlaceEcho = { zip: dossier.zip ?? token, name: identityForLocation(loc).headline }`.
- **`buildWelcomeAnswer(input): Promise<WelcomeAnswer | null>`** — `@/lib/welcome/answer`;
  `input = { dossier: LocationDossier; explicitZip: boolean; place: PlaceEcho; loadBrain? }`.
  `WelcomeAnswer.metrics: WelcomeMetric[]` → these become `ScopedContent.cards`.
- **`buildPlaceContext(message: string): string`** — `@/lib/place-context` returns a PROSE system-prompt
  prefix, **NOT a ZIP.** ⚠️ The draft's "`buildPlaceContext(scope_value) → representative ZIP`" is wrong —
  use `resolveLocation(scope_value)` for the place→zip resolution.
- **Substrate:** at audit time the 3 scope columns were NOT live in prod (table exists, 14 cols; scope_kind/
  scope_value/topic absent). Applying `docs/sql/20260613_email_schedule_scope.sql` (additive+idempotent) is
  gated on operator approval (see step-01 / SESSION_LOG). `ScheduleRow` (`lib/email/scheduler.ts:46-67`) already
  declares the 3 optional/nullable fields, so once the columns land the claim RPC's `s.*` flows them through.

### Pinned in `lib/email/scoped-content.ts` (step-01)

`ScopedContent` (cards-only v1) + `ResolvedScope`/`ResolveScope`. **`ResolvedScope` carries the full
`LocationInput`, not a bare zip, + a NULLABLE zip:**
```ts
export interface ResolvedScope { loc: LocationInput; zip: string | null; explicitZip: boolean; topic: string | null }
```
- both `assembleLocationDossier(loc)` and `identityForLocation(loc)` need `loc`;
- re-deriving loc from a bare zip relabels a `scope_kind='place'` ('cape coral') as `"ZIP 33904"` — losing the
  town identity; so `assembleScopedContent` reads `r.loc`, it does NOT re-resolve from `r.zip`;
- `scope_kind='county'` resolves with no zip → `zip: string | null`; `buildWelcomeAnswer` takes the coarse path
  when `dossier.zip` is empty.

## `resolveScope(row)` — in `lib/email/scoped-content.ts`

All branches resolve via `const loc = await resolveLocation(scope_value)` (one primitive, zip + place + county),
then return `{ loc, zip, explicitZip, topic }` (see `ResolvedScope` above):
- `scope_kind==='zip'` → `loc.kind==='zip'`; `{ loc, zip: loc.resolution.zip, explicitZip: true, topic }`.
- `scope_kind==='place'` → `loc.kind==='place'` (gazetteer resolves the town → primary zip);
  `{ loc, zip: loc.resolution.zip, explicitZip: false, topic }` (a town spans ZIPs → `explicitZip:false`
  self-suppresses the flood card, mirroring the welcome path). The place identity rides on `loc`, not the zip.
- `scope_kind==='county'` → `loc.kind==='county'` (no zip); `{ loc, zip: null, explicitZip: false, topic }`
  → `buildWelcomeAnswer` takes the coarse path (`dossier.zip` empty).
- **MOAT gate:** for zip/place the resolved `loc.resolution.in_scope` must be true (6-county footprint, the
  `fixtures/swfl-zip-county.json` gate already enforced inside `resolveZip`). Out-of-scope / unresolvable kinds
  (`out-of-scope`/`address-unsupported`) → return `null` (caller falls back to the global digest + logs; never invent).
- `scope_kind==NULL && topic==NULL` is handled by the CALLER (global path) — `resolveScope` is only invoked when
  a scope is present.

## `assembleScopedContent(row, deps)` — pure, DI

```ts
interface ScopedDeps {
  // DI seam over assembleLocationDossier(loc,{origin}) — takes the resolved loc, NOT a zip.
  assembleDossier: (loc: LocationInput) => Promise<LocationDossier | null>;
  identityForLocation: (loc: LocationInput) => IdentityModel; // { headline, subline } — NOT a PlaceEcho
  buildWelcomeAnswer: typeof import("@/lib/welcome/answer").buildWelcomeAnswer;
  log: (line: string) => void;
}
```
1. `const r = await resolveScope(row); if (!r) return null;` — `resolveScope` is **async** (`resolveLocation` is).
2. `const dossier = await deps.assembleDossier(r.loc); if (!dossier || !dossier.in_scope || dossier.lines.length === 0) return null;`
3. compose the echo, then call the answer producer:
   `const place: PlaceEcho = { zip: dossier.zip ?? r.zip ?? "", name: deps.identityForLocation(r.loc).headline };`
   `const answer = await deps.buildWelcomeAnswer({ dossier, explicitZip: r.explicitZip, place });`
4. `if (!answer) return null;` → `let cards = answer.metrics`
5. **Topic filter** (this lane owns topic→card; HERO_CARDS keys = `home_value`/`rent`/`flood_aal`):
   - `'flood'` → `flood_aal`; `'price'|'prices'|'value'|'home'` → `home_value`; `'rent'|'rents'` → `rent`.
   - Known topic → keep matching card(s). **Unknown topic** (e.g. `'permits'` — no card yet) → keep ALL
     geography-scoped cards (never empty-out the send).
6. Return `{ cards, scope_kind: row.scope_kind!, scope_value: row.scope_value!, topic: row.topic ?? null }`.

## Correctness flags

- Cards come ONLY from `buildWelcomeAnswer` — already cited + gated + grain-consistent. Do not add a second
  source, do not regex prose, do not recompute.
- An empty `cards` after a *known* topic filter that matched nothing → fall back to all cards (geography still
  narrows it), never send a blank body.

## Done when

- `resolveScope` covers zip/place/county/out-of-scope; `assembleScopedContent` returns gated cards or `null`.
- Topic filter maps correctly; unknown topic keeps all cards. `tsc`/eslint clean. (Tests in step-04.)
