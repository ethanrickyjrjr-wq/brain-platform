# CT Review — Brain Factory Blueprint v1.0

**Reviewer:** CT (Claude Code)
**Date:** 2026-05-15
**Blueprint:** Notion page 36135f3b-7faf-813d-b9b8-dfc16ee7da0b
**Method:** Blueprint cross-referenced against actual source files

---

## Summary Verdict

The architecture is right. The output-chain model, the thin pipe, the registry, the scaffold — all correct. But the spec has 6 blockers that would cause the build to fail on first run, 4 type-level errors that would fail compilation, and several design decisions that work against the existing system. None of these are hard problems. They are all fixable with small corrections before we write a line of code.

---

## 1. BLOCKERS — Would fail before first `--dry-run`

### 1a. `corpusSummary` signature is completely wrong

**What LB wrote:**

```typescript
corpusSummary: () => string;
```

**What actually exists** (`refinery/types/pack.mts:56`):

```typescript
corpusSummary?: (allFragments: RawFragment[]) => SynthesisFact[];
```

This is not a style difference. `corpusSummary` receives ALL Stage-1 fragments (including ones that failed triage) and returns a typed `SynthesisFact[]` array — not a string. Stage 3 (`3-synthesis.mts:65`) calls it with `allFragments`, converts each `SynthesisFact` to a `SynthesizedEvent` with max composite so it lands at the top of the rendered facts. If we use LB's signature, Stage 3 blows up immediately. Every corpus aggregate (brand counts, corridor counts, survival rates) lives here. This is the most load-bearing function in the pack.

**Fix:** Keep the actual signature. The spec YAML in the Blueprint is wrong.

---

### 1b. `SourceConnector` interface has no `normalize()` method

**What LB wrote** in `BrainInputConnector`:

```typescript
async fetch(): Promise<string>   // returns raw text
normalize(raw: string): RawFragment   // separate step
```

**What actually exists** (`refinery/types/pack.mts:20`):

```typescript
interface SourceConnector {
  source_id: string;
  fetch(): Promise<RawFragment[]>; // returns ALREADY-normalized fragments
  citationMeta(verifiedDate, ttlSeconds): Omit<CitationRow, "id">;
}
```

There is no `normalize()` step. `fetch()` does both the fetching and normalization and returns `RawFragment[]` directly. Stage 1 (`1-ingest.mts:20`) calls `source.fetch()` and gets back the normalized array — it never calls `normalize()`. LB's `BrainInputConnector` class doesn't implement the actual interface; it would be a TypeScript error.

The existing `makeIndexSource()` in `master-source.mts` is the correct pattern: `fetch()` reads the local file, parses it, normalizes it, and returns `RawFragment[]` in one shot. `BrainInputConnector` needs to follow this exact same pattern.

**Fix:** `BrainInputConnector.fetch()` reads the brain file, extracts the Output block, and returns `[RawFragment]`. No separate `normalize()`.

---

### 1c. `BrainInputConnector` fetches the live Vercel URL — this breaks offline builds and is the wrong source

**What LB wrote:**

```typescript
constructor(upstreamSlug: string, registryUrl: string) {
  this.resolvedUrl = registryUrl;   // the live Vercel URL
}
async fetch(): Promise<string> {
  const res = await fetch(this.resolvedUrl);  // hitting Vercel every build
  return res.text();
}
```

**What the current master-source.mts actually does** (line 101):

```typescript
const filePath = path.join(BRAINS_DIR, `${cfg.brain_id}.md`);
md = normalizeEol(await readFile(filePath, "utf-8"));
```

It reads the local `brains/{slug}.md` file. This is the correct approach for the build pipeline. Three reasons:

1. **Vercel may not have the latest version.** If you build `macro-swfl` locally and immediately want `master` to read its output, master should read the local file — not the previous deployed version on Vercel.
2. **Offline/fixture mode would break.** `REFINERY_SOURCE=fixture` is the proven offline testing path. If `BrainInputConnector` hits Vercel, fixture mode is useless for builds that depend on other brains.
3. **Live URL is for Claude, not for the Refinery.** The Vercel URL is what Claude fetches in a user session. The Refinery build chain uses local files. These are two different reading contexts.

The `resolvedUrl` from the registry is still useful — it goes into the `citationMeta()` so the citation table in the consuming brain points to the live URL. That's correct. But `fetch()` reads the local file.

