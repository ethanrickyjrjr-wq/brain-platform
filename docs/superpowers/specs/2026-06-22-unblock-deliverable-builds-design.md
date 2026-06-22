# Spec: Unblock the deliverable builds — build at any grain, never refuse for missing data

**Date:** 2026-06-22
**Status:** Design — approved in brainstorm, pending operator review of this doc before writing the plan.
**Author:** session 2026-06-22 (grounded by a code-verified probe of the deliverable surface + the email/PDF convergence specs).
**Trigger:** operator hit "An email needs a single ZIP to ground its numbers. This project isn't scoped to a ZIP yet." while trying to build an email, and called it out as a handcuff: _"We are not blocking anything because we don't have the information. We are letting them build what they want, how they want to. Stop handcuffing these builds."_

---

## 0. The governing invariant (this is the point — the email is just the first instance)

**A deliverable build is NEVER refused because data is missing.** It builds from what is sourced, fills gaps from the cascade below in order, names the lane each number came from, and honestly omits/notes only what genuinely cannot be sourced. The ONLY thing ever blocked is **invention** — never **building**.

**The source cascade (operator-stated order, = the locked four-lane provenance moat, `e79ed31c`):**

1. **Our database** — the SWFL lake (brains / `data_lake.*`).
2. **The user's uploads** — a filed PDF's `extracted_text`, a filed figure.
3. **The internet** — a named, sourced web fact (cited verbatim).
4. **The user can add** — a number the user supplies directly.

A number is allowed when it **names its real source in plain words** from one of those four lanes. Only an **invented** number is forbidden. This is the moat — _"sourced, not payload-only"_ — and it must not regress to _"no source in this payload → no claim."_ (See `refinery/lib/rules-of-engagement.mts` Rule 1; memory `project_four-lane-provenance-moat`.)

