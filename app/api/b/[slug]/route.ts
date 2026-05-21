import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  parseBrainMarkdown,
  speak,
  type SpeakerTier,
} from "../../../../refinery/render/speaker.mts";

// Node runtime, not Edge: Edge isolates have no filesystem access, and Phase 0
// is a fetch-reliability test, not a latency test. Move to Edge in v2.
export const runtime = "nodejs";

// Never cache: Phase 0 tests cache-invalidation behavior explicitly.
export const dynamic = "force-dynamic";

const BRAINS_DIR = path.join(process.cwd(), "brains");

// Only lowercase alphanumerics and hyphens. Blocks path traversal (../, etc.).
const VALID_SLUG = /^[a-z0-9-]+$/;

const COMMON_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const url = new URL(request.url);
  const view = url.searchParams.get("view");
  const tierParam = url.searchParams.get("tier");
  console.log(
    `[brain-url] ${new Date().toISOString()} slug=${slug} view=${view ?? "raw"} tier=${tierParam ?? "-"}`,
  );

  if (!VALID_SLUG.test(slug)) {
    return Response.json(
      { error: "brain not found" },
      { status: 404, headers: COMMON_HEADERS },
    );
  }

  let content: string;
  try {
    content = await readFile(path.join(BRAINS_DIR, `${slug}.md`), "utf-8");
  } catch {
    return Response.json(
      { error: "brain not found" },
      { status: 404, headers: COMMON_HEADERS },
    );
  }

  if (view === "speak") {
    const tier = parseTier(tierParam);
    if (tier === null) {
      return Response.json(
        { error: "tier must be 1, 2, or 3" },
        { status: 400, headers: COMMON_HEADERS },
      );
    }
    try {
      const brain = parseBrainMarkdown(content);
      const spoken = speak(brain, { tier, origin: url.origin });
      return new Response(spoken, {
        status: 200,
        headers: {
          ...COMMON_HEADERS,
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    } catch (err) {
      return Response.json(
        { error: (err as Error).message },
        { status: 500, headers: COMMON_HEADERS },
      );
    }
  }

  return new Response(content, {
    status: 200,
    headers: {
      ...COMMON_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function parseTier(raw: string | null): SpeakerTier | null {
  if (raw === "1") return 1;
  if (raw === "2") return 2;
  if (raw === "3") return 3;
  return null;
}
