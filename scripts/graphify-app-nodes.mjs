#!/usr/bin/env node
// scripts/graphify-app-nodes.mjs
//
// Extracts app-layer nodes (pages, components, API routes, hooks, tables,
// lib_modules, app_components) from the Next.js codebase and merges them into
// graphify-out/graph.json so that `graphify query/path/explain` works across
// BOTH the data plane (brains, slugs, pipelines) and the application plane.
//
// Node types:
//   page          — app/**/page.tsx
//   component     — components/**/*.tsx
//   api_route     — app/api/**/route.ts
//   hook          — use* exports from lib/**
//   table         — CREATE TABLE in docs/sql/*.sql
//   lib_module    — non-test utility/service files in lib/** (business logic layer)
//   app_component — co-located tsx files in app/** that aren't page/layout/error
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
import { execSync } from "child_process";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "graphify-out");
const WIKI_DIR = join(OUT, "wiki");

const GRAPH_PATH = join(OUT, "graph.json");
const APP_GRAPH_PATH = join(OUT, "app-graph.json");
const WIKI_PATH = join(WIKI_DIR, "index.md");

// NOTE: no "build" entry — app/api/projects/[id]/build/route.ts is a real
// route whose folder happens to be named "build"; a generic skip here would
// silently drop it (confirmed the only "build"-named dir under app/lib/components).
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
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

const APP_COMPONENT_SKIP = new Set([
  "page.tsx",
  "layout.tsx",
  "error.tsx",
  "loading.tsx",
  "not-found.tsx",
  "template.tsx",
]);

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
  // Co-located tsx files in app/ that aren't special Next.js files
  if (
    rel.startsWith("app/") &&
    !rel.startsWith("app/api/") &&
    absPath.endsWith(".tsx") &&
    !APP_COMPONENT_SKIP.has(basename(absPath))
  ) {
    return `app_component:${basename(absPath, ".tsx")}`;
  }
  // Lib utility/service files (covers hooks too, for cross-file import edges)
  if (rel.startsWith("lib/") && (absPath.endsWith(".ts") || absPath.endsWith(".tsx"))) {
    return `lib_module:${rel.replace(/\.(tsx?)$/, "")}`;
  }
  return null;
}

// ── Node extractors ───────────────────────────────────────────────────────────

