import fs from "node:fs/promises";
import path from "node:path";
import {
  CorridorRentChart,
  ZHVIAreaChart,
  CorridorMarketScatter,
} from "@/components/viz";
import { CORRIDOR_ALIASES } from "@/refinery/lib/corridor-aliases.mts";
import type {
  CorridorEntry,
  CorridorPermitsEntry,
  CorridorCentroidEntry,
  JoinedCorridorRow,
  ZHVIMonth,
  ZHVITrendEntry,
} from "@/types/viz";

export const dynamic = "force-static";
export const revalidate = 3600;

async function loadFixture<T>(name: string): Promise<T> {
  const file = path.join(process.cwd(), "fixtures", name);
  const raw = await fs.readFile(file, "utf-8");
  return JSON.parse(raw) as T;
}

async function loadFixtureOptional<T>(name: string): Promise<T | null> {
  try {
    return await loadFixture<T>(name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Single canonical join site for the three corridor fixtures. Walks the
 * alias table in `refinery/lib/corridor-aliases.mts` — never falls back to
 * fuzzy string matching. The alias-coverage test guarantees every rent row
 * has an explicit entry (string for Lee, null for Collier), so a row whose
 * alias resolves to `undefined` is a bug, not a no-coverage signal.
 *
 * `corridor-permits.json` is currently absent on disk because the live
 * `npm run refinery permits-swfl` run is blocked on Accela ingest (see the
 * TODO at the top of `brains/permits-swfl.md`). The viz components handle
 * `permits: null` as "no permits coverage" — same treatment Collier rows
 * get permanently. When Accela ships and the sidecar lands, all 16 Lee
 * rows light up automatically.
 */
function joinCorridors(
  rents: CorridorEntry[],
  permits: CorridorPermitsEntry[],
  centroids: CorridorCentroidEntry[],
): JoinedCorridorRow[] {
  const permitsById = new Map(permits.map((p) => [p.corridor_id, p]));
  const centroidsById = new Map(centroids.map((c) => [c.corridor_id, c]));
  return rents.map((row) => {
    const centroidId = CORRIDOR_ALIASES[row.id];
    const permitsEntry =
      centroidId == null ? null : (permitsById.get(centroidId) ?? null);
    const centroidEntry =
      centroidId == null ? null : (centroidsById.get(centroidId) ?? null);
    return {
      id: row.id,
      name: row.name,
      submarket: row.submarket,
      nnn_asking_rent_per_sqft: row.nnn_asking_rent_per_sqft,
      vacancy_pct: row.vacancy_pct,
      absorption_sqft: row.absorption_sqft,
      permits: permitsEntry,
      centroid: centroidEntry,
    };
  });
}

export default async function EmbedChartsPage() {
  const [zhviRaw, rents, permits, centroids] = await Promise.all([
    loadFixture<ZHVIMonth[]>("zhvi-trend.json"),
    loadFixture<CorridorEntry[]>("corridor-rents.json"),
    loadFixtureOptional<CorridorPermitsEntry[]>("corridor-permits.json"),
    loadFixture<CorridorCentroidEntry[]>("corridor-centroids.json"),
  ]);

  const zhvi: ZHVITrendEntry[] = zhviRaw.filter(
    (m): m is ZHVITrendEntry =>
      m.cape_coral != null && m.fort_myers != null && m.naples != null,
  );

  const joined = joinCorridors(rents, permits ?? [], centroids);
  const withPermits = joined.filter((r) => r.permits != null).length;
  const noCoverage = joined.length - withPermits;

  return (
    <main
      style={{
        background: "#0A1419",
        color: "#F0EDE6",
        minHeight: "100dvh",
        padding: "32px",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(480px, 1fr))",
          gap: "24px",
          maxWidth: "1280px",
          margin: "0 auto",
        }}
      >
        <section
          style={{
            background: "#152832",
            border: "1px solid #22414F",
            borderRadius: 12,
            padding: 24,
          }}
        >
          <header style={{ marginBottom: 16 }}>
            <h2
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 600,
                color: "#F0EDE6",
              }}
            >
              Home values across SWFL
            </h2>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 13,
                color: "#807E76",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              Zillow ZHVI · Cape Coral · Fort Myers · Naples
            </p>
          </header>
          <ZHVIAreaChart data={zhvi} loading={false} />
        </section>

        <section
          style={{
            background: "#152832",
            border: "1px solid #22414F",
            borderRadius: 12,
            padding: 24,
          }}
        >
          <header style={{ marginBottom: 16 }}>
            <h2
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 600,
                color: "#F0EDE6",
              }}
            >
              CRE corridor asking rents
            </h2>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 13,
                color: "#807E76",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              {joined.length} corridors · NNN $/sqft · click a bar for detail
            </p>
          </header>
          <CorridorRentChart data={joined} loading={false} />
        </section>

        <section
          style={{
            background: "#152832",
            border: "1px solid #22414F",
            borderRadius: 12,
            padding: 24,
            gridColumn: "1 / -1",
          }}
        >
          <header style={{ marginBottom: 16 }}>
            <h2
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 600,
                color: "#F0EDE6",
              }}
            >
              CRE corridor market scatter
            </h2>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 13,
                color: "#807E76",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              {withPermits} Lee corridors plotted · {noCoverage} Collier
              corridors hidden (no permits coverage — see docs/data-coverage.md)
            </p>
          </header>
          <CorridorMarketScatter data={joined} loading={false} />
        </section>
      </div>
    </main>
  );
}
