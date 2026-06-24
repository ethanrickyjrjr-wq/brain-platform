import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { EmailDocSchema, ContentPatchSchema, type ContentPatch } from "@/lib/email/doc/schema";
import type { EmailDoc } from "@/lib/email/doc/types";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.swfldatagulf.com";

// claude-haiku-4-5 = 200K ctx / 64K out (verified crawl4ai 2026-06-24 → Anthropic
// docs). The old max_tokens:1024 was an artificial token-patch cap; a full-doc
// content fill + an AI "reading" paragraph fit easily.
const MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 4096;

async function fetchLakeContext(scope?: { kind?: string; value?: string }): Promise<string> {
  try {
    const params = new URLSearchParams({ view: "speak", tier: "1", v: "5" });
    if (scope?.kind === "zip" && scope.value) params.set("zip", scope.value);
    else if (scope?.kind === "county" && scope.value) params.set("county", scope.value);
    const res = await fetch(`${BASE_URL}/api/b/master?${params}`, { next: { revalidate: 3600 } });
    if (!res.ok) return "";
    return (await res.text()).slice(0, 2000);
  } catch {
    return "";
  }
}

// ── Content-patch mode (block canvas) ───────────────────────────────────────
// The AI fills CONTENT into a fixed skeleton. It rewrites words and numbers, not
// the block graph, never colors/links/identity (ContentPatchSchema enforces this
// at parse time). No-invention moat: every SWFL number must come from LAKE DATA.

const TEXT_KEYS = ["kicker", "value", "label", "prose", "title", "body", "caption", "alt"] as const;

function docSkeleton(doc: EmailDoc): string {
  const lines = doc.blocks.map((b) => {
    const props = b.props as Record<string, unknown>;
    const text: Record<string, unknown> = {};
    for (const k of TEXT_KEYS) {
      if (props[k] !== undefined && props[k] !== "") text[k] = props[k];
    }
    if (b.type === "stats") text.stats = props.stats;
    return `  "${b.id}" (${b.type}): ${JSON.stringify(text)}`;
  });
  return lines.join("\n");
}

function contentPatchSystem(lakeContext: string): string {
  const dataBlock = lakeContext
    ? `\n\nREAL LAKE DATA (the ONLY source for SWFL numbers — never invent one):\n${lakeContext}\n`
    : "";
  return `You are an email content writer for SWFL Data Gulf, a Southwest Florida real estate intelligence platform.

You are given an EmailDoc skeleton (blocks with ids) and REAL LAKE DATA. Return ONLY a JSON object: a content patch mapping each changed block's id to its new text fields. No markdown, no commentary outside the JSON.${dataBlock}

Allowed text fields (per block): kicker, value, label, prose, title, body, caption, alt, and stats (an array of {value, label}).

Rules:
- Put real numbers from LAKE DATA into value / label / stats / body fields. NEVER invent a SWFL number — if the data isn't above, leave the field alone.
- Do NOT add, remove, or reorder blocks. Do NOT change block types.
- Do NOT emit colors, backgrounds, fonts, urls, logos, photos, company name, agent name/title, or phone — those are the user's brand settings, not yours to change. Only the allowed text fields above.
- Only include blocks and fields you are actually changing.
- Tight prose, no jargon, no internal ids in the copy.`;
}

function applyPatch(doc: EmailDoc, patch: ContentPatch): unknown {
  return {
    globalStyle: doc.globalStyle,
    blocks: doc.blocks.map((b) => {
      const p = patch[b.id];
      if (!p) return b;
      // Text-only overlay; EmailDocSchema re-parse strips any field a block type
      // doesn't accept (so a misaimed patch is a safe no-op, never a break).
      return { ...b, props: { ...(b.props as Record<string, unknown>), ...p } };
    }),
  };
}

/** Extract the first JSON object, parse it, and validate it as a content patch.
 *  Returns null on any failure (no match / malformed JSON / schema reject) so the
 *  caller can keep the current doc and surface a message — never render garbage. */
