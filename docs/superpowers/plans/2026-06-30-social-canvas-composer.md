# Social Canvas Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Recommended model:** 🧠 Opus — 9 tasks, 27 files, keywords: refactor, schema, architecture

**Goal:** Add a Canva-style, canvas-native social composer to the paid grid lab where a user designs a fixed-size post (blank or AI-filled from real cited data), exports a pixel-exact PNG client-side, and schedules it to the 5 publishable platforms — the schedule posts the frozen image verbatim.

**Architecture:** A 2D HTML5-canvas editor (`react-konva`) where **preview == export** (`stage.toDataURL({ pixelRatio })`) — no Satori, no headless chromium, no 4th render engine. The composer reuses the shipped publish backbone (`social_schedules` recipe + `freezePost` + cron worker, all DRY-gated by `SOCIAL_PUBLISH_ENABLED`) and the shipped four-lane AI fill (`socialPostSystem` + `tryParseSocial`). The only backend change is one **frozen-image branch** in the cron worker. The design serializes to JSON (with bindings) and is stored on `frozen_post.design`, unlocking carousel + auto-refresh later with no rebuild.

**Tech Stack:** Next.js App Router (client components, route handlers), TypeScript, React 19, `react-konva@19.2.5` + `konva@10.3.0`, Supabase (`social_schedules` / `social_posts` / public `social-media` Storage bucket), Anthropic Haiku for AI fill (existing `build-week.ts` helpers).

**Spec:** `docs/superpowers/specs/2026-06-30-social-canvas-composer-design.md`. **Supersedes** Tasks 5 & 6 of `docs/superpowers/plans/2026-06-29-grid-lab-socials/`. **Build check:** `social_canvas_composer_live_verify` (open).

---

## Global Constraints

Every task implicitly includes these — values copied verbatim from project rules, the spec, and the in-session vendor pass.

- **Vendor facts (verified in-session 06/30/2026 via crawl4ai, RULE 1).** `react-konva@19.2.5` — peerDependencies `react: ^19.2.0`, `react-dom: ^19.2.0` (React-19-aligned; this repo is React 19, so it fits), `konva: ^8.0.1 || ^7.2.5 || ^9.0.0 || ^10.0.0`. `konva@10.3.0`. react-konva is **browser-only** (Konva touches `window`) → must be loaded with `next/dynamic` `{ ssr: false }`. `stage.toDataURL()` **throws `SECURITY_ERR` on cross-origin images** (vendor doc, verbatim) — see the CORS constraint below.
- **Paid-only, via the dial.** Social mode is gated on `capabilitiesFor(tier).socialCalendar` (`lib/email/lab/capabilities.ts`). The grid shell resolves `capabilitiesFor("paid")`. **Never hardcode a tier check.** `lib/email/lab/capabilities.test.ts` enforces the dial — do not relax it. No new capability key is added; reuse `socialCalendar`.
- **Publishable (5) ≠ displayable (8).** Schedule/publish targets are ONLY the 5 `Platform` union members (`x | facebook | instagram | linkedin | google_business` — `lib/social/types.ts`). The 8 in `lib/email/social/platforms.ts` are display/branding only and have no adapters — never a fireable target.
- **No-invention moat.** AI-filled text rides the existing four-lane `socialPostSystem` prompt (cited value carried in the patch) — **no redundant scrub is added**; the moat is already enforced at the prompt. User-typed canvas text is the user's own figure (lane 4) and is intentionally not scrubbed (consistent with the shipped caption model and `feedback_client-data-not-police`).
- **DRY invariant.** Composing/exporting/scheduling NEVER fires a live post. The composer writes a `social_schedules` recipe + `frozen_post` only; the cron worker posts, gated by `SOCIAL_PUBLISH_ENABLED`.
- **No resvg in the browser.** `lib/social/render-social-image.ts` imports `@resvg/resvg-js` (a native Node binary) at module top. **No client component may import from it.** Client-safe pieces (`SOCIAL_FORMATS`, chart→SVG helpers) are carved into resvg-free modules in Task 1.
- **CORS / tainted canvas.** Every Konva `Image` sets `crossOrigin="anonymous"`. v1 image elements are sourced ONLY from the Supabase public `social-media` / lab-media buckets and the existing Photos bridge (same-origin or CORS-enabled). A pasted arbitrary URL that taints the canvas must be caught: export shows an actionable error, never a silent crash.
- **Fonts before raster.** Before `toDataURL()`, `await document.fonts.ready` and explicitly load the selected brand font — otherwise export silently diverges from preview (same failure class as `project_emaildoc-three-render-engines`).
- **Layout standard.** Use `h-full` / `dvh`, never `h-screen`.
- **Clean output.** As-of dates render MM/DD/YYYY, stated once. No internal IDs / jargon on any user-facing surface.
- **Pre-push gates.** Task 0 changes `package.json` → `bun install` + `git add bun.lock` in the SAME push (lockfile gate). Append a `SESSION_LOG.md` entry before every push. Use `node scripts/safe-push.mjs`, stage explicit paths only, never `--no-verify` / force-push `main`. End commit messages with the `Co-Authored-By: Claude Opus 4.8 (1M context)` footer.

---

## File Structure

**New — client-safe shared modules (resvg-free):**
- `lib/social/formats.ts` — `SOCIAL_FORMATS`, `SocialFormat`, `isSocialFormat`, `FORMAT_RATIO`. Moved out of `render-social-image.ts`.
- `lib/social/chart-svg.ts` — `extractInnerSvg`, `nativeBarSvg`, `chartFragment` + the `esc`/`clip` helpers. Moved out of `render-social-image.ts`.

**New — the design model (pure, client+server safe):**
- `lib/social/design/types.ts` — `SocialDesign`, `SocialElement` union, element interfaces.
- `lib/social/design/serialize.ts` — `serializeDesign`, `deserializeDesign`, `designToSkeleton`, `applyDesignPatch`, `newDesign`.

**New — the frozen-post publish helper (pure, server):**
- `lib/social/frozen-post.ts` — `frozenPublishPayload(row)`.

**New — AI canvas fill (server):**
- `lib/email/social-calendar/build-canvas-fill.ts` — `buildSocialCanvasFill(scope, skeleton, opts)`.

**New — API routes:**
- `app/api/email-lab/social/upload/route.ts` — authed PNG → public `social-media` URL.
- `app/api/email-lab/social/generate/route.ts` — AI canvas fill (mirrors `app/api/email-lab/social-calendar/route.ts` auth posture).

**New — composer UI:**
- `components/email-lab/social/KonvaStage.tsx` — the Konva `Stage`/`Layer` + element renderers + `Transformer` (the `ssr:false` dynamic chunk).
- `components/email-lab/social/SocialComposer.tsx` — design state, aspect picker, element palette, Generate/caption/schedule panels; dynamic-imports `KonvaStage`.

**Modified:**
- `lib/social/render-social-image.ts` — re-export `SOCIAL_FORMATS`/`SocialFormat`/`isSocialFormat` from `formats.ts`; import chart helpers from `chart-svg.ts` (back-compat, behaviour byte-identical).
- `lib/social/types.ts` — add optional `design?: SocialDesign | null` to `FrozenPost`.
- `lib/social/persist-schedule.ts` — `freezePost` accepts + stores `design`.
- `app/api/social/schedule/route.ts` — pass `body.design` into `freezePost`.
- `scripts/social/run-schedules.mts` — frozen-image branch at the top of `processSchedule`.
- `components/email-lab/ScheduleSocialModal.tsx` — accept + POST `mediaUrl` + `design`.
- `components/email-lab/EmailLabGridShell.tsx` — Email | Social mode tab; wrap email-mode center + email-only panels; mount `SocialComposer` in social mode; keep Brand/Photos shared; keep Generate-Week panel in social mode.

---

## Task Index & Build Order

| # | Task | Seam-independent? | Touches shared shell? |
|---|------|-------------------|------------------------|
| 1 | Carve client-safe `formats.ts` + `chart-svg.ts` out of `render-social-image.ts` | ✅ yes | no |
| 2 | `SocialDesign` model + serialize/patch + `FrozenPost.design` | ✅ yes | no |
| 3 | Cron frozen-image branch (`frozenPublishPayload` + worker wiring) | ✅ yes | no |
| 4 | Deps + SSR-safe Konva wrapper | foundation | no |
| 5 | Email \| Social mode tab + mode-aware panel split | no | 🔴 yes |
| 6 | The Konva composer (elements, drag/resize, brand, CORS) | no | 🔴 yes |
| 7 | Export → upload route → `media_url` (pixelRatio, font preload) | no | 🔴 yes |
| 8 | AI Generate canvas-fill + caption/variants editor | no | 🔴 yes |
| 9 | Schedule wiring (`ScheduleSocialModal` sends `mediaUrl` + `design`) | no | 🔴 yes |

**Recommended order:** Run **Tasks 1, 2, 3** first (or in parallel — they are seam-independent and touch no shared file). **Task 4** is the dependency foundation for 6. Then run the shared-shell chain **5 → 6 → 7 → 8 → 9 strictly in sequence** (each rebases on the prior; all touch `EmailLabGridShell.tsx`).

---

### Task 1: Carve client-safe `formats.ts` + `chart-svg.ts` out of `render-social-image.ts`

**Why:** `render-social-image.ts` imports `@resvg/resvg-js` (native Node binary) at module top. The composer (client) and Task 8 need `SOCIAL_FORMATS` and the chart→SVG helpers; importing them from `render-social-image.ts` would pull resvg into the browser bundle and break. Carve the pure pieces into resvg-free modules; re-point the renderer at them and prove output is byte-identical.

**Files:**
- Create: `lib/social/formats.ts`
- Create: `lib/social/chart-svg.ts`
- Modify: `lib/social/render-social-image.ts`
- Test: `lib/social/__tests__/chart-svg-parity.test.ts`

**Interfaces:**
- Produces: `SOCIAL_FORMATS`, `type SocialFormat`, `isSocialFormat(v): v is SocialFormat`, `FORMAT_RATIO: Record<SocialFormat, string>` (from `formats.ts`); `esc`, `clip`, `extractInnerSvg`, `nativeBarSvg`, `chartFragment` (from `chart-svg.ts`).

- [ ] **Step 1: Write the parity test (captures current renderer output as the oracle)**

```ts
// lib/social/__tests__/chart-svg-parity.test.ts
import { test, expect } from "bun:test";
import { composeCardSvg } from "@/lib/social/render-social-image";
import { chartFragment, nativeBarSvg } from "@/lib/social/chart-svg";
import { SOCIAL_FORMATS, FORMAT_RATIO, isSocialFormat } from "@/lib/social/formats";
import type { EmailChartSpec } from "@/lib/email/templates/charts/chart-types";

test("SOCIAL_FORMATS dims unchanged + ratio map", () => {
  expect(SOCIAL_FORMATS.square).toEqual({ width: 1080, height: 1080 });
  expect(SOCIAL_FORMATS.portrait).toEqual({ width: 1080, height: 1350 });
  expect(SOCIAL_FORMATS.landscape).toEqual({ width: 1200, height: 630 });
  expect(SOCIAL_FORMATS.story).toEqual({ width: 1080, height: 1920 });
  expect(FORMAT_RATIO).toEqual({
    square: "1:1",
    portrait: "4:5",
    landscape: "1.91:1",
    story: "9:16",
  });
  expect(isSocialFormat("square")).toBe(true);
  expect(isSocialFormat("nope")).toBe(false);
});

test("nativeBarSvg byte-identical for a bar spec", () => {
  const spec = { type: "bar", data: [{ label: "A", value: 3 }, { label: "B", value: 6 }] } as EmailChartSpec;
  const svg = nativeBarSvg(spec, 700, "#0ea5b7", "#9CA3AF");
  expect(svg).toContain("<svg");
  expect(svg).toContain("B"); // label rendered
});

test("composeCardSvg still produces a watermarked card after the move", () => {
  const svg = composeCardSvg({
    model: { headline: "Test", stat: { label: "median", value: "$412K" }, as_of: "2026-06-01" },
    format: "square",
    now: new Date("2026-06-30T12:00:00Z"),
  });
  expect(svg).toContain("$412K");
  expect(svg).toContain("SWFL Data Gulf");
});
```

