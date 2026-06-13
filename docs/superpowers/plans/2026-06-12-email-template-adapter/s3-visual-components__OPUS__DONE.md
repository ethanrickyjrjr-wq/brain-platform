# Section 3 — Visual Components
**Builder: Opus (3A/3B/3C) + Sonnet (3D smoke test)**
**Gate: BLOCKED — shells must be committed AND Section 2 Task 2A must be done**
**Output: `lib/email/templates/components/`**

---

## Sequential build order

**3A, 3B, and 3C all run in parallel** once 2A is done. 3D cannot start until 1C + 2C + 3A + 3B + 3C are all done.

```
(2A done) ─→  [3A] metric-card + stat-row  ─┐
               [3B] callout + badge          ├──→  [3D] smoke test (Sonnet)
               [3C] map-placeholder         ─┘
                                              ↑
                              also needs 1C + 2C done
```

---

## Task 3A — metric-card.ts + stat-row.ts (Opus)
**Runs in parallel with 3B and 3C**

### metric-card.ts

File: `lib/email/templates/components/metric-card.ts`

```typescript
export interface MetricDelta {
  value:     number;
  direction: 'up' | 'down' | 'flat';
  label:     string;
}

// Returns a self-contained <td> block, max 180px wide (3-up fits 600px email column)
// Direction arrow = inline SVG — no icon fonts
export function renderMetricCard(
  label:  string,
  value:  string,
  delta?: MetricDelta,
  theme?: { primary?: string; accent?: string },
): string
```

### stat-row.ts

File: `lib/email/templates/components/stat-row.ts`

```typescript
export interface StatItem {
  label: string;
  value: string;
  sub?:  string;
}

// Single-row HTML table, full 600px width
// Background: SURFACE token color
export function renderStatRow(stats: StatItem[]): string
```

---

## Task 3B — callout-box.ts + badge.ts (Opus)
**Runs in parallel with 3A and 3C**

### callout-box.ts

File: `lib/email/templates/components/callout-box.ts`

```typescript
export type CalloutType = 'info' | 'warn' | 'highlight';

// Left-border accent block (CSS border-left, inline style)
// info → accent color border
// warn → #F59E0B border
// highlight → primary color border
// No background images, no gradients — email-safe
export function renderCallout(type: CalloutType, text: string): string
```

### badge.ts

File: `lib/email/templates/components/badge.ts`

```typescript
// Inline <span> pill — inline border-radius style
// color defaults to ACCENT token
export function renderBadge(text: string, color?: string): string
```

---

## Task 3C — map-placeholder.ts (Opus)
**Runs in parallel with 3A and 3B**

File: `lib/email/templates/components/map-placeholder.ts`

```typescript
// If mapUrl: <img src="${mapUrl}" width="560" alt="Map">
// If empty: gray placeholder box 560×200 with centered "Map" text (pure HTML/CSS)
// Handles the {{MAP_URL}} token use case at component level for data-driven builds
export function renderMapPlaceholder(mapUrl?: string): string
```

---

## Task 3D — Integration Smoke Test (Sonnet)
**Cannot start until 1C + 2C + 3A + 3B + 3C are all done**

Build a fixture email combining all sections:
1. Pick a shell via `renderEmailTemplate('digest', brandThemeToTokens(testBrand), { chart: chartHtml, body: bodyHtml })`
2. `chartHtml` = `renderChart({ type: 'bar', data: [...] })`
3. `bodyHtml` = composed from `renderMetricCard()`, `renderStatRow()`, `renderCallout()`, `renderBadge()`

Assertions:
- No raw `{{TOKEN}}` strings in output
- No `<script>` tags
- No `<canvas>` tags
- `{{{RESEND_UNSUBSCRIBE_URL}}}` still present (not stripped by token replacement)
- All styles inline

Final step: POST rendered HTML to `/api/email/broadcast` with `send: false` — confirm draft appears in Resend dashboard.

---

## Component rules (apply to all of 3A/3B/3C)

- Inline styles only — no `<style>` blocks
- No external resources inside component output
- No JavaScript
- Each component returns a self-contained HTML string — composable, not dependent on each other
- Max 600px wide at the component level
