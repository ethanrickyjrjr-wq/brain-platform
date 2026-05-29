import Image from "next/image";
import { Link } from "../ui";

export const revalidate = 3600;

type TargetStatus = "live" | "building" | "new" | "want";

interface Target {
  label: string;
  note?: string;
  status: TargetStatus;
  url?: string;
  cadence?: string;
  coverage?: string;
}

interface TargetCategory {
  key: string;
  title: string;
  dot: string;
  items: Target[];
}

const TARGETS: TargetCategory[] = [
  {
    key: "economy",
    title: "Economy & Employment",
    dot: "#4ade80",
    items: [
      {
        label: "BLS LAUS — Monthly Labor Market",
        note: "Unemployment rate · labor force · employment. Lee + Collier + FL.",
        status: "live",
        url: "https://www.bls.gov/lau/",
        cadence: "monthly",
        coverage: "Lee + Collier + FL",
      },
      {
        label: "BLS QCEW — Quarterly Wages by Industry",
        note: "Private-sector wages + employment by NAICS sector.",
        status: "live",
        url: "https://www.bls.gov/cew/",
        cadence: "quarterly",
        coverage: "Lee + Collier",
      },
      {
        label: "Census CBP — Annual Business Patterns",
        note: "Business count + employment by NAICS. County level.",
        status: "live",
        url: "https://www.census.gov/programs-surveys/cbp.html",
        cadence: "annual",
        coverage: "Lee + Collier",
      },
      {
        label: "Census VIP — Business Conditions Survey",
        note: "Quarterly business volume change indicators.",
        status: "live",
        url: "https://www.census.gov/econ/vip/",
        cadence: "quarterly",
        coverage: "FL + US",
      },
      {
        label: "FRED G17 — Industrial Production Index",
        note: "US + FL industrial output. Macro context chain.",
        status: "live",
        url: "https://fred.stlouisfed.org/",
        cadence: "monthly",
        coverage: "US + FL",
      },
      {
        label: "BLS PPI — Producer Price Index",
        note: "Construction + trade cost pressures for SWFL context.",
        status: "live",
        url: "https://www.bls.gov/ppi/",
        cadence: "monthly",
        coverage: "US",
      },
      {
        label: "FGCU RERI — Regional Economic Indicators",
        note: "8 SWFL metrics per month: airport activity, tourist tax, taxable sales, unemployment, permits, home sales, home prices, active listings.",
        status: "new",
        url: "https://www.fgcu.edu/cob/reri/",
        cadence: "monthly (~4th of month)",
        coverage: "Lee + Collier + Charlotte",
      },
      {
        label: "Census ACS — Demographics by ZIP",
        note: "Income, age, household size, migration. 5-year ACS.",
        status: "want",
        url: "https://www.census.gov/programs-surveys/acs/",
        cadence: "annual",
        coverage: "Lee + Collier ZIPs",
      },
      {
        label: "FL DEO / CareerSource — Job Postings",
        note: "Live job listings + industry demand by county.",
        status: "want",
        url: "https://www.careersourceflorida.com/",
        cadence: "weekly",
        coverage: "Lee + Collier",
      },
      {
        label: "FGCU RERI EBCS — Business Climate Survey",
        note: "Quarterly executive sentiment for Lee, Collier, Charlotte.",
        status: "want",
        url: "https://www.fgcu.edu/cob/reri/research/",
        cadence: "quarterly",
        coverage: "Lee + Collier + Charlotte",
      },
    ],
  },
  {
    key: "realestate",
    title: "Real Estate",
    dot: "#f59e0b",
    items: [
      {
        label: "LeePA — Lee County Property Appraiser",
        note: "Parcel sales velocity + SOH-gap. 500k+ parcels.",
        status: "live",
        url: "https://www.leepa.org/",
        cadence: "annual",
        coverage: "Lee County",
      },
      {
        label: "FHFA HPI — House Price Index",
        note: "Quarterly repeat-sales price index.",
        status: "live",
        url: "https://www.fhfa.gov/data/hpi",
        cadence: "quarterly",
        coverage: "Cape Coral–Fort Myers MSA",
      },
      {
        label: "Zillow ZORI — Rental Rates",
        note: "Monthly observed rent index by ZIP.",
        status: "live",
        url: "https://www.zillow.com/research/data/",
        cadence: "monthly",
        coverage: "125 SWFL ZIPs",
      },
      {
        label: "Redfin — Housing Market Tracker",
        note: "Listings, days on market, price reductions, sold-above-ask.",
        status: "live",
        url: "https://www.redfin.com/news/data-center/",
        cadence: "monthly",
        coverage: "125 SWFL ZIPs",
      },
      {
        label: "Lee Building Permits — Accela",
        note: "Weekly permit pulls: residential + commercial new construction.",
        status: "live",
        url: "https://aca-prod.accela.com/LEECO/",
        cadence: "weekly",
        coverage: "Lee County",
      },
      {
        label: "Collier Building Permits — XLSX",
        note: "Monthly permit issuance from Collier county portal.",
        status: "live",
        url: "https://www.collierfl.gov/",
        cadence: "monthly",
        coverage: "Collier County",
      },
      {
        label: "Collier County Property Appraiser",
        note: "Parcel data + sales history. Sibling of LeePA brain.",
        status: "want",
        url: "https://www.collierappraiser.com/",
        cadence: "annual",
        coverage: "Collier County",
      },
      {
        label: "Charlotte County Property Appraiser",
        note: "Parcel + sales data for the northern SWFL corridor.",
        status: "want",
        url: "https://www.ccappraiser.com/",
        cadence: "annual",
        coverage: "Charlotte County",
      },
      {
        label: "CoStar / Commercial RE Data",
        note: "CRE asking rents, vacancy, absorption by submarket.",
        status: "want",
        url: "https://www.costar.com/",
        cadence: "quarterly",
        coverage: "SWFL submarkets",
      },
    ],
  },
  {
    key: "tourism",
    title: "Tourism & Consumer Spending",
    dot: "#a78bfa",
    items: [
      {
        label: "FL DOR TDT — Tourist Development Tax",
        note: "Monthly lodging + short-term rental tax collections.",
        status: "live",
        url: "https://floridarevenue.com/dataPortal/GTA/",
        cadence: "monthly",
        coverage: "Lee + Collier (FY1999–present)",
      },
      {
        label: "FL DOR Sales Tax — Taxable Sales",
        note: "Monthly retail taxable sales. 40,140 rows cy0203–cy2425.",
        status: "live",
        url: "https://floridarevenue.com/taxes/taxesfees/Pages/sales_tax.aspx",
        cadence: "monthly",
        coverage: "Lee + Collier",
      },
      {
        label: "RSW / Naples / PGD Airport Passenger Data",
        note: "Enplanements, cargo, operations by month.",
        status: "want",
        url: "https://www.flylcpa.com/about/statistics/",
        cadence: "monthly",
        coverage: "Lee + Collier + Charlotte airports",
      },
      {
        label: "Visit Florida — Visitor Volume + Spending",
        note: "State tourism dashboard: visitor counts + spending estimates.",
        status: "want",
        url: "https://www.visitflorida.org/research/",
        cadence: "quarterly",
        coverage: "FL + SWFL region",
      },
      {
        label: "STR / AirDNA — Hotel Occupancy + ADR",
        note: "RevPAR, occupancy, ADR for short-term rentals and hotels.",
        status: "want",
        url: "https://www.airdna.co/",
        cadence: "monthly",
        coverage: "SWFL markets",
      },
    ],
  },
  {
    key: "environmental",
    title: "Environmental",
    dot: "#34d399",
    items: [
      {
        label: "FEMA NFIP — National Flood Insurance",
        note: "Policy count + claims by county. SFHA exposure.",
        status: "live",
        url: "https://www.fema.gov/flood-insurance/tools-resources/nfip",
        cadence: "quarterly",
        coverage: "Lee + Collier",
      },
      {
        label: "HURDAT2 — Atlantic Hurricane Tracks",
        note: "Complete 1851–2024 storm database. Historical risk context.",
        status: "live",
        url: "https://www.nhc.noaa.gov/data/#hurdat",
        cadence: "annual",
        coverage: "Atlantic basin",
      },
      {
        label: "NOAA Storm Events — SWFL",
        note: "Damage + injury records by event type and county.",
        status: "live",
        url: "https://www.ncdc.noaa.gov/stormevents/",
        cadence: "monthly",
        coverage: "Lee + Collier (1996–present)",
      },
      {
        label: "USGS Water Levels — SWFL",
        note: "Daily gauge readings for freshwater + coastal flood monitoring.",
        status: "live",
        url: "https://waterdata.usgs.gov/fl/nwis/",
        cadence: "daily",
        coverage: "SWFL gauge network",
      },
      {
        label: "SFWMD — SW Florida Water Management District",
        note: "Reservoir levels, canals, water quality, drought index.",
        status: "want",
        url: "https://www.sfwmd.gov/science-data/dbhydro",
        cadence: "daily",
        coverage: "SFWMD district",
      },
      {
        label: "NOAA / CO-OPS — Sea Level + Tidal Data",
        note: "Sea level anomaly, king tides, coastal flood frequency.",
        status: "want",
        url: "https://tidesandcurrents.noaa.gov/",
        cadence: "daily",
        coverage: "SWFL coastal stations",
      },
      {
        label: "EPA AQS — Air Quality",
        note: "PM2.5, ozone, smoke events. Red Tide smoke plume context.",
        status: "want",
        url: "https://www.epa.gov/aqs",
        cadence: "daily",
        coverage: "Lee + Collier monitors",
      },
    ],
  },
  {
    key: "infrastructure",
    title: "Infrastructure & Logistics",
    dot: "#60a5fa",
    items: [
      {
        label: "FDOT AADT — Annual Average Daily Traffic",
        note: "Statewide traffic counts by roadway segment.",
        status: "live",
        url: "https://www.fdot.gov/statistics/trafficdata/",
        cadence: "annual",
        coverage: "FL state roads + US highways",
      },
      {
        label: "FAF5 — Freight Analysis Framework",
        note: "Freight flows by mode, commodity, origin/destination.",
        status: "live",
        url: "https://ops.fhwa.dot.gov/freight/freight_analysis/faf/",
        cadence: "annual",
        coverage: "US freight flows",
      },
      {
        label: "Port Manatee / SWFL Seaport Cargo",
        note: "Container + bulk cargo volumes. SWFL logistics pulse.",
        status: "want",
        url: "https://www.portmanatee.com/",
        cadence: "monthly",
        coverage: "Port Manatee",
      },
      {
        label: "FCC Broadband Map — Coverage by Block",
        note: "ISP coverage + speed tiers by Census block. Development indicator.",
        status: "want",
        url: "https://broadbandmap.fcc.gov/",
        cadence: "bi-annual",
        coverage: "Lee + Collier + Charlotte",
      },
      {
        label: "FDOT Active Construction Projects",
        note: "Open bids + active contracts by county. Investment signal.",
        status: "want",
        url: "https://www.fdot.gov/programmanagement/",
        cadence: "monthly",
        coverage: "District 1 (SWFL)",
      },
    ],
  },
  {
    key: "news",
    title: "News & Sentiment",
    dot: "#fb923c",
    items: [
      {
        label: "SWFL News Scrape — Local Business Press",
        note: "News-Press, Naples Daily News, Wink News, Business Observer. Daily markdown snapshots.",
        status: "building",
        url: "https://www.news-press.com/business/",
        cadence: "daily",
        coverage: "Lee + Collier",
      },
      {
        label: "WGCU Public Media — SWFL Stories",
        note: "Local NPR affiliate. Economy + environment + development coverage.",
        status: "want",
        url: "https://www.wgcu.org/",
        cadence: "daily",
        coverage: "SWFL",
      },
      {
        label: "Lee + Collier Chambers — Announcements",
        note: "New member filings, event signals, business climate tone.",
        status: "want",
        url: "https://www.fortmyers.org/",
        cadence: "weekly",
        coverage: "Lee + Collier",
      },
      {
        label: "SWFL Inc. — Economic Development Releases",
        note: "Site selectors, expansions, relocations, incentive grants.",
        status: "want",
        url: "https://www.swflinc.com/",
        cadence: "as published",
        coverage: "Lee + Collier + Charlotte",
      },
    ],
  },
  {
    key: "safety",
    title: "Crime & Public Safety",
    dot: "#f87171",
    items: [
      {
        label: "Lee County Sheriff — Incident Reports",
        note: "Arrest records, crime type by ZIP. Neighborhood safety signal.",
        status: "want",
        url: "https://www.sheriffleefl.org/",
        cadence: "weekly",
        coverage: "Lee County",
      },
      {
        label: "Collier County Sheriff — Incident Reports",
        note: "Crime log, call volume by district.",
        status: "want",
        url: "https://www.colliersheriff.org/",
        cadence: "weekly",
        coverage: "Collier County",
      },
      {
        label: "FDLE Uniform Crime Reports — FL",
        note: "Annual crime stats by county. State-level context.",
        status: "want",
        url: "https://www.fdle.state.fl.us/FSAC/",
        cadence: "annual",
        coverage: "FL counties",
      },
    ],
  },
];

