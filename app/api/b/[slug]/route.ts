import {
  fetchBrain,
  readBrainMarkdown,
  parseTier,
  BrainNotFoundError,
  BrainBadTierError,
} from "@/lib/fetch-brain";

// Node runtime, not Edge: Edge isolates have no filesystem access, and Phase 0
// is a fetch-reliability test, not a latency test. Move to Edge in v2.
export const runtime = "nodejs";

// Never cache: Phase 0 tests cache-invalidation behavior explicitly.
export const dynamic = "force-dynamic";

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

  try {
    if (view === "speak") {
      const tier = parseTier(tierParam);
      const { text } = await fetchBrain(slug, { tier, origin: url.origin });
      return new Response(text, {
        status: 200,
        headers: {
          ...COMMON_HEADERS,
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    const content = await readBrainMarkdown(slug);
    return new Response(content, {
      status: 200,
      headers: {
        ...COMMON_HEADERS,
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch (err) {
    if (err instanceof BrainNotFoundError) {
      return Response.json(
        { error: "brain not found" },
        { status: 404, headers: COMMON_HEADERS },
      );
    }
    if (err instanceof BrainBadTierError) {
      return Response.json(
        { error: "tier must be 1, 2, or 3" },
        { status: 400, headers: COMMON_HEADERS },
      );
    }
    return Response.json(
      { error: (err as Error).message },
      { status: 500, headers: COMMON_HEADERS },
    );
  }
}
