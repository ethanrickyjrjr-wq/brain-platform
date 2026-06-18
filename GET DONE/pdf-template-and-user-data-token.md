# PDF Templates + User Data Token Documents — Future

Decided 2026-06-18. Two related but distinct features. Build after Phase B (PDF extraction + contacts + blast) is live.

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