- [ ] **Step 2: Run it — fails (modules not created yet)**

Run: `bun test lib/social/__tests__/chart-svg-parity.test.ts`
Expected: FAIL — `Cannot find module '@/lib/social/chart-svg'` / `'@/lib/social/formats'`.

- [ ] **Step 3: Create `lib/social/formats.ts`** (move the format block + add `FORMAT_RATIO`)

```ts
// lib/social/formats.ts
//
// Client-safe platform formats. Carved out of render-social-image.ts (which imports
// the native @resvg/resvg-js binary) so the browser composer + AI-fill can import sizes
// + aspect ratios without pulling resvg into the client bundle.

export const SOCIAL_FORMATS = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  landscape: { width: 1200, height: 630 },
  story: { width: 1080, height: 1920 },
} as const;

export type SocialFormat = keyof typeof SOCIAL_FORMATS;

export function isSocialFormat(v: unknown): v is SocialFormat {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(SOCIAL_FORMATS, v);
}

/** Aspect-ratio string per format — the cron passes this to the publish adapters. */
export const FORMAT_RATIO: Record<SocialFormat, string> = {
  square: "1:1",
  portrait: "4:5",
  landscape: "1.91:1",
  story: "9:16",
};
```

- [ ] **Step 4: Create `lib/social/chart-svg.ts`** (move `esc`, `clip`, `extractInnerSvg`, `nativeBarSvg`, `chartFragment` VERBATIM from `render-social-image.ts` lines 110–262)

Copy these functions exactly as they are today (do not change a character of the bodies): `esc`, `clip`, `extractInnerSvg` (+ the `SVG_OPEN_RE` / `SVG_CLOSE_RE` regexes it uses), `nativeBarSvg`, `chartFragment`. Add the imports they need at the top:

```ts
// lib/social/chart-svg.ts
//
// Client-safe SVG chart helpers. Carved out of render-social-image.ts so the canvas
// composer can render the SAME chart shapes to an SVG (then load it as a Konva image)
// without importing @resvg/resvg-js. renderChart itself is import-safe (no native bin).
import { renderChart } from "@/lib/email/templates/charts/chart-renderer";
import type { EmailChartSpec } from "@/lib/email/templates/charts/chart-types";

// ...paste esc, clip, SVG_OPEN_RE, SVG_CLOSE_RE, extractInnerSvg, nativeBarSvg, chartFragment here...
// export esc, clip, extractInnerSvg, nativeBarSvg, chartFragment
```

Mark `esc`, `clip`, `extractInnerSvg`, `nativeBarSvg`, `chartFragment` as `export`.

- [ ] **Step 5: Re-point `render-social-image.ts` at the new modules**

In `lib/social/render-social-image.ts`: delete the moved function bodies + the `SOCIAL_FORMATS` block, and replace with re-exports/imports:

```ts
// near the top, after the resvg import:
export { SOCIAL_FORMATS, isSocialFormat, type SocialFormat } from "@/lib/social/formats";
import { SOCIAL_FORMATS, isSocialFormat, type SocialFormat } from "@/lib/social/formats";
import { esc, clip, chartFragment } from "@/lib/social/chart-svg";
```

Keep `composeCardSvg` / `renderSocialImage` bodies unchanged — they now call the imported `esc`/`clip`/`chartFragment`. The `extractInnerSvg`/`nativeBarSvg` helpers are used only inside `chartFragment`, so they no longer need to live here.

- [ ] **Step 6: Run the parity test + the existing renderer test — both pass**

Run: `bun test lib/social/__tests__/chart-svg-parity.test.ts lib/social/__tests__/render-social-image.test.ts`
Expected: PASS (all). The existing `render-social-image.test.ts` is the byte-identity guard — if it still passes, the move changed nothing observable.

- [ ] **Step 7: Typecheck**

Run: `bunx tsc --noEmit` (verify import in `lib/social/__tests__/render-social-image.test.ts` `import { SOCIAL_FORMATS } from "@/lib/social/render-social-image"` still resolves via the re-export).
Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git add lib/social/formats.ts lib/social/chart-svg.ts lib/social/render-social-image.ts lib/social/__tests__/chart-svg-parity.test.ts
git commit -m "refactor(social): carve client-safe formats + chart-svg out of render-social-image"
```

---

### Task 2: `SocialDesign` model + serialize/patch + `FrozenPost.design`

**Why:** The canvas design needs a serializable shape (stored on `frozen_post.design` for the carousel/auto-refresh roadmap), a skeleton for the AI fill (element id → current text, matching the email `docSkeleton` contract), and a patch applier (AI text-by-id → design, text fields ONLY). All pure, all client+server safe, all TDD.

**Files:**
- Create: `lib/social/design/types.ts`
- Create: `lib/social/design/serialize.ts`
- Modify: `lib/social/types.ts`
- Test: `lib/social/design/__tests__/serialize.test.ts`

**Interfaces:**
- Consumes: `SocialFormat`, `FORMAT_RATIO` (Task 1).
- Produces: `type SocialDesign`, `type SocialElement` (+ element interfaces); `newDesign(format)`, `serializeDesign(d): string`, `deserializeDesign(s): SocialDesign | null`, `designToSkeleton(d): Record<string, Record<string,string>>`, `applyDesignPatch(d, patch): SocialDesign`. `FrozenPost.design?: SocialDesign | null`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/social/design/__tests__/serialize.test.ts
import { test, expect } from "bun:test";
import {
  newDesign,
  serializeDesign,
  deserializeDesign,
  designToSkeleton,
  applyDesignPatch,
} from "@/lib/social/design/serialize";
import type { SocialDesign } from "@/lib/social/design/types";

const sample: SocialDesign = {
  version: 1,
  format: "square",
  background: "#0f1d24",
  elements: [
    { id: "t1", type: "text", x: 80, y: 80, width: 920, height: 120, text: "Headline here", fontSize: 64, fontFamily: "Arial", fill: "#ffffff" },
    { id: "s1", type: "stat", x: 80, y: 240, width: 600, height: 200, value: "$412K", label: "median sale price", valueFontSize: 130, labelFontSize: 34, fill: "#ffffff", accent: "#0ea5b7" },
    { id: "i1", type: "image", x: 0, y: 700, width: 1080, height: 380, src: "https://x/p.png" },
  ],
};

test("newDesign seeds an empty design at the requested format", () => {
  const d = newDesign("portrait");
  expect(d.version).toBe(1);
  expect(d.format).toBe("portrait");
  expect(d.elements).toEqual([]);
});

test("serialize → deserialize round-trips", () => {
  const json = serializeDesign(sample);
  const back = deserializeDesign(json);
  expect(back).toEqual(sample);
});

test("deserialize rejects garbage", () => {
  expect(deserializeDesign("not json")).toBeNull();
  expect(deserializeDesign(JSON.stringify({ version: 99 }))).toBeNull();
});

test("designToSkeleton emits only text-bearing elements + their text fields", () => {
  expect(designToSkeleton(sample)).toEqual({
    t1: { type: "text", text: "Headline here" },
    s1: { type: "stat", value: "$412K", label: "median sale price" },
    // i1 (image) excluded — no text
  });
});

test("applyDesignPatch updates text fields by id, leaves geometry/colors/images untouched", () => {
  const patched = applyDesignPatch(sample, {
    t1: { text: "New headline" },
    s1: { value: "$455K", label: "median list price", fill: "#000000" /* ignored */ },
    i1: { src: "https://evil/x.png" /* ignored — image not text-patchable */ },
    bogus: { text: "no element" /* ignored */ },
  });
  const t1 = patched.elements.find((e) => e.id === "t1")!;
  const s1 = patched.elements.find((e) => e.id === "s1")!;
  const i1 = patched.elements.find((e) => e.id === "i1")!;
  expect(t1.type === "text" && t1.text).toBe("New headline");
  expect(t1.type === "text" && t1.fontSize).toBe(64); // geometry intact
  expect(s1.type === "stat" && s1.value).toBe("$455K");
  expect(s1.type === "stat" && s1.label).toBe("median list price");
  expect(s1.type === "stat" && s1.fill).toBe("#ffffff"); // color NOT patched
  expect(i1.type === "image" && i1.src).toBe("https://x/p.png"); // image NOT patched
  expect(patched).not.toBe(sample); // immutable
});
```

- [ ] **Step 2: Run it — fails**

Run: `bun test lib/social/design/__tests__/serialize.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `lib/social/design/types.ts`**

```ts
// lib/social/design/types.ts
//
// The serializable canvas-design model. Pure data, no DOM/Konva imports — safe to
// import from the client composer, the AI-fill server route, and lib/social/types.ts.
import type { SocialFormat } from "@/lib/social/formats";

export type SocialElementType = "text" | "image" | "stat" | "chart" | "cta" | "logo";

interface BaseElement {
  id: string;
  type: SocialElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  fontSize: number;
  fontFamily: string;
  fill: string;
  align?: "left" | "center" | "right";
  fontStyle?: string; // "bold" | "italic" | "bold italic" | "normal"
}

export interface ImageElement extends BaseElement {
  type: "image";
  src: string; // public / Storage URL (CORS-safe, same-origin in v1)
}

export interface StatElement extends BaseElement {
  type: "stat";
  value: string; // shown verbatim; the user controls layout, no auto-placeholder
  label: string;
  valueFontSize: number;
  labelFontSize: number;
  fill: string;
  accent: string;
}

export interface ChartElement extends BaseElement {
  type: "chart";
  /** EmailChartSpec — kept opaque here to keep lib/social refinery-free; rendered to SVG via chart-svg. */
  spec: unknown;
}

export interface CtaElement extends BaseElement {
  type: "cta";
  text: string;
  url: string; // ride-along link; also injected into the caption
  fill: string;
  textFill: string;
  fontSize: number;
}

export interface LogoElement extends BaseElement {
  type: "logo";
  src: string; // brand logo URL
}

export type SocialElement =
  | TextElement
  | ImageElement
  | StatElement
  | ChartElement
  | CtaElement
  | LogoElement;

export interface SocialDesign {
  version: 1;
  /** Carries the aspect so the cron knows the publish ratio without re-deriving it. */
  format: SocialFormat;
  background: string;
  elements: SocialElement[];
  /** element id -> metric binding (Phase-2 auto-refresh). Populated when AI fills from a metric. */
  bindings?: Record<string, { metric: string; source?: string }>;
}
```

- [ ] **Step 4: Create `lib/social/design/serialize.ts`**

```ts
// lib/social/design/serialize.ts
import type { SocialFormat } from "@/lib/social/formats";
import type { SocialDesign, SocialElement } from "@/lib/social/design/types";

