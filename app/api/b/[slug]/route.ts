import {
  fetchBrain,
  buildDossier,
  readBrainMarkdown,
  parseTier,
  BrainNotFoundError,
  BrainBadTierError,
} from "@/lib/fetch-brain";
import { RULES_OF_ENGAGEMENT } from "@/refinery/lib/rules-of-engagement.mts";

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
      const { text, freshness_token, output } = await fetchBrain(slug, {
        tier,
        origin: url.origin,
      });
      // Opt-in structured envelope. Default stays plain text (backward compat
      // for anyone hitting this raw); `?format=json` adds the rules block +
      // dossier for a consuming Claude to reason over.
      if (url.searchParams.get("format") === "json") {
        return Response.json(
          {
            text,
            freshness_token,
            rules: RULES_OF_ENGAGEMENT,
            dossier: buildDossier(output, freshness_token),
          },
          { status: 200, headers: COMMON_HEADERS },
        );
      }
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