**Fix:** `BrainInputConnector.fetch()` reads `brains/{upstreamSlug}.md` locally, same as `makeIndexSource()`. The `registryUrl` is used only in `citationMeta()`.

---

### 1d. No YAML parser in the project

**What LB wrote:**

````
## Output
```yaml
brain_id: hurricane-risk
conclusion: |
  Lee County hurricane risk is elevated...
confidence: 0.82
key_metrics:
  - metric: cat3_plus_probability_18mo
    value: 0.34
````

**What's in package.json:** No `js-yaml`, no `yaml`, no YAML parsing library. The project currently parses YAML frontmatter with a custom line-by-line regex parser (`frontmatterValue()` in `master-source.mts:51`). That parser does NOT handle multi-line scalars (`|`), arrays, or nested objects — which are all used in LB's Output block format.

Adding YAML parsing for the Output block requires either:

- Installing `js-yaml` or `yaml` (new dependency, add to package.json)
- Or switching the Output block to JSON (zero new dependencies, consistent with SAVED FACTS format which is already JSON)

**Recommendation: Use JSON, not YAML, for the Output block.** The SAVED FACTS section is already JSON. Every fact is JSON. The spec-validator already parses JSON. The inference-bait lint already parses JSON. Using JSON here is consistent, dependency-free, and already validated. YAML reads nicer but adds a dependency and a parser we'd have to maintain.

**Fix:** Change the Output block format to JSON. Remove the YAML fenced block. Use the same format as SAVED FACTS.

---

### 1e. Vercel URL in seed data is wrong

**What LB wrote:**

```sql
'https://brain-platform.vercel.app/api/brains/franchise-outcomes'
```

**Actual deployed URL** (from `master-source.mts:22` and confirmed in `docs/engine_state_may15.md`):

```
https://brain-platform-amber.vercel.app/api/b/franchise-outcomes
```

Two differences: the subdomain is `brain-platform-amber` not `brain-platform`, and the path is `/api/b/` not `/api/brains/`. The seed data with wrong URLs would populate the registry with dead links.

**Fix:** Update all three seed URLs to the correct base: `https://brain-platform-amber.vercel.app/api/b/{slug}`

---

### 1f. `supabase/migrations/` directory does not exist

LB references `supabase/migrations/20260515_brain_registry.sql`. There is no `supabase/` directory in the repo. The project has no Supabase migration infrastructure — schema changes are applied manually via the Supabase SQL editor. The migration file can still be created as `docs/sql/brain_registry.sql` for the user to paste and run, but should not be placed at a Supabase CLI path that doesn't exist.

---

## 2. TYPE-LEVEL ERRORS — Compilation fails

### 2a. Three identifiers on PackDefinition: `id`, `slug`, and `brain_id`

**What LB adds:** `slug: string` (NEW, required, URL-safe identifier)

**What already exists:**

- `id: string` — the CLI arg (`franchise-outcomes`)
- `brain_id: string` — the frontmatter key and `brains/*.md` filename

Currently `id` and `brain_id` are always the same value in all three packs. Adding `slug` creates a third identifier. LB's spec uses `slug` throughout the scaffold and DAG resolver, but the existing CLI (`cli.mts:29`) calls `getPack(packId)` which uses `id`. The pack registry uses `PACKS[franchiseOutcomes.id]`.

**Recommendation:** Drop `slug`. Rename `brain_id` to `slug` if the clean name matters, and make `id` an alias pointing to the same value. Or just keep `id` as the single stable identifier and document that it IS the URL-safe slug. Adding a third field solves no actual problem.

---

### 2b. `domain` and `input_brains` are required (non-optional) in LB's spec

**What LB wrote:**

```typescript
domain: string;        // required, no default
input_brains: string[]; // required, no default
```

**What this means for existing packs:** `franchiseOutcomes`, `creSwfl`, and `master` currently have neither field. If these are required (non-optional), TypeScript compilation fails immediately on existing pack definitions before we write a single new pack.

**Fix:** Both fields must be optional with defaults or the spec must acknowledge that all existing packs need backfilling in Step 8 BEFORE Step 1b's type change is committed. Step 8 should be elevated to run immediately after Step 1b, not at the end.

**Recommendation:** Make both optional:

