"""One-shot script: writes city-matrix.ts + cities page to swfldatagulf-ops."""
import os

OPS = r"C:\Users\ethan\dev\swfldatagulf-ops"

# ─── lib/city-matrix.ts ──────────────────────────────────────────────────────
MATRIX = r"""/**
 * city-matrix.ts — SWFL city x data-stream parity matrix.
 *
 * RULE: update this file whenever a cell changes. Bump MATRIX_AUDITED every
 * time. Stale cells are worse than no cells.
 *
 * Last audited: 2026-06-07 (geocoding complete — all Lee cities live)
 */

export const MATRIX_AUDITED = "2026-06-07";

export type CellStatus = "live" | "partial" | "gap" | "na";

export interface Column {
  key: string;
  label: string;
  sub: string;
}

export interface CityRow {
  slug: string;
  city: string;
  county: "Lee" | "Collier";
  parent?: string;
  zips: string[];
  corridorCount: number;
  cols: Record<string, CellStatus>;
  needs: string[];
}

export const COLUMNS: Column[] = [
  { key: "city_pulse", label: "City Pulse",  sub: "Daily news signals" },
  { key: "permits",    label: "Permits",      sub: "Bldg permits in lake" },
  { key: "perm_geo",   label: "Geocoded",     sub: "lat/lon → corridor z-scores" },
  { key: "corridors",  label: "Corridors",    sub: "# in corridor_profiles" },
  { key: "corr_voice", label: "Voice",        sub: "character_facts written" },
  { key: "properties", label: "Properties",   sub: "Parcel / appraiser" },
  { key: "cre_broker", label: "CRE Broker",   sub: "MarketBeat / MHS quarterly" },
  { key: "rentals",    label: "Rentals",      sub: "ZORI ZIP rent index" },
  { key: "flood_aal",  label: "Flood / AAL",  sub: "NFIP avg annual loss" },
  { key: "traffic",    label: "Traffic",      sub: "FDOT AADT road counts" },
  { key: "safety",     label: "Safety",       sub: "FBI CDE NIBRS" },
  { key: "labor",      label: "Labor",        sub: "BLS LAUS + OEWS" },
  { key: "fhfa_hpi",   label: "FHFA HPI",     sub: "Home price index" },
];

// LEE_GEO_GAP — RESOLVED 2026-06-07: 117/118 permits geocoded (Census batch + Mapbox fallback);
// 13 corridor IDs assigned across 5 Lee corridors. lehigh_permit_geocode check closed.

export const CITIES: CityRow[] = [
  // --- Lee County ---
  {
    slug: "fort-myers", city: "Fort Myers", county: "Lee",
    zips: ["33901","33907","33908","33912","33919"], corridorCount: 7,
    cols: {
      city_pulse:"live", permits:"live",   perm_geo:"live",
      corridors:"live",  corr_voice:"live",properties:"live",
      cre_broker:"live", rentals:"live",   flood_aal:"partial",
      traffic:"live",    safety:"partial", labor:"partial", fhfa_hpi:"partial",
    },
    needs: [
      "Flood/AAL partial: 33901 downtown is coastal-mainland (0.5). Most Fort Myers ZIPs are inland — correct, not a gap.",
      "Safety / Labor / FHFA: county-level only — city-level disaggregation not available from source.",
    ],
  },
  {
    slug: "cape-coral", city: "Cape Coral", county: "Lee",
    zips: ["33904","33909","33914","33990","33991","33993"], corridorCount: 3,
    cols: {
      city_pulse:"live", permits:"live",   perm_geo:"live",
      corridors:"live",  corr_voice:"live",properties:"live",
      cre_broker:"live", rentals:"live",   flood_aal:"partial",
      traffic:"live",    safety:"partial", labor:"partial", fhfa_hpi:"live",
    },
    needs: [
      "Flood/AAL partial: 33914 SW Cape Coral is coastal-mainland; east ZIPs are inland. Partial is correct.",
      "FHFA HPI live as Cape Coral-Fort Myers MSA (fhfa_cape_coral_msa_yoy_pct).",
    ],
  },
  {
    slug: "bonita-springs", city: "Bonita Springs", county: "Lee",
    zips: ["34134","34135"], corridorCount: 2,
    cols: {
      city_pulse:"live", permits:"live",   perm_geo:"live",
      corridors:"live",  corr_voice:"live",properties:"live",
      cre_broker:"live", rentals:"live",   flood_aal:"partial",
      traffic:"live",    safety:"partial", labor:"partial", fhfa_hpi:"partial",
    },
    needs: [
      "Flood/AAL partial: 34134 Bonita Beach is coastal-mainland (0.5). Inland Bonita is correctly excluded.",
    ],
  },
  {
    slug: "estero", city: "Estero", county: "Lee",
    zips: ["33928"], corridorCount: 3,
    cols: {
      city_pulse:"live", permits:"live",   perm_geo:"live",
      corridors:"live",  corr_voice:"live",properties:"live",
      cre_broker:"gap",  rentals:"live",   flood_aal:"na",
      traffic:"live",    safety:"partial", labor:"partial", fhfa_hpi:"partial",
    },
    needs: [
      "CRE Broker: MarketBeat publishes zero rows for Estero submarket (documented). 3 corridors exist but all have NULL metrics. Source: boutique broker data or LoopNet/Crexi active listings on Ben Hill Griffin Pkwy / Coconut Point Mall.",
    ],
  },
  {
    slug: "fort-myers-beach", city: "Fort Myers Beach", county: "Lee",
    zips: ["33931"], corridorCount: 1,
    cols: {
      city_pulse:"live", permits:"live",   perm_geo:"live",
      corridors:"live",  corr_voice:"live",properties:"live",
      cre_broker:"gap",  rentals:"live",   flood_aal:"live",
      traffic:"live",    safety:"partial", labor:"partial", fhfa_hpi:"partial",
    },
    needs: [
      "CRE Broker: MarketBeat zero rows for FMB submarket (documented). Post-Ian rebuild is the story. LoopNet active listings on Estero Blvd is best available source.",
    ],
  },
  {
    slug: "sanibel", city: "Sanibel", county: "Lee",
    zips: ["33957"], corridorCount: 0,
    cols: {
      city_pulse:"gap",  permits:"live",   perm_geo:"live",
      corridors:"na",    corr_voice:"na",  properties:"live",
      cre_broker:"gap",  rentals:"live",   flood_aal:"live",
      traffic:"live",    safety:"partial", labor:"partial", fhfa_hpi:"partial",
    },
    needs: [
      "City Pulse: not in the 7-city list. Post-Ian recovery story is notable. Add to city_pulse/pipeline.py CITIES list if operator wants daily coverage.",
      "CRE Broker: The Islands submarket is registered but returns zero MarketBeat rows. Sanibel commercial is minimal — narrative-only is the right answer.",
      "No corridors defined. Estero Blvd Sanibel is a future candidate.",
    ],
  },
  {
    slug: "lehigh-acres", city: "Lehigh Acres", county: "Lee",
    zips: ["33936","33971","33972","33973","33974","33976"], corridorCount: 2,
    cols: {
      city_pulse:"live", permits:"live",    perm_geo:"live",
      corridors:"live",  corr_voice:"gap",  properties:"live",
      cre_broker:"gap",  rentals:"partial", flood_aal:"na",
      traffic:"live",    safety:"partial",  labor:"partial", fhfa_hpi:"partial",
    },
    needs: [
      "Geocoding DONE 2026-06-07: 29 Lehigh-ZIP permits now geocoded; Lee Blvd + Joel Blvd corridor IDs assigned where within 1.5mi.",
      "Corridor Voice: both corridors have NULL character_facts + character_speculative. Run corridor_grounded/pipeline.py → run-corridor-character-preview.mts → write-corridor-character-to-db.mts. Check open: lehigh_broker_narrative.",
      "CRE Broker: no MarketBeat/MHS coverage by design — Lehigh has minimal commercial inventory. MSA-level data only → narrative, never to corridor metric columns. Check open: lehigh_cre_metrics.",
      "Rentals partial: ZORI has 94 SWFL ZIPs — verify all 6 Lehigh ZIPs included. Query: SELECT zip_code FROM data_lake.zori_zip_rents WHERE zip_code IN ('33936','33971','33972','33973','33974','33976') GROUP BY 1.",
      "Flood/AAL N/A: inland — correctly out of NFIP coastal AAL set. This is the right answer.",
    ],
  },
  {
    slug: "north-fort-myers", city: "North Fort Myers", county: "Lee",
    parent: "Fort Myers",
    zips: ["33903","33917"], corridorCount: 0,
    cols: {
      city_pulse:"gap",  permits:"live",   perm_geo:"live",
      corridors:"na",    corr_voice:"na",  properties:"live",
      cre_broker:"gap",  rentals:"live",   flood_aal:"na",
      traffic:"live",    safety:"partial", labor:"partial", fhfa_hpi:"partial",
    },
    needs: [
      "City Pulse: not in 7-city list. Sub-area of Fort Myers — lower priority.",
      "CRE Broker + Corridors: no corridors defined, no MarketBeat coverage. US-41 North Fort Myers is a future corridor candidate.",
    ],
  },

  // --- Collier County ---
  {
    slug: "naples", city: "Naples", county: "Collier",
    zips: ["34102","34103","34105","34108","34109","34110","34112"], corridorCount: 9,
    cols: {
      city_pulse:"live", permits:"live",   perm_geo:"live",
      corridors:"live",  corr_voice:"live",properties:"live",
      cre_broker:"live", rentals:"live",   flood_aal:"partial",
      traffic:"live",    safety:"partial", labor:"partial", fhfa_hpi:"gap",
    },
    needs: [
      "FHFA HPI: only Cape Coral-Fort Myers MSA is in the lake. Naples-Marco Island MSA HPI is NOT ingested. Source: FRED series ATNHPIUS34940Q. Wire via existing FHFA/FRED pipeline.",
      "Flood/AAL partial: 34102 coastal Naples is coastal-mainland. Most Naples ZIPs are inland — partial is correct.",
    ],
  },
  {
    slug: "marco-island", city: "Marco Island", county: "Collier",
    zips: ["34145"], corridorCount: 0,
    cols: {
      city_pulse:"gap",    permits:"live",    perm_geo:"live",
      corridors:"na",      corr_voice:"na",   properties:"live",
      cre_broker:"partial",rentals:"live",    flood_aal:"live",
      traffic:"live",      safety:"partial",  labor:"partial", fhfa_hpi:"gap",
    },
    needs: [
      "City Pulse: not in 7-city list. High-value barrier island market — consider adding.",
      "CRE Broker partial: no Marco Island submarket — rolls under Naples MarketBeat at best. 0 corridors defined.",
      "FHFA HPI: Naples-Marco Island MSA not in lake. See Naples needs above.",
    ],
  },
  {
    slug: "east-naples", city: "East Naples", county: "Collier",
    parent: "Naples", zips: ["34112","34113"], corridorCount: 0,
    cols: {
      city_pulse:"gap",    permits:"live",    perm_geo:"live",
      corridors:"na",      corr_voice:"na",   properties:"live",
      cre_broker:"partial",rentals:"live",    flood_aal:"na",
      traffic:"live",      safety:"partial",  labor:"partial", fhfa_hpi:"gap",
    },
    needs: [
      "City Pulse: not in 7-city list. Sub-area of Naples.",
      "CRE Broker partial: Davis Blvd East Naples corridor is under Naples MarketBeat submarket — coverage exists via that corridor.",
      "FHFA HPI: Naples-Marco Island MSA not in lake.",
    ],
  },
  {
    slug: "north-naples", city: "North Naples", county: "Collier",
    parent: "Naples", zips: ["34108","34109","34110"], corridorCount: 0,
    cols: {
      city_pulse:"gap",    permits:"live",    perm_geo:"live",
      corridors:"na",      corr_voice:"na",   properties:"live",
      cre_broker:"partial",rentals:"live",    flood_aal:"na",
      traffic:"live",      safety:"partial",  labor:"partial", fhfa_hpi:"gap",
    },
    needs: [
      "City Pulse: not in 7-city list. Sub-area of Naples.",
      "CRE Broker partial: Immokalee Rd + Vanderbilt Beach Rd corridors are under Naples submarket — coverage via those corridors.",
      "FHFA HPI: Naples-Marco Island MSA not in lake.",
    ],
  },
  {
    slug: "golden-gate", city: "Golden Gate", county: "Collier",
    parent: "Naples", zips: ["34116","34120"], corridorCount: 0,
    cols: {
      city_pulse:"gap",  permits:"live",    perm_geo:"live",
      corridors:"na",    corr_voice:"na",   properties:"live",
      cre_broker:"gap",  rentals:"partial", flood_aal:"na",
      traffic:"live",    safety:"partial",  labor:"partial", fhfa_hpi:"gap",
    },
    needs: [
      "City Pulse: not in 7-city list. Sub-area of Naples.",
      "CRE Broker: no MarketBeat coverage. No corridors defined.",
      "Rentals partial: ZORI coverage for 34116/34120 unverified — lower-listing-velocity inland CDP may not publish. Verify: SELECT zip_code FROM data_lake.zori_zip_rents WHERE zip_code IN ('34116','34120') GROUP BY 1.",
      "FHFA HPI: Naples-Marco Island MSA not in lake.",
    ],
  },
];
"""