function tryParsePatch(text: string): ContentPatch | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const r = ContentPatchSchema.safeParse(obj);
  return r.success ? r.data : null;
}

async function handleContentPatch(
  prompt: string,
  rawDoc: unknown,
  scope?: { kind?: string; value?: string },
) {
  const docParsed = EmailDocSchema.safeParse(rawDoc);
  if (!docParsed.success) {
    return NextResponse.json({ error: "Invalid email document." }, { status: 400 });
  }
  const doc = docParsed.data;
  const lakeContext = scope ? await fetchLakeContext(scope) : "";

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: contentPatchSystem(lakeContext),
    messages: [
      {
        role: "user",
        content: `CURRENT DOC (block id → current text):\n${docSkeleton(doc)}\n\nUser request: ${prompt}`,
      },
    ],
  });

  const text = msg.content[0]?.type === "text" ? msg.content[0].text : "";
  const patch = tryParsePatch(text);

  if (!patch) {
    // Spec: keep the current doc, surface a message. Never render garbage.
    return NextResponse.json({
      doc,
      applied: false,
      message: "The AI returned an invalid response — try rephrasing.",
    });
  }

  const candidate = applyPatch(doc, patch);
  const reparsed = EmailDocSchema.safeParse(candidate);
  if (!reparsed.success) {
    return NextResponse.json({
      doc,
      applied: false,
      message: "The AI response didn't fit the layout — try rephrasing.",
    });
  }

  return NextResponse.json({ doc: reparsed.data, applied: true, patch });
}

// ── Legacy token mode (kept for the transition / structural templates) ───────

function legacyTokenSystem(lakeContext?: string): string {
  const dataBlock = lakeContext
    ? `\n\nREAL LAKE DATA (use these numbers — do not invent):\n${lakeContext}\n`
    : "";
  return `You are an email design assistant for SWFL Data Gulf, a Southwest Florida real estate intelligence platform.

The user will describe the email they want. Return ONLY a valid JSON object with updated token values — no markdown, no explanation.${dataBlock}

Available tokens: COMPANY_NAME, TAGLINE, WEBSITE_URL, CONTACT_EMAIL, HERO_KICKER, HERO_VALUE, HERO_LABEL, HERO_PROSE, STAT1_VALUE, STAT1_LABEL, STAT2_VALUE, STAT2_LABEL, STAT3_VALUE, STAT3_LABEL, SIGNAL_KICKER, SIGNAL_TITLE, SIGNAL_BODY.

Rules:
- ${lakeContext ? "Prefer the REAL LAKE DATA numbers above over anything invented" : "Use real-sounding SWFL data (Lee County, Collier County, Cape Coral, Fort Myers, Naples, etc.)"}
- Keep prose tight — no fluff
- Return only the tokens you're changing, not all of them`;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    prompt?: string;
    doc?: unknown;
    currentTokens?: Record<string, string>;
    scope?: { kind?: string; value?: string };
  };
  const prompt = body.prompt ?? "";

  // New block-canvas mode wins when a doc is present.
  if (body.doc !== undefined) {
    return handleContentPatch(prompt, body.doc, body.scope);
  }

  // ── Legacy token mode ──
  const lakeContext = body.scope ? await fetchLakeContext(body.scope) : "";
  const userMsg = body.currentTokens
    ? `Current values:\n${JSON.stringify(body.currentTokens, null, 2)}\n\nUser request: ${prompt}`
    : `User request: ${prompt}`;

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: legacyTokenSystem(lakeContext || undefined),
    messages: [{ role: "user", content: userMsg }],
  });

  const text = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
  let tokens: Record<string, string> = {};
  try {
    const m = text.match(/\{[\s\S]*\}/);
    tokens = m ? JSON.parse(m[0]) : {};
  } catch {
    // empty update on parse failure
  }
  return NextResponse.json({ tokens });
}