```typescript
domain?: string;
input_brains?: string[];   // defaults to []
```

---

### 2c. `compositeCutoff` optionality mismatch

**LB's spec:** `compositeCutoff: number` (required)
**Actual code:** `compositeCutoff?: number` (optional, has engine fallback)

Minor, but would require backfilling all existing pack definitions.

---

### 2d. Output block duplication with frontmatter

LB's YAML Output block includes `brain_id`, `version`, and `refined_at`:

```yaml
brain_id: hurricane-risk
version: v3
refined_at: "2026-05-15T06:30:00Z"
```

These three fields are ALREADY in the YAML frontmatter at the top of every brain file (lines 2-4 of every rendered `.md`). The `BrainInputConnector` can read `brain_id`, `version`, and `refined_at` directly from frontmatter using the existing `frontmatterValue()` parser. Putting them in the Output block creates a drift risk — two copies of the same data that can get out of sync.

**Fix:** Remove `brain_id`, `version`, `refined_at` from the Output block. Keep only the novel information: `conclusion`, `confidence`, `key_metrics`, `caveats`.

---

## 3. DESIGN ISSUES — Would work but fight the existing system

### 3a. `confidence: 0.0-1.0` computed by the synthesis agent violates the core principle

**What LB wrote:**

> `confidence` - 0.0-1.0. Computed by synthesis agent based on data freshness, source count, agreement across branches. NOT a vibes number.

This directly contradicts the project's core architectural rule: **Supabase does math, Claude paints the narrative.** We have extensive hardening against LLMs computing numbers — the inference-bait lint, the facts-only contract, the explicit prohibition on the synthesis agent computing aggregates.

Having Sonnet output a float between 0.0 and 1.0 is exactly the kind of unreliable numeric computation we've been defending against. The synthesis agent in this project is deliberately constrained to qualitative synthesis. If confidence is a number, it must be deterministic.

**Concrete deterministic confidence formula:**

```
confidence = (avg_source_trust_tier_score) × (freshness_ratio)
```

Where `freshness_ratio = min(1.0, days_remaining / ttl_days)` and `trust_tier_score` maps tier 1→1.0, tier 2→0.8, tier 3→0.6.

This is computable in Stage 4 from the pack's source connectors and citation table, with no LLM involvement.

**Fix:** Remove confidence from synthesis prompt. Compute it deterministically in Stage 4 from trust tiers and TTL freshness. Add a helper function in `lib/` for this.

---

### 3b. Per-pack files `refinery/packs/{slug}.mts` breaks the CLI discovery mechanism

**What LB wrote:** Scaffold generates `refinery/packs/{slug}.mts` and "Appends new slug to `refinery/cli.mts` known packs array."

**How the CLI actually works:**

- `cli.mts:1` imports `getPack` from `./config/packs.mts`
- `packs.mts:487` exports `PACKS: Record<string, PackDefinition>` — a static object
- `getPack(id)` looks up `PACKS[id]` — no dynamic discovery, no file scanning

If packs move to separate files, `cli.mts` needs to dynamically import or statically import every pack file. There's no glob-based discovery in the current build. Adding dynamic imports (`import()`) would work but adds async complexity to what is currently a synchronous registry lookup.

**The simpler fix:** Scaffold appends to the monolithic `packs.mts`. One import at the top, one entry in the `PACKS` object at the bottom. This is how the current system works, it scales to 20-30 packs easily, and it requires zero changes to the CLI or discovery mechanism.

The per-pack file pattern is worth revisiting if the pack count reaches 50+. Not now.

---

### 3c. DAG resolver reads from Supabase for build order

**What LB wrote:**

```typescript
export async function resolveBuildOrder(targetSlug: string): Promise<string[]> {
  // 1. Fetch full registry from Supabase
  // 2. Build adjacency map: slug -> input_brains[]
```

**The problem:** Every build — including `REFINERY_SOURCE=fixture` offline mode — would require a live Supabase connection to compute build order. But ALL the build-order information needed already exists in memory: each `PackDefinition` has `input_brains`. The DAG can be built from the in-memory `PACKS` registry with zero network calls.

```typescript
// Build order from in-memory pack definitions — no Supabase needed
function resolveBuildOrder(
  targetId: string,
  packs: Record<string, PackDefinition>,
): string[] {
  // topological sort over packs[id].input_brains
  // pure function, no I/O
}
```

