import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { HOME_MAP_DATA, METRIC_ORDER, type MetricKey } from "@/lib/landing/home-map-data";
import { extractZipShape } from "@/lib/map/extract-zip-shape";
import "./zip-page.css";

/* ─── Helpers (mirrors Hero.tsx, needed server-side) ─── */

function fmt(val: number, format: "currency" | "number"): string {
  if (format === "currency") {
    if (val >= 1_000_000) return "$" + (val / 1_000_000).toFixed(2) + "M";
    if (val >= 1000) return "$" + Math.round(val / 1000) + "K";
    return "$" + val.toLocaleString();
  }
  return val.toLocaleString();
}

function rankOf(zip: string, metric: MetricKey) {
  const m = HOME_MAP_DATA.metrics[metric];
  const sorted = Object.entries(m.data).sort((a, b) => b[1] - a[1]);
  const i = sorted.findIndex(([z]) => z === zip);
  return i === -1 ? null : { pos: i + 1, total: sorted.length };
}

function barWidth(zip: string, metric: MetricKey): number {
  const m = HOME_MAP_DATA.metrics[metric];
  const val = m.data[zip];
  if (val === undefined) return 0;
  return Math.max(3, ((val - m.low) / (m.high - m.low)) * 100);
}

function county(zip: string): string {
  return parseInt(zip) >= 34100 ? "Collier County" : "Lee County";
}

function hexToRgb(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}
function lerpColor(c1: string, c2: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(c1);
  const [r2, g2, b2] = hexToRgb(c2);
  return `rgb(${Math.round(lerp(r1, r2, t))},${Math.round(lerp(g1, g2, t))},${Math.round(lerp(b1, b2, t))})`;
}
function metricColor(zip: string, metric: MetricKey): string {
  const m = HOME_MAP_DATA.metrics[metric];
  const val = m.data[zip];
  if (val === undefined) return "#0a8078";
  const t = (val - m.low) / (m.high - m.low);
  return t < 0.5 ? lerpColor(m.c0, m.c1, t * 2) : lerpColor(m.c1, m.c2, (t - 0.5) * 2);
}

/* ─── Metadata ─── */

