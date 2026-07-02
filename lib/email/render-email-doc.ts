// lib/email/render-email-doc.ts
//
// ONE root for EmailDoc → email HTML. Every surface that turns a saved
// block-canvas doc into sendable/previewable HTML (email-lab render route,
// deliverable blast route, scheduled-send runner) calls this — never the
// renderer pair directly — so the paid-grid branch can't silently diverge
// between preview and send (that divergence shipped: blast sent grid docs
// through the free stacker while preview compiled them).
//
// PAID grid path: any block carrying a `layout` → compile the positioned doc
// (Cerberus hybrid columns + Outlook ghost tables). Free tier (no `layout`)
// stays on the exact `render(EmailDocEmail(...))` call — byte-identical to
// the pre-extraction route line. Component called as a function (no JSX in
// server modules) — same proven pattern as scripts/email/build-digest.mts.

import { render } from "@react-email/render";
import { EmailDocEmail } from "./blocks/EmailDocRenderer";
import { isGridDoc } from "./grid-schema";
import { compileGrid } from "./compile-grid";
import type { EmailDoc } from "./doc/types";

export async function renderEmailDocHtml(doc: EmailDoc): Promise<string> {
  return isGridDoc(doc.blocks) ? compileGrid(doc) : render(EmailDocEmail({ doc }));
}
