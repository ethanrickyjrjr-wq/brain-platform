import { readFile } from "node:fs/promises";
import path from "node:path";

// Node runtime, not Edge: Edge isolates have no filesystem access. Same constraint
// as /api/b — this reads brains/_build-report.json off disk.
export const runtime = "nodejs";

// The build report changes on every nightly --resilient run; never cache.
export const dynamic = "force-dynamic";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
};

/**
 * Serve `brains/_build-report.json` — the resilient executor's per-run health
 * report (BuildReport from refinery/lib/resilient-build.mts). Read by the
 * swfldatagulf-ops LittleBird page to render build-status-aware health tiles.
 *
 * Read path mirrors the live /api/b route (lib/fetch-brain.ts): readFile from
 * `process.cwd()/brains` under the Node runtime. No auth — same public surface
 * as /api/b/*.
 *
 * NB: the nightly rebuild does not run with --resilient until Phase 7, so until
 * then the file is absent in prod and this returns the 404 not-yet-run body.
 */
export async function GET() {
  try {
    const raw = await readFile(
      path.join(process.cwd(), "brains", "_build-report.json"),
      "utf-8",
    );
    return new Response(raw, {
      status: 200,
      headers: {
        ...HEADERS,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch {
    return Response.json(
      {
        status: "not-yet-run",
        message:
          "No build report yet. The nightly rebuild runs --resilient from Phase 7.",
      },
      { status: 404, headers: HEADERS },
    );
  }
}