**Scope boundary (so we don't over-promise):** the chart engine already implements all four lanes live + footnoted (`lib/.../compose-chart.ts` held/upload/user + `gap-fill.ts` web). Wiring **build-time cascade gap-fill INTO the deliverable narrative** (lanes 3–4 actively pulled at assemble time) is the adjacent increment — SOLO-27 / `generic_chart_capability` ("same producer into emails + deliverables") — and is **out of scope here**. This spec (a) removes the only build-refusal handcuff on the surface, and (b) writes the invariant down so no future build re-adds one. The architecture is left lined up for that increment, not blocked by this change.

---

## 1. Audit — where a build can refuse today (6 templates)

Probed `lib/deliverable/*`, `app/api/projects/[id]/build/route.ts`, `app/api/projects/[id]/action/route.ts`, `app/project/[id]/ProjectWorkspace.tsx`.

| Template | Refuses to build? | Verdict |
|---|---|---|
| `market-overview` | No — any grain, any items | ✅ keep |
| `bov-lite` | No | ✅ keep |
| `client-email` | No — already a grain-flexible email | ✅ keep |
| `one-pager` | No (deterministic truncate, never errors) | ✅ keep |
| **`email` (send-ready)** | **YES — ZIP-only.** No ZIP in items → `NEEDS_SCOPE` 422 + `setBuildError`; `buildEmailDeliverableModel` returns `null` for non-ZIP | ❌ **the handcuff — remove** |
| `social` | Refuses out-of-footprint / unknown scope | ✅ keep — this is the moat per the social spec ("refuse and offer the grain we hold") |

**Other non-refusals (correct, unchanged):** `itemCount === 0 → button disabled` (nothing to build from); `freezeSnapshot` drops an unrenderable chart/frame exhibit (degrade, not block); `bind-frame` returns null for an un-bindable frame (drop one exhibit, not the build).

**Conclusion:** the send-ready `email` ZIP gate is the **only** "refuse because we don't have the information" handcuff on the surface. Everything else either builds at any grain or refuses only to protect the moat.

---

## 2. Why the email ZIP gate is safe to remove (the moat is untouched)

The briefcase `email` renders from the **frozen `items_snapshot` + linted `narrative`** — it does **not** re-fetch live data by scope (`lib/deliverable/email-deliverable.ts` is pure; `buildEmailDeliverableModel` reads `row.items_snapshot` + `row.narrative`). The `zip` is used only as a **display label** (`scope`, the header subtitle, a report link) — never as a fetch key.

Therefore the moat's concern — **sub-grain invention** (fabricating a number finer than the data held) — **cannot occur** here: the filed items _are_ the grain held. The ZIP gate was copied from the **recurring** lane (`lib/email/recurring-report.ts`, which _does_ re-fetch live by ZIP via `assembleActivationReport({zip})`) and never belonged on the frozen email.

The convergence spine was **designed** for this generalization:
- `GroundedReportScope.kind` is already `"zip" | "place" | "county" | "region"` (`lib/email/grounded-report.ts:33`).
- `renderGroundedReport` already derives its header from `model.primaryPlace` / `model.countyName`, falling back to `"Southwest Florida"` (`grounded-report.ts:208-209`).
- The code comment at `grounded-report.ts:206-207` literally says non-ZIP lanes derive these "from `model.scope`; that generalization is Task 3." Task 3 + the social spec D6 both call to **"lift the ZIP-only lock."** We are finishing an intended generalization, not fighting the design.

**`resolveReportZip` (the shared ZIP guard) is NOT touched.** The recurring scheduled-send lane keeps calling it and stays ZIP-only. We change only the one-off briefcase email.

---

## 3. The change — four small pieces

### Piece 1 — Scope deriver never returns null (`lib/deliverable/email-scope.ts`)

`emailDeliverableScope(items)` today returns `{scope_kind:"zip", scope_value}` or **`null`** (→ the refusal). Replace with the **held grain** from the single scope root `inferScopeFromItems` (`lib/project/derive-name.ts`), **never null**:

- `zip` present → `{ scope_kind: "zip",    scope_value: zip }`
- else `place` present → `{ scope_kind: "place",  scope_value: place }`
- else → `{ scope_kind: "region", scope_value: "Southwest Florida" }`

(`region` matches the `email_schedules` scope contract where NULL/NULL = whole region; we pass an explicit `"region"`/`"Southwest Florida"` so the label is honest. `parse-scope.ts` already tolerates the kinds.)

The function name stays `emailDeliverableScope`; only its return contract changes — from `{…} | null` to always-`{…}`. It stays pure, no I/O. (Callers that branched on `null` are cleaned up in Piece 4.)

### Piece 2 — Email model builds for any grain (`lib/deliverable/email-deliverable.ts`)

`buildEmailDeliverableModel(row)` stops gating on `resolveReportZip → null`. It maps the persisted `scope_kind`/`scope_value` → grounded header fields:

| scope | `zip` | `primaryPlace` | `countyName` | `scope` |
|---|---|---|---|---|
| zip | the ZIP | place for ZIP (crosswalk) | county for ZIP (`swfl-zip-county.json`) | `{kind:"zip", value:zip, grain:"zip"}` |
| place | `""` | the place | county if derivable, else `null` | `{kind:"place", value:place, grain:"place"}` |
| county | `""` | the county name | the county | `{kind:"county", value, grain:"county"}` |
| region / blank | `""` | `"Southwest Florida"` | `null` | `{kind:"region", value:"Southwest Florida", grain:"region"}` |

`metrics` (from `items_snapshot`) and `lines` (from `narrative` prose) are **unchanged** — verbatim frozen numbers. The function returns a model for **every** grain; it returns `null` only if there is genuinely nothing to render (no metrics AND no prose) — the true empty case, where `GlobalDigestFallback` still applies. **No re-fetch is added** (moat preserved by construction).

`resolveReportZip` stays imported ONLY where the recurring lane uses it. The briefcase email no longer calls it as a gate.

### Piece 3 — Renderer header is grain-aware; ZIP path byte-identical (`lib/email/grounded-report.ts` + a sibling shell) — **approach (A)**

Two spots in `templates/html/email/email-report.html` are ZIP-coupled:
- the subtitle `{{COUNTY}} &middot; ZIP {{ZIP}}` (line 36),
- the footer `View the full {{ZIP}} report online` → `{{REPORT_URL}}` (= `/r/zip-report/{{ZIP}}`, line 85).

**Approach (A) — sibling "area" shell (operator-chosen):** clone `email-report.html` → `email-report-area.html` and `doc-report.html` → `doc-report-area.html`, with the subtitle reduced to the place/county line (no "ZIP") and the footer link reading "View the full report online" → the area/region report URL (or site origin). `renderSkin` selects the area shell when `model.scope.kind !== "zip"`, the existing shell when `=== "zip"`.

**Guarantee:** the ZIP path renders the **exact same shell with the exact same tokens** → **byte-identical** output. The live activation + recurring ZIP emails cannot regress — enforced by the existing golden-equivalence test (`lib/email/grounded-report.test.ts`).

The renderer's non-ZIP token values (`ZIP: ""`, `REPORT_URL`: area/region URL, `place = model.primaryPlace ?? "Southwest Florida"`) are computed only on the `scope.kind !== "zip"` branch.

_Verification item for the plan:_ confirm the area shells pass the unfilled-token gate (every `{{TOKEN}}` the renderer fills must exist in the shell, and vice-versa) — same gate the original `doc-report.html` clone had to satisfy.

### Piece 4 — The refusal branches become unreachable (`ProjectWorkspace.tsx` + `app/api/projects/[id]/action/route.ts`)

Both call `emailDeliverableScope` and branch to a refusal on `null`. Since Piece 1 never returns `null`, those branches are dead — remove them. Clicking **Build** on "Email (send-ready)" for a place/county/region project just builds. The seed/`?seed=` ZIP path (already honored when `scopeKind === "zip"`) is unchanged.

---

## 4. Testing

- **Golden-equivalence (`grounded-report.test.ts`) — MUST stay byte-identical** for the ZIP/activation path. This is the proof we did not touch the live emails.
- `email-deliverable.test.ts` (21 existing) — update: a non-ZIP scope now yields a **model at the held grain** (not `null`); ZIP case unchanged; `null` only for the genuinely-empty (no metrics, no prose) case.
- `grounded-report-briefcase.test.ts` — add **place / county / region** render cases: honest header (no dangling "ZIP "), numbers verbatim from frozen items, area shell selected, unfilled-token gate green.
- **Moat assertions** — the email model still derives from frozen items only; no scope-keyed fetch is introduced (a test that `buildEmailDeliverableModel` is pure over its row).
- `resolveReportZip` + `lib/email` recurring suites — untouched, stay green.
- Build-route / action-route — an "email" build for a non-ZIP project returns `{id}` (no `NEEDS_SCOPE`).

---

## 5. Risk + mitigation

| Risk | Mitigation |
|---|---|
| Regress the **live** activation / recurring ZIP email | ZIP path renders the **same shell + tokens** → byte-identical; golden-equivalence test is the wall. `resolveReportZip` untouched → scheduled sends unchanged. |
| Accidentally invent a sub-grain number | Impossible by construction — the email renders **frozen filed items**, no scope-keyed re-fetch is added. |
| Re-introducing a "refuse for missing data" handcuff later | §0 invariant is written down; the social refusal (the one legitimate refusal) is documented as moat, not handcuff. |

---

## 6. Explicitly out of scope (named so we don't half-build it)

- **Build-time cascade gap-fill into the deliverable narrative** (actively pulling lanes 3–4 — sourced web / user-add — at assemble time, cited). That is SOLO-27 / `generic_chart_capability`; the chart engine already does it (`gap-fill.ts`) and the deliverable builder will adopt the same producer in that increment. This spec leaves the seam aligned, not wired.
- **The `social` guard.** Stays a refusal — it is the moat per `2026-06-20-social-auto-posting-design.md` D6. Not in the workspace dropdown today regardless.
- **`resolveReportZip` / the recurring scheduled-send lane.** ZIP-only by design; untouched.
```
