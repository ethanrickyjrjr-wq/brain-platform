# Data-driven `email-report.html` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the live per-ZIP activation email (broken by `9f976f4`'s static mockup) by making `email-report.html` data-driven via a repeat-block renderer, while keeping the new dark design in the `.html`.

**Architecture:** Add an opt-in `repeats` param to `renderHtmlTemplate` that clones `<!-- repeat:KEY -->…<!-- /repeat:KEY -->` blocks once per data item. Keep `email-report.html`'s masthead + footer; replace its hardcoded middle with a headline, a `<!-- repeat:hero -->` 0-or-1 block, a `[ DELTA ]` slot, `<!-- repeat:metrics -->`, `<!-- repeat:reads -->`, freshness token, and CTA. `render.ts` supplies real data (tokens + repeats) and builds only the conditional delta block (dark-restyled). The 5 failing `lib/email` tests go green; a no-fabrication tripwire is added.

**Tech Stack:** TypeScript, Bun (`bun test`), HTML email templates under `templates/html/email/`.

**Spec:** `docs/superpowers/specs/2026-06-16-email-report-data-driven-design.md`

---

## File Structure

- **Modify** `lib/templates/render-html-template.ts` — add optional `repeats` param; export `expandRepeats`.
- **Modify** `lib/email/templates/render-template.ts` — thread `repeats`; add always-replaced `[ DELTA ]` slot.
- **Rewrite** `templates/html/email/email-report.html` — keep masthead/footer; data-driven middle.
- **Rewrite** `reportToEmailHtml` + dark-restyle delta block in `lib/email/activation/render.ts`; drop dead `metricsTable`.
- **Modify** `lib/email/__tests__/components.test.ts` — fix `SWFL_PRIMARY` by single-source reference.
- **Create** `lib/templates/render-html-template.test.ts` — unit tests for `expandRepeats` + no-repeats regression.
- **Modify** `lib/email/activation/render.test.ts` — add the no-fabrication tripwire test.

Per spec §6: **do not edit `_shared.ts`** (stale comment is non-load-bearing) and **change no color value** (the test fix is by-reference / navy-agnostic).

---

## Task 1: Renderer — opt-in `repeats` expansion

**Files:**
- Modify: `lib/templates/render-html-template.ts`
- Test: `lib/templates/render-html-template.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `lib/templates/render-html-template.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { expandRepeats, renderHtmlTemplate } from "./render-html-template";

describe("expandRepeats", () => {
  const block = `<!-- repeat:rows --><li>{{LABEL}}: {{VALUE}}</li><!-- /repeat:rows -->`;

  it("clones the inner block once per item and fills per-row tokens", () => {
    const out = expandRepeats(block, { rows: [
      { LABEL: "a", VALUE: 1 },
      { LABEL: "b", VALUE: 2 },
    ]});
    expect(out).toBe("<li>a: 1</li><li>b: 2</li>");
  });

  it("renders an empty string when the list is empty or absent", () => {
    expect(expandRepeats(block, { rows: [] })).toBe("");
    expect(expandRepeats(block, {})).toBe("");
  });

  it("leaves global tokens (not on the item) intact for the outer pass", () => {
    const out = expandRepeats(
      `<!-- repeat:rows --><td style="color:{{ACCENT}}">{{LABEL}}</td><!-- /repeat:rows -->`,
      { rows: [{ LABEL: "x" }] },
    );
    expect(out).toBe(`<td style="color:{{ACCENT}}">x</td>`);
  });

  it("expands multiple distinct blocks independently", () => {
    const html = `<!-- repeat:a -->A{{N}}<!-- /repeat:a -->|<!-- repeat:b -->B{{N}}<!-- /repeat:b -->`;
    const out = expandRepeats(html, { a: [{ N: 1 }], b: [{ N: 2 }, { N: 3 }] });
    expect(out).toBe("A1|B2B3");
  });
});