// graphify's own BRAIN_CATALOG parser (refinery/packs/catalog.mts) silently
// drops entries whose `scope` uses string concatenation or that carry an
// inline comment — a limitation of its lightweight parser, not our code — and
// catalog.mts never lists packs still marked KNOWN_INCOMPLETE (see
// catalog.test.mts). Read brain identity straight from each pack module
// instead: it's the source of truth PER_PACK_REGISTRY (index.mts) already
// trusts, so this never disagrees with what's actually wired up. Only fills
// gaps — a brain graphify already typed (from BRAIN_CATALOG) keeps its
// richer domain/scope/community data; see the newNodes dedupe below.
function extractBrains() {
  const packsDir = join(ROOT, "refinery", "packs");
  const seen = new Map();
  for (const name of readdirSync(packsDir)) {
    if (!name.endsWith(".mts") || name.includes(".test.") || name.startsWith("_")) continue;
    if (name === "index.mts" || name === "catalog.mts") continue;
    const f = join(packsDir, name);
    const content = readFileSync(f, "utf8");

    // Every pack exports exactly one `PackDefinition` object whose FIRST field
    // is always `id: "..."` (checked directly, not via the less-common
    // `BRAIN_ID` const some newer packs also declare) — that consistency is
    // what makes this extractor reliable across all 40+ packs.
    const defMatch = content.match(/export\s+const\s+\w+\s*:\s*PackDefinition\s*=\s*\{/);
    if (!defMatch) continue;
    const body = content.slice(defMatch.index + defMatch[0].length);

    const idMatch = body.match(/\bid:\s*["']([^"']+)["']/);
    if (!idMatch) continue;
    const id = idMatch[1];

    const domainMatch = body.match(/\bdomain:\s*["']([^"']+)["']/);
    const labelMatch = body.match(/\bpublic_label:\s*["']([^"']+)["']/);

    // scope: may be one literal or several joined with `+` — pull every
    // string literal in the field and concatenate rather than eval it.
    const scopeBlockMatch = body.match(
      /\bscope:\s*([\s\S]*?),\s*\n\s*(?:ttl_seconds|sources|input_brains)/,
    );
    let scope;
    if (scopeBlockMatch) {
      const pieces = [...scopeBlockMatch[1].matchAll(/["']((?:[^"'\\]|\\.)*)["']/g)].map(
        (m) => m[1],
      );
      if (pieces.length) scope = pieces.join("");
    }

    const nodeId = `brain:${id}`;
    if (!seen.has(nodeId)) {
      seen.set(nodeId, {
        id: nodeId,
        label: labelMatch ? labelMatch[1] : id,
        type: "brain",
        domain: domainMatch ? domainMatch[1] : undefined,
        scope,
        source_file: relative(ROOT, f).replace(/\\/g, "/"),
      });
    }
  }
  return [...seen.values()].map((n) =>
    Object.fromEntries(Object.entries(n).filter(([, v]) => v !== undefined)),
  );
}

// graphify's own cadence_registry.yaml → pipeline-node extractor also drops
// entries silently (confirmed: 61 of 65 `pipelines:` entries surface; e.g.
// market_heat_swfl and census_acs — nothing distinguishes the missing ones
// structurally, so this is the same parser-gap pattern as extractBrains()).
// Read the YAML directly with the same `yaml` package already used below for
// the writes-edge extraction, so every top-level pipeline is guaranteed to
// appear regardless of graphify's own coverage.
function extractPipelines() {
  const cadencePath = join(ROOT, "ingest", "cadence_registry.yaml");
  if (!existsSync(cadencePath)) return [];
  let doc;
  try {
    doc = parseYaml(readFileSync(cadencePath, "utf8"));
  } catch (e) {
    console.warn("  warn: could not parse cadence_registry.yaml for pipelines:", e.message);
    return [];
  }
  const seen = new Map();
  for (const p of doc?.pipelines ?? []) {
    if (!p?.name) continue;
    const nodeId = `pipeline:${p.name}`;
    if (!seen.has(nodeId)) {
      seen.set(nodeId, {
        id: nodeId,
        label: p.name,
        type: "pipeline",
        lane: p.lane,
        cadence_days: p.cadence_days,
        source_file: "ingest/cadence_registry.yaml",
      });
    }
  }
  return [...seen.values()].map((n) =>
    Object.fromEntries(Object.entries(n).filter(([, v]) => v !== undefined)),
  );
}

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
    // Strip single-line SQL comments before matching — avoids catching table names
    // from comments like "-- shipped a CREATE TABLE for them" or "CREATE TABLE when".
    const content = readFileSync(f, "utf8").replace(/--[^\n]*/g, "");
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

function extractAppComponents() {
  const appDir = join(ROOT, "app");
  return walk(appDir, (n) => n.endsWith(".tsx") && !APP_COMPONENT_SKIP.has(n))
    .filter((f) => !relative(ROOT, f).replace(/\\/g, "/").startsWith("app/api/"))
    .map((f) => ({
      id: `app_component:${basename(f, ".tsx")}`,
      label: basename(f, ".tsx"),
      type: "app_component",
      source_file: relative(ROOT, f).replace(/\\/g, "/"),
    }));
}

function extractLibModules() {
  const libDir = join(ROOT, "lib");
  const seen = new Map();
  for (const f of walk(
    libDir,
    (n) =>
      (n.endsWith(".ts") || n.endsWith(".tsx")) && !n.includes(".test.") && !n.includes(".spec."),
  )) {
    const content = readFileSync(f, "utf8");
    // Skip files with no exports (type stubs, barrel re-exports only)
    if (!/^export\s/m.test(content)) continue;
    const rel = relative(ROOT, f).replace(/\\/g, "/");
    const id = `lib_module:${rel.replace(/\.(tsx?)$/, "")}`;
    if (!seen.has(id)) {
      seen.set(id, {
        id,
        label: basename(f).replace(/\.(tsx?)$/, ""),
        type: "lib_module",
        source_file: rel,
      });
    }
  }
  return [...seen.values()];
}

// ── Edge extraction ───────────────────────────────────────────────────────────
//
// Edge relations:
//   renders  — page/component/app_component → component/app_component
//   uses     — any file → hook        (use* import from @/lib/…)
//   imports  — any file → lib_module  (non-hook import from @/lib/…)
//   fetches  — any file → api_route   (fetch('/api/…') call)
//   queries  — api_route/hook/lib_module → table  (.from('tableName'))
//   writes   — pipeline → table       (cadence_registry dlt_schema_name)
//   feeds    — pipeline → brain       (PACK_ID in duckdb_pipelines/*/constants.py)

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

      // uses / imports: any import from '@/lib/...'
      for (const [, namedA, namedB, fromPath] of content.matchAll(
        /import\s+(?:type\s+)?(?:\{([^}]+)\}|\w+)(?:\s*,\s*\{([^}]+)\})?\s+from\s+['"](@\/lib\/[^'"]+)['"]/g,
      )) {
        const libPath = fromPath.slice(2); // strip '@/'  → 'lib/chat/use-project-thread'
        const fileBase = libPath.split("/").pop() ?? "";

        // imports edge → lib_module (file-level, works for any @/lib import)
        const libModuleId = `lib_module:${libPath}`;
        if (sourceId && nodeIds.has(libModuleId)) {
          addEdge(sourceId, libModuleId, "imports");
        }

        // uses edge → hook (named symbol level)
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

        // Fallback: infer hook from filename (use-project-thread → useProjectThread)
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
          if (sourceId) addEdge(sourceId, target, "queries");
          // Also wire from any hooks defined in this file
          const hooksHere = hooksByFile.get(rel) ?? [];
          for (const hookId of hooksHere) addEdge(hookId, target, "queries");
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

  // feeds: pipeline → consuming brain, from PACK_ID in each DuckDB pipeline's
  // constants.py. Without this, every pipeline node floats unconnected on the
  // graph even though the brain genuinely consumes it (the data-plane edge layer
  // previously only had ~2 pipeline→table `writes` edges; parquet pipelines have
  // no SQL table node to write to). The pipeline NODE name can carry a lane
  // suffix (zhvi_swfl_duckdb) the code dir (zhvi_swfl) lacks, so resolve by
  // stripping known suffixes. PACK_ID may be annotated (`PACK_ID: str | None =`).
  const duckdbDir = join(ROOT, "ingest", "duckdb_pipelines");
  for (const n of allNodes) {
    if (n.type !== "pipeline") continue;
    const base = n.id.replace(/^pipeline:/, "");
    const candidates = [base, base.replace(/_duckdb$/, ""), base.replace(/_tier2$/, "")];
    for (const cand of candidates) {
      const constPath = join(duckdbDir, cand, "constants.py");
      if (!existsSync(constPath)) continue;
      const m = readFileSync(constPath, "utf8").match(
        /^PACK_ID(?:\s*:\s*[^=\n]+)?\s*=\s*["']([^"']+)["']/m,
      );
      if (m) addEdge(n.id, `brain:${m[1]}`, "feeds");
      break; // first matching code dir wins
    }
  }

  // reads: brain → table  (via refinery/sources → data_lake.*)
  // Source files use variable-based .from(TABLE) calls — `const TABLE = "bls_laus"` —
  // that the literal-string regex above can't catch, and refinery/ isn't in scanRoots.
  // Walk refinery/sources for TABLE/VIEW consts (require data_lake guard), then trace
  // pack imports to emit brain→table edges. addEdge silently drops edges whose table
  // node doesn't exist (parquet-only sources have no CREATE TABLE in docs/sql/).
  const refSrcDir = join(ROOT, "refinery", "sources");
  const refPacksDir = join(ROOT, "refinery", "packs");
  const sourceTableMap = new Map(); // source basename → tableName[]
  if (existsSync(refSrcDir)) {
    for (const f of walk(refSrcDir, (n) => n.endsWith(".mts") && !n.includes(".test."))) {
      const content = readFileSync(f, "utf8");
      const tables = new Set();
      for (const [, tbl] of content.matchAll(/const\s+\w*(?:TABLE|VIEW)\w*\s*=\s*['"](\w+)['"]/g)) {
        tables.add(tbl);
      }
      for (const [, tbl] of content.matchAll(/\.from\(\s*['"](\w+)['"]\s*\)/g)) {
        tables.add(tbl);
      }
      if (tables.size) sourceTableMap.set(basename(f), [...tables]);
    }
  }
  if (existsSync(refPacksDir)) {
    for (const f of walk(refPacksDir, (n) => n.endsWith(".mts") && !n.includes(".test."))) {
      const content = readFileSync(f, "utf8");
      const brainMatch = content.match(/const\s+BRAIN_ID\s*=\s*['"]([^'"]+)['"]/);
      if (!brainMatch) continue;
      const brainNodeId = `brain:${brainMatch[1]}`;
      if (!nodeIds.has(brainNodeId)) continue;
      for (const [, srcPath] of content.matchAll(/from\s+['"]\.\.\/sources\/([^'"]+)['"]/g)) {
        const fname = basename(srcPath).replace(/\.mts$/, "") + ".mts";
        for (const tbl of sourceTableMap.get(fname) ?? []) {
          addEdge(brainNodeId, `table:${tbl}`, "reads");
        }
      }
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
| \`app_component\` | Co-located tsx files in \`app/**\` (non-page) |
| \`api_route\` | API handlers (\`app/api/**/route.ts\`) |
| \`hook\` | Data/state hooks exported from \`lib/**\` (use* symbols) |
| \`lib_module\` | Utility/service files in \`lib/**\` (business logic) |
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

const brains = extractBrains();
const pipelines = extractPipelines();
const pages = extractPages();
const components = extractComponents();
const apiRoutes = extractApiRoutes();
const hooks = extractHooks();
const tables = extractTables();
const appComponents = extractAppComponents();
const libModules = extractLibModules();

console.log(
  `  brains:        ${brains.length}  (fills gaps graphify's BRAIN_CATALOG parser misses)`,
);
console.log(
  `  pipelines:     ${pipelines.length}  (fills gaps graphify's cadence_registry parser misses)`,
);
console.log(`  pages:         ${pages.length}`);
console.log(`  components:    ${components.length}`);
console.log(`  app_components:${appComponents.length}`);
console.log(`  api_routes:    ${apiRoutes.length}`);
console.log(`  hooks:         ${hooks.length}`);
console.log(`  lib_modules:   ${libModules.length}`);
console.log(`  tables:        ${tables.length}`);

const appNodes = [
  ...brains,
  ...pipelines,
  ...pages,
  ...components,
  ...apiRoutes,
  ...hooks,
  ...tables,
  ...appComponents,
  ...libModules,
];

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
// graphify CLI outputs `links`; older snapshots used `edges` — normalise both
const brainEdges = brainGraph.edges ?? brainGraph.links ?? [];

const existingNodeIds = new Set(brainGraph.nodes.map((n) => n.id));
const newNodes = appNodes.filter((n) => !existingNodeIds.has(n.id));

const existingEdgeKeys = new Set(brainEdges.map((e) => `${e.source}→${e.target}→${e.relation}`));
const newEdges = appEdges.filter(
  (e) => !existingEdgeKeys.has(`${e.source}→${e.target}→${e.relation}`),
);

const headCommit = (() => {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
})();

const merged = {
  ...brainGraph,
  nodes: [...brainGraph.nodes, ...newNodes],
  edges: [...brainEdges, ...newEdges],
  meta: {
    ...(brainGraph.meta ?? {}),
    app_plane_commit: headCommit,
    app_plane_generated: new Date().toISOString(),
  },
};
writeFileSync(GRAPH_PATH, JSON.stringify(merged, null, 2));
console.log(`  → graphify-out/graph.json  (+${newNodes.length} nodes, +${newEdges.length} edges)`);

// ── Write wiki/index.md ───────────────────────────────────────────────────────
if (!existsSync(WIKI_DIR)) mkdirSync(WIKI_DIR, { recursive: true });
writeFileSync(WIKI_PATH, generateWiki(merged.nodes, merged.edges));
console.log(`  → graphify-out/wiki/index.md`);

console.log(`\nDone. ${merged.nodes.length} total nodes · ${merged.edges.length} total edges`);