The Supabase registry is for querying what brains exist (catalog for humans and Claude). It is NOT the source of truth for build-time dependency resolution. The PackDefinition is.

**Fix:** DAG resolver works entirely from in-memory `PACKS`. Supabase is only queried for `--list-brains` (the catalog command) or when Stage 4 upserts the registry after a successful build.

---

### 3d. `## Output` is outside the reference block — which breaks spec-validator

LB's format puts `## Output` as a markdown heading AFTER the closing triple-backtick of the reference block:

````
```reference
... all the existing sections ...
````

## Output

```yaml

...
```

```

The current spec-validator (`spec-validator.mts:44`) checks for REQUIRED_SECTIONS inside the reference block. The `## Output` section is outside it. This means:
1. The spec-validator doesn't validate the Output block (it doesn't know it exists)
2. The facts-only lint doesn't scan it (it only scans the reference block)

If the Output block is outside the fence, an attacker who writes a brain could put instruction-shaped text in it. The validator would miss it.

**Two valid options:**
- **Option A (LB's approach):** Keep `## Output` outside the reference block. Update the spec-validator to also scan the Output block separately. Add explicit facts-only lint for the Output block. Simpler for the `BrainInputConnector` to parse (just find `## Output`).
- **Option B (my original plan):** Put `--- OUTPUT ---` INSIDE the reference block. The existing validator and linter already scan everything inside the reference fence. The BrainInputConnector parses like the master-source already parses SAVED FACTS.

**Recommendation: Option B.** Zero changes to validator or linter. `BrainInputConnector` uses the same extraction pattern as `extractSavedFacts()`. Consistent with the spec's "payload is a fenced reference block" design.

---

## 4. MISSING PIECES — Not in the spec, would block specific steps

### 4a. `## Output` (or `--- OUTPUT ---`) is not in spec-validator REQUIRED_SECTIONS

The Blueprint spec updates `4-output.mts` to render the Output block. But it doesn't update `spec-validator.mts` to require it. Once the renderer adds the section, the validator must also enforce it — otherwise builds without the Output block pass validation silently.

Missing from Blueprint Step table: update `spec-validator.mts`.

---

### 4b. No spec for stale upstream brain behavior in DAG resolver

LB mentions: "If upstream brain's `.md` is fresh (last_refined + ttl > now), skip rebuilding. Read cached output."

What if the upstream brain IS stale and doesn't exist yet (first build)? What if it's stale but the user hasn't built it? The DAG resolver spec is silent on error states. We need to define:
1. Missing upstream brain → hard error with helpful message (build it first)
2. Stale upstream brain → warning + use stale (with staleness flagged in consuming brain's caveats)
3. `--force` → rebuild everything regardless of freshness

---

### 4c. `extractOutput()` is a stub with `throw new Error("TODO")`

LB's spec has this as a TODO. But the parsing logic is the most critical part of the chaining system. We need to spec the exact format before implementation so the renderer and parser are synchronized. What happens if:
- The `## Output` / `--- OUTPUT ---` section is missing (brain was built before v1.3)?
- The JSON/YAML is malformed?
- A required field (`conclusion`) is empty?

Need error handling spec for each case.

---

### 4d. Seed data trigger timing on multi-row INSERT

The `sync_consumer_brains()` trigger fires after each row INSERT. When the seed data INSERTs 'master' with `input_brains = ['franchise-outcomes', 'cre-swfl']`, the trigger correctly updates `franchise-outcomes.consumer_brains` and `cre-swfl.consumer_brains`.

BUT: on a subsequent re-seed with `ON CONFLICT DO NOTHING`, the trigger doesn't fire for existing rows. If the registry is re-seeded (e.g., in a dev environment), `consumer_brains` on franchise-outcomes and cre-swfl would be empty. There should be a final `UPDATE` block in the migration to force-sync consumer_brains after the seed, or the trigger should cover `ON CONFLICT DO UPDATE` as well.

---

## 5. REORDERED BUILD SEQUENCE

LB's sequence has Step 8 (backfill existing packs) after Step 7 (scaffold). But:
- Steps 1b (type change: add `domain`, `input_brains`, `outputProducer`) makes the existing packs fail TypeScript compilation immediately if the fields are required
- Step 8 adds those fields to the existing packs
- Therefore Step 8 must be **atomic with Step 1b** — you can't commit 1b without also committing 8, or the codebase is broken in between

Also: LB's sequence doesn't include updating `spec-validator.mts`. It must be added alongside Step 3/4.

**Recommended sequence:**

| Step | Files | Notes |
|------|-------|-------|
| 1a | `refinery/types/output.mts` | New `BrainOutput` type (JSON shape, not YAML) |
| 1b + 8 | `refinery/types/pack.mts` + `refinery/config/packs.mts` | Type change + backfill in ONE commit. Can't separate these if fields are required |
| 2 | `docs/sql/brain_registry.sql` | User runs in Supabase SQL editor |
| 3 | `refinery/render/master-index.mts` | Add `--- OUTPUT ---` inside reference block |
| 3b | `refinery/validate/spec-validator.mts` | Add `--- OUTPUT ---` to REQUIRED_SECTIONS (must pair with Step 3) |
| 4 | `refinery/stages/4-output.mts` | Call `outputProducer`, render section, upsert registry |
| 1c | `refinery/sources/brain-input-source.mts` | Generic `makeBrainInputSource()` (reads local file, not Vercel URL) |
| 5 | `refinery/dag-resolver.mts` | Topological sort over in-memory PACKS (not Supabase) |
| 6 | `refinery/cli.mts` | Wire DAG resolver |
| 7 | `refinery/scaffold.mts` | Scaffold CLI — appends to `packs.mts`, not per-pack files |
| 9 | `macro-swfl` pack | First brain through factory. FRED fixture + Supabase SQL |

---

## 6. SIMPLIFICATIONS TO ACCEPT

These are LB's choices that I'd push back on — not blockers, but complexity that doesn't pay for itself yet:

| LB's Choice | Simpler Alternative |
|-------------|-------------------|
| Per-pack files `refinery/packs/{slug}.mts` | Scaffold appends to monolithic `packs.mts` |
| `refinery/connectors/` directory | Use existing `refinery/sources/` |
| YAML fenced block for Output | JSON block (consistent with SAVED FACTS, no new dependency) |
| DAG resolver reads Supabase | DAG resolver walks in-memory `input_brains` fields |
| `confidence` computed by Sonnet | `confidence` computed deterministically from trust tiers + TTL |
| Output block includes `brain_id`/`version`/`refined_at` | Those are in frontmatter already — don't duplicate |
| `class BrainInputConnector` | Factory function `makeBrainInputSource()` (matches codebase style) |

---

## 7. WHAT'S CORRECT AND SHOULD BE KEPT AS-IS

- **The output-chain model** — exactly right. Thin pipe. One output. The `master` brain is not special.
- **The registry schema** — mostly correct. The trigger logic for `consumer_brains` sync is sound (aside from seed-timing issue noted above).
- **The scaffold CLI flags** — clean, usable interface. The generated checklist is exactly right.
- **The DAG resolver concept** — correct, just source it from in-memory packs instead of Supabase.
- **The build sequence order** — correct except for the 1b/8 atomicity issue and missing spec-validator step.
- **`key_metrics` as array of typed objects** — correct and better than a flat Record<string, string>.
- **`subBrainPointers` deprecated** — agreed, replaced by `input_brains` + registry. But don't remove from the renderer until all existing uses are migrated.
- **The one-sentence success test** — valid. If scaffold + 3 fetch() implementations produces a deployable brain, the factory works.

---

## 8. RECOMMENDED PRE-BUILD DECISIONS

Before writing a line of code, LB and CT should agree on:

1. **Output block format:** JSON or YAML? (CT recommends JSON — no new dependency)
2. **Output block position:** Inside or outside the reference fence? (CT recommends inside, as `--- OUTPUT ---`, for consistent validation)
3. **`slug` field:** Add it or keep using `id`? (CT recommends keep `id`, don't add a third identifier)
4. **`confidence` computation:** Sonnet or deterministic? (CT recommends deterministic — trust tier × freshness)
5. **Per-pack files or monolithic `packs.mts`?** (CT recommends monolithic for now)
6. **BrainInputConnector: local file or live URL?** (CT recommends local file — same as current master-source)

Once these six are decided, implementation is unambiguous. All six are currently ambiguous from the spec.
```
