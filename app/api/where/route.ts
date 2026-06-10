import { resolveLocation } from "@/refinery/lib/location-resolver.mts";
import { assembleLocationDossier, renderLocationDossierText } from "@/lib/zip-dossier";
import { parseTier, BrainBadTierError } from "@/lib/fetch-brain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMON_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  if (!q || !q.trim()) {
    return Response.json(
      { error: "missing required parameter: q" },
      { status: 400, headers: COMMON_HEADERS },
    );
  }

  let tier: 1 | 2 | 3 = 2;
  const tierParam = url.searchParams.get("tier");
  if (tierParam) {
    try {
      tier = parseTier(tierParam);
    } catch (err) {
      if (err instanceof BrainBadTierError) {
        return Response.json(
          { error: "tier must be 1, 2, or 3" },
          { status: 400, headers: COMMON_HEADERS },
        );
      }
      throw err;
    }
  }

  try {
    const loc = await resolveLocation(q.trim());
    const dossier = await assembleLocationDossier(loc, { origin: url.origin });

    if (url.searchParams.get("format") === "json") {
      return Response.json(
        {
          resolved_as: dossier.resolved_as,
          zip: dossier.zip,
          lines: dossier.lines,
          freshness_tokens: dossier.freshness_tokens,
          coverage_caveats: dossier.coverage_caveats,
        },
        { status: 200, headers: COMMON_HEADERS },
      );
    }

    const text = renderLocationDossierText(dossier, tier);
    return new Response(text, {
      status: 200,
      headers: { ...COMMON_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    return Response.json(
      { error: (err as Error).message },
      { status: 500, headers: COMMON_HEADERS },
    );
  }
}
