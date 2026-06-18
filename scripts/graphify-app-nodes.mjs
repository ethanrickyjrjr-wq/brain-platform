#!/usr/bin/env node
// scripts/graphify-app-nodes.mjs
//
// Extracts app-layer nodes (pages, components, API routes, hooks, tables) from
// the Next.js codebase and merges them into graphify-out/graph.json so that
// `graphify query/path/explain` works across BOTH the data plane (brains,
// slugs, pipelines) and the application plane.
//
// Outputs:
//   graphify-out/app-graph.json  — standalone app-plane graph (networkx format)
//   graphify-out/graph.json      — patched in-place with app nodes + edges
//   graphify-out/wiki/index.md   — auto-generated navigation index
//
// Run standalone:  node scripts/graphify-app-nodes.mjs
// Full update:     bun run graphify:update   (graphify update . first, then this)

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, basename, dirname, relative } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "graphify-out");
const WIKI_DIR = join(OUT, "wiki");

const GRAPH_PATH = join(OUT, "graph.json");
const APP_GRAPH_PATH = join(OUT, "app-graph.json");
const WIKI_PATH = join(WIKI_DIR, "index.md");

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "__tests__",
  "__mocks__",
  "coverage",
]);

// ── File walker ───────────────────────────────────────────────────────────────

function walk(dir, filter) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full, filter));
    } else if (filter(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

// ── Route helpers ─────────────────────────────────────────────────────────────

function fileToRoute(absPath, baseDir) {
  const rel = relative(baseDir, absPath).replace(/\\/g, "/");
  // Strip trailing /page.tsx or /route.ts
  const route = rel
    .replace(/\/page\.tsx$/, "")
    .replace(/\/route\.ts$/, "")
    .replace(/^page\.tsx$/, "")
    .replace(/^route\.ts$/, "");
  return "/" + (route || "");
}

// Return the graph node ID for a source file, or null if not a primary node.
function fileToNodeId(absPath) {
  const rel = relative(ROOT, absPath).replace(/\\/g, "/");
  if (rel.startsWith("app/api/") && basename(absPath) === "route.ts") {
    return `api_route:/api${fileToRoute(absPath, join(ROOT, "app", "api"))}`;
  }
  if (rel.startsWith("app/") && basename(absPath) === "page.tsx") {
    return `page:${fileToRoute(absPath, join(ROOT, "app"))}`;
  }
  if (rel.startsWith("components/") && absPath.endsWith(".tsx")) {
    return `component:${basename(absPath, ".tsx")}`;
  }
  return null;
}

// ── Node extractors ───────────────────────────────────────────────────────────

function extractPages() {
  const appDir = join(ROOT, "app");
  return walk(appDir, (n) => n === "page.tsx").map((f) => ({
    id: `page:${fileToRoute(f, appDir)}`,
    label: fileToRoute(f, appDir) === "/" ? "/ (home)" : fileToRoute(f, appDir),
    type: "page",
    source_file: relative(ROOT, f).replace(/\\/g, "/"),
  }));
}

function extractComponents() {
  const compDir = join(ROOT, "components");
  // Skip barrel index files; only .tsx
  return walk(compDir, (n) => n.endsWith(".tsx") && n !== "index.tsx").map((f) => ({
    id: `component:${basename(f, ".tsx")}`,
    label: basename(f, ".tsx"),
    type: "component",
    source_file: relative(ROOT, f).replace(/\\/g, "/"),
  }));
}

function extractApiRoutes() {
  const apiDir = join(ROOT, "app", "api");
  return walk(apiDir, (n) => n === "route.ts").map((f) => {
    const route = `/api${fileToRoute(f, apiDir)}`;
    return {
      id: `api_route:${route}`,
      label: route,
      type: "api_route",
      source_file: relative(ROOT, f).replace(/\\/g, "/"),
    };
  });
}

function extractHooks() {
  const libDir = join(ROOT, "lib");
  const seen = new Map(); // hookName → node (dedup across files)
  const files = walk(libDir, (n) => n.endsWith(".ts") || n.endsWith(".tsx"));
  for (const f of files) {
    const content = readFileSync(f, "utf8");
    for (const [, name] of content.matchAll(
      /export\s+(?:async\s+)?(?:function|const)\s+(use[A-Z]\w*)/g,
    )) {
      if (!seen.has(name)) {
        seen.set(name, {
          id: `hook:${name}`,
          label: name,
          type: "hook",
          source_file: relative(ROOT, f).replace(/\\/g, "/"),
        });
      }
    }
  }
  return [...seen.values()];
}

function extractTables() {
  // Migrations live in docs/sql/ in this repo (not supabase/migrations/)
  const migDir = join(ROOT, "docs", "sql");
  const seen = new Map();
  for (const f of walk(migDir, (n) => n.endsWith(".sql"))) {
    const content = readFileSync(f, "utf8");
    for (const [, name] of content.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:\w+\.)?(\w+)/gi,
    )) {
      if (!seen.has(name)) {
        seen.set(name, {
          id: `table:${name}`,
          label: name,
          type: "table",
          source_file: relative(ROOT, f).replace(/\\/g, "/"),
        });
      }
    }
  }
  return [...seen.values()];
}

