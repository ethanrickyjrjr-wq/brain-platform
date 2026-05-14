import { readFile } from "node:fs/promises";
import path from "node:path";

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
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  console.log(`[brain-url] ${new Date().toISOString()} slug=${slug}`);

  if (!VALID_SLUG.test(slug)) {
    return Response.json(
      { error: "brain not found" },
      { status: 404, headers: COMMON_HEADERS },
    );
  }

  try {
    const content = await readFile(
      path.join(BRAINS_DIR, `${slug}.md`),
      "utf-8",
    );
    return new Response(content, {
      status: 200,
      headers: {
        ...COMMON_HEADERS,
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch {
    return Response.json(
      { error: "brain not found" },
      { status: 404, headers: COMMON_HEADERS },
    );
  }
}
