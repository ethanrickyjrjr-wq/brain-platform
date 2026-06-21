# Branded Deliverable Templates + User Data Tokens — Future / Potential

Decided 2026-06-18 (Features 1–3 below). **Style Gallery folded in 2026-06-21 as POTENTIAL USE.** The through-line across all of these: **tokened skeletons we fill on the fly** — platform brand colors/logo today, user data + provenance tokens next. Build after Phase B (PDF extraction + contacts + blast) is live.

---

## Style Gallery — tokened deliverable skeletons · POTENTIAL USE (built, parked, NOT live)

**This IS the "tokened skeletons we create on the fly with brand colors" idea — already built, not shipped.** In-product gallery at `/project/[id]` (`StyleGallery.tsx`): Email / PDF / Website tabs, live iframe thumbnails, click-to-zoom, per-lane actions (Email → "Send to me", PDF → "Open as PDF", Website → "Build this style"). One brand-agnostic engine `renderHtmlTemplate(slug, tokens)` — `{{TOKEN}}` find-and-replace re-skins every template from the project's brand (primary/accent color + logo). Plumbing built + tested (12 green).

- **Why parked:** operator saw the render and said *"I can't ship this."* The gap is **visual quality, not architecture** — the skeletons ship generic finance-demo data (non-FL ZIPs, "$4.2M portfolio") so it reads like a bought template.
- **Saved off-machine (safe):** branch `wip/style-gallery-visual-polish` @ `f973dcf2`, committed AND on `origin` (`git fetch && git switch wip/style-gallery-visual-polish`). Full self-contained brief in that commit: `docs/superpowers/plans/2026-06-15-B2-style-gallery-visual-handoff.md`.
- **Reviving is NOT just polish:** the branch is **~288 commits behind `main`** and edits `app/project/[id]/ProjectDetail.tsx`, which `main` has since **deleted** (refactored into `ProjectWorkspace.tsx`, FINAL BOSS Piece 1). So: (1) reconcile with the current workspace code, THEN (2) the visual work — believable SWFL data instead of finance demo, readable thumbnails, a real logo lockup, premium chrome to match `templates/html/viz/*` + the brand kit (`docs/fiverr-briefs/assets/`).
- **Guardrails (don't break the system):** keep the `{{TOKEN}}` system (never hardcode brand colors/fonts/logo); email = inbox-safe (inline CSS, tables, ≤600px, no `<style>`/JS/external fonts); shells keep CAN-SPAM tokens (`{{{RESEND_UNSUBSCRIBE_URL}}}` + `{{PHYSICAL_ADDRESS}}`); docs keep `@media print`; keep `bun test lib/email/templates "app/project/[id]"` green; builds free, SEND is the only paywall; restyle only — don't touch the render pipeline / routes / data flow.
- **Trigger:** before any styled deliverable goes to a real broker/prospect — it has to look shippable first.

---

## Feature 1 — PDF as a Visual Template

A broker has a branded offering memo or market report layout they use repeatedly.
Goal: keep the visual design, swap in new property data for each deal/client.

What it requires:
- PDF editing library (pymupdf/reportlab) to modify fields inside a PDF
- A way for the user to mark which parts of the PDF are "variable" (the price, the address, the cap rate)
- A mapping UI: "this field in the PDF = this data from the project"
- Render a new PDF with the variables filled from the project's items

Trigger to build: when brokers ask "can I use my flyer template" more than once.

---

## Feature 2 — User-Level Document Library

Currently a PDF uploaded to Project A can't be used in Project B without re-uploading.
Goal: upload once to a personal library, reference it in any project.

What it requires:
- `documents` table at user level (not project level)
- UI to manage the library (upload, label, delete)
- A "Add from library" option in the project workspace alongside "Upload new"
- Extracted text cached once on the document, shared across all projects that reference it

---

## Feature 3 — User Data Token Document

The platform's brain outputs carry freshness tokens that certify "this data was accurate at this moment."
Goal: extend that same provenance guarantee to USER-provided data.

Example: A broker enters their property's rent roll, NOI, asking price, vacancy rate.
The platform stamps it: "Seller data certified June 18 2026 — token USRDAT-{id}-20260618"
Any deliverable built from it cites that token. The investor receiving the email knows exactly when the seller's numbers were captured.

What it requires:
- A "User Data Card" entity — structured fields the user fills in (or extracted from a PDF)
- Freshness token generation at save time (same pattern as brain freshness tokens)
- Integration into the deliverable build system as a first-class source type
- Display in the deliverable: cited like any other source, with the token and capture date

Why it matters:
This is the moat applied to user data. The platform doesn't just cite its own lake — it certifies the seller's/broker's own numbers with the same rigor. That's a real differentiator for investor-facing deliverables.

Trigger to build: when a user asks "can I make my numbers official" or wants to send a deliverable where their own data needs to be cited.