type Props = { params: Promise<{ zip: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { zip } = await params;
  const name = HOME_MAP_DATA.placeNames[zip];
  const co = county(zip);
  if (!name) return { title: `ZIP ${zip}` };
  return {
    title: `${zip} ${name}`,
    description: `Flood risk, home values, and permits for ${zip} (${name}), ${co}, FL.`,
  };
}

/* ─── Page ─── */

export default async function ZipPage({ params }: Props) {
  const { zip } = await params;

  const placeName = HOME_MAP_DATA.placeNames[zip];
  if (!placeName) notFound();

  const countyName = county(zip);
  const { svgMarkup, found } = extractZipShape(zip);

  // Primary metric color drives the hero shape fill
  const fillColor = metricColor(zip, "flood");

  const metrics = METRIC_ORDER.map((key) => ({
    key,
    m: HOME_MAP_DATA.metrics[key],
    val: HOME_MAP_DATA.metrics[key].data[zip],
    rank: rankOf(zip, key),
    width: barWidth(zip, key),
  }));

  const [flood, value, permits] = metrics;

  return (
    <main>
      {/* ── HERO ── */}
      <section className="zp-hero">
        <div className="zp-hero-inner">
          {/* ZIP shape cutout */}
          {found ? (
            <div
              className="zp-shape-wrap"
              style={
                {
                  "--zip-fill": fillColor,
                  "--zip-glow": fillColor.replace("rgb(", "rgba(").replace(")", ",0.45)"),
                } as React.CSSProperties
              }
              dangerouslySetInnerHTML={{ __html: svgMarkup }}
            />
          ) : (
            <div className="zp-shape-placeholder" />
          )}

          {/* Identity */}
          <div className="zp-identity">
            <Link href="/" className="zp-nav-back">
              ← Map
            </Link>
            <div className="zp-eyebrow">SWFL Data Gulf · Lee &amp; Collier</div>
            <div className="zp-number">{zip}</div>
            <div className="zp-name">{placeName}</div>
            <div className="zp-county">{countyName}, Florida</div>
          </div>
        </div>
      </section>

      {/* ── STATS BAR ── */}
      <div className="zp-stats-bar">
        <div className="zp-stat-cell">
          <div className="zp-stat-label">Annual Flood Loss</div>
          <div className="zp-stat-value">
            {flood.val !== undefined ? fmt(flood.val, "currency") : "—"}
          </div>
          <div className="zp-stat-sub">FEMA NFIP avg/property</div>
          {flood.rank && (
            <div className="zp-stat-tag">
              #{flood.rank.pos} of {flood.rank.total} ZIPs
            </div>
          )}
        </div>
        <div className="zp-stat-cell">
          <div className="zp-stat-label">Median Home Value</div>
          <div className="zp-stat-value">
            {value.val !== undefined ? fmt(value.val, "currency") : "—"}
          </div>
          <div className="zp-stat-sub">Zillow ZHVI · Apr 2026</div>
          {value.rank && (
            <div className="zp-stat-tag">
              #{value.rank.pos} of {value.rank.total} ZIPs
            </div>
          )}
        </div>
        <div className="zp-stat-cell">
          <div className="zp-stat-label">New Permits 2024</div>
          <div className="zp-stat-value">
            {permits.val !== undefined ? fmt(permits.val, "number") : "—"}
          </div>
          <div className="zp-stat-sub">Lee + Collier county</div>
          {permits.rank && (
            <div className="zp-stat-tag">
              #{permits.rank.pos} of {permits.rank.total} ZIPs
            </div>
          )}
        </div>
        <div className="zp-stat-cell">
          <div className="zp-stat-label">County</div>
          <div className="zp-stat-value zp-stat-value--sm">{countyName}</div>
          <div className="zp-stat-sub">Southwest Florida</div>
          <div className="zp-stat-tag">57 ZIPs covered</div>
        </div>
      </div>

      {/* ── BODY: breakdown + side rail ── */}
      <div className="zp-body">
        {/* LEFT — breakdown */}
        <div className="zp-breakdown">
          <div className="zp-breakdown-header">
            <h1 className="zp-breakdown-title">{zip} at a glance</h1>
            <span className="zp-breakdown-badge">Sample data · Lee &amp; Collier fixture</span>
          </div>

          {metrics.map(({ key, m, val, rank, width }) => (
            <div key={key} className="zp-metric-block">
              <div className="zp-metric-header">
                <div className="zp-metric-label">{m.label}</div>
                {rank && (
                  <div className="zp-metric-rank">
                    #{rank.pos} of {rank.total} ZIPs
                  </div>
                )}
              </div>
              <div className="zp-metric-value">{val !== undefined ? fmt(val, m.format) : "—"}</div>
              <div className="zp-metric-sublabel">{m.sublabel}</div>
              <div className="zp-bar-track">
                <div className={`zp-bar-fill zp-bar-fill--${key}`} style={{ width: `${width}%` }} />
              </div>
              {rank && (
                <div className="zp-percentile">
                  {Math.round((1 - (rank.pos - 1) / rank.total) * 100)}th percentile
                </div>
              )}
            </div>
          ))}
        </div>

        {/* RIGHT — side rail (matches homepage data-rail style) */}
        <aside className="zp-rail">
          <div className="zp-rail-header">
            <div className="zp-rail-metric-name">Data Summary</div>
            <div className="zp-rail-sublabel">All three tracked metrics</div>
          </div>
          <div className="zp-rail-zip-header">
            <div className="zp-rail-zip-code">{zip}</div>
            <div className="zp-rail-place">{placeName}</div>
            <div className="zp-rail-county">{countyName}</div>
          </div>
          {metrics.map(({ key, m, val, rank, width }) => (
            <div
              key={key}
              className={`zp-rail-metric-row${key === "flood" ? " zp-rail-metric-row--active" : ""}`}
            >
              <div className="zp-rail-row-label">{m.label}</div>
              <div className="zp-rail-row-value">
                {val !== undefined ? fmt(val, m.format) : "—"}
              </div>
              {rank && (
                <div className="zp-rail-row-rank">
                  #{rank.pos} of {rank.total} ZIPs
                </div>
              )}
              <div className="zp-mini-bar">
                <div
                  className={`zp-mini-bar-fill zp-mini-bar-fill--${key}`}
                  style={{ width: `${width}%` }}
                />
              </div>
            </div>
          ))}
          <div className="zp-rail-footer">
            Sources: FEMA NFIP · Zillow ZHVI · Lee/Collier County Permits · Census TIGER 2020
          </div>
        </aside>
      </div>
    </main>
  );
}
