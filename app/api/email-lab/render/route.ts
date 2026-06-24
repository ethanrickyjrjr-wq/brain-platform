import { NextRequest, NextResponse } from "next/server";
import { render } from "@react-email/render";
import { renderHtmlTemplate } from "@/lib/templates/render-html-template";
import { SWFL_TOKEN_DEFAULTS } from "@/lib/email/templates/token-defaults";
import { EmailDocSchema } from "@/lib/email/doc/schema";
import { EmailDocEmail } from "@/lib/email/blocks/EmailDocRenderer";

// Two render paths share this URL during (and after) the block-canvas
// transition (spec → Modified files):
//   • { doc: EmailDoc }        → block canvas: validate, then render() to HTML.
//   • { template, tokens }     → legacy token path, kept for the 5 structural
//                                templates (shell-two-col, compare, hbar, …).
export async function POST(req: NextRequest) {
  const body = (await req.json()) as
    | { doc?: unknown }
    | { template?: string; tokens?: Record<string, string> };

  // ── Block-canvas path ─────────────────────────────────────────────────────
  if (body && typeof body === "object" && "doc" in body && body.doc !== undefined) {
    const parsed = EmailDocSchema.safeParse(body.doc);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid email document.", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    // Call the component as a function (no JSX in a route handler) — same proven
    // pattern as scripts/email/build-digest.mts.
    const html = await render(EmailDocEmail({ doc: parsed.data }));
    return NextResponse.json({ html });
  }

  // ── Legacy token path ─────────────────────────────────────────────────────
  const { template = "email/email-hero", tokens = {} } = body as {
    template?: string;
    tokens?: Record<string, string>;
  };
  const merged = { ...SWFL_TOKEN_DEFAULTS, ...tokens };
  const html = await renderHtmlTemplate(template, merged);
  return NextResponse.json({ html });
}