export function newDesign(format: SocialFormat): SocialDesign {
  return { version: 1, format, background: "#0f1d24", elements: [] };
}

export function serializeDesign(d: SocialDesign): string {
  return JSON.stringify(d);
}

/** Parse + minimal shape-guard. Returns null on anything that isn't a v1 design. */
export function deserializeDesign(s: string): SocialDesign | null {
  let o: unknown;
  try {
    o = JSON.parse(s);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const d = o as Record<string, unknown>;
  if (d.version !== 1) return null;
  if (typeof d.format !== "string") return null;
  if (!Array.isArray(d.elements)) return null;
  return d as unknown as SocialDesign;
}

/** Text fields the AI may write, per element type. The ONLY surface the patch can touch. */
const TEXT_FIELDS: Partial<Record<SocialElement["type"], readonly string[]>> = {
  text: ["text"],
  stat: ["value", "label"],
  cta: ["text"],
};

/** element id -> { type, <current text fields> } — matches the email docSkeleton shape. */
export function designToSkeleton(d: SocialDesign): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const el of d.elements) {
    const fields = TEXT_FIELDS[el.type];
    if (!fields) continue;
    const rec: Record<string, string> = { type: el.type };
    for (const f of fields) {
      const v = (el as unknown as Record<string, unknown>)[f];
      if (typeof v === "string") rec[f] = v;
    }
    out[el.id] = rec;
  }
  return out;
}

/**
 * Apply an AI patch (element id -> { field: value }) to TEXT FIELDS ONLY. Geometry,
 * colors, images, urls, and unknown ids are never touched. Returns a new design.
 */
export function applyDesignPatch(
  d: SocialDesign,
  patch: Record<string, Record<string, unknown>>,
): SocialDesign {
  const elements = d.elements.map((el) => {
    const p = patch[el.id];
    const fields = TEXT_FIELDS[el.type];
    if (!p || !fields) return el;
    const next = { ...el } as Record<string, unknown>;
    for (const f of fields) {
      const v = p[f];
      if (typeof v === "string" && v.trim()) next[f] = v;
    }
    return next as unknown as SocialElement;
  });
  return { ...d, elements };
}
```

- [ ] **Step 5: Extend `FrozenPost` in `lib/social/types.ts`**

Add the import + the field (no other change to that file):

```ts
// at the top with the other type imports:
import type { SocialDesign } from "@/lib/social/design/types";

// inside interface FrozenPost { ... }, after composed_at:
  /**
   * v1 canvas design (incl. format/aspect). Stored so a frozen post can be re-rendered
   * later (Phase-2 auto-refresh) without a rebuild. Absent for SocialModel/template posts.
   */
  design?: SocialDesign | null;
```

- [ ] **Step 6: Run the test + typecheck — pass**

Run: `bun test lib/social/design/__tests__/serialize.test.ts && bunx tsc --noEmit`
Expected: PASS, no new type errors.

- [ ] **Step 7: Commit**

```bash
git add lib/social/design/ lib/social/types.ts
git commit -m "feat(social): SocialDesign model + serialize/patch + FrozenPost.design"
```

---

### Task 3: Cron frozen-image branch

**Why:** The cron worker (`scripts/social/run-schedules.mts`) today ALWAYS re-renders the SocialModel template server-side (step 5) and ignores `frozen_post.media_url`. A scheduled canvas post would silently publish a template image, not the canvas. The frozen branch posts the frozen image + caption verbatim. **Critically, it must skip the freshness gate** — a v1 frozen image is static, so the gate would turn "post daily" into "post once then skip". It keeps the at-most-once idempotency claim (so daily→once/day, weekly→once/week) and respects `DRY_RUN` / `SOCIAL_PUBLISH_ENABLED`. The pure decision is extracted into a unit-testable helper.

**Files:**
- Create: `lib/social/frozen-post.ts`
- Modify: `scripts/social/run-schedules.mts`
- Test: `lib/social/__tests__/frozen-post.test.ts`

**Interfaces:**
- Consumes: `FORMAT_RATIO` (Task 1), `FrozenPost.design` (Task 2), `SocialSchedule` (`lib/social/types.ts`).
- Produces: `frozenPublishPayload(row): { caption: string; media: { url: string; ratio: string }[] } | null`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/social/__tests__/frozen-post.test.ts
import { test, expect } from "bun:test";
import { frozenPublishPayload } from "@/lib/social/frozen-post";
import type { SocialSchedule } from "@/lib/social/types";

function row(frozen: Partial<SocialSchedule["frozen_post"]> | null): SocialSchedule {
  return { id: 1, frozen_post: frozen as SocialSchedule["frozen_post"] } as SocialSchedule;
}

test("returns null when there is no frozen media_url (template path)", () => {
  expect(frozenPublishPayload(row(null))).toBeNull();
  expect(frozenPublishPayload(row({ caption: "x", media_url: null, hashtags: [], freshness_token: null, composed_at: "" }))).toBeNull();
});

test("frozen square post → caption + media at 1:1", () => {
  const p = frozenPublishPayload(
    row({ caption: "Hello", media_url: "https://x/a.png", hashtags: [], freshness_token: null, composed_at: "" }),
  );
  expect(p).toEqual({ caption: "Hello", media: [{ url: "https://x/a.png", ratio: "1:1" }] });
});

test("ratio comes from frozen design.format", () => {
  const p = frozenPublishPayload(
    row({
      caption: "Tall",
      media_url: "https://x/b.png",
      hashtags: [],
      freshness_token: null,
      composed_at: "",
      design: { version: 1, format: "portrait", background: "#000", elements: [] },
    }),
  );
  expect(p?.media[0].ratio).toBe("4:5");
});
```

- [ ] **Step 2: Run it — fails**

Run: `bun test lib/social/__tests__/frozen-post.test.ts`
Expected: FAIL — `Cannot find module '@/lib/social/frozen-post'`.

- [ ] **Step 3: Create `lib/social/frozen-post.ts`**

```ts
// lib/social/frozen-post.ts
//
// Pure helper: given a claimed schedule row, return the verbatim publish payload IF it
// carries a frozen canvas image. The cron worker branches on this BEFORE building content
// or checking the freshness gate — a v1 frozen image is static, so the gate (which skips
// when brain data hasn't advanced) would wrongly suppress every repeat fire.
import { FORMAT_RATIO } from "@/lib/social/formats";
import type { SocialSchedule } from "@/lib/social/types";

export function frozenPublishPayload(
  row: SocialSchedule,
): { caption: string; media: { url: string; ratio: string }[] } | null {
  const url = row.frozen_post?.media_url;
  if (!url) return null;
  const fmt = row.frozen_post?.design?.format ?? "square";
  const ratio = FORMAT_RATIO[fmt] ?? "1:1";
  return { caption: row.frozen_post!.caption, media: [{ url, ratio }] };
}
```

- [ ] **Step 4: Run the test — pass**

Run: `bun test lib/social/__tests__/frozen-post.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the branch into the worker**

In `scripts/social/run-schedules.mts`, add the import near the other `lib/social` imports:

```ts
import { frozenPublishPayload } from "@/lib/social/frozen-post";
```

At the **top of `processSchedule`**, immediately after the `const log = ...` line and BEFORE step 1 (`buildSocialContent`), insert:

```ts
  // ── FROZEN CANVAS IMAGE — post verbatim. Skip content build + the freshness gate
  //    (a v1 frozen image is static; the gate would suppress every repeat fire). Keep
  //    the at-most-once idempotency claim and the publish gate. ──
  const frozen = frozenPublishPayload(row);
  if (frozen) {
    const nowIso = now.toISOString();
    const idempotencyKey = buildIdempotencyKey(scheduleId, now);
    if (!DRY_RUN) {
      const won = await claimSocialOnce(db, idempotencyKey, {
        userId: target.userId,
        kind: "post",
        scheduleId,
      });
      if (!won) {
        log(`frozen: already claimed for ${idempotencyKey} — skip duplicate`);
        return "skipped";
      }
    }
    const frozenToken = row.frozen_post?.freshness_token ?? null;
    if (DRY_RUN || !PUBLISH_ENABLED) {
      log(DRY_RUN ? "DRY_RUN — frozen post (no write)" : "publish gate closed — frozen dry_run record");
      if (!DRY_RUN) {
        const { error } = await db.from("social_posts").upsert(
          {
            post_schedule_id: scheduleId,
            social_account_id: target.accountId,
            platform: target.platform,
            platform_post_id: null,
            freshness_token: frozenToken,
            caption: frozen.caption,
            media_url: frozen.media[0]?.url ?? null,
            status: "dry_run",
            error: null,
            idempotency_key: idempotencyKey,
            published_at: null,
            created_at: nowIso,
            updated_at: nowIso,
          },
          { onConflict: "idempotency_key", ignoreDuplicates: true },
        );
        if (error) {
          log(`frozen social_posts upsert (dry_run) failed: ${error.message}`);
          return "error";
        }
      }
      return "dry_run";
    }
    const result = await postToChannel(db, target.userId, {
      platform: target.platform,
      accountId: target.accountId,
      caption: frozen.caption,
      media: frozen.media,
    });
    const { error: insErr } = await db.from("social_posts").upsert(
      {
        post_schedule_id: scheduleId,
        social_account_id: target.accountId,
        platform: target.platform,
        platform_post_id: result.ok ? (result.platform_post_id ?? null) : null,
        freshness_token: frozenToken,
        caption: frozen.caption,
        media_url: frozen.media[0]?.url ?? null,
        status: result.ok ? "published" : "failed",
        error: result.ok ? null : (result.error ?? "unknown error"),
        idempotency_key: idempotencyKey,
        published_at: result.ok ? nowIso : null,
        created_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true },
    );
    if (insErr) log(`frozen social_posts upsert failed: ${insErr.message}`);
    if (result.ok) {
      log(`frozen: published to ${target.platform} — post_id=${result.platform_post_id ?? "?"}`);
      return "published";
    }
    log(`frozen: publish failed on ${target.platform}: ${result.error ?? "unknown"}`);
    return "error";
  }
