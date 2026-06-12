"use client";

import { useEffect, useRef, useState } from "react";

export interface ZipValue {
  value: number;
  label?: string; // e.g. "$1,200/mo" or "High Risk"
}

interface Props {
  /** { "33901": { value: 0.8, label: "$312k" }, ... } — value 0–1 drives color */
  data: Record<string, ZipValue>;
  /** Tailwind/CSS color for low end of scale */
  colorLow?: string;
  colorHigh?: string;
  /** Which county to show: "Lee" | "Collier" | "both" */
  county?: "Lee" | "Collier" | "both";
  onZipClick?: (zip: string) => void;
  className?: string;
}

function lerp(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t);
}

function valueToColor(t: number, low = "#dbeafe", high = "#1d4ed8") {
  const lowRgb = hexToRgb(low);
  const highRgb = hexToRgb(high);
  if (!lowRgb || !highRgb) return "#e5e7eb";
  return `rgb(${lerp(lowRgb.r, highRgb.r, t)},${lerp(lowRgb.g, highRgb.g, t)},${lerp(lowRgb.b, highRgb.b, t)})`;
}

function hexToRgb(hex: string) {
  const m = hex.replace("#", "").match(/.{2}/g);
  if (!m) return null;
  return { r: parseInt(m[0], 16), g: parseInt(m[1], 16), b: parseInt(m[2], 16) };
}

// ZIPs that belong to Lee county (from fixtures/swfl-zip-county.json)
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

export function ZipChoropleth({
  data,
  colorLow = "#dbeafe",
  colorHigh = "#1d4ed8",
  county = "both",
  onZipClick,
  className = "",
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{
    zip: string;
    label: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    fetch("/maps/lee-collier.svg")
      .then((r) => r.text())
      .then((svgText) => {
        container.innerHTML = svgText;
        const svg = container.querySelector("svg");
        if (!svg) return;

        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
        svg.style.display = "block";

        svg.querySelectorAll<SVGPathElement>("path[id]").forEach((path) => {
          const zip = path.getAttribute("id")!;
          const isLee = LEE_ZIPS.has(zip);

          // County filter
          if (county === "Lee" && !isLee) {
            path.style.display = "none";
            return;
          }
          if (county === "Collier" && isLee) {
            path.style.display = "none";
            return;
          }

          const entry = data[zip];
          const fill = entry != null ? valueToColor(entry.value, colorLow, colorHigh) : "#e5e7eb";

          path.style.fill = fill;
          path.style.stroke = "#fff";
          path.style.strokeWidth = "0.5";
          path.style.cursor = onZipClick ? "pointer" : "default";
          path.style.transition = "fill 0.2s";

          path.addEventListener("mouseenter", (e) => {
            path.style.opacity = "0.8";
            const rect = container.getBoundingClientRect();
            const me = e as MouseEvent;
            setTooltip({
              zip,
              label: entry?.label ?? zip,
              x: me.clientX - rect.left,
              y: me.clientY - rect.top,
            });
          });
          path.addEventListener("mouseleave", () => {
            path.style.opacity = "1";
            setTooltip(null);
          });
          if (onZipClick) {
            path.addEventListener("click", () => onZipClick(zip));
          }
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(data), colorLow, colorHigh, county]);

  return (
    <div className={`relative ${className}`} style={{ minHeight: 200 }}>
      <div ref={ref} className="w-full h-full" />
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 rounded bg-gray-900 px-2 py-1 text-xs text-white shadow"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
        >
          <span className="font-mono">{tooltip.zip}</span>
          {tooltip.label !== tooltip.zip && (
            <span className="ml-1 text-gray-300">{tooltip.label}</span>
          )}
        </div>
      )}
    </div>
  );
}
