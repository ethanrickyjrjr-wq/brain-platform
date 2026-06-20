#!/usr/bin/env node
/**
 * Build the served ZIP choropleth SVG from Census ZCTA boundaries.
 *
 * Source : public/maps/swfl-zcta.geojson  (57 SWFL ZIP polygons, Census ZCTA via
 *          OpenDataDE cartographic data — lon/lat, WGS84)
 * Output : public/maps/lee-collier.svg     (served by components/charts/ZipChoropleth.tsx)
 *
 * Why: the contractor SVG assigned the MAINLAND to ZIP 33931 (Fort Myers Beach),
 * so the island rendered as a mainland blob. Census ZCTA assigns 33931 to the actual
 * island (mainland is 33908), so the geometry is correct per-ZIP. This is the parallel
 * "is the data right" build while the contractor (Fiverr) fixes their file; to swap
 * back to the contractor map, re-run scripts/clean-contractor-map.mjs.
 *
 * Projection: equirectangular with cos(lat) x-correction (fine for this small extent).
 * Format matches the contractor output: each ZIP is <g id="NNNNN" class="zip-group">
 * with one <path> (all polygon rings). The component fills paths per data at runtime.
 */
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "public/maps/swfl-zcta.geojson";
const OUT = "public/maps/lee-collier.svg";
const W = 1000; // px canvas width

const fc = JSON.parse(readFileSync(SRC, "utf8"));

// gather all coords for projection bounds
const all = [];
for (const f of fc.features) {
  const g = f.geometry;
  const polys = g.type === "MultiPolygon" ? g.coordinates : [g.coordinates];
  for (const poly of polys) for (const ring of poly) for (const c of ring) all.push(c);
}
const lon0 = all.reduce((s, c) => s + c[0], 0) / all.length;
const lat0 = all.reduce((s, c) => s + c[1], 0) / all.length;
const kx = Math.cos((lat0 * Math.PI) / 180);
const px = all.map((c) => (c[0] - lon0) * kx);
const py = all.map((c) => -(c[1] - lat0));
const minx = Math.min(...px), maxx = Math.max(...px);
const miny = Math.min(...py), maxy = Math.max(...py);
const scale = W / (maxx - minx);
const H = Math.round((maxy - miny) * scale);
const proj = (c) => [
  (((c[0] - lon0) * kx) - minx) * scale,
  ((-(c[1] - lat0)) - miny) * scale,
];

const groups = [];
for (const f of fc.features) {
  const zip = f.properties.zip;
  const g = f.geometry;
  const polys = g.type === "MultiPolygon" ? g.coordinates : [g.coordinates];
  let d = "";
  for (const poly of polys) {
    for (const ring of poly) {
      d += "M" + ring.map((c) => { const [x, y] = proj(c); return `${x.toFixed(1)},${y.toFixed(1)}`; }).join("L") + "Z";
    }
  }
  groups.push(`<g id="${zip}" class="zip-group" data-name="${zip}"><path d="${d}"/></g>`);
}

const style = `<style>
  #contractor-map .zip-group path { fill: #e5e7eb; stroke: #ffffff; stroke-width: 0.5px; }
</style>`;
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg id="contractor-map" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${style}<rect width="${W}" height="${H}" fill="#cfe3ff"/>${groups.join("")}</svg>`;

writeFileSync(OUT, svg);
console.log(`wrote ${OUT}  (${W}x${H}, ${groups.length} ZIP groups)`);
