# Session 2026-06-06 — What Changed, What Broke, What Was Fixed

## 1. LOGO — What actually changed

### Landing page (`components/landing/Header.tsx`)

- **Untouched this session.** Already used `/logo.png` at 44×44 with `rounded-xl`.

### `/r/[slug]/page.tsx` (brain report pages e.g. `/r/master`)

- **Before:** Custom inline `WaveMark` SVG (teal wave lines, no logo image).
- **After:** `<Image src="/logo.png" width={28} height={28} className="h-7 w-7 rounded-lg" />` in header; `16×16 rounded` in footer.
- WaveMark function deleted.

### `/r/cre-swfl/[corridor]/page.tsx` (corridor report pages)

- **Before:** Same WaveMark SVG in header and footer.
- **After:** `logo.png` 28×28 header, 16×16 footer. WaveMark function deleted.

### `/r/zip-report/[zip]/page.tsx` (ZIP drill pages)

- **Before:** `logo.png` at 16×16 `h-4 w-4` (tiny, no border-radius).
- **After:** `logo.png` at 28×28 `h-7 w-7 rounded-lg` (consistent with other pages).

### `/r/source/[table]/page.tsx` (source provenance pages)

- **Before:** No logo, just `<p>Source provenance</p>` label.
- **After (wrong):** Added `logo.png` + "SWFL Data Gulf" — broke the page header.
- **Reverted (this fix):** Back to `<p>Source provenance</p>` only. Logo removed.

---

## 2. COLORS — Direction badge tokens

### Problem

All `/r/` pages used generic Tailwind color classes for direction badges:

- `bg-emerald-900/40 text-emerald-400` (bullish)
- `bg-rose-900/40 text-rose-400` (bearish)
- `bg-amber-900/40 text-amber-400` (mixed) ← looked brown/red on dark bg

### Fix

Replaced with gulf design system tokens from `globals.css`:

- Bullish: `bg-[#5bc97a]/10 text-[#5bc97a]` (mangrove green)
- Bearish: `bg-[#e08158]/10 text-[#e08158]` (sunset coral)
- Mixed: `bg-[#d4b370]/10 text-[#d4b370]` (neutral gold)

Applied in: `/r/[slug]`, `/r/cre-swfl/[corridor]`, `/r/zip-report/[zip]`.

---

## 3. SPEAKER LAYER — Conclusion and caveats

### Problem A: Raw brain slugs in master conclusion

`/r/master` conclusion listed raw IDs: `permits-swfl, housing-swfl, rsw-airport` etc.

**Fix:** Added 9 missing entries to `PACK_ID_LABELS` in `refinery/render/speaker.mts`:

- `permits-swfl` → "SWFL building permits"
- `rentals-swfl` → "SWFL rental market"
- `housing-swfl` → "SWFL housing market"
- `safety-swfl` → "SWFL public safety"
- `labor-demand-swfl` → "SWFL labor demand"
- `econ-dev-swfl` → "SWFL economic development"
- `city-pulse-swfl` → "SWFL city pulse"
- `rsw-airport` → "RSW airport activity"
- `news-swfl` → "SWFL news signals"

Also added to `PACK_DISPLAY_NAMES` (page `<h1>` titles).

### Problem B: Master conclusion dumps all 21 upstreams + metadata

Full text: "Read is mixed… Driven by: [21 items]. Overrides: flood-barrier-mode-1. Combined confidence 0.91, trust tier T3, based on 21 upstream brains."

**Fix:** Added `cleanConclusionText()` to speaker, applied in `toDisplayBrain`:

- Strips "Combined confidence … upstream brains." (already shown in badges)
- Strips "Overrides: …." (internal cascade key)
- Trims "Driven by:" list to top 5 + "and N more"

Also added `flood-barrier-mode-1` → "flood barrier" to `PACK_ID_LABELS`.

### Problem C: "Worth knowing" section flooded with QA caveats

`[config]`-stuffed lines like "All per-submarket MarketBeat [config] metrics ship direction=stable…" filling the top 8 display slots.

**Fix:** Added `isDisplayableCaveat()` filter in `toDisplayBrain`:

- Drops caveats containing "D-mapped areas"
- Drops caveats containing "verified corpus this run"
- Drops caveats still containing "[config]" after scrubbing

---

## 4. PAYWALL GATE — Sources section

### What was done

Replaced the "Full detail — every source and note" `<details>` expandable with a `SourcesGate` component across all report pages:

- Shows blurred skeleton rows (preview of locked content)
- "Members only" badge with lock icon
- "Get access to unlock sources" CTA → `/#waitlist`

Applied in:

- `/r/[slug]/page.tsx` — gates "Full detail" + removed "Raw data" footer link
- `/r/cre-swfl/[corridor]/page.tsx` — gates `WebCitations` sources section
- `/r/zip-report/[zip]/page.tsx` — removed raw `/api/b/*` footer links

**This is a soft gate (no auth enforcement).** The real bearer gate is the open check: `app/api/mcp/auth.ts` ($39-79 tier).

---

## 5. SOURCE TABLE — URL overflow (this fix)

### Problem

`/r/source/[table]` sample rows table: SOURCE_URL column contained long URLs (`https://floridarevenue.com/dataPortal/GTA/Form%203/F3FY2026.xlsx`) that blew the table width beyond the container even with `overflow-x-auto`.

### Fix

Added `max-w-[220px] break-all` to all `<td>` cells. Long URLs now wrap within the column instead of stretching the table.

---

## 6. THINGS NOT DONE / STILL BROKEN

- **MCP widget** — Vercel triangle showing instead of our logo in Claude.ai sidebar. The `mcp-widget/` has the built widget but the MCP server icon is not configured. Needs `icon_url` in the MCP server manifest.
- **City pulse LLM data** — not pulling through to the widget/MCP response.
- **Web citations not highlighted** — `[web-N]` references in brain output not rendered as clickable links on report pages.
- **"Outcome / Speculation / Facts" card structure** — the five-part card planned for the MCP App widget is not yet wired to the live `swfl_fetch` tool response.
- **Bearer gate** — `app/api/mcp/auth.ts` is still a no-op stub. The $39-79 paid tier is not enforced.