function statusLabel(s: TargetStatus): string {
  if (s === "live") return "live";
  if (s === "new") return "new!";
  if (s === "building") return "building";
  return "want";
}

function statusClass(s: TargetStatus): string {
  if (s === "live") return "green";
  if (s === "new") return "new";
  if (s === "building") return "yellow";
  return "want";
}

function tally(items: Target[]) {
  return {
    live: items.filter((i) => i.status === "live" || i.status === "new").length,
    building: items.filter((i) => i.status === "building").length,
    want: items.filter((i) => i.status === "want").length,
  };
}

const allItems = TARGETS.flatMap((c) => c.items);
const overall = {
  live: allItems.filter((i) => i.status === "live" || i.status === "new")
    .length,
  building: allItems.filter((i) => i.status === "building").length,
  want: allItems.filter((i) => i.status === "want").length,
  total: allItems.length,
};

export default function TargetsPage() {
  return (
    <main className="wrap">
      <div className="topbar">
        <Image
          src="/logo.png"
          alt="SWFL Data Gulf"
          width={48}
          height={48}
          className="logo"
          priority
        />
        <div className="topbar-text">
          <h1>
            Data Targets <span className="ops-badge">/ops</span>
          </h1>
          <p className="subtitle mono">
            Every source we have + every source we want ·{" "}
            <span className="ts">
              {overall.live} live · {overall.building} building · {overall.want}{" "}
              targeted
            </span>
          </p>
        </div>
        <div className="topbar-stats">
          <div className="top-stat">
            <span className="top-stat-num green">{overall.live}</span>
            <span className="top-stat-label">live</span>
          </div>
          <div className="top-stat">
            <span className="top-stat-num yellow">{overall.building}</span>
            <span className="top-stat-label">building</span>
          </div>
          <div className="top-stat">
            <span className="top-stat-num red">{overall.want}</span>
            <span className="top-stat-label">want</span>
          </div>
          <div className="top-stat">
            <span className="top-stat-num dim">{overall.total}</span>
            <span className="top-stat-label">total</span>
          </div>
        </div>
      </div>

      <nav className="catnav">
        {TARGETS.map((c) => {
          const t = tally(c.items);
          return (
            <a key={c.key} href={`#${c.key}`} className="catnav-pill">
              <span className="catnav-dot" style={{ background: c.dot }} />
              {c.title}
              <span className="catnav-counts">
                <span style={{ color: "var(--green)" }}>{t.live}✓</span>
                {t.building > 0 && (
                  <span style={{ color: "var(--yellow)" }}>{t.building}~</span>
                )}
                {t.want > 0 && (
                  <span style={{ color: "var(--muted)" }}>{t.want}○</span>
                )}
              </span>
            </a>
          );
        })}
        <Link
          href="/"
          className="catnav-pill catnav-queue"
          style={{ marginLeft: "auto" }}
        >
          ← /ops dashboard
        </Link>
      </nav>

      {TARGETS.map((cat, catIdx) => {
        const t = tally(cat.items);
        const pct =
          cat.items.length > 0
            ? Math.round((t.live / cat.items.length) * 100)
            : 0;
        return (
          <div
            id={cat.key}
            key={cat.key}
            className="category"
            style={
              { "--delay": `${0.08 + catIdx * 0.05}s` } as React.CSSProperties
            }
          >
            <div className="category-header">
              <span className="cat-dot" style={{ background: cat.dot }} />
              <span className="cat-title">{cat.title}</span>
              <div className="cat-stats">
                <span className="stat-num-sm" style={{ color: "var(--green)" }}>
                  {t.live}
                </span>
                <span className="stat-sym">✓</span>
                {t.building > 0 && (
                  <>
                    <span
                      className="stat-num-sm"
                      style={{ color: "var(--yellow)" }}
                    >
                      {t.building}
                    </span>
                    <span className="stat-sym">~</span>
                  </>
                )}
                {t.want > 0 && (
                  <>
                    <span
                      className="stat-num-sm"
                      style={{ color: "var(--muted)" }}
                    >
                      {t.want}
                    </span>
                    <span className="stat-sym" style={{ marginRight: 0 }}>
                      ○
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 80 }}>Status</th>
                    <th>Source</th>
                    <th style={{ width: 100 }}>Cadence</th>
                    <th style={{ width: 180 }}>Coverage</th>
                    <th style={{ width: 180 }}>Link</th>
                  </tr>
                </thead>
                <tbody>
                  {cat.items.map((item) => (
                    <tr
                      key={item.label}
                      data-status={
                        item.status === "live" || item.status === "new"
                          ? "green"
                          : item.status === "building"
                            ? "yellow"
                            : "red"
                      }
                    >
                      <td>
                        <span className={`pill ${statusClass(item.status)}`}>
                          {statusLabel(item.status)}
                        </span>
                      </td>
                      <td>
                        <div className="name">{item.label}</div>
                        {item.note && (
                          <div className="row-note">{item.note}</div>
                        )}
                      </td>
                      <td>
                        {item.cadence && (
                          <span className="cadence-chip">{item.cadence}</span>
                        )}
                      </td>
                      <td className="coverage-col">{item.coverage ?? "—"}</td>
                      <td>
                        {item.url && (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="target-url"
                          >
                            {item.url
                              .replace(/^https?:\/\//, "")
                              .replace(/\/$/, "")}
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="recap">
              <div className="recap-head">
                <span className="recap-title">Acquisition progress</span>
                <div className="progress-wrap">
                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${pct}%`,
                        background:
                          pct >= 80
                            ? "var(--green)"
                            : pct >= 40
                              ? "var(--yellow)"
                              : "var(--red)",
                      }}
                    />
                  </div>
                  <span className="progress-pct">{pct}%</span>
                </div>
              </div>
              {t.live > 0 && (
                <div className="recap-row">
                  <span className="recap-tag green">live</span>
                  <div className="recap-chips">
                    {cat.items
                      .filter((i) => i.status === "live" || i.status === "new")
                      .map((i) => (
                        <span key={i.label} className="chip chip-green">
                          {i.label.split("—")[0].trim()}
                        </span>
                      ))}
                  </div>
                </div>
              )}
              {t.building > 0 && (
                <div className="recap-row">
                  <span className="recap-tag yellow">building</span>
                  <div className="recap-chips">
                    {cat.items
                      .filter((i) => i.status === "building")
                      .map((i) => (
                        <span key={i.label} className="chip chip-yellow">
                          {i.label.split("—")[0].trim()}
                        </span>
                      ))}
                  </div>
                </div>
              )}
              {t.want > 0 && (
                <div className="recap-row">
                  <span className="recap-tag red">want</span>
                  <div className="recap-chips">
                    {cat.items
                      .filter((i) => i.status === "want")
                      .map((i) => (
                        <span key={i.label} className="chip">
                          {i.label.split("—")[0].trim()}
                        </span>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}

      <footer>
        SWFL Data Gulf · /ops/targets · all data sources we have + all we want ·{" "}
        <Link href="/">dashboard</Link> · <Link href="/queue">build queue</Link>
      </footer>
    </main>
  );
}
