import { NextRequest, NextResponse } from "next/server";
import { renderHtmlTemplate } from "@/lib/templates/render-html-template";
import { SWFL_TOKEN_DEFAULTS } from "@/lib/email/templates/token-defaults";
import { EmailDocSchema } from "@/lib/email/doc/schema";
import { renderEmailDocHtml } from "@/lib/email/render-email-doc";
import { lintCompiledHtml, collectAllowedUrls } from "@/lib/deliverable/url-lint";

// Two render paths share this URL during (and after) the block-canvas
// transition (spec → Modified files):
//   • { doc: EmailDoc }        → block canvas: validate, then render() to HTML.
//   • { template, tokens }     → legacy token path, kept for the 5 structural
//                                templates (shell-two-col, compare, hbar, …).
export async function POST(req: NextRequest) {
  const body = (await req.json()) as
    { doc?: unknown } | { template?: string; tokens?: Record<string, string> };

  // ── Block-canvas path ─────────────────────────────────────────────────────
  if (body && typeof body === "object" && "doc" in body && body.doc !== undefined) {
    const parsed = EmailDocSchema.safeParse(body.doc);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid email document.", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    // The ONE EmailDoc→HTML root: paid grid docs (any block with `layout`)
    // compile; free docs stay byte-identical on render(EmailDocEmail(...)).
    // Shared with the blast route and the scheduled runner so preview and
    // send can't diverge.
    const html = await renderEmailDocHtml(parsed.data);
    // Fake-link tripwire (invention-surface-guards §C, interactive = strip +
    // warn, never block an edit).
    const urlGate = lintCompiledHtml(html, collectAllowedUrls(parsed.data));
    return NextResponse.json({
      html: urlGate.stripped,
      ...(urlGate.ok ? {} : { url_warnings: urlGate.violations }),
    });
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