describe("renderHtmlTemplate without repeats", () => {
  it("is unchanged: fills a global token in an existing template", async () => {
    const html = await renderHtmlTemplate("email/email-hero", { COMPANY_NAME: "ZZTEST" });
    expect(html).toContain("ZZTEST");
    expect(html).not.toContain("{{COMPANY_NAME}}");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/templates/render-html-template.test.ts`
Expected: FAIL — `expandRepeats` is not exported (import error / undefined).

- [ ] **Step 3: Implement `expandRepeats` + thread it into `renderHtmlTemplate`**

In `lib/templates/render-html-template.ts`, add the repeat regex near `TOKEN_RE` (line 24):

```ts
/** Matches `<!-- repeat:key -->…<!-- /repeat:key -->` (single-level, non-greedy). */
const REPEAT_RE = /<!--\s*repeat:([a-zA-Z0-9_]+)\s*-->([\s\S]*?)<!--\s*\/repeat:\1\s*-->/g;

/**
 * Expand `<!-- repeat:KEY -->inner<!-- /repeat:KEY -->` blocks: clone `inner` once per
 * item in `repeats[KEY]`, filling that item's `{{tokens}}`. Tokens NOT on the item are
 * left verbatim (`{{token}}`) so the normal global pass fills them. Absent/empty list →
 * the block renders to nothing. Single-level only (no nested repeats).
 */
export function expandRepeats(
  html: string,
  repeats: Record<string, TemplateTokens[]>,
): string {
  return html.replace(REPEAT_RE, (_match, key: string, inner: string) => {
    const items = repeats[key] ?? [];
    return items
      .map((item) =>
        inner.replace(TOKEN_RE, (whole, k: string) => {
          const value = item[k];
          return value === undefined ? whole : String(value);
        }),
      )
      .join("");
  });
}
```

Then change the `renderHtmlTemplate` signature and body. Replace the current signature (line 54) and the final `return` (lines 70-73):

```ts
export async function renderHtmlTemplate(
  slug: string,
  tokens: TemplateTokens,
  repeats?: Record<string, TemplateTokens[]>,
): Promise<string> {
  if (!SLUG_RE.test(slug) || slug.includes("..")) throw new InvalidSlugError(slug);

  const filePath = path.join(TEMPLATE_ROOT, `${slug}.html`);
  const rel = path.relative(TEMPLATE_ROOT, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new InvalidSlugError(slug);

  let shell: string;
  try {
    shell = await readFile(filePath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new TemplateNotFoundError(slug);
    throw e;
  }

  if (repeats) shell = expandRepeats(shell, repeats);

  return shell.replace(TOKEN_RE, (_match, key: string) => {
    const value = tokens[key];
    return value === undefined ? "" : String(value);
  });
}
```

(The `try/catch` and slug guards above are copied verbatim from the existing body — only the new `repeats` param and the `if (repeats) …` line are added.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/templates/render-html-template.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/templates/render-html-template.ts lib/templates/render-html-template.test.ts
git commit -m "feat(render): opt-in repeat-block expansion in renderHtmlTemplate"
```

---

## Task 2: Email wrapper — thread `repeats` + `[ DELTA ]` slot

**Files:**
- Modify: `lib/email/templates/render-template.ts`

- [ ] **Step 1: Update `TemplateData` and `renderEmailTemplate`**

In `lib/email/templates/render-template.ts`, extend the `TemplateData` interface (currently lines 8-11):

```ts
export interface TemplateData {
  chart?: string; // fills [ CHART ] placeholder if present in shell
  body?: string; // fills [ BODY TEXT ] placeholder if present in shell
  delta?: string; // fills [ DELTA ] placeholder; ALWAYS replaced (empty when absent)
  repeats?: Record<string, Array<Record<string, string | number>>>; // per-block row data
}
```

Then update `renderEmailTemplate` (currently lines 23-43) — pass `repeats` to `renderHtmlTemplate` and always-replace `[ DELTA ]`:

```ts
export async function renderEmailTemplate(
  slug: TemplateSlug,
  tokens?: TemplateTokens,
  data?: TemplateData,
): Promise<string> {
  const resolvedSlug = EMAIL_TEMPLATES[slug];
  const merged = { ...SWFL_TOKEN_DEFAULTS, ...tokens };

  let html = await renderHtmlTemplate(resolvedSlug, merged, data?.repeats);

  if (data?.chart) html = html.replace(/\[\s*CHART\s*\]/g, data.chart);
  if (data?.body) html = html.replace(/\[\s*BODY TEXT\s*\]/g, data.body);
  // DELTA is always replaced — an absent delta must not leave a literal `[ DELTA ]`.
  html = html.replace(/\[\s*DELTA\s*\]/g, data?.delta ?? "");

  const remaining = html.match(/\{\{[A-Z_]+\}\}/g);
  if (remaining) throw new Error(`Unfilled tokens: ${remaining.join(", ")}`);

  return html;
}
```

Add the import for the generic token type at the top (the `renderHtmlTemplate` repeats param wants `Record<string, string|number>` rows — already structurally compatible with the interface above; no new import needed beyond the existing `renderHtmlTemplate`).

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: clean (no errors). If a type mismatch appears on `data?.repeats`, widen the `renderHtmlTemplate` `repeats` param to `Record<string, Array<Record<string, string | number>>>` (same shape).

- [ ] **Step 3: Commit**

```bash
git add lib/email/templates/render-template.ts
git commit -m "feat(email): thread repeats + always-replaced [ DELTA ] slot through renderEmailTemplate"
```

(Verification of the delta/repeats path is the integration tests in Task 4 — `renderEmailTemplate` needs the new template to exercise them.)

---

## Task 3: Rewrite `email-report.html` (keep masthead + footer)

**Files:**
- Rewrite: `templates/html/email/email-report.html`

- [ ] **Step 1: Replace the whole file**

Write `templates/html/email/email-report.html` with EXACTLY this content. The masthead and footer are unchanged from the current file; only the middle (former SECTION 1-4) is replaced with the data-driven structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{COMPANY_NAME}} — Market Intelligence Report</title>
</head>
<body style="margin:0;padding:0;background-color:{{PRIMARY}};font-family:{{FONT_FAMILY}};">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:{{PRIMARY}};">
  <tr>
    <td align="center" style="padding:0;">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

        <!-- ━━━━ MASTHEAD ━━━━ -->
        <tr>
          <td style="padding:24px 32px;border-bottom:1px solid rgba(255,255,255,0.10);">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="middle">
                  <img src="{{LOGO_URL}}" alt="{{COMPANY_NAME}}" height="26" style="display:block;border:0;max-height:26px;" />
                  <p style="margin:4px 0 0 0;font-family:{{FONT_FAMILY}};font-size:15px;font-weight:800;color:{{TEXT_PRIMARY}};letter-spacing:-0.4px;">{{COMPANY_NAME}}</p>
                </td>
                <td align="right" valign="middle">
                  <p style="margin:0 0 3px 0;font-family:{{FONT_FAMILY}};font-size:10px;color:{{ACCENT}};text-transform:uppercase;letter-spacing:2px;font-weight:700;">Market Intelligence</p>
                  <p style="margin:0;font-family:{{FONT_FAMILY}};font-size:10px;color:{{TEXT_DIM}};letter-spacing:0.5px;">SWFL Region</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ━━━━ HEADLINE + HERO (0-or-1) ━━━━ -->
        <tr>
          <td style="padding:32px 32px 8px;">
            <p style="margin:0 0 4px 0;font-family:{{FONT_FAMILY}};font-size:10px;font-weight:700;color:{{ACCENT}};text-transform:uppercase;letter-spacing:2.5px;">{{PLACE}} market read</p>
            <p style="margin:0 0 20px 0;font-family:{{FONT_FAMILY}};font-size:12px;color:{{TEXT_DIM}};">{{COUNTY}} &middot; ZIP {{ZIP}}</p>
            <!-- repeat:hero -->
            <p style="margin:0 0 2px 0;font-family:{{FONT_FAMILY}};font-size:44px;font-weight:900;color:{{ACCENT}};line-height:1;letter-spacing:-1.5px;">{{HERO_VALUE}}</p>
            <p style="margin:0;font-family:{{FONT_FAMILY}};font-size:11px;color:{{TEXT_DIM}};text-transform:uppercase;letter-spacing:1px;">{{HERO_LABEL}}</p>
            <!-- /repeat:hero -->
          </td>
        </tr>

        <!-- ━━━━ DELTA (conditional; email #2 only) ━━━━ -->
        <tr>
          <td style="padding:16px 32px 0;">[ DELTA ]</td>
        </tr>

        <!-- ━━━━ KEY FIGURES ━━━━ -->
        <tr>
          <td style="padding:24px 32px 8px;">
            <p style="margin:0 0 12px 0;font-family:{{FONT_FAMILY}};font-size:10px;font-weight:700;color:{{ACCENT}};text-transform:uppercase;letter-spacing:2.5px;">Key Figures</p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <!-- repeat:metrics -->
              <tr>
                <td style="padding:8px 0;font-family:{{FONT_FAMILY}};font-size:13px;color:{{TEXT_PRIMARY}};border-bottom:1px solid rgba(255,255,255,0.08);">{{M_LABEL}}</td>
                <td align="right" style="padding:8px 0;font-family:{{FONT_FAMILY}};font-size:13px;font-weight:700;color:{{TEXT_PRIMARY}};border-bottom:1px solid rgba(255,255,255,0.08);">{{M_VALUE}}</td>
              </tr>
              <!-- /repeat:metrics -->
            </table>
          </td>
        </tr>

        <!-- ━━━━ THE READS ━━━━ -->
        <tr>
          <td style="padding:24px 32px 8px;">
            <p style="margin:0 0 12px 0;font-family:{{FONT_FAMILY}};font-size:10px;font-weight:700;color:{{ACCENT}};text-transform:uppercase;letter-spacing:2.5px;">The Reads</p>
            <!-- repeat:reads -->
            <div style="margin:0 0 14px 0;font-family:{{FONT_FAMILY}};font-size:13px;line-height:1.6;color:{{TEXT_PRIMARY}};">{{READ_HTML}}</div>
            <!-- /repeat:reads -->
          </td>
        </tr>

        <!-- ━━━━ FRESHNESS + CTA ━━━━ -->
        <tr>
          <td style="padding:8px 32px 28px;">
            <p style="margin:0 0 18px 0;font-family:{{FONT_FAMILY}};font-size:11px;color:{{TEXT_DIM}};">Live data token: <span style="color:{{ACCENT}};">{{FRESHNESS_TOKEN}}</span></p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center">
                  <a href="{{CTA_URL}}" style="display:inline-block;background-color:{{ACCENT}};color:{{PRIMARY}};text-decoration:none;font-family:{{FONT_FAMILY}};font-size:14px;font-weight:700;padding:13px 30px;border-radius:6px;">Get this for your whole book of clients &rarr;</a>
                </td>
              </tr>
            </table>
            <p style="margin:12px 0 0 0;font-family:{{FONT_FAMILY}};font-size:11px;color:{{TEXT_DIM}};text-align:center;"><a href="{{REPORT_URL}}" style="color:{{TEXT_DIM}};">View the full {{ZIP}} report online</a></p>
          </td>
        </tr>

        <!-- ━━━━ FOOTER ━━━━ -->
        <tr>
          <td style="padding:16px 32px 24px;border-top:1px solid rgba(255,255,255,0.10);">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td colspan="2" style="padding:0 0 12px 0;font-family:{{FONT_FAMILY}};font-size:12px;">
                  <a href="mailto:{{CONTACT_EMAIL}}" style="color:{{ACCENT}};text-decoration:none;font-weight:700;">{{CONTACT_EMAIL}}</a>
                  <span style="color:{{TEXT_DIM}};">&nbsp;&middot;&nbsp;</span>
                  <a href="tel:{{CONTACT_PHONE}}" style="color:{{TEXT_DIM}};text-decoration:none;">{{CONTACT_PHONE}}</a>
                </td>
              </tr>
              <tr>
                <td style="font-family:{{FONT_FAMILY}};font-size:10px;color:{{TEXT_DIM}};line-height:1.5;max-width:380px;">{{DISCLAIMER}}</td>
                <td align="right" valign="top"><a href="{{WEBSITE_URL}}" style="font-family:{{FONT_FAMILY}};font-size:11px;color:{{ACCENT}};text-decoration:none;font-weight:600;">{{WEBSITE_URL}}</a></td>
              </tr>
            </table>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>
```

- [ ] **Step 2: Confirm no hardcoded mockup data remains**

Run: `grep -nE "412K|587K|247K|Lehigh|Q3 Outlook|3.8 mo|842|Cautious optimism|polyline" templates/html/email/email-report.html`
Expected: no output (all fabricated sample data removed).

- [ ] **Step 3: Commit**

```bash
git add templates/html/email/email-report.html
git commit -m "feat(email): data-driven email-report.html (repeat blocks + DELTA slot, dark design kept)"
```

---

## Task 4: Rewrite `reportToEmailHtml` + dark delta block

**Files:**
- Modify: `lib/email/activation/render.ts`
- Test (existing, currently failing): `lib/email/activation/render.test.ts`

- [ ] **Step 1: Run the existing tests to confirm the 4 failures**

Run: `bun test lib/email/activation/render.test.ts`
Expected: FAIL — `quotes the freshness token once`, `renders a real delta block`, `no-change delta leads with re-verified`, `points the CTA at the gate` (4 fails); the other 4 pass.

- [ ] **Step 2: Update the color constants (dark palette) in `render.ts`**

Replace lines 31-33:

```ts
const GOOD = "#5bc97a"; // mangrove — favorable change (reads on the dark shell)
const BAD = "#e08158"; // coral — unfavorable change
const NEUTRAL = "#b8b4a8"; // warm dim — flat / unknown
```

- [ ] **Step 3: Dark-restyle the delta helpers**

Replace `metricChangeRow` (lines 73-86) and `deltaBlock` (lines 88-117) with dark-surface versions (same text content the tests assert; only styling + a `textPrimary` arg change):

```ts
function metricChangeRow(c: MetricChange): string {
  let color = NEUTRAL;
  if (c.favorable === true) color = GOOD;
  else if (c.favorable === false) color = BAD;

  let detail: string;
  if (c.direction === "appeared") detail = `now reported: ${formatChangeValue(c.to, c.unit)}`;
  else if (c.direction === "disappeared") detail = `no longer reported`;
  else {
    const arrow = c.direction === "up" ? "▲" : "▼";
    detail = `${formatChangeValue(c.from, c.unit)} → ${formatChangeValue(c.to, c.unit)} <span style="color:${color};">${arrow}</span>`;
  }
  return `<tr><td style="padding:4px 0;font-size:13px;color:#f0ede6;"><strong>${esc(c.label)}</strong></td><td align="right" style="padding:4px 0;font-size:13px;color:#f0ede6;">${detail}</td></tr>`;
}

function deltaBlock(delta: ReportDelta, accent: string): string {
  const surface = "rgba(255,255,255,0.06)";
  const since = tokenDate(delta.freshness_token_prev);
  const sincePhrase = since ? ` since ${esc(since)}` : "";

  if (!delta.has_change) {
    // No-change is first-class: lead with the moved freshness token, never a fake change.
    const reVerified = tokenDate(delta.freshness_token_current);
    return (
      `<div style="background-color:${surface};border-left:3px solid ${accent};padding:12px 16px;border-radius:4px;">` +
      `<p style="margin:0;font-size:13px;line-height:1.55;color:#f0ede6;">` +
      `<strong>Re-verified${reVerified ? ` ${esc(reVerified)}` : ""}.</strong> ` +
      `We re-pulled every figure for your area and nothing material moved this cycle — here's where it stands.` +
      `</p></div>`
    );
  }

  const rows: string[] = [];
  for (const c of delta.metric_changes) rows.push(metricChangeRow(c));
  const signals = delta.signal_changes
    .map((s) => `<li style="font-size:13px;line-height:1.55;margin:0 0 4px 0;color:#f0ede6;">New activity: <strong>${esc(s.label)}</strong></li>`)
    .join("");

  return (
    `<div style="background-color:${surface};border-left:3px solid ${accent};padding:14px 16px;border-radius:4px;">` +
    `<p style="margin:0 0 8px 0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:${accent};">What changed${sincePhrase}</p>` +
    (rows.length ? `<table width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join("")}</table>` : "") +
    (signals ? `<ul style="margin:8px 0 0 0;padding-left:18px;">${signals}</ul>` : "") +
    `</div>`
  );
}
```

- [ ] **Step 4: Delete the now-dead `metricsTable`**

Remove `metricsTable` entirely (lines 119-133) — the metrics now render via the template's `repeat:metrics` block.

- [ ] **Step 5: Rewrite `reportToEmailHtml` to supply tokens + repeats + delta**

Replace the whole `reportToEmailHtml` function (lines 139-207) with:

```ts
export async function reportToEmailHtml(
  report: AssembledReport,
  opts: RenderReportOptions = {},
): Promise<string> {
  const brand = opts.brand ?? null;
  const accent = brand?.accent || SWFL_TOKEN_DEFAULTS.ACCENT;
  const ctaUrl = opts.ctaUrl ?? "https://www.swfldatagulf.com/pricing";
  const origin = opts.siteOrigin ?? "https://www.swfldatagulf.com";

  const place = report.primaryPlace ?? `ZIP ${report.zip}`;
  const county = report.countyName ? `${report.countyName} County` : "Southwest Florida";

  // Hero = the first key figure, as a 0-or-1 repeat (empty metrics → no hero number).
  const hero = report.metrics.length
    ? [{ HERO_VALUE: esc(report.metrics[0].display), HERO_LABEL: esc(report.metrics[0].label) }]
    : [];

  const metrics = report.metrics.slice(0, MAX_METRIC_ROWS).map((m) => ({
    M_LABEL: esc(m.label),
    M_VALUE: esc(m.display),
  }));

  const reads = report.lines.slice(0, MAX_LINES).map((l) => ({
    READ_HTML: lineToHtml(l.text, accent),
  }));

  const tokens = {
    ...brandThemeToTokens(
      brand ? { primary: brand.primary ?? null, accent: brand.accent ?? null, logoUrl: brand.logoUrl ?? null } : null,
    ),
    ...(brand?.companyName ? { COMPANY_NAME: brand.companyName } : {}),
    PLACE: esc(place),
    COUNTY: esc(county),
    ZIP: esc(report.zip),
    FRESHNESS_TOKEN: report.freshness_token ? esc(report.freshness_token) : "",
    CTA_URL: esc(ctaUrl),
    REPORT_URL: esc(`${origin}/r/zip-report/${report.zip}`),
  };

  const delta = opts.delta ? deltaBlock(opts.delta, accent) : "";

  // Render the branded shell, THEN inject the unsubscribe token (email-only; the assert
  // in renderEmailTemplate would reject the inner {{RESEND_UNSUBSCRIBE_URL}} pre-render).
  const html = await renderEmailTemplate("report", tokens, { repeats: { hero, metrics, reads }, delta });
  return ensureUnsubscribeToken(html);
}
```

Note: coverage caveats (`report.coverage_caveats`) are no longer rendered inline. If any exist they are dropped from the email body (acceptable for this iteration — they were small print). If a later test requires them, add a `repeat:caveats` block; not in scope now.

- [ ] **Step 6: Typecheck + run the activation tests**

Run: `bunx tsc --noEmit && bun test lib/email/activation/render.test.ts`
Expected: tsc clean; **all 8 tests PASS** (the 4 previously-failing now green; `lineToHtml`, `tokenDate`, `esc`, `formatChangeValue` still in use).

- [ ] **Step 7: Commit**

```bash
git add lib/email/activation/render.ts
git commit -m "feat(email): reportToEmailHtml feeds real data via repeats; dark delta block; drop dead metricsTable"
```

---

## Task 5: Fix `renderCallout` test by single-source reference

**Files:**
- Modify: `lib/email/__tests__/components.test.ts`

- [ ] **Step 1: Run to confirm the failure**

Run: `bun test lib/email/__tests__/components.test.ts`
Expected: FAIL — `renderCallout > highlight uses the primary border` (test's `SWFL_PRIMARY = "#0F2035"` ≠ live `SWFL_THEME.primary = "#0f1d24"`).

- [ ] **Step 2: Reference the single source instead of a literal**

In `lib/email/__tests__/components.test.ts`, add an import after line 7:

```ts
import { SWFL_THEME } from "@/scripts/email/types";
```

Then replace line 13:

```ts
const SWFL_PRIMARY = SWFL_THEME.primary; // single-source: matches what callout-box emits
```

(Leave `SWFL_ACCENT`, `GREEN`, `RED` as-is — only `SWFL_PRIMARY` was stale. Per spec §6 this is navy-agnostic: it passes for whatever `SWFL_THEME.primary` holds.)

- [ ] **Step 3: Run to verify it passes**

Run: `bun test lib/email/__tests__/components.test.ts`
Expected: PASS (all `renderCallout` tests green).

- [ ] **Step 4: Commit**

```bash
git add lib/email/__tests__/components.test.ts
git commit -m "test(email): fix renderCallout highlight by referencing SWFL_THEME.primary (navy-agnostic)"
```

---

## Task 6: No-fabrication tripwire + full suite green

**Files:**
- Modify: `lib/email/activation/render.test.ts`

- [ ] **Step 1: Add the tripwire test**

Append inside the `describe("reportToEmailHtml", …)` block in `lib/email/activation/render.test.ts` (before the closing `});` at line 100):

```ts
  it("contains none of the mockup's fabricated literals (no-fabrication tripwire)", async () => {
    const html = await reportToEmailHtml(report());
    for (const literal of [
      "Median Price by ZIP",
      "33971 · Lehigh",
      "Q3 Outlook",
      "Cautious optimism heading into summer",
    ]) {
      expect(html).not.toContain(literal);
    }
  });
```

- [ ] **Step 2: Run the new test**

Run: `bun test lib/email/activation/render.test.ts -t "no-fabrication"`
Expected: PASS.

- [ ] **Step 3: Run the full email suite**

Run: `bun test lib/email lib/templates`
Expected: all PASS — 0 failures (the original 5 are now green, plus the new repeat + tripwire tests).

- [ ] **Step 4: Full typecheck + targeted regression**

Run: `bunx tsc --noEmit && bun test lib/email lib/templates`
Expected: tsc clean, all green.

- [ ] **Step 5: Commit**

```bash
git add lib/email/activation/render.test.ts
git commit -m "test(email): no-fabrication tripwire for the report email"
```

---

## Task 7: Open follow-up checks + SESSION_LOG (then STOP for operator push)

**Files:**
- Modify: `SESSION_LOG.md`

- [ ] **Step 1: Open the two parked checks**

Run:
```bash
node scripts/check.mjs open email-report email_report_multizip_revival "Revive email-report ZIP-comparison bars + sparkline" --detail "Needs real multi-ZIP price + per-ZIP time-series assembly; parked from the data-driven rebuild"
node scripts/check.mjs open email-report email_brand_navy_canonical "Rule on canonical brand navy" --detail "SWFL_THEME.primary is #0f1d24 live; confirm vs #0F2035. Does not block any test (callout test is by-reference)."
```
Expected: two checks created (`node scripts/check.mjs list` shows them).

- [ ] **Step 2: Add the SESSION_LOG entry (top of file)**

Add a new entry at the top of `SESSION_LOG.md` under the header:

```markdown
## 2026-06-16 (main) — feat(email): data-driven email-report.html (repeat-block, Route A)

- Restored the live activation email broken by 9f976f4 (static mockup, no body slot →
  fabricated data, no token/CTA). Repeat-block expansion added to renderHtmlTemplate
  (opt-in `repeats`, exported `expandRepeats`); renderEmailTemplate threads it + an
  always-replaced `[ DELTA ]` slot. email-report.html keeps masthead/footer, middle is
  now headline + repeat:hero + [ DELTA ] + repeat:metrics + repeat:reads + token + CTA.
  reportToEmailHtml feeds real data; delta block dark-restyled; dead metricsTable removed.
- renderCallout test fixed by referencing SWFL_THEME.primary (navy-agnostic). Parked the
  ZIP-comparison bars + Q3 outlook + sparkline (no single-ZIP data) behind two checks.
- All 5 prior failures green + new repeat + no-fabrication tripwire tests. Spec/plan:
  docs/superpowers/{specs,plans}/2026-06-16-email-report-data-driven*.
- Next: operator to confirm brand navy (email_brand_navy_canonical); push when approved.
```

- [ ] **Step 3: Commit the log + checks state**

```bash
git add SESSION_LOG.md
git commit -m "log(email): data-driven email-report rebuild"
```

- [ ] **Step 4: STOP — do not push**

Per operator policy (never push without explicit confirmation): present the commit list and the green `bun test lib/email lib/templates` output, and ask before `node scripts/safe-push.mjs`. The push will trigger CI (now green) and a Vercel redeploy.

---

## Self-Review

- **Spec coverage:** §1 renderer → Task 1; §2 wrapper → Task 2; §3 template → Task 3; §4 render.ts → Task 4; §5 unsubscribe invariant → preserved in Task 4 Step 5 (`ensureUnsubscribeToken` kept, not in template); §6 callout fix → Task 5; Testing (repeat, tripwire, 5 green) → Tasks 1/6; Parked checks → Task 7. All covered.
- **Placeholder scan:** none — every code step shows full code.
- **Type consistency:** `expandRepeats(html, repeats)` signature identical in Task 1 def and Task 2 usage; `repeats: { hero, metrics, reads }` keys match the template's `repeat:hero|metrics|reads`; per-row token names (`HERO_VALUE/HERO_LABEL`, `M_LABEL/M_VALUE`, `READ_HTML`) match between Task 3 template and Task 4 `render.ts`; tokens (`PLACE/COUNTY/ZIP/FRESHNESS_TOKEN/CTA_URL/REPORT_URL`) match template and render.ts; `deltaBlock(delta, accent)` signature matches its single call site.