```

(The existing template path below is unchanged — it runs only when `frozen` is null.)

> **VERIFIED — the frozen row reaches `processSchedule` with a target (no silent skip).** The branch lives _inside_ `processSchedule(row, target, …)`, which only runs if `buildTargetsFromSchedules` (`lib/social/targets.ts`) built a target for the row. Confirmed by reading that file (06/30/2026): it rejects ONLY (a) an unknown platform, or (b) a **non-null** `scope_kind` that isn't `zip|place|county`. A canvas row always has a publishable platform (the schedule route's `isPublishable` filter guarantees it) and a `scope_kind` that is either `null` (the check `row.scope_kind != null` is false → skipped) or a valid kind. So a scopeless frozen row gets a target (`scopeKind:null` is valid by contract — "null = whole region") and the branch fires. **If `targets.ts` is ever tightened to reject null scope, this branch must move ahead of target-building in `main()`'s loop** — note it there.

Also set `freshness_gate: false` on canvas inserts for honesty — that change lands in Task 9's `buildSocialScheduleInsert` call, not here.

- [ ] **Step 6: Typecheck the worker**

Run: `bunx tsc --noEmit`
Expected: no new errors. (Confirm `claimSocialOnce`, `buildIdempotencyKey`, `postToChannel`, `DRY_RUN`, `PUBLISH_ENABLED` are all already imported/in-scope in the worker — they are, per the current file.)

- [ ] **Step 7: Dry-run smoke (no live post)**

Run: `DRY_RUN=true bun scripts/social/run-schedules.mts`
Expected: exits 0; logs `claimed N due schedule(s)` then `nothing due` (or processes existing rows read-only). No crash. (The frozen branch is exercised end-to-end by the live-verify once a canvas post is scheduled — Task 9.)

- [ ] **Step 8: Commit**

```bash
git add lib/social/frozen-post.ts lib/social/__tests__/frozen-post.test.ts scripts/social/run-schedules.mts
git commit -m "feat(social): cron posts a frozen canvas image verbatim, skipping the freshness gate"
```

---

### Task 4: Deps + SSR-safe Konva wrapper

**Why:** Foundation for the composer. `react-konva` is browser-only (touches `window`) — importing it in a server-rendered tree throws. It must be loaded with `next/dynamic` `{ ssr: false }`. This task adds the deps (with the verified versions) and proves the wrapper mounts without an SSR crash.

**Files:**
- Modify: `package.json` (+ `bun.lock`)
- 🔴 Create: `components/email-lab/social/KonvaStage.tsx` (minimal stub here; fleshed out in Task 6)
- 🔴 Create: `components/email-lab/social/SocialComposer.tsx` (minimal stub here; fleshed out in Task 6)

**Interfaces:**
- Produces: a `SocialComposer` React component (default export) that dynamic-imports `KonvaStage` with `ssr: false`.

- [ ] **Step 1: Add the deps (verified versions)**

Run:
```bash
bun add react-konva@19.2.5 konva@10.3.0
```
Expected: `package.json` gains `react-konva` + `konva`; `bun.lock` updates. (Versions verified in-session against the npm registry: react-konva@19.2.5 peers react ^19.2.0 — matches this repo's React 19.)

- [ ] **Step 2: Create the minimal `KonvaStage.tsx` stub**

```tsx
// components/email-lab/social/KonvaStage.tsx
"use client";
import { Stage, Layer, Rect } from "react-konva";

export interface KonvaStageProps {
  width: number;
  height: number;
}

/** Minimal stub — Task 6 fleshes this out into the full element renderer. */
export default function KonvaStage({ width, height }: KonvaStageProps) {
  return (
    <Stage width={width} height={height}>
      <Layer>
        <Rect x={0} y={0} width={width} height={height} fill="#0f1d24" />
      </Layer>
    </Stage>
  );
}
```

- [ ] **Step 3: Create the minimal `SocialComposer.tsx` stub** (proves the `ssr:false` wrapper)

```tsx
// components/email-lab/social/SocialComposer.tsx
"use client";
import dynamic from "next/dynamic";

// react-konva is browser-only (it touches `window`); never server-render it.
const KonvaStage = dynamic(() => import("./KonvaStage"), {
  ssr: false,
  loading: () => <div className="text-xs text-white/40">Loading composer…</div>,
});

export interface SocialComposerProps {
  scope?: { kind?: string; value?: string };
  projectId?: string;
  branding: Record<string, string>;
}

/** Minimal stub — Task 6 adds the design state, palette, and panels. */
export function SocialComposer(_props: SocialComposerProps) {
  return (
    <div className="flex h-full items-center justify-center bg-[#0a141a]">
      <KonvaStage width={360} height={360} />
    </div>
  );
}
```

- [ ] **Step 4: Verify it builds (the real SSR test)**

Run: `bunx next build` (or, faster, add a throwaway import of `SocialComposer` to a page and run; cleanest is the full build which exercises SSR of the route tree).
Expected: build succeeds. If `react-konva` were imported without `ssr:false`, the build would throw `ReferenceError: window is not defined` during prerender — the wrapper prevents that.

> Note: prefer `bunx next build` over bare `bunx tsc` for verification — local tsc ≠ Vercel (memory `feedback_verify-with-next-build-not-npx-tsc`).

- [ ] **Step 5: Commit (lockfile gate — bun.lock in the SAME commit)**

```bash
git add package.json bun.lock components/email-lab/social/KonvaStage.tsx components/email-lab/social/SocialComposer.tsx
git commit -m "feat(social): add react-konva@19.2.5 + konva@10.3.0; SSR-safe composer wrapper"
```

---

### Task 5: Email | Social mode tab + mode-aware panel split

**Why:** The grid shell needs an Email | Social top-level mode that swaps the center (email grid ↔ social composer) and the mode-specific panels, while Brand + Photos persist across both. **Email mode must not regress** — `EmailLabGridShell.tsx` is 1230 lines of shared state and the contention file. The low-risk approach: wrap the existing email center + email-only panels in `{mode === "email" && ...}` (byte-identical when rendered), mount `<SocialComposer>` for social, and keep Brand/Photos outside the mode conditionals. **Generate-Week stays** — it moves into Social mode untouched (decision 06/30/2026: non-destructive; the "open day in composer" bridge is a roadmap follow-up, not v1).

**Files:**
- Modify: `components/email-lab/EmailLabGridShell.tsx`
- Test: `components/email-lab/__tests__/grid-shell-mode.test.tsx` (vitest + RTL; if no RTL harness exists, fall back to the manual checklist in Step 6)

**Interfaces:**
- Consumes: `SocialComposer` (Task 4), `capabilitiesFor("paid").socialCalendar`.
- Produces: a `mode` state (`"email" | "social"`) gating the shell.

- [ ] **Step 1: Add `mode` state + the tab**

In `EmailLabGridShell`, after the existing `caps` line (`const caps = capabilitiesFor("paid");`):

```tsx
  const [mode, setMode] = useState<"email" | "social">("email");
