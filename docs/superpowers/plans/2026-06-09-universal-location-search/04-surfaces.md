# §D — Surfaces + human entry

**Phase 2 · ~1.5 days total · depends on: §C · status: not started**
Read [`README.md`](./README.md) §0 first. **D1, D2, D3 are independently claimable** — three
parallel Claudes, each driving off `assembleLocationDossier` (§C).

---

## D1 — MCP `swfl_fetch` (`app/api/mcp/server.ts:235`)
When `zip`/location is set AND `report_id` is unset/`"master"` → `resolveLocation` + fan out via
`assembleLocationDossier`. An explicit non-master `report_id` keeps **today's single-brain
`fetchDetailRow` path** (back-compat — do not break it). Out-of-scope → an honest "outside Lee &
Collier coverage" text. Update the `zip`-param doc (`:226–230`) and the "report_id defaults to
housing-swfl when a zip is given" rule line to "returns every dataset covering that location at
its true grain."

**Acceptance:** `swfl_fetch zip=33931` returns a multi-brain grain-labeled dossier (not just
housing); `zip=33908` includes corridor NNN labeled corridor-grain.

## D2 — endpoints
- **NEW `app/api/where/route.ts`** — the universal search endpoint. Accepts any input
  (`?q=`: ZIP | place | corridor | county | address) → `resolveLocation` → dossier. `?format=json`
  carries `resolved_as` + `zip` + `lines` + `freshness_tokens`; default = plain text.
- **NEW `app/api/z/[zip]/route.ts`** — canonical ZIP permalink, cloned from the GET pattern in
  `app/api/b/[slug]/route.ts`. `VALID_ZIP = /^\d{5}$/`, `runtime="nodejs"`, `dynamic="force-dynamic"`,
  `COMMON_HEADERS`. Do NOT overload `/api/b/master?zip=` — a ZIP fan-out is a different resource.

**Acceptance:** `GET /api/where?q=33908` → corridor NNN labeled corridor-grain;
`?q=Lee County` → county dossier (no ZIP lines); `?q=airport-pulling-naples` → corridor dossier
(no synthesized ZIP); `GET /api/z/33931` matches the ZIP path.

## D3 — web page + the human's first move (PB5)

> **BUILT 2026-06-10 (Opus 4.8).** `/r` index + `/r/search` resolver (redirect ZIP / render
> county·corridor·region inline / friendly out-of-scope) + generalized `/r/zip-report/[zip]`
> (identity card → chips → true-ZIP housing+flood → labeled "covers {zip}" rollups). Page
> *decisions* live in pure, tested `lib/location-surface.ts` (`searchRoute`, `didYouMeanBanner`,
> `identityForZip`, `distinctChips`, `barrierTagLabel` — G6; 19 tests). **Deviation, code-verified:**
> the brief keys did-you-mean on "`resolvePlace` confidence === fuzzy", but "bonita" is an EXACT
> gazetteer alias of "Bonita Springs" (`fixtures/swfl-place-zip-crosswalk.json`) and never reaches
> the fuzzy path — so did-you-mean keys on **matched-name ≠ typed-input** (more correct + more
> general). **Blocker fixed in-scope:** `refinery/lib/place-resolver.mts` loaded
> `corridor-centroids.json` via `path.resolve(import.meta.dirname,…)` + `readFileSync`, and
> `import.meta.dirname` is `undefined` in the Next/Vercel server bundle → `resolveLocation` threw on
> EVERY web/route import (latent on D2's corridor path too). Switched to a static ESM JSON import
> (G1, same as `zip-resolver.mts`). All three acceptance cases verified live on `:3000`.

The operator's north star here: *"make it work best for a human."* A human's first move is
typing into a box, not crafting a URL.

1. **Search box** on the report index/landing: one input, any format, GET → `resolveLocation` →
   redirect to the canonical page (ZIP, corridor, or county view). Out-of-scope → a friendly page
   ("We cover Lee & Collier counties, Florida — try a ZIP, city, or address."), **never a bare
   404 for a typed query.**
2. **Identity header card** from `ZipResolution`, rendered BEFORE any metric:
   "33931 — Fort Myers Beach · Lee County · barrier island" (show "barrier island" only when
   classified — G6). Humans confirm *where* before they read *what*.
3. **Plain-language chips** — "ZIP-level / County-wide / Metro-wide / Region-wide". **Never the
   word "grain" on a human surface.** Coverage labels like "Lee county-wide — covers 33931" stay
   (through `sanitizeProse`).
4. **Did-you-mean** — when `resolvePlace` confidence is `"fuzzy"`: "Showing Bonita Springs
   (matched from 'bonida')" so a silent mis-resolve is visible and correctable.
5. **Freshness token once** per page (header area), not per line (`freshness_tokens` supports it).
6. **Human ordering** — identity card on top; true-ZIP real-estate + flood next; county/macro
   rollups collapsed/below. Mirror the MCP ranking; don't render 27 uniform sections.
   Generalize `app/r/zip-report/[zip]/page.tsx` off `assembleLocationDossier`; `notFound()` only
   when truly out of scope. Keep `runtime="nodejs"` / `force-dynamic`.

**Acceptance:** type "bonita" in the box → did-you-mean banner + Bonita Springs page; type
"Miami" → friendly out-of-scope page, not a 404; `/r/zip-report/33931` shows the identity card +
grain chips with "Lee county-wide — covers 33931" sections below the true-ZIP ones.