# ─── app/cities/page.tsx ─────────────────────────────────────────────────────
PAGE = r"""import Image from "next/image";
import { Link } from "../ui";
import {
  CITIES,
  COLUMNS,
  MATRIX_AUDITED,
  type CellStatus,
  type CityRow,
} from "../../lib/city-matrix";

export const revalidate = 3600;

// ── Cell rendering ────────────────────────────────────────────────────────────

function cellLabel(status: CellStatus, count?: number): string {
  if (status === "live")    return count != null ? String(count) : "✓";
  if (status === "partial") return "~";
  if (status === "gap")     return "✗";
  return "—";
}

function cellStyle(status: CellStatus): React.CSSProperties {
  if (status === "live")    return { color: "var(--green)",  fontWeight: 600 };
  if (status === "partial") return { color: "var(--yellow)", fontWeight: 600 };
  if (status === "gap")     return { color: "var(--red)",    fontWeight: 600 };
  return { color: "var(--muted)" };
}

function Cell({ col, row }: { col: string; row: CityRow }) {
  const status = row.cols[col] ?? "na";
  const count  = col === "corridors" && status === "live" ? row.corridorCount : undefined;
  return (
    <td style={{ textAlign: "center", ...cellStyle(status) }}>
      {cellLabel(status, count)}
    </td>
  );
}

// ── Gap count per city ────────────────────────────────────────────────────────
function gapCount(row: CityRow) {
  return Object.values(row.cols).filter((s) => s === "gap").length;
}

// ── Summary counts ────────────────────────────────────────────────────────────
function summarize() {
  let totalCells = 0, live = 0, partial = 0, gap = 0;
  for (const row of CITIES) {
    for (const s of Object.values(row.cols)) {
      totalCells++;
      if (s === "live")    live++;
      else if (s === "partial") partial++;
      else if (s === "gap")     gap++;
    }
  }
  return { totalCells, live, partial, gap };
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function CitiesPage() {
  const stats = summarize();
  const citiesWithGaps = CITIES.filter((r) => gapCount(r) > 0);

  return (
    <main className="wrap">
      {/* Topbar */}
      <div className="topbar">
        <Image src="/logo.png" alt="SWFL Data Gulf" width={48} height={48} className="logo" priority />
        <div className="topbar-text">
          <h1>City Data Parity <span className="ops-badge">/ops</span></h1>
          <p className="subtitle mono">
            Every city × every data stream · audited{" "}
            <span className="ts">{MATRIX_AUDITED}</span>
          </p>
        </div>
        <div className="topbar-stats">
          <div className="top-stat">
            <span className="top-stat-num green">{stats.live}</span>
            <span className="top-stat-label">live</span>
          </div>
          <div className="top-stat">
            <span className="top-stat-num yellow">{stats.partial}</span>
            <span className="top-stat-label">partial</span>
          </div>
          <div className="top-stat">
            <span className="top-stat-num red">{stats.gap}</span>
            <span className="top-stat-label">gaps</span>
          </div>
          <div className="top-stat">
            <span className="top-stat-num dim">{stats.totalCells}</span>
            <span className="top-stat-label">cells</span>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="catnav">
        <span className="catnav-pill" style={{ gap: "0.5rem" }}>
          <span style={{ color:"var(--green)", fontWeight:700 }}>✓ live</span>
          <span style={{ color:"var(--yellow)", fontWeight:700 }}>~ partial</span>
          <span style={{ color:"var(--red)", fontWeight:700 }}>✗ gap</span>
          <span style={{ color:"var(--muted)" }}>— N/A</span>
        </span>
        <Link href="/coverage" className="catnav-pill catnav-targets">Pipeline Coverage ▤</Link>
        <Link href="/" className="catnav-pill catnav-queue" style={{ marginLeft:"auto" }}>
          ← /ops dashboard
        </Link>
      </nav>

      {/* Update rule */}
      <div className="banner warn" style={{ marginBottom:"1.5rem" }}>
        <strong>RULE:</strong> update <code>lib/city-matrix.ts</code> the same
        session you wire a new pipeline, fix geocoding, or connect a brain to a
        city. Bump <code>MATRIX_AUDITED</code> every time. Stale cells are worse
        than no cells.
      </div>

      {/* Matrix table */}
      <section className="category">
        <div className="category-header">
          <span className="cat-dot" style={{ background:"#2dd4bf" }} />
          <span className="cat-title">
            {CITIES.length} cities × {COLUMNS.length} data streams
          </span>
        </div>

        <div className="table-wrap" style={{ overflowX:"auto" }}>
          <table style={{ minWidth:"max-content", width:"100%" }}>
            <thead>
              <tr>
                <th style={{ position:"sticky", left:0, background:"var(--bg-raised)", zIndex:2, minWidth:160 }}>
                  City
                </th>
                <th style={{ minWidth:56 }}>County</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} style={{ minWidth:76, textAlign:"center" }}>
                    <div style={{ fontSize:"0.72rem", lineHeight:1.2 }}>{c.label}</div>
                    <div className="note" style={{ fontSize:"0.6rem", fontWeight:400 }}>{c.sub}</div>
                  </th>
                ))}
                <th style={{ minWidth:52, textAlign:"center" }}>Gaps</th>
              </tr>
            </thead>
            <tbody>
              {CITIES.map((row) => {
                const gaps = gapCount(row);
                return (
                  <tr key={row.slug} data-status={gaps === 0 ? "green" : gaps >= 3 ? "red" : "yellow"}>
                    <td style={{ position:"sticky", left:0, background:"var(--bg-row)", zIndex:1 }}>
                      <div className="name" style={{ display:"flex", alignItems:"center", gap:"0.4rem" }}>
                        {row.city}
                        {row.parent && (
                          <span className="note" style={{ fontSize:"0.65rem" }}>
                            → {row.parent}
                          </span>
                        )}
                      </div>
                      <div className="mono note" style={{ fontSize:"0.62rem" }}>
                        {row.zips.join(" · ")}
                      </div>
                    </td>
                    <td>
                      <span
                        className="cadence-chip"
                        style={{ background: row.county === "Lee" ? "#0c2a1a" : "#1a1a2a",
                                 color: row.county === "Lee" ? "var(--green)" : "#a78bfa" }}
                      >
                        {row.county}
                      </span>
                    </td>
                    {COLUMNS.map((c) => (
                      <Cell key={c.key} col={c.key} row={row} />
                    ))}
                    <td style={{ textAlign:"center" }}>
                      {gaps === 0 ? (
                        <span style={{ color:"var(--green)" }}>0</span>
                      ) : (
                        <span style={{ color: gaps >= 3 ? "var(--red)" : "var(--yellow)", fontWeight:700 }}>
                          {gaps}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Needs per city */}
      <section className="category">
        <div className="category-header">
          <span className="cat-dot" style={{ background:"#f87171" }} />
          <span className="cat-title">Needs by city</span>
        </div>
        <p className="note" style={{ margin:"0 0 1rem" }}>
          Only cities with at least one gap (✗) are listed. N/A cells are correct by design and are not listed as needs.
        </p>

        {citiesWithGaps.map((row) => (
          <div
            key={row.slug}
            style={{
              marginBottom:"1.25rem",
              padding:"0.85rem 1rem",
              background:"var(--bg-raised)",
              border:"1px solid var(--border)",
              borderRadius:6,
            }}
          >
            <div style={{ display:"flex", alignItems:"baseline", gap:"0.75rem", marginBottom:"0.5rem" }}>
              <span style={{ fontWeight:700, color:"var(--text)", fontSize:"0.95rem" }}>
                {row.city}
              </span>
              <span className="cadence-chip">{row.county} County</span>
              {row.parent && (
                <span className="note" style={{ fontSize:"0.72rem" }}>sub-area of {row.parent}</span>
              )}
              <span style={{ marginLeft:"auto", color:"var(--red)", fontWeight:700, fontSize:"0.82rem" }}>
                {gapCount(row)} gap{gapCount(row) !== 1 ? "s" : ""}
              </span>
            </div>
            <ul style={{ margin:0, padding:"0 0 0 1.1rem", listStyle:"disc" }}>
              {row.needs.map((n, i) => (
                <li key={i} className="note" style={{ marginBottom:"0.3rem", lineHeight:1.5, fontSize:"0.8rem" }}>
                  {n}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <footer>
        SWFL Data Gulf · /ops/cities · audited {MATRIX_AUDITED} against live
        code + DB + git. Source of truth:{" "}
        <code>lib/city-matrix.ts</code> in swfldatagulf-ops.{" "}
        <Link href="/">dashboard</Link> ·{" "}
        <Link href="/coverage">pipeline coverage</Link>
      </footer>
    </main>
  );
}
"""

# Write files
os.makedirs(os.path.join(OPS, "app", "cities"), exist_ok=True)
with open(os.path.join(OPS, "lib", "city-matrix.ts"), "w", encoding="utf-8") as f:
    f.write(MATRIX)
with open(os.path.join(OPS, "app", "cities", "page.tsx"), "w", encoding="utf-8") as f:
    f.write(PAGE)
print("Done.")
