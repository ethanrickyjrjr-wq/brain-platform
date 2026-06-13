import { getAnthropic, TRIAGE_MODEL } from "@/refinery/agents/anthropic.mts";
import { recordWelcomeChat } from "@/lib/welcome/chat-usage";
import { PLACE_ZIP_CROSSWALK, type PlaceZipEntry } from "@/refinery/lib/geography-gazetteer.mts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TOKENS = 500;
const MAX_HISTORY = 12;

const FORMAT_RULE =
  "CRITICAL: Respond in plain text ONLY. " +
  "NEVER use markdown — no asterisks (* or **), no # headers, no - bullet lists, no backticks (`), no > blockquotes. " +
  "Plain prose sentences only. If you use any markdown symbol the answer will be unreadable to the user.\n\n";

export const WELCOME_SYSTEM =
  "You are the assistant for SWFL Data Gulf — live, cited intelligence on Southwest Florida " +
  "(Lee, Collier, Charlotte, Glades, Hendry, Sarasota) real estate, building permits, flood risk, " +
  "freight, tourism, and the local economy, down to the ZIP and named-place level. You are talking to a " +
  "visitor who hasn't signed up yet. Explain plainly what the platform can do and how it would help their " +
  "work. Speak in illustrative ranges, never specific current statistics — for example, beachfront and " +
  "barrier-island ZIPs carry the region's steepest flood-loss estimates while inland corridors are far " +
  "lower; never a precise dollar figure. You do NOT have live data in this conversation. If asked for a " +
  "specific number (a flood loss, a sale price, a rate), do NOT make one up and do NOT guess — say that's " +
  'exactly what a project builds (a cited, branded one-pager) and steer them to sign up: "sign up and you ' +
  'can build it". Inventing a Southwest Florida number is the one thing you must never do. Be a ' +
  'knowledgeable, direct local expert, not a salesperson, and never use internal jargon (no "master", ' +
  '"brain", "payload", "grain", "dossier").';

// --- Deterministic ZIP/place ground truth (built ONCE at import, no per-request I/O) ---
// Source of record: fixtures/swfl-place-zip-crosswalk.json via the gazetteer. This
// surface is un-grounded (no lake fetch), so the model otherwise resolves ZIP->place
// from its own weights and gets it wrong (it glossed 33931 as Lehigh Acres; 33931 is
// Fort Myers Beach). Place identity is a lookup, not speculation — inject the verified
// mapping the visitor referenced so even un-grounded chat names the place correctly.

/** Lowercase, fold punctuation to single spaces — aligns the scan text with the needles. */
function flatten(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ZIP -> entry. Primary/dedicated codes win; alt ZIPs fill in only if unclaimed
// (33913 is Gateway's dedicated code, even though Fort Myers lists it as an alt).
const ZIP_TO_ENTRY = new Map<string, PlaceZipEntry>();
for (const entry of PLACE_ZIP_CROSSWALK.entries) ZIP_TO_ENTRY.set(entry.zip, entry);
for (const entry of PLACE_ZIP_CROSSWALK.entries)
  for (const alt of entry.alt_zips) if (!ZIP_TO_ENTRY.has(alt)) ZIP_TO_ENTRY.set(alt, entry);

// Place name + every alias -> entry, longest needle first so "fort myers beach"
// wins over "fort myers" and we consume the matched span before testing shorter ones.
const ALIAS_NEEDLES: { needle: string; entry: PlaceZipEntry }[] = PLACE_ZIP_CROSSWALK.entries
  .flatMap((entry) =>
    [entry.place, ...entry.aliases].map((name) => ({ needle: flatten(name), entry })),
  )
  .filter((n) => n.needle.length > 0)
  .sort((a, b) => b.needle.length - a.needle.length);

const COUNTY_LABEL: Record<string, string> = { lee: "Lee", collier: "Collier" };

/**
 * Scan the visitor's message for any SWFL ZIP (primary or alt) or known place
 * alias and return a sourced GROUND-TRUTH system prefix naming the correct
 * ZIP<->place identities. Returns "" when nothing SWFL is referenced — un-grounded
 * stays un-grounded; we never fabricate an identity for a ZIP we don't hold.
 */
export function buildPlaceContext(message: string): string {
  if (!message) return "";

  // Keyed by place name so a ZIP hit and an alias hit for the same town dedupe.
  const lines = new Map<string, string>();

  // 1. ZIP scan — only 5-digit tokens that map to a crosswalk ZIP.
  for (const zip of message.match(/\b\d{5}\b/g) ?? []) {
    const entry = ZIP_TO_ENTRY.get(zip);
    if (entry && !lines.has(entry.place))
      lines.set(entry.place, `ZIP ${zip} = ${entry.place}, ${COUNTY_LABEL[entry.county]} County.`);
  }

  // 2. Place name / alias scan — word boundaries via space padding, longest first,
  //    consuming matched spans so "fort myers" can't re-fire inside "fort myers beach".
  let scan = ` ${flatten(message)} `;
  for (const { needle, entry } of ALIAS_NEEDLES) {
    const padded = ` ${needle} `;
    if (!scan.includes(padded)) continue;
    if (!lines.has(entry.place))
      lines.set(
        entry.place,
        `${entry.place} = primary ZIP ${entry.zip}, ${COUNTY_LABEL[entry.county]} County.`,
      );
    scan = scan.split(padded).join("  ");
  }

  if (lines.size === 0) return "";

  return (
    "GROUND TRUTH — the visitor's message names these Southwest Florida places. These " +
    "ZIP-to-place identities are sourced (USPS ZIP Code Lookup; U.S. Census 2024 ZCTA), are " +
    "fact you already hold (not something to fetch), and must never be reassigned to the wrong town:\n" +
    [...lines.values()].map((l) => `- ${l}`).join("\n") +
    "\n\n"
  );
}

/**
 * Yield text from the SDK MessageStream. Copied verbatim from
 * app/api/converse/route.ts:27-51 (SDK v0.69.0 has no .textStream on the real
 * stream; mocks/future SDKs may — check it first).
 */
async function* extractText(
  ai: AsyncIterable<unknown> & { textStream?: AsyncIterable<string> },
): AsyncIterable<string> {
  if (ai.textStream) {
    yield* ai.textStream;
    return;
  }
  for await (const event of ai) {
    const e = event as { type?: string; delta?: { type?: string; text?: string } };
    if (
      e.type === "content_block_delta" &&
      e.delta?.type === "text_delta" &&
      typeof e.delta.text === "string"
    ) {
      yield e.delta.text;
    }
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: { messages?: { role?: string; content?: string }[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const all = Array.isArray(body.messages) ? body.messages : [];
  const messages = all
    .filter(
      (m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"),
    )
    .slice(-MAX_HISTORY) as { role: "user" | "assistant"; content: string }[];

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return Response.json({ error: "messages required (last must be user)" }, { status: 400 });
  }

  // Fire-and-forget telemetry — zero enforcement.
  void recordWelcomeChat(request, messages.length);

  // Last message is guaranteed role "user" (checked above). Prepend deterministic
  // ZIP->place ground truth for any SWFL place it names — no-op for everything else.
  const lastUser = messages[messages.length - 1].content;
  const system = buildPlaceContext(lastUser) + FORMAT_RULE + WELCOME_SYSTEM;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const client = getAnthropic();
        const ai = client.messages.stream({
          model: TRIAGE_MODEL, // claude-haiku-4-5
          max_tokens: MAX_TOKENS,
          system,
          messages,
        });
        for await (const text of extractText(ai)) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
      } catch (e) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: (e as Error).message })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}
