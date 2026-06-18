#!/usr/bin/env node
// scripts/graphify-publish.mjs
//
// Transforms graphify-out/graph.json (networkx format, both planes) into the
// ops repo's brain-graph.json format and writes it to the sibling ops repo.
//
// Source format  (graphify-out/graph.json):
//   nodes: [{ id, label, type, domain?, scope?, source_file? }]
//   edges: [{ source, target, relation }]
//
// Target format  (ops/app/graph/brain-graph.json):
//   nodes: [{ id, label, type, domain?, scope?, category, size, shape, color, font }]
//   edges: [{ from, to, label }]
//
// Run: node scripts/graphify-publish.mjs
//      bun run graphify:publish

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OPS_ROOT = join(ROOT, "..", "swfldatagulf-ops");
const GRAPH_PATH = join(ROOT, "graphify-out", "graph.json");
const OPS_TARGET = join(OPS_ROOT, "app", "graph", "brain-graph.json");

// ── Visual config ─────────────────────────────────────────────────────────────
// Data-plane types keep their existing domain-based coloring in page.tsx;
// we only need size/shape here for nodes in the static JSON.

const TYPE_CONFIG = {
  // Data plane (existing)
  brain: { size: 28, shape: "ellipse" },
  slug: { size: 10, shape: "dot" },
  pipeline: { size: 16, shape: "square" },
  // App plane (new)
  page: { size: 18, shape: "diamond" },
  component: { size: 14, shape: "ellipse" },
  api_route: { size: 16, shape: "square" },
  hook: { size: 12, shape: "triangle" },
  table: { size: 14, shape: "hexagon" },
};

// Colors for app-plane types (data-plane colors are handled by domain in page.tsx)
const APP_TYPE_COLORS = {
  page: "#a78bfa", // violet
  component: "#34d399", // emerald
  api_route: "#fbbf24", // amber
  hook: "#f472b6", // pink
  table: "#38bdf8", // sky
};

function nodeColor(node) {
  const c = APP_TYPE_COLORS[node.type];
  if (!c) return null; // data-plane nodes: page.tsx handles coloring by domain
  return {
    background: c,
    border: c,
    highlight: { background: "#f1f5f9", border: "#fff" },
    hover: { background: "#fff", border: c },
  };
}

function transformNode(n) {
  const cfg = TYPE_CONFIG[n.type] ?? { size: 12, shape: "dot" };
  const color = nodeColor(n);
  const out = {
    id: n.id,
    label: n.label,
    type: n.type,
    domain: n.domain ?? undefined,
    scope: n.scope ?? undefined,
    category: n.category ?? "",
    size: cfg.size,
    shape: cfg.shape,
    font: { size: 13, color: "#e2e8f0" },
  };
  if (color) out.color = color;
  // Strip undefined keys for a clean JSON
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

function transformEdge(e) {
  return { from: e.source, to: e.target, label: e.relation };
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (!existsSync(GRAPH_PATH)) {
  console.error(`ERROR: ${GRAPH_PATH} not found.`);
  console.error("Run `node scripts/graphify-app-nodes.mjs` first.");
  process.exit(1);
}

if (!existsSync(OPS_ROOT)) {
  console.error(`ERROR: ops repo not found at ${OPS_ROOT}`);
  console.error("Expected sibling directory: ../swfldatagulf-ops");
  process.exit(1);
}

const graph = JSON.parse(readFileSync(GRAPH_PATH, "utf8"));

const outNodes = graph.nodes.map(transformNode);
const outEdges = graph.edges.map(transformEdge);

// Count by type for the summary
const byType = {};
for (const n of outNodes) byType[n.type] = (byType[n.type] || 0) + 1;
const typeSummary = Object.entries(byType)
  .sort((a, b) => b[1] - a[1])
  .map(([t, c]) => `${t}:${c}`)
  .join("  ");

const output = { nodes: outNodes, edges: outEdges };
writeFileSync(OPS_TARGET, JSON.stringify(output, null, 2));

console.log(`graphify-publish: wrote ${OPS_TARGET}`);
console.log(`  ${outNodes.length} nodes (${typeSummary})`);
console.log(`  ${outEdges.length} edges`);
console.log(`\nNext: commit the ops repo and deploy.`);
