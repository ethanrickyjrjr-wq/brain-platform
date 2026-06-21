"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HOME_MAP_DATA as DATA, type MetricKey } from "@/lib/landing/home-map-data";

// Lee County ZIPs (source of truth: fixtures/swfl-zip-county.json)
const LEE_ZIPS = new Set([
  "33901",
  "33903",
  "33904",
  "33905",
  "33907",
  "33908",
  "33909",
  "33912",
  "33913",
  "33914",
  "33916",
  "33917",
  "33919",
  "33920",
  "33921",
  "33922",
  "33924",
  "33928",
  "33931",
  "33936",
  "33956",
  "33957",
  "33965",
  "33966",
  "33967",
  "33971",
  "33972",
  "33973",
  "33974",
  "33976",
  "33990",
  "33991",
  "33993",
  "34134",
  "34135",
]);

interface Props {
  county?: "Lee" | "Collier" | "both";
  metric?: MetricKey;
  className?: string;
}

export function MapCanvas({ county = "both", metric = "flood", className = "" }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [tooltip, setTooltip] = useState<{
    zip: string;
    place: string;
    val: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;

    // — exact same color logic as Hero —
    const clamp = (t: number) => Math.max(0, Math.min(1, t));
    const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp(t);
    const hexToRgb = (h: string): [number, number, number] => [
      parseInt(h.slice(1, 3), 16),
      parseInt(h.slice(3, 5), 16),
      parseInt(h.slice(5, 7), 16),
    ];
    const lerpColor = (c1: string, c2: string, t: number) => {
      const [r1, g1, b1] = hexToRgb(c1);
      const [r2, g2, b2] = hexToRgb(c2);
      return `rgb(${Math.round(lerp(r1, r2, t))},${Math.round(lerp(g1, g2, t))},${Math.round(lerp(b1, b2, t))})`;
    };
    const getColor = (zip: string, m: MetricKey) => {
      const md = DATA.metrics[m];
      const val = md.data[zip];
      if (val === undefined) return "#152832";
      const t = (val - md.low) / (md.high - md.low);
      return t < 0.5 ? lerpColor(md.c0, md.c1, t * 2) : lerpColor(md.c1, md.c2, (t - 0.5) * 2);
    };
    const fmt = (val: number, format: "currency" | "number") => {
      if (format === "currency") {
        if (val >= 1_000_000) return "$" + (val / 1_000_000).toFixed(2) + "M";
        if (val >= 1000) return "$" + Math.round(val / 1000) + "K";
        return "$" + val.toLocaleString();
      }
      return val.toLocaleString();
    };

    fetch("/map/lee-collier.svg")
      .then((r) => r.text())
      .then((svgText) => {
        if (cancelled) return;
        host.innerHTML = svgText;
        const svg = host.querySelector("svg");
        if (!svg) return;
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
        svg.style.display = "block";

        const visible: SVGGElement[] = [];

        svg.querySelectorAll<SVGGElement>("g.zip-group[id]").forEach((group) => {
          const zip = group.id;
          const isLee = LEE_ZIPS.has(zip);

          if (county === "Lee" && !isLee) {
            group.style.display = "none";
            return;
          }
          if (county === "Collier" && isLee) {
            group.style.display = "none";
            return;
          }
          visible.push(group);

          const color = getColor(zip, metric);
          group.querySelectorAll<SVGPathElement>("path").forEach((p) => {
            p.style.fill = color;
            p.style.stroke = "#0a1419";
            p.style.strokeWidth = ".3px";
            p.style.opacity = "1";
          });
          group.style.cursor = "pointer";

          group.addEventListener("mouseenter", (e) => {
            group
              .querySelectorAll<SVGPathElement>("path")
              .forEach((p) => (p.style.filter = "brightness(1.22)"));
            const md = DATA.metrics[metric];
            const val = md.data[zip];
            const rect = host.getBoundingClientRect();
            const me = e as MouseEvent;
            setTooltip({
              zip,
              place: DATA.placeNames[zip] ?? zip,
              val: val !== undefined ? fmt(val, md.format) : "N/A",
              x: me.clientX - rect.left,
              y: me.clientY - rect.top,
            });
          });
          group.addEventListener("mousemove", (e) => {
            const rect = host.getBoundingClientRect();
            const me = e as MouseEvent;
            setTooltip((t) =>
              t ? { ...t, x: me.clientX - rect.left, y: me.clientY - rect.top } : t,
            );
          });
          group.addEventListener("mouseleave", () => {
            group.querySelectorAll<SVGPathElement>("path").forEach((p) => (p.style.filter = ""));
            setTooltip(null);
          });
          group.addEventListener("click", () => router.push(`/z/${zip}`));
        });

        // Single-county views: zoom the viewBox to just that county's ZIPs so
        // the shape fills its box, big and centered. (The full-region "both"
        // view keeps its natural viewBox + surrounding coast for context.)
        if (county !== "both" && visible.length) {
          let x0 = Infinity;
          let y0 = Infinity;
          let x1 = -Infinity;
          let y1 = -Infinity;
          visible.forEach((g) => {
            try {
              const bb = g.getBBox();
              if (bb.width === 0 && bb.height === 0) return;
              x0 = Math.min(x0, bb.x);
              y0 = Math.min(y0, bb.y);
              x1 = Math.max(x1, bb.x + bb.width);
              y1 = Math.max(y1, bb.y + bb.height);
            } catch {
              /* getBBox can throw on non-rendered nodes — skip */
            }
          });
          if (Number.isFinite(x0)) {
            const w = x1 - x0;
            const h = y1 - y0;
            const pad = Math.max(w, h) * 0.06;
            svg.setAttribute(
              "viewBox",
              `${x0 - pad} ${y0 - pad} ${w + pad * 2} ${h + pad * 2}`,
            );
            svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
          }
        }
      })
      .catch(() => {
        /* SVG fetch failed — page still renders */
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [county, metric]);

  return (
    // .home-explorer wrapper activates home-explorer.css coast + county-outline rules
    <div
      className={`home-explorer relative overflow-hidden ${className}`}
      style={{ background: "var(--gulf-deep, #152832)" }}
    >
      <div ref={hostRef} className="map-canvas w-full h-full" style={{ position: "relative" }} />
      {tooltip && (
        <div
          className="pointer-events-none absolute z-20 rounded-lg border px-3 py-2 text-xs"
          style={{
            left: tooltip.x + 14,
            top: tooltip.y - 8,
            background: "rgba(10,20,25,0.96)",
            borderColor: "var(--gulf-teal, #0a8078)",
            minWidth: 140,
          }}
        >
          <div
            style={{
              fontFamily: "monospace",
              fontSize: 10,
              color: "var(--text-tertiary, #6b8899)",
              marginBottom: 2,
            }}
          >
            {tooltip.zip}
          </div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 3 }}>{tooltip.place}</div>
          <div
            style={{
              fontFamily: "monospace",
              fontSize: 14,
              fontWeight: 600,
              color: "var(--neutral-gold, #d4b370)",
            }}
          >
            {tooltip.val}
          </div>
        </div>
      )}
    </div>
  );
}
