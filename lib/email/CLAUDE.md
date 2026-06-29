# lib/email/ — email & deliverable conventions (loads when you edit here)

- **Social platforms have ONE root:** `lib/email/social/platforms.ts` (8 platforms). The footer, the
  social-icons block, the icons, `applyBrand`, the brand form, and the PDF all read it — change it there,
  not in copies. Custom icons = keyless favicon → globe fallback. **No paid logo vendor** (Logo.dev was
  killed — don't re-propose).
- **Outlook reality:** SVG icons render as text in Outlook — use the established fallback, don't ship raw SVG.
- **Charts in deliverables** go through `buildChartForQuestion` (`lib/email/build-doc.ts`). Every plotted
  number is REAL (held brain / live-web-cited / upload-verified / user-stated) — the model selects points,
  never writes a number. If a shape isn't built, offer bar/table — never "can't chart it".
- **CAN-SPAM = 3 real requirements:** a working opt-out, accurate headers, no misleading subject. That's
  it — don't re-add a compliance lecture.
- **Layout:** use `h-full` / `dvh`, never `h-screen`.
- **Send is the paywall, builds are free** — watermark only; no build gate, no Stripe on creation.
- **Email Lab tier DIAL has ONE root:** `lib/email/lab/capabilities.ts`. Every feature + every font
  declares ONE target — `"free-only"` / `"both"` / `"paid-only"` — in `FEATURE_ROUTING` /
  `FONT_ROUTING`. The free/paid capability sets are DERIVED from those (not hand-maintained), and
  `capabilities.test.ts` enforces each thing lands exactly where it was routed (paid-only never
  leaks to free, paid never silently downgraded). Want a thing in paid? Route it `"paid-only"`.
  Everywhere? `"both"`. Free only? `"free-only"`. Never hardcode a tier difference in a shell or a
  shared component — read `capabilitiesFor(tier)` / `fontsFor(tier)`. (`FontFamily` is a keyed
  `Record`, so adding a font FORCES you to route it.)