// ── Edge extraction ───────────────────────────────────────────────────────────
//
// Edge relations (mirror the data-plane vocabulary):
//   renders  — page/component → component   (import from @/components/…)
//   uses     — any file       → hook        (import of a use* export from @/lib/…)
//   fetches  — any file       → api_route   (fetch('/api/…') call)
//   queries  — api_route/hook → table       (.from('tableName') Supabase call)
//   writes   — pipeline       → table       (cadence_registry dlt_schema_name)

function extractEdges(allNodes) {
  const nodeIds = new Set(allNodes.map((n) => n.id));
  const edgeKeys = new Set();
  const edges = [];

  function addEdge(source, target, relation) {
    if (!nodeIds.has(source) || !nodeIds.has(target)) return;
    const key = `${source}→${target}→${relation}`;
    if (!edgeKeys.has(key)) {
      edgeKeys.add(key);
      edges.push({ source, target, relation });
    }
  }

  // Build a map from relative lib path → hook node IDs defined in that file
  const hooksByFile = new Map(); // relPath → hookId[]
  for (const n of allNodes.filter((n) => n.type === "hook")) {
    const rel = n.source_file;
    if (!hooksByFile.has(rel)) hooksByFile.set(rel, []);
    hooksByFile.get(rel).push(n.id);
  }

  // Scan all TSX/TS source files for edges
  const scanRoots = [join(ROOT, "app"), join(ROOT, "components"), join(ROOT, "lib")];
  for (const root of scanRoots) {
    for (const f of walk(root, (n) => n.endsWith(".tsx") || n.endsWith(".ts"))) {
      const content = readFileSync(f, "utf8");
      const sourceId = fileToNodeId(f);

      // renders: import from '@/components/SomeName'
      for (const [, name] of content.matchAll(
        /from\s+['"]@\/components\/(?:[^'"]*\/)?(\w+)['"]/g,
      )) {
        if (sourceId) addEdge(sourceId, `component:${name}`, "renders");
      }

      // uses: import { useXxx } from '@/lib/...'
      // Capture the full import statement so we can see named exports
      for (const [, namedA, namedB, fromPath] of content.matchAll(
        /import\s+(?:type\s+)?(?:\{([^}]+)\}|\w+)(?:\s*,\s*\{([^}]+)\})?\s+from\s+['"](@\/lib\/[^'"]+)['"]/g,
      )) {
        const libPath = fromPath.slice(2); // strip '@/'  → 'lib/chat/use-project-thread'
        const fileBase = libPath.split("/").pop() ?? "";

        // Named imports that are hooks
        const namedRaw = ((namedA ?? "") + "," + (namedB ?? ""))
          .split(",")
          .map((s) =>
            s
              .trim()
              .split(/\s+as\s+/)[0]
              .trim(),
          )
          .filter((n) => n.startsWith("use") && n.length > 3);

        for (const h of namedRaw) {
          if (sourceId && nodeIds.has(`hook:${h}`)) addEdge(sourceId, `hook:${h}`, "uses");
        }

        // Fallback: infer from filename (use-project-thread → useProjectThread)
        if (namedRaw.length === 0 && fileBase.startsWith("use")) {
          const camel = fileBase.replace(/-(\w)/g, (_, c) => c.toUpperCase());
          if (sourceId && nodeIds.has(`hook:${camel}`)) addEdge(sourceId, `hook:${camel}`, "uses");
        }
      }

      // fetches: fetch('/api/...')  — string or template literal start
      for (const [, path] of content.matchAll(/fetch\(\s*['"`](\/api\/[^'"`?\s#]+)/g)) {
        if (sourceId && nodeIds.has(`api_route:${path}`)) {
          addEdge(sourceId, `api_route:${path}`, "fetches");
        }
      }

      // queries: .from('tableName') Supabase calls
      const rel = relative(ROOT, f).replace(/\\/g, "/");
      if (rel.startsWith("app/api/") || rel.startsWith("lib/")) {
        for (const [, tableName] of content.matchAll(/\.from\(\s*['"](\w+)['"]\s*\)/g)) {
          const target = `table:${tableName}`;
          if (!nodeIds.has(target)) continue;
          if (sourceId) {
            addEdge(sourceId, target, "queries");
          } else {
            // lib file: wire from each hook defined in this file
            const hooksHere = hooksByFile.get(rel) ?? [];
            for (const hookId of hooksHere) addEdge(hookId, target, "queries");
          }
        }
      }
    }
  }

  // writes: pipeline → table via dlt_schema_name in cadence_registry.yaml
  const cadencePath = join(ROOT, "ingest", "cadence_registry.yaml");
  if (existsSync(cadencePath)) {
    try {
      const yaml = parseYaml(readFileSync(cadencePath, "utf8"));
      const pipelines = yaml?.pipelines ?? [];
      for (const p of pipelines) {
        if (!p?.name || !p?.dlt_schema_name) continue;
        // dlt_schema_name is the Postgres schema name for the pipeline's tables
        // Map to a table node if one exists
        const pipeId = `pipeline:${p.name}`;
        if (nodeIds.has(pipeId) && nodeIds.has(`table:${p.dlt_schema_name}`)) {
          addEdge(pipeId, `table:${p.dlt_schema_name}`, "writes");
        }
      }
    } catch (e) {
      console.warn("  warn: could not parse cadence_registry.yaml:", e.message);
    }
  }

  return edges;
}

// ── Wiki generator ────────────────────────────────────────────────────────────

function generateWiki(allNodes, allEdges) {
  const byType = {};
  for (const n of allNodes) (byType[n.type] = byType[n.type] || []).push(n);

  const typeCounts = Object.entries(byType)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([t, ns]) => `| \`${t}\` | ${ns.length} |`)
    .join("\n");

  const relationCounts = {};
  for (const e of allEdges) relationCounts[e.relation] = (relationCounts[e.relation] || 0) + 1;
  const edgeCounts = Object.entries(relationCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([r, c]) => `| \`${r}\` | ${c} |`)
    .join("\n");

  return `# Graphify Knowledge Graph — Index

_Auto-generated by \`scripts/graphify-app-nodes.mjs\`. Re-run after code changes._

## Counts

| Node type | Count |
|-----------|-------|
${typeCounts}
| **Total nodes** | **${allNodes.length}** |

| Edge relation | Count |
|---------------|-------|
${edgeCounts}
| **Total edges** | **${allEdges.length}** |

## Node Types

### Data Plane
| Type | Description |
|------|-------------|
| \`brain\` | Refinery brain packs (\`refinery/packs/**\`) |
| \`slug\` | Metric slugs in brain-vocabulary.json |
| \`pipeline\` | Ingest pipelines from cadence_registry.yaml |

### Application Plane
| Type | Description |
|------|-------------|
| \`page\` | Next.js route pages (\`app/**/page.tsx\`) |
| \`component\` | React components (\`components/**/*.tsx\`) |
| \`api_route\` | API handlers (\`app/api/**/route.ts\`) |
| \`hook\` | Data/state hooks exported from \`lib/**\` |
| \`table\` | Supabase tables from migrations |

## Example Queries

\`\`\`bash
# Application plane
graphify query "project thread hook"
graphify query "api routes projects table"
graphify query "BriefcaseChat component"
graphify query "branding api route"

# Cross-plane (data → app)
graphify path "pipeline:leepa" "page:/project/[id]"
graphify query "what pages fetch swfl data"
\`\`\`

## Update Commands

\`\`\`bash
node scripts/graphify-app-nodes.mjs   # app layer only (fast)
bun run graphify:update               # full: brains graph + app layer
bun run graphify:publish              # write merged graph to ops repo
\`\`\`
`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log("graphify-app-nodes: extracting application plane…\n");

const pages = extractPages();
const components = extractComponents();
const apiRoutes = extractApiRoutes();
const hooks = extractHooks();
const tables = extractTables();

console.log(`  pages:       ${pages.length}`);
console.log(`  components:  ${components.length}`);
console.log(`  api_routes:  ${apiRoutes.length}`);
console.log(`  hooks:       ${hooks.length}`);
console.log(`  tables:      ${tables.length}`);

const appNodes = [...pages, ...components, ...apiRoutes, ...hooks, ...tables];

// Load the existing brains graph
const brainGraph = JSON.parse(readFileSync(GRAPH_PATH, "utf8"));

// Extract edges (needs all node IDs to validate endpoints)
console.log("\nExtracting edges…");
const appEdges = extractEdges([...brainGraph.nodes, ...appNodes]);
console.log(`  app edges:   ${appEdges.length}  (renders/uses/fetches/queries/writes)`);

// ── Write app-graph.json (standalone, app plane only) ────────────────────────
writeFileSync(
  APP_GRAPH_PATH,
  JSON.stringify(
    {
      directed: true,
      nodes: appNodes,
      edges: appEdges,
      meta: { generated: new Date().toISOString(), generator: "graphify-app-nodes.mjs" },
    },
    null,
    2,
  ),
);
console.log(`\n  → ${relative(ROOT, APP_GRAPH_PATH)}`);

// ── Patch graph.json (merge app plane into brains graph) ─────────────────────
const existingNodeIds = new Set(brainGraph.nodes.map((n) => n.id));
const newNodes = appNodes.filter((n) => !existingNodeIds.has(n.id));

const existingEdgeKeys = new Set(
  brainGraph.edges.map((e) => `${e.source}→${e.target}→${e.relation}`),
);
const newEdges = appEdges.filter(
  (e) => !existingEdgeKeys.has(`${e.source}→${e.target}→${e.relation}`),
);

const merged = {
  ...brainGraph,
  nodes: [...brainGraph.nodes, ...newNodes],
  edges: [...brainGraph.edges, ...newEdges],
};
writeFileSync(GRAPH_PATH, JSON.stringify(merged, null, 2));
console.log(`  → graphify-out/graph.json  (+${newNodes.length} nodes, +${newEdges.length} edges)`);

// ── Write wiki/index.md ───────────────────────────────────────────────────────
if (!existsSync(WIKI_DIR)) mkdirSync(WIKI_DIR, { recursive: true });
writeFileSync(WIKI_PATH, generateWiki(merged.nodes, merged.edges));
console.log(`  → graphify-out/wiki/index.md`);

console.log(`\nDone. ${merged.nodes.length} total nodes · ${merged.edges.length} total edges`);