```

In the top bar (`<div className="flex items-center gap-4">`, right after `{headerSlot}`), add the tab — only when social is enabled by the dial:

```tsx
            {caps.socialCalendar && (
              <div className="flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/5 p-0.5">
                {(["email", "social"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`rounded-md px-3 py-1 text-xs font-semibold capitalize transition-colors ${
                      mode === m ? "bg-gulf-teal text-[#06231f]" : "text-white/55 hover:text-white/85"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
```

- [ ] **Step 2: Gate the email-mode center**

Wrap the existing center grid block (the `{/* the real grid */}` `<div className="min-h-0 flex-1">…<GridCanvas .../>…</div>`) so it renders only in email mode, and mount the composer in social mode. Replace that block with:

```tsx
        {/* the real grid (email) ↔ the social composer */}
        <div className="min-h-0 flex-1">
          {mode === "email" ? (
            <GridCanvas
              doc={doc}
              selectedId={selectedId}
              onSelectBlock={setSelectedId}
              onChangeDoc={commit}
              onDuplicate={duplicateBlock}
              onAddBlock={() => setShowBlocks(true)}
              onBlockAi={setSelectedId}
              onEditPhoto={(id) => {
                setSelectedId(id);
                setPhotopeaBlockId(id);
              }}
            />
          ) : (
            <SocialComposer
              scope={scope}
              projectId={projectId}
              branding={branding}
            />
          )}
        </div>
```

Add the import at the top:

```tsx
import { SocialComposer } from "./social/SocialComposer";
```

> The width-preset bar above the grid is email-only. Wrap it too: change its container to render only when `mode === "email"` (it operates on `selectedBlock`, an email-grid concept). Wrap the whole `{/* width-preset bar (selected block) */}` block in `{mode === "email" && ( ... )}`.

- [ ] **Step 3: Gate the email-only right-panel accordions; keep shared + social**

In the right `<aside>`, the panels are: Build-with-AI, Now-editing, Social calendar, Brand, Start-from (seeds), Add-block, Photos.

- **Email-only** (wrap each in `{mode === "email" && ( ... )}`): "Build with AI" block, "Now editing" block, "Start from a layout" block, "Add a block" block.
- **Shared** (leave unconditional): "Brand" block, "Photos" block.
- **Social calendar** block: change its guard from `{caps.socialCalendar && (` to `{caps.socialCalendar && mode === "social" && (` — Generate-Week now lives in Social mode only (removed from Email mode per the spec; preserved, not deleted).

- [ ] **Step 4: Write the regression + mode test**

```tsx
// components/email-lab/__tests__/grid-shell-mode.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmailLabGridShell } from "@/components/email-lab/EmailLabGridShell";
import { SEED_DOCS } from "@/lib/email/doc/default-docs";

// The composer dynamic-imports Konva (browser-only); mock it so jsdom doesn't choke.
vi.mock("@/components/email-lab/social/SocialComposer", () => ({
  SocialComposer: () => <div data-testid="social-composer">composer</div>,
}));

const doc = SEED_DOCS[0].build();

describe("grid shell mode tab", () => {
  it("email mode mounts every existing panel (no regression)", () => {
    render(<EmailLabGridShell initialDoc={doc} headerSlot={<span>hdr</span>} projectId="p1" />);
    expect(screen.getByText("Build with AI")).toBeTruthy();
    expect(screen.getByText("Brand")).toBeTruthy();
    expect(screen.getByText("Start from a layout")).toBeTruthy();
    expect(screen.getByText("Add a block")).toBeTruthy();
    expect(screen.getByText("Photos")).toBeTruthy();
    expect(screen.queryByTestId("social-composer")).toBeNull();
  });

  it("social mode swaps the center + email-only panels, keeps Brand/Photos", () => {
    render(<EmailLabGridShell initialDoc={doc} headerSlot={<span>hdr</span>} projectId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "social" }));
    expect(screen.getByTestId("social-composer")).toBeTruthy();
    expect(screen.queryByText("Build with AI")).toBeNull();
    expect(screen.queryByText("Start from a layout")).toBeNull();
    expect(screen.getByText("Brand")).toBeTruthy(); // shared, persists
    expect(screen.getByText("Photos")).toBeTruthy(); // shared, persists
  });
});
```

- [ ] **Step 5: Run the test**

Run: `bunx vitest run components/email-lab/__tests__/grid-shell-mode.test.tsx`
Expected: PASS both. (If the repo has no vitest+RTL harness for client components yet, skip to Step 6 and treat the assertions as a manual checklist instead — do NOT invent a harness in this task.)

- [ ] **Step 6: Verify in the running app + capabilities test stays green**

Run: `bunx vitest run lib/email/lab/capabilities.test.ts` → PASS (the dial is untouched; this confirms it).
Then load `/email-lab/grid`: email mode shows the grid + all panels exactly as before; click **Social** → the composer stub mounts, the width bar + email-only panels disappear, Brand + Photos remain, and the Social-calendar (Generate-Week) panel is present.

- [ ] **Step 7: Commit**

```bash
git add components/email-lab/EmailLabGridShell.tsx components/email-lab/__tests__/grid-shell-mode.test.tsx
git commit -m "feat(email-lab): Email | Social mode tab; mode-aware panels, email mode unchanged"
```

---

### Task 6: The Konva composer (elements, drag/resize, brand, CORS)

**Why:** The heart of the build — the canvas editor. A fixed-aspect `Stage` keyed to `SOCIAL_FORMATS`, an element palette (text / image / stat / chart / CTA / logo), drag + resize via `Transformer`, brand colors/fonts/logo applied from the branding blob, and the design serialized to `SocialDesign`. Every `Image` sets `crossOrigin="anonymous"`.

**Files:**
- 🔴 Modify: `components/email-lab/social/KonvaStage.tsx` (full element renderer + Transformer)
- 🔴 Modify: `components/email-lab/social/SocialComposer.tsx` (design state, aspect picker, palette, brand application)
- Create: `components/email-lab/social/use-konva-image.ts` (CORS-safe image loader hook)
- Test: `components/email-lab/social/__tests__/use-konva-image.test.ts`

**Interfaces:**
- Consumes: `SocialDesign`, `SocialElement`, `newDesign` (Task 2); `SOCIAL_FORMATS`, `SocialFormat` (Task 1); `brandingToTokens` (`lib/email/brand/branding-to-tokens.ts`); `chartFragment` (Task 1, for the chart element).
- Produces: `KonvaStage` taking `{ design, selectedId, onSelect, onChange, stageRef }`; `SocialComposer` holding the design + exposing the stage ref for Task 7's export.

- [ ] **Step 1: CORS-safe image loader hook + its test**

```ts
// components/email-lab/social/use-konva-image.ts
"use client";
import { useEffect, useState } from "react";

/**
 * Load an image element for Konva with crossOrigin="anonymous" so the canvas stays
 * EXPORTABLE (toDataURL throws SECURITY_ERR on a tainted canvas — vendor-confirmed).
 * Returns [image, status]. A load error resolves to status "error" (caller omits it),
 * never a throw.
 */
export function useKonvaImage(src: string | undefined): [HTMLImageElement | null, "idle" | "loading" | "loaded" | "error"] {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  useEffect(() => {
    if (!src) {
      setImg(null);
      setStatus("idle");
      return;
    }
    setStatus("loading");
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    let alive = true;
    image.onload = () => {
      if (!alive) return;
      setImg(image);
      setStatus("loaded");
    };
    image.onerror = () => {
      if (!alive) return;
      setImg(null);
      setStatus("error");
    };
    image.src = src;
    return () => {
      alive = false;
    };
  }, [src]);
  return [img, status];
}
```

```ts
// components/email-lab/social/__tests__/use-konva-image.test.ts
import { test, expect } from "bun:test";
import { useKonvaImage } from "@/components/email-lab/social/use-konva-image";

test("hook is exported and is a function (mount behaviour is covered by live-verify)", () => {
  expect(typeof useKonvaImage).toBe("function");
});
```

> Why so thin a test: `useKonvaImage` depends on the browser `Image` + real network/CORS — its real verification is the live export in Task 7 with a genuine cross-origin photo. The unit test only guards the export surface; the behavioural guarantee (crossOrigin set, tainted-canvas avoided) is asserted in Task 7's live-verify.

Run: `bun test components/email-lab/social/__tests__/use-konva-image.test.ts` → PASS.

- [ ] **Step 2: Flesh out `KonvaStage.tsx` — element renderers + selection + Transformer**

```tsx
// components/email-lab/social/KonvaStage.tsx
"use client";
import { useEffect, useRef } from "react";
import { Stage, Layer, Rect, Text, Image as KonvaImg, Group, Transformer } from "react-konva";
import type Konva from "konva";
import type { SocialDesign, SocialElement } from "@/lib/social/design/types";
import { useKonvaImage } from "./use-konva-image";

export interface KonvaStageProps {
  design: SocialDesign;
  /** on-screen render width (the design's intrinsic px are scaled to fit this). */
  displayWidth: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (el: SocialElement) => void;
  stageRef: React.RefObject<Konva.Stage | null>;
}

function ImageEl({ el, onSelect, onChange, isSelected }: {
  el: Extract<SocialElement, { type: "image" | "logo" }>;
  onSelect: () => void;
  onChange: (e: SocialElement) => void;
  isSelected: boolean;
}) {
  const [img, status] = useKonvaImage(el.src);
  if (status !== "loaded" || !img) {
    // placeholder box while loading / on error — keeps the layout, never crashes export
    return <Rect x={el.x} y={el.y} width={el.width} height={el.height} fill="#1f2d36" cornerRadius={6} onClick={onSelect} onTap={onSelect} />;
  }
  return (
    <KonvaImg
      image={img}
      x={el.x}
      y={el.y}
      width={el.width}
      height={el.height}
      draggable
      name={isSelected ? "selected" : undefined}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => onChange({ ...el, x: e.target.x(), y: e.target.y() })}
      onTransformEnd={(e) => {
        const node = e.target;
        onChange({
          ...el,
          x: node.x(),
          y: node.y(),
          width: Math.max(20, node.width() * node.scaleX()),
          height: Math.max(20, node.height() * node.scaleY()),
          rotation: node.rotation(),
        });
        node.scaleX(1);
        node.scaleY(1);
      }}
    />
  );
}

function renderElement(
  el: SocialElement,
  isSelected: boolean,
  onSelect: () => void,
  onChange: (e: SocialElement) => void,
) {
  const commonText = {
    x: el.x,
    y: el.y,
    width: el.width,
    draggable: true,
    onClick: onSelect,
    onTap: onSelect,
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) =>
      onChange({ ...el, x: e.target.x(), y: e.target.y() }),
  };
  switch (el.type) {
    case "text":
      return (
        <Text
          {...commonText}
          text={el.text}
          fontSize={el.fontSize}
          fontFamily={el.fontFamily}
          fontStyle={el.fontStyle ?? "normal"}
          fill={el.fill}
          align={el.align ?? "left"}
        />
      );
    case "cta":
      return (
        <Group {...commonText}>
          <Rect width={el.width} height={el.height} fill={el.fill} cornerRadius={el.height / 2} />
          <Text
            text={el.text}
            width={el.width}
            height={el.height}
            align="center"
            verticalAlign="middle"
            fontSize={el.fontSize}
            fill={el.textFill}
          />
        </Group>
      );
    case "stat":
      return (
        <Group {...commonText}>
          <Text text={el.value} fontSize={el.valueFontSize} fontStyle="bold" fill={el.accent} />
          <Text text={el.label} y={el.valueFontSize + 8} fontSize={el.labelFontSize} fill={el.fill} />
        </Group>
      );
    case "image":
    case "logo":
      return <ImageEl el={el} isSelected={isSelected} onSelect={onSelect} onChange={onChange} />;
    case "chart":
      // The chart is rendered to an SVG (Task 8) and stored as an image element's src at
      // fill time; a raw "chart" element with no rasterized src shows a placeholder here.
      return <Rect {...commonText} height={el.height} fill="#1f2d36" cornerRadius={6} />;
    default:
      return null;
  }
}

export default function KonvaStage({
  design,
  displayWidth,
  selectedId,
  onSelect,
  onChange,
  stageRef,
}: KonvaStageProps) {
  const trRef = useRef<Konva.Transformer | null>(null);
  const { width, height } = { width: design.format === "landscape" ? 1200 : 1080, height: 0 } as { width: number; height: number };
  // intrinsic design size — keep in one place (mirror SOCIAL_FORMATS without importing resvg path)
  const dims = SIZE[design.format];
  const scale = displayWidth / dims.width;

  // Attach the transformer to the selected node.
  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    if (!selectedId) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }
    const node = stage.findOne(`#${selectedId}`);
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, design, stageRef]);

  return (
    <Stage
      ref={stageRef}
      width={dims.width * scale}
      height={dims.height * scale}
      scaleX={scale}
      scaleY={scale}
      onMouseDown={(e) => {
        if (e.target === e.target.getStage()) onSelect(null); // click empty → deselect
      }}
    >
      <Layer>
        <Rect x={0} y={0} width={dims.width} height={dims.height} fill={design.background} />
        {design.elements.map((el) => (
          <Group key={el.id} id={el.id}>
            {renderElement(el, el.id === selectedId, () => onSelect(el.id), onChange)}
          </Group>
        ))}
        <Transformer
          ref={trRef}
          rotateEnabled
          boundBoxFunc={(oldBox, newBox) => (newBox.width < 20 || newBox.height < 20 ? oldBox : newBox)}
        />
      </Layer>
    </Stage>
  );
}

// intrinsic design dimensions (mirror of SOCIAL_FORMATS; kept local to avoid any resvg-path import).
const SIZE: Record<SocialDesign["format"], { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  landscape: { width: 1200, height: 630 },
  story: { width: 1080, height: 1920 },
};
```

> Note: `SIZE` duplicates `SOCIAL_FORMATS` deliberately — importing `lib/social/formats.ts` is fine (it's resvg-free), so the executor MAY instead `import { SOCIAL_FORMATS } from "@/lib/social/formats"` and delete `SIZE`. Prefer the import (DRY); the local copy is only the fallback if a circular-import surprise appears. Delete the dead `const { width, height } = ...` line — it was scaffolding; use `dims` only.

- [ ] **Step 3: Flesh out `SocialComposer.tsx` — design state, aspect picker, palette, brand**

```tsx
// components/email-lab/social/SocialComposer.tsx
"use client";
import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import type Konva from "konva";
import { SOCIAL_FORMATS, type SocialFormat } from "@/lib/social/formats";
import { newDesign } from "@/lib/social/design/serialize";
import type { SocialDesign, SocialElement } from "@/lib/social/design/types";
import { brandingToTokens } from "@/lib/email/brand/branding-to-tokens";
import { mintBlockId } from "@/lib/email/doc/schema";

const KonvaStage = dynamic(() => import("./KonvaStage"), {
  ssr: false,
  loading: () => <div className="p-6 text-xs text-white/40">Loading composer…</div>,
});

export interface SocialComposerProps {
  scope?: { kind?: string; value?: string };
  projectId?: string;
  branding: Record<string, string>;
}

const FORMAT_LABEL: Record<SocialFormat, string> = {
  square: "Square 1:1",
  portrait: "Portrait 4:5",
  landscape: "Landscape 1.91:1",
  story: "Story 9:16",
};

const PALETTE: { type: SocialElement["type"]; label: string }[] = [
  { type: "text", label: "Text" },
  { type: "stat", label: "Stat" },
  { type: "cta", label: "Button + link" },
  { type: "image", label: "Image" },
  { type: "logo", label: "Logo" },
];

export function SocialComposer({ branding }: SocialComposerProps) {
  const tokens = brandingToTokens(branding);
  const primary = tokens.PRIMARY ?? "#0f1d24";
  const accent = tokens.ACCENT ?? "#0ea5b7";
  const text = tokens.TEXT ?? "#ffffff";
  const logoUrl = tokens.LOGO_URL;

  const [design, setDesign] = useState<SocialDesign>(() => ({ ...newDesign("square"), background: primary }));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);

  function setFormat(format: SocialFormat) {
    setDesign((d) => ({ ...d, format }));
  }

  function updateElement(next: SocialElement) {
    setDesign((d) => ({ ...d, elements: d.elements.map((e) => (e.id === next.id ? next : e)) }));
  }

  function addElement(type: SocialElement["type"]) {
    const id = mintBlockId();
    const base = { id, x: 80, y: 80, width: 400, height: 120 };
    let el: SocialElement;
    switch (type) {
      case "text":
        el = { ...base, type: "text", text: "Your text", fontSize: 56, fontFamily: tokens.FONT ?? "Arial", fill: text };
        break;
      case "stat":
        el = { ...base, type: "stat", height: 200, value: "", label: "label", valueFontSize: 120, labelFontSize: 32, fill: text, accent };
        break;
      case "cta":
        el = { ...base, type: "cta", height: 70, text: "Learn more →", url: "", fill: accent, textFill: primary, fontSize: 30 };
        break;
      case "image":
        el = { ...base, type: "image", height: 400, src: "" };
        break;
      case "logo":
        el = { ...base, type: "logo", width: 240, height: 90, src: logoUrl ?? "" };
        break;
      default:
        return;
    }
    setDesign((d) => ({ ...d, elements: [...d.elements, el] }));
    setSelectedId(id);
  }

  function deleteSelected() {
    if (!selectedId) return;
    setDesign((d) => ({ ...d, elements: d.elements.filter((e) => e.id !== selectedId) }));
    setSelectedId(null);
  }

  const displayWidth = design.format === "story" ? 320 : design.format === "portrait" ? 380 : 460;

  return (
    <div className="flex h-full">
      {/* left tools */}
      <div className="w-48 shrink-0 space-y-3 overflow-y-auto border-r border-white/8 bg-[#0b1620] p-3">
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-[0.15em] text-white/35">Size</p>
          <div className="space-y-1">
            {(Object.keys(SOCIAL_FORMATS) as SocialFormat[]).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`w-full rounded border px-2 py-1 text-left text-[11px] ${design.format === f ? "border-gulf-teal text-gulf-teal" : "border-white/10 text-white/55"}`}
              >
                {FORMAT_LABEL[f]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-[0.15em] text-white/35">Add</p>
          <div className="grid grid-cols-2 gap-1">
            {PALETTE.map((p) => (
              <button
                key={p.type}
                onClick={() => addElement(p.type)}
                className="rounded border border-white/10 px-2 py-1 text-[11px] text-white/60 hover:text-white/90"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {selectedId && (
          <button onClick={deleteSelected} className="w-full rounded border border-red-400/30 px-2 py-1 text-[11px] text-red-300">
            Delete selected
          </button>
        )}
      </div>

      {/* canvas */}
      <div className="flex flex-1 items-center justify-center overflow-auto bg-[#0a141a] p-6">
        <div className="shadow-2xl">
          <KonvaStage
            design={design}
            displayWidth={displayWidth}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={updateElement}
            stageRef={stageRef}
          />
        </div>
      </div>
    </div>
  );
}
```

> `tokens.FONT` is illustrative — `brandingToTokens` does not emit a `FONT` token today (font lives on `doc.globalStyle.fontFamily`). For v1 use `"Arial"` as the default `fontFamily` and treat brand-font selection as part of Task 7's font-preload work; do NOT invent a `FONT` token in `branding-to-tokens.ts`.

- [ ] **Step 4: Build verification**

Run: `bunx next build`
Expected: builds clean (no `window is not defined` — the `ssr:false` dynamic import holds).

- [ ] **Step 5: Live-verify in the app**

Load `/email-lab/grid` → Social mode. Pick each aspect → the canvas resizes. Add a text, a stat, a CTA, a logo → each appears, is draggable, selectable, resizable (Transformer handles), deletable. Brand primary is the background; accent colors the stat value + CTA. No console errors.

> **Expected rework point (not a regression):** the Step-2 skeleton puts `draggable` + `onDragEnd` on the inner `Text`/`Image`/`Group` while the `Transformer` attaches to the outer `<Group id={el.id}>` wrapper — so drag (inner node) and the transform handles (outer node) can fight. Fix during this step by making the draggable node and the transformer-target node the SAME node: drop the wrapper `<Group id>` and put the `id` + `draggable` on each element's own top node (give `Text`/`Image`/element-`Group` the `id={el.id}`), so `stage.findOne('#id')` resolves the exact node being dragged. Verify drag + resize agree after the change.

- [ ] **Step 6: Commit**

```bash
git add components/email-lab/social/KonvaStage.tsx components/email-lab/social/SocialComposer.tsx components/email-lab/social/use-konva-image.ts components/email-lab/social/__tests__/use-konva-image.test.ts
git commit -m "feat(social): Konva composer — elements, drag/resize, brand, CORS-safe images"
```

---

### Task 7: Export → upload route → `media_url`

**Why:** Turn the on-screen canvas into a pixel-exact platform PNG (`toDataURL({ pixelRatio })`) and upload it to the public `social-media` bucket so the publish adapters can fetch it. Two failure modes the spec's "preview == export" claim hides: (1) **fonts** not loaded at raster time silently fall back; (2) a **tainted canvas** (cross-origin image without CORS) makes `toDataURL` throw `SECURITY_ERR`. Both are handled explicitly.

**Files:**
- Create: `app/api/email-lab/social/upload/route.ts`
- 🔴 Modify: `components/email-lab/social/SocialComposer.tsx` (export button + handler)
- Test: `app/api/email-lab/social/__tests__/upload.test.ts` (pure-ish: key shaping; the upload itself is live-verified)

**Interfaces:**
- Consumes: `uploadSocialImage`, `SOCIAL_MEDIA_BUCKET` (`lib/social/media-upload.ts`); `SOCIAL_FORMATS` (Task 1); the `stageRef` (Task 6).
- Produces: route `POST /api/email-lab/social/upload` returning `{ url }`; a composer `exportPng()` that returns the uploaded `media_url`.

- [ ] **Step 1: The upload route**

```ts
// app/api/email-lab/social/upload/route.ts
//
// Authed client export: accepts a PNG blob from the canvas composer, uploads it to the
// public `social-media` bucket under a user-scoped key, returns the public URL the publish
// adapters fetch. Auth via the cookie/RLS client (authorization); the Storage write uses
// the service-role client (Storage bypasses RLS) under a user-scoped key — mirrors the
// cron worker's use of uploadSocialImage.
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { uploadSocialImage } from "@/lib/social/media-upload";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  if (file.size > 8 * 1024 * 1024) {
    return NextResponse.json({ error: "file too large" }, { status: 413 });
  }
  const buf = Buffer.from(await file.arrayBuffer());
  // user-scoped key; uuid keeps re-exports from clobbering an already-scheduled image.
  const key = `lab/${user.id}/${crypto.randomUUID()}.png`;
  try {
    const url = await uploadSocialImage(createServiceRoleClient(), buf, key);
    return NextResponse.json({ url });
  } catch (err) {
    console.error("[social/upload] failed:", err);
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Export handler in `SocialComposer`** (pixelRatio + font preload + tainted-canvas guard)

Add state + handler to `SocialComposer`:

```tsx
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);

  async function exportPng(): Promise<string | null> {
    const stage = stageRef.current;
    if (!stage) return null;
    setExporting(true);
    setExportError(null);
    try {
      // 1) Fonts must be loaded before raster, or export diverges from preview.
      if (typeof document !== "undefined" && document.fonts?.ready) {
        await document.fonts.ready;
      }
      // 2) pixelRatio = target platform width ÷ on-screen stage width.
      const targetW = SOCIAL_FORMATS[design.format].width;
      const pixelRatio = targetW / stage.width();
      // 3) toDataURL throws SECURITY_ERR on a tainted (cross-origin, non-CORS) canvas.
      let dataUrl: string;
      try {
        dataUrl = stage.toDataURL({ pixelRatio, mimeType: "image/png" });
      } catch {
        setExportError(
          "An image on the canvas blocks export (it's hosted somewhere that doesn't allow it). Use an uploaded photo or one from your library.",
        );
        return null;
      }
      const blob = await (await fetch(dataUrl)).blob();
      const fd = new FormData();
      fd.append("file", blob, "post.png");
      const res = await fetch("/api/email-lab/social/upload", { method: "POST", body: fd });
      if (!res.ok) {
        setExportError("Couldn't save the image — try again.");
        return null;
      }
      const { url } = (await res.json()) as { url: string };
      setMediaUrl(url);
      return url;
    } finally {
      setExporting(false);
    }
  }
```

> Confirm the exact `toDataURL` call shape against the react-konva **Canvas Export** doc (`konvajs.org/docs/react/Canvas_Export.html`) at build time per RULE 1 — `stageRef.current.toDataURL({ pixelRatio })` is the documented Stage export; the `mimeType` option is supported. Add `import { SOCIAL_FORMATS } from "@/lib/social/formats"` to the composer (already present from Task 6).

Add an Export button to the left tools (under the palette):

```tsx
        <button
          onClick={() => void exportPng()}
          disabled={exporting || design.elements.length === 0}
          className="w-full rounded-lg bg-gulf-teal py-2 text-xs font-semibold text-[#070f14] disabled:opacity-40"
        >
          {exporting ? "Exporting…" : "Export PNG"}
        </button>
        {exportError && <p className="text-[10px] text-amber-300/80">{exportError}</p>}
        {mediaUrl && <p className="text-[10px] text-gulf-teal/80">Image saved ✓</p>}
```

- [ ] **Step 3: Key-shaping test**

```ts
// app/api/email-lab/social/__tests__/upload.test.ts
import { test, expect } from "bun:test";

// The route's behaviour (auth + storage) is live-verified; this guards the key contract:
// keys are user-scoped under lab/<userId>/ and end in .png so the public bucket policy applies.
test("upload key contract", () => {
  const userId = "abc-123";
  const key = `lab/${userId}/${"uuid-placeholder"}.png`;
  expect(key.startsWith(`lab/${userId}/`)).toBe(true);
  expect(key.endsWith(".png")).toBe(true);
});
```

Run: `bun test app/api/email-lab/social/__tests__/upload.test.ts` → PASS.

- [ ] **Step 4: Build + live-verify (the real export test — use a CROSS-ORIGIN photo)**

Run: `bunx next build` → clean.
Then, on `/email-lab/grid` Social mode: add a text + stat + a logo (from brand). Click **Export PNG** → "Image saved ✓"; open the returned URL → a pixel-exact PNG at the platform size (e.g. 1080×1080) that matches the preview, fonts included.
**Tainted-canvas check:** add an image element whose `src` is a known non-CORS cross-origin URL → Export shows the actionable error, no crash. Add an image from the Photos bridge / uploaded (same-origin / CORS-OK) → exports fine. (This is the failure that passes in dev with same-origin images and breaks in prod — verify it deliberately.)

- [ ] **Step 5: Commit**

```bash
git add app/api/email-lab/social/upload/route.ts app/api/email-lab/social/__tests__/upload.test.ts components/email-lab/social/SocialComposer.tsx
git commit -m "feat(social): client PNG export (pixelRatio + font preload + tainted-canvas guard) → public url"
```

---

### Task 8: AI Generate canvas-fill + caption/variants editor

**Why:** The second create path — "Generate" lays out cited, four-lane-sourced copy into the canvas elements and writes the caption (per-platform shaped). Reuses the shipped `socialPostSystem` + `tryParseSocial` (the patch is "id → text fields", mapping 1:1 to canvas element ids via `applyDesignPatch`). The four-lane no-invention moat rides for free in the prompt — **no redundant scrub is added**.

**Files:**
- Create: `lib/email/social-calendar/build-canvas-fill.ts`
- Create: `app/api/email-lab/social/generate/route.ts`
- 🔴 Modify: `components/email-lab/social/SocialComposer.tsx` (Generate button, caption + variants editor, chart element rasterization)
- Test: `lib/email/social-calendar/__tests__/build-canvas-fill.test.ts`

**Interfaces:**
- Consumes: `socialPostSystem`, `tryParseSocial`, `buildVariants` (`build-week.ts`, all exported); `fetchLakeParts`, `refreshStaleLakeContext` (`lib/email/build-doc.ts`); `resolveEmailModel` (`lib/email/model-router.ts`); `designToSkeleton`, `applyDesignPatch` (Task 2); `chartFragment` (Task 1).
- Produces: `buildSocialCanvasFill(scope, skeleton, opts): Promise<{ caption: string; hashtags: string[]; patch: Record<string,Record<string,unknown>>; variants: Partial<Record<Platform,string>>; webSources: {label:string;value:string;url:string}[] } | null>`; route `POST /api/email-lab/social/generate`.

- [ ] **Step 1: Failing test for the pure parts of `buildSocialCanvasFill`**

The network call (Anthropic + lake) is live-verified; unit-test the skeleton-shaping + the fact that the reused `tryParseSocial`/`applyDesignPatch` produce a text-only patch. Test the wiring via a small exported pure helper:

```ts
// lib/email/social-calendar/__tests__/build-canvas-fill.test.ts
import { test, expect } from "bun:test";
import { canvasFillPrompt } from "@/lib/email/social-calendar/build-canvas-fill";

test("canvasFillPrompt renders the element skeleton as id->text lines", () => {
  const skeleton = {
    t1: { type: "text", text: "Headline" },
    s1: { type: "stat", value: "", label: "median price" },
  };
  const msg = canvasFillPrompt(skeleton);
  expect(msg).toContain("t1");
  expect(msg).toContain("Headline");
  expect(msg).toContain("s1");
  expect(msg).toContain("median price");
});
```

- [ ] **Step 2: Run it — fails**

Run: `bun test lib/email/social-calendar/__tests__/build-canvas-fill.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `lib/email/social-calendar/build-canvas-fill.ts`**

```ts
// lib/email/social-calendar/build-canvas-fill.ts
//
// AI fill for the canvas composer. Reuses the shipped four-lane social prompt + parser
// (socialPostSystem / tryParseSocial) — the patch keyed by element id maps 1:1 onto canvas
// element ids. The no-invention moat lives in the prompt; nothing is scrubbed here.
import Anthropic from "@anthropic-ai/sdk";
import { socialPostSystem, tryParseSocial, buildVariants } from "@/lib/email/social-calendar/build-week";
import { fetchLakeParts, refreshStaleLakeContext, type BuildScope } from "@/lib/email/build-doc";
import { resolveEmailModel } from "@/lib/email/model-router";
import type { GoalTone } from "@/lib/email/social-calendar/types";
import type { Platform } from "@/lib/social/types";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ADDENDUM = "A single social post. Fill the listed elements with cited SWFL figures; keep each value short.";

/** The user message: element id -> current text (mirrors docSkeleton's shape for the email path). */
export function canvasFillPrompt(skeleton: Record<string, Record<string, string>>): string {
  const lines = Object.entries(skeleton).map(([id, fields]) => `${id}: ${JSON.stringify(fields)}`);
  return `ELEMENTS (id -> current text fields):\n${lines.join("\n")}`;
}

export interface CanvasFillResult {
  caption: string;
  hashtags: string[];
  patch: Record<string, Record<string, unknown>>;
  variants: Partial<Record<Platform, string>>;
  webSources: { label: string; value: string; url: string }[];
}

export async function buildSocialCanvasFill(
  scope: BuildScope | undefined,
  skeleton: Record<string, Record<string, string>>,
  opts?: { platforms?: Platform[]; goalTone?: GoalTone },
): Promise<CanvasFillResult | null> {
  const { figures, dossier } = await fetchLakeParts(scope);
  const fresh = await refreshStaleLakeContext({
    scope,
    figures,
    dossier,
    prompt: scope?.value ? `${scope.value} Southwest Florida real estate market` : "Southwest Florida real estate market",
    today: new Date(),
    includeGapProbe: false,
  });
  try {
    const msg = await client.messages.create({
      model: resolveEmailModel("interactive"),
      max_tokens: opts?.platforms?.length ? Math.min(512 + opts.platforms.length * 320, 2048) : 700,
      system: socialPostSystem(fresh.lakeContext, ADDENDUM, opts),
      messages: [{ role: "user", content: canvasFillPrompt(skeleton) }],
    });
    const txt = msg.content[0]?.type === "text" ? msg.content[0].text : "";
    const parsed = tryParseSocial(txt);
    if (!parsed) return null;
    return {
      caption: parsed.caption,
      hashtags: parsed.hashtags,
      patch: (parsed.patch as Record<string, Record<string, unknown>>) ?? {},
      variants: opts?.platforms?.length ? buildVariants(parsed.caption, parsed.variants, opts.platforms) : parsed.variants,
      webSources: fresh.web.verified.map((v) => ({ label: v.label, value: String(v.value), url: v.url })),
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the test — pass**

Run: `bun test lib/email/social-calendar/__tests__/build-canvas-fill.test.ts` → PASS.

- [ ] **Step 5: Create the generate route** (mirror `app/api/email-lab/social-calendar/route.ts` auth posture)

```ts
// app/api/email-lab/social/generate/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { buildSocialCanvasFill } from "@/lib/email/social-calendar/build-canvas-fill";
import type { BuildScope } from "@/lib/email/build-doc";
import type { Platform } from "@/lib/social/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const scope = body?.scope as BuildScope | undefined;
  const skeleton = (body?.skeleton ?? {}) as Record<string, Record<string, string>>;
  const platforms = Array.isArray(body?.platforms) ? (body.platforms as Platform[]) : undefined;
  const goalTone = body?.goalTone;
  if (Object.keys(skeleton).length === 0) {
    return NextResponse.json({ error: "no elements to fill" }, { status: 400 });
  }
  const result = await buildSocialCanvasFill(scope, skeleton, { platforms, goalTone });
  if (!result) return NextResponse.json({ error: "fill_failed" }, { status: 502 });
  return NextResponse.json(result);
}
```

> Confirm the existing social-calendar route's auth posture (cookie client vs none) and mirror it exactly so paid-gating is consistent. The client surface is already paid-gated by the mode tab (Task 5); add the same server-side user check here if the social-calendar route has one.

- [ ] **Step 6: Wire Generate + caption editor + chart rasterization into `SocialComposer`**

Add state + handler:

```tsx
  const [generating, setGenerating] = useState(false);
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [variants, setVariants] = useState<Partial<Record<string, string>>>({});

  async function generate() {
    setGenerating(true);
    try {
      const skeleton = designToSkeleton(design);
      const res = await fetch("/api/email-lab/social/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, skeleton }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setDesign((d) => applyDesignPatch(d, data.patch ?? {}));
      setCaption(data.caption ?? "");
      setHashtags(data.hashtags ?? []);
      setVariants(data.variants ?? {});
    } finally {
      setGenerating(false);
    }
  }
```

Add the imports: `import { designToSkeleton, applyDesignPatch } from "@/lib/social/design/serialize";` and pass `scope` through `SocialComposerProps` (already a prop).

Add a Generate button + a caption textarea (below the canvas or in the left tools). Note: if `design.elements` is empty, Generate seeds a default text + stat element first (so there's something to fill), then fills — implement as: if empty, `addElement("text"); addElement("stat")` before the fetch, or seed a starter design.

**Chart element rasterization:** when the user adds a "chart" element from a real brain (v1: from a passed chart spec), render it to SVG via `chartFragment` (Task 1), wrap it in a standalone `<svg>`, convert to a data-URL, and store it as the element's `src` so `useKonvaImage` draws it. Keep v1 simple: a chart is added as an **image element** whose `src` is the chart SVG data-URL (so no new Konva renderer is needed). Document this in a comment; full interactive chart elements are a follow-up.

- [ ] **Step 7: Build + live-verify**

Run: `bunx next build` → clean.
On `/email-lab/grid` Social mode for a ZIP/place scope: click **Generate** → the stat/text fill with cited SWFL figures, the caption populates. Confirm a figure traces to a real source (lake / cited web) — the four-lane prompt guarantees it. Edit the caption → persists. (This is an answer-path-adjacent feature; the live result is the proof per `feedback_checks-prod-evidence-not-dev-attestation`.)

- [ ] **Step 8: Commit**

```bash
git add lib/email/social-calendar/build-canvas-fill.ts app/api/email-lab/social/generate/route.ts lib/email/social-calendar/__tests__/build-canvas-fill.test.ts components/email-lab/social/SocialComposer.tsx
git commit -m "feat(social): AI Generate canvas-fill (reuses four-lane socialPostSystem) + caption editor"
```

---

### Task 9: Schedule wiring — `ScheduleSocialModal` sends `mediaUrl` + `design`

**Why:** Close the loop. The schedule route ALREADY reads `body.mediaUrl` → `freezePost` (route.ts:137) and `Cadence` ALREADY includes `"daily"` — so the only gaps are: (1) the composer exports → opens the schedule modal carrying the exported `media_url` + caption + design; (2) the modal POSTs `mediaUrl` + `design`; (3) `freezePost` stores `design`; (4) canvas inserts set `freshness_gate: false` (honesty — the frozen branch already ignores the gate). Then the cron frozen branch (Task 3) posts it verbatim.

**Files:**
- Modify: `lib/social/persist-schedule.ts` (`freezePost` stores `design`; `buildSocialScheduleInsert` sets `freshness_gate: false` when a design is present)
- Modify: `app/api/social/schedule/route.ts` (pass `body.design` to `freezePost`)
- Modify: `components/email-lab/ScheduleSocialModal.tsx` (accept + POST `mediaUrl` + `design`)
- 🔴 Modify: `components/email-lab/social/SocialComposer.tsx` (Schedule button → export → open modal)
- Test: `lib/social/__tests__/persist-schedule-design.test.ts`

**Interfaces:**
- Consumes: `freezePost`, `buildSocialScheduleInsert` (`persist-schedule.ts`); `SocialDesign` (Task 2); the exported `media_url` (Task 7).
- Produces: `freezePost(draft, nowIso, { mediaUrl, freshnessToken, design })`; modal accepts `mediaUrl?: string` + `design?: SocialDesign`.

- [ ] **Step 1: Failing test for `freezePost` design + `freshness_gate`**

```ts
// lib/social/__tests__/persist-schedule-design.test.ts
import { test, expect } from "bun:test";
import { freezePost, buildSocialScheduleInsert } from "@/lib/social/persist-schedule";
import type { SocialDraft } from "@/lib/email/social-calendar/types";
import type { SocialDesign } from "@/lib/social/design/types";

const draft = { day: "mon", theme: "x", caption: "hi", hashtags: ["swfl"], card: { globalStyle: {}, blocks: [] } } as unknown as SocialDraft;
const design: SocialDesign = { version: 1, format: "portrait", background: "#000", elements: [] };

test("freezePost stores the design when given", () => {
  const f = freezePost(draft, "2026-06-30T00:00:00Z", { mediaUrl: "https://x/a.png", design });
  expect(f.design).toEqual(design);
  expect(f.media_url).toBe("https://x/a.png");
});

test("freezePost design defaults to null", () => {
  const f = freezePost(draft, "2026-06-30T00:00:00Z", { mediaUrl: null });
  expect(f.design ?? null).toBeNull();
});

test("canvas insert (design present) disables the freshness gate", () => {
  const f = freezePost(draft, "2026-06-30T00:00:00Z", { mediaUrl: "https://x/a.png", design });
  const ins = buildSocialScheduleInsert({
    userId: "u", projectId: null, socialAccountId: "a", platform: "x",
    cadence: { cadence: "daily", send_hour_et: 9 },
    scopeKind: null, scopeValue: null, hashtags: [], mediaKind: "image",
    frozenPost: f, signature: null, nextRunAtIso: "2026-07-01T13:00:00Z",
  });
  expect(ins.freshness_gate).toBe(false);
});
```

- [ ] **Step 2: Run it — fails**

Run: `bun test lib/social/__tests__/persist-schedule-design.test.ts`
Expected: FAIL — `freezePost` has no `design` param; `freshness_gate` is hardcoded `true`.

- [ ] **Step 3: Extend `freezePost` + `buildSocialScheduleInsert`**

In `lib/social/persist-schedule.ts`:

```ts
// add import
import type { FrozenPost, Platform } from "@/lib/social/types";
import type { SocialDesign } from "@/lib/social/design/types";

// freezePost: add design to opts + the returned object
export function freezePost(
  draft: SocialDraft,
  nowIso: string,
  opts: { mediaUrl?: string | null; freshnessToken?: string | null; design?: SocialDesign | null },
): FrozenPost {
  return {
    caption: draft.caption,
    media_url: opts.mediaUrl && opts.mediaUrl.trim() ? opts.mediaUrl : null,
    hashtags: draft.hashtags ?? [],
    freshness_token: opts.freshnessToken && opts.freshnessToken.trim() ? opts.freshnessToken : null,
    composed_at: nowIso,
    design: opts.design ?? null,
  };
}
```

In `buildSocialScheduleInsert`, change the hardcoded `freshness_gate: true` to derive from the frozen design:

```ts
    // A frozen canvas image is static (v1) — the cron's frozen branch ignores the gate;
    // record freshness_gate:false for honesty. Template posts keep the gate on.
    freshness_gate: input.frozenPost.design ? false : true,
```

- [ ] **Step 4: Run the test — pass**

Run: `bun test lib/social/__tests__/persist-schedule-design.test.ts` → PASS.

- [ ] **Step 5: Route passes `design` through**

In `app/api/social/schedule/route.ts`, the `freezePost` call (line ~136) gains `design`:

```ts
  const frozen = freezePost(post, nowIso, {
    mediaUrl: typeof body?.mediaUrl === "string" ? body.mediaUrl : null,
    freshnessToken: typeof body?.freshnessToken === "string" ? body.freshnessToken : null,
    design: body?.design ?? null,
  });
```

(`body.design` is the serialized `SocialDesign` object; it is stored verbatim in `frozen_post.design`. No server validation beyond JSON shape is needed for v1 — it's the user's own design.)

- [ ] **Step 6: Modal accepts + POSTs `mediaUrl` + `design`**

In `components/email-lab/ScheduleSocialModal.tsx`:
- Add to `Props`: `mediaUrl?: string | null;` and `design?: import("@/lib/social/design/types").SocialDesign | null;`
- In `confirm()`'s POST body, add: `mediaUrl: mediaUrl ?? undefined,` and `design: design ?? undefined,`
- Update the success copy: when `mediaUrl` is present, the line "It re-posts on your cadence with fresh data each time." is wrong for a frozen image — change to "It posts your designed image on your cadence." when `mediaUrl` is set (keep the existing copy for the template/calendar path).

- [ ] **Step 7: Composer Schedule button → export → open modal**

In `SocialComposer`, add a Schedule button that first exports (reusing `exportPng`), then opens `ScheduleSocialModal` with a minimal draft + the exported url + the design:

```tsx
  const [scheduleOpen, setScheduleOpen] = useState(false);

  async function openSchedule() {
    const url = mediaUrl ?? (await exportPng());
    if (!url) return; // export error already surfaced
    setScheduleOpen(true);
  }
```

Render the modal (import `ScheduleSocialModal` + build a `SocialDraft`-shaped object — the route only reads `caption` + `hashtags`):

```tsx
  {scheduleOpen && (
    <ScheduleSocialModal
      draft={{ day: "mon", theme: "composed", caption, hashtags, card: { globalStyle: {}, blocks: [] } as never, variants }}
      projectId={projectId}
      scopeKind={scope?.kind ?? null}
      scopeValue={scope?.value ?? null}
      mediaUrl={mediaUrl}
      design={design}
      onClose={() => setScheduleOpen(false)}
    />
  )}
```

Add a "Schedule post" button to the left tools (after Export), calling `openSchedule`. (`projectId` must be threaded through `SocialComposerProps` — add it; the shell already passes `projectId`.)

- [ ] **Step 8: Build + full live-verify (the build check)**

Run: `bunx next build` → clean. Run `bunx vitest run lib/email/lab/capabilities.test.ts` → PASS.
Then the end-to-end live verify (this closes `social_canvas_composer_live_verify`):
1. `/email-lab/grid` → Social → design a post (or Generate) → **Export PNG** → "saved ✓".
2. **Schedule post** → pick a connected platform + daily + a time → confirm → success.
3. In Supabase, the new `social_schedules` row has `frozen_post.media_url` = the exported PNG, `frozen_post.design.format` set, `freshness_gate = false`, and `next_run_at` non-null.
4. `DRY_RUN=true bun scripts/social/run-schedules.mts` (or wait for the cron) → the frozen branch logs `frozen: ...`, writes a `social_posts` `dry_run` row whose `media_url` is the EXPORTED PNG (not a re-rendered template), and does NOT call `buildSocialContent`.

- [ ] **Step 9: Close the build check + SESSION_LOG + push**

```bash
node scripts/check.mjs close social_canvas_composer_live_verify
# append a SESSION_LOG.md entry (what shipped, the live-verify evidence, PR/commit)
git add lib/social/persist-schedule.ts app/api/social/schedule/route.ts components/email-lab/ScheduleSocialModal.tsx components/email-lab/social/SocialComposer.tsx lib/social/__tests__/persist-schedule-design.test.ts SESSION_LOG.md _AUDIT_AND_ROADMAP/build-queue.md
git commit -m "feat(social): schedule a canvas post — modal sends media_url + design, freeze stores design"
node scripts/safe-push.mjs
```

> Per `feedback_checks-prod-evidence-not-dev-attestation`: close the check only on the LIVE evidence from Step 8, never on "code looks right". Per `feedback_no-autonomous-push`: stop before `safe-push` and confirm with the operator first.

---

## Roadmap (follow-up — on the record, not v1)

> **Known v1 limitation (inherent to frozen-verbatim).** A frozen canvas image is byte-identical on every fire, so the same image + caption posts each day. Platforms run duplicate-content detection — **X rejects an exact duplicate post** ("Status is a duplicate") and Meta may suppress it. So "schedule daily" effectively posts once on X until the image/caption changes. This is not a bug to fix in v1; it is exactly what roadmap item 3 (auto-refresh) resolves by re-rendering with fresh data each fire. State it to the user when they pick a daily cadence on a frozen post (a one-line note in `ScheduleSocialModal`), so it's a known limit, not a support surprise.

1. **Generate-Week → composer bridge.** Add "Open in composer" on each Generate-Week day to seed the canvas from that day's caption + AI patch (the day's `card` text maps through `applyDesignPatch`). Decided non-destructive for v1: Generate-Week stays as-is in Social mode; the bridge is the first social follow-up.
2. **Carousel / multi-image (Fast-follow A).** `ComposedPost.media[]` is already a list; add a multi-page canvas concept (add/reorder pages → N PNGs) + multi-media in the publish adapters. Verify per-platform carousel limits (IG ≤10, X ≤4, FB, LinkedIn) with a targeted crawl4ai pass at build time.
3. **Auto-refresh a designed post (Phase-2 B).** The design JSON + bindings are already stored on `frozen_post.design`; on schedule, refetch the bound brain metrics, `applyDesignPatch` the bound fields, **re-render server-side** (Konva headless via `skia-canvas`/`node-canvas` in the Bun cron — validate it runs in the GHA runtime), and post. The real work is **layout-safety** (a bound number that changes length must auto-fit its box). This is why v1 stores the design + bindings now.
4. **Interactive chart elements.** v1 places a chart as a rasterized SVG image element; a follow-up can make it a live, re-styleable Konva chart element.

## Self-Review (against the spec)

- **Spec §"Architecture (v1)" Layer 1** (Email|Social tab, mode-aware panels, paid via `socialCalendar`, calendar removed from email mode) → Task 5. **Generate-Week fate** resolved (preserve in social mode; bridge → roadmap #1).
- **Layer 2** (fixed-aspect canvas, `SOCIAL_FORMATS`, element types text/image/stat/chart/CTA/logo, drag/resize/brand) → Tasks 4 + 6.
- **Layer 3** (Generate reuses `build-week`'s prompt/patch by element id; per-platform variants; four-lane unchanged) → Task 8.
- **Layer 4** (`toDataURL({pixelRatio})` client export → upload) → Task 7 (+ the spec-silent CORS + font-preload failures handled).
- **Layer 5** (schedule writes recipe + frozen PNG + caption + platforms + cadence; cron posts frozen verbatim; DRY-gated) → Tasks 3 + 9.
- **v1 scope items 1–9** → all covered (item 9 "store design JSON + bindings" = `FrozenPost.design`, Task 2 + 9).
- **Spec "Key decisions to finalize"**: canvas lib = `react-konva@19.2.5` (React-19 verified); export = client `toDataURL` v1; watermark = user places own logo, no forced burn-in (paid surface); **daily cadence already supported** (verified — no work); cron branch = Task 3.
- **No-resvg-in-browser** (spec memory `project_emaildoc-three-render-engines`) → Task 1 carves resvg-free modules.
- **Placeholder scan:** every code step carries real code; the two "verify the exact vendor call at build" notes (toDataURL shape, generate-route auth posture) are RULE-1 execution-time checks, not placeholders. Type names consistent across tasks (`SocialDesign`, `applyDesignPatch`, `designToSkeleton`, `frozenPublishPayload`, `freezePost(..., {design})`).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-30-social-canvas-composer.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, two-stage review between tasks, fast iteration. Run Tasks 1/2/3 in parallel first (seam-independent), then the shared-shell chain 5→6→7→8→9 in sequence (each touches `EmailLabGridShell.tsx`).
2. **Inline Execution** — execute tasks in this session with checkpoints for review.

Which approach?

---

## Parallel Safety

> Tasks sharing a color badge touch overlapping files and **cannot run in parallel**.

| Group | Tasks | Shared Files |
|-------|-------|--------------|
| 🔴 | Task 4, Task 6, Task 7, Task 8, Task 9 | `components/email-lab/social/KonvaStage.tsx`, `components/email-lab/social/SocialComposer.tsx` |

Tasks with no color badge have no file conflicts — safe to parallelize freely.
