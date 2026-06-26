import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { EmailDocSchema, ContentPatchSchema, type ContentPatch } from "@/lib/email/doc/schema";
import type { EmailDoc } from "@/lib/email/doc/types";
import { loadMarketFigures, figuresToPromptBlock } from "@/lib/email/market-context";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.swfldatagulf.com";

// claude-haiku-4-5 = 200K ctx / 64K out (verified crawl4ai 2026-06-24 → Anthropic
// docs). The old max_tokens:1024 was an artificial token-patch cap; a full-doc
// content fill + an AI "reading" paragraph fit easily.
const MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 4096;

// The Email Lab builder's data feed — EVERYTHING, every time. Two lanes, BOTH always:
//   1. The full Master dossier (`/api/b/master` tier-2 speak) — the synthesized read
//      over ALL reporters (real estate, permits, traffic, tourism, flood, labor,
//      safety, freight, FRED, the daily-moving figures). Region-wide by default,
//      tighter when a scope is given. This is the "information from everywhere."
//   2. The per-figure cited bundle (`loadMarketFigures`) — value · source · as-of for
//      the no-invention numbers the fill AI quotes verbatim at the broker's grain.
// No hand-picked slice, no scope gate. The builder sees the whole site and CHOOSES
// what to feature; if a lane is empty (no creds / no scope) the other still feeds it.
async function fetchMasterDossier(scope?: { kind?: string; value?: string }): Promise<string> {
  try {
    const params = new URLSearchParams({ view: "speak", tier: "2", v: "5" });
    if (scope?.kind === "zip" && scope.value) params.set("zip", scope.value);
    else if (scope?.kind === "county" && scope.value) params.set("county", scope.value);
    const res = await fetch(`${BASE_URL}/api/b/master?${params}`, { next: { revalidate: 3600 } });
    if (!res.ok) return "";
    return (await res.text()).slice(0, 12000);
  } catch {
    return "";
  }
}

async function fetchLakeContext(scope?: { kind?: string; value?: string }): Promise<string> {
  const [figs, dossier] = await Promise.all([
    loadMarketFigures(scope).catch(() => []),
    fetchMasterDossier(scope).catch(() => ""),
  ]);
  const parts: string[] = [];
  if (figs.length)
    parts.push(
      `CITED FIGURES (quote verbatim — value · source · as-of):\n${figuresToPromptBlock(figs)}`,
    );
  if (dossier)
    parts.push(`FULL SWFL MARKET DOSSIER (all site data — choose what's relevant):\n${dossier}`);
  return parts.join("\n\n");
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
    ? `\n\nREAL LAKE DATA (cite verbatim — value · source · as-of):\n${lakeContext}\n`
    : "";
  return `You are an email content writer for SWFL Data Gulf, a Southwest Florida real estate intelligence platform.

You receive an EmailDoc skeleton (block ids + current text) and real lake data. Return ONLY a JSON content patch — a flat object mapping block id → updated text fields. No markdown fences, no commentary outside the JSON object.${dataBlock}

Allowed text fields per block: kicker, value, label, prose, title, body, caption, alt, tagline, stats (array of {value, label}).

DATA SOURCING — four lanes, in order. NEVER leave a requested field empty because you "don't have the number":
1. LAKE DATA above — use verbatim (value · source · as-of).
2. User's uploaded doc or figure — if the user pasted a number in their request, use it exactly.
3. Internet / publicly known figure — use it; note the source inline (e.g. "per Realtor.com", "per Census Bureau").
4. Can't source it at all — write [Need: brief description of the exact figure] so the user can supply it.
ONLY block: an invented number with no real source. Build is NEVER blocked.

Block rules:
- Do NOT add, remove, or reorder blocks. Do NOT change block types.
- Only the allowed text fields — no colors, urls, logos, photos, company name, agent names, or brand settings.
- Only include block ids and fields you are actually changing.
- Tight prose, no jargon, no internal ids in the copy.
- If the request asks for something this canvas can't render (e.g. a live chart), express the data in the closest available blocks — stats for key numbers, text/body for a list. Always produce a valid patch; never error out.`;
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
  // Always feed the builder — region-wide dossier when no scope, scoped when present.
  const lakeContext = await fetchLakeContext(scope);

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
- Data sourcing — four lanes: (1) LAKE DATA above, verbatim; (2) user's uploaded doc or figure — use exactly what they gave; (3) widely known public figure with source inline (e.g. "per Realtor.com"); (4) write [Need: description] placeholder if you can't source it at all. Never invent. Never leave a field blank because you don't have it.
- Keep prose tight — no fluff
- Return only the tokens you're changing, not all of them`;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    prompt?: string;
    doc?: unknown;
    currentTokens?: Record<string, string>;
    scope?: { kind?: string; value?: string };
    // Informational label so callers (the materials refresh route) can pass mode:"refresh"
    // without it being an unknown field. No behavior change — ContentPatchSchema already
    // enforces content-only when a doc is present.
    mode?: string;
  };
  const prompt = body.prompt ?? "";

  // New block-canvas mode wins when a doc is present.
  if (body.doc !== undefined) {
    return handleContentPatch(prompt, body.doc, body.scope);
  }

  // ── Legacy token mode ──
  const lakeContext = await fetchLakeContext(body.scope);
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
