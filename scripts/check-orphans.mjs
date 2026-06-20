#!/usr/bin/env node
/**
 * check-orphans.mjs — Node port of runs/connectivity-map.py
 *
 * Classifies every App-Router page.tsx into:
 *   IN-CHROME       — reachable from a persistent nav/footer file (CHROME_FILES)
 *   body-link-only  — linked from a page body but not from chrome
 *   ORPHAN          — no inbound link at all
 *
 * Exits 1 if any ORPHAN route is NOT in ALLOWLIST.
 * Exits 0 if all orphans are allowlisted (or there are none).
 *
 * Flags:
 *   --all   print the full classification table (all routes)
 *   --json  write machine-readable JSON to stdout instead of the table
 *
 * B1 (landed 2026-06-20): CHROME_FILES now points at the unified
 *   components/nav/SiteShell.tsx + components/nav/SiteFooter.tsx.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");

// Persistent nav/footer surfaces — an inbound link from any of these means
// the route is reachable by clicking from "anywhere". B1 unified the old split
// (GlobalNav + landing Header/Footer) into SiteShell + SiteFooter.
const CHROME_FILES = new Set([
  "components/nav/SiteShell.tsx",
  "components/nav/SiteFooter.tsx",
  "app/layout.tsx",
  "app/project/layout.tsx",
  "app/project/ProjectsRail.tsx",
  "components/briefcase/AppShell.tsx",
  "components/briefcase/AiBriefcasePill.tsx",
  "components/briefcase/BriefcasePanel.tsx",
]);

// By-design URL-entry routes — these are intentionally orphaned (no nav link)
// because they are entered via direct URL (email links, iframes, auth, etc.).
// Treat dynamic provenance links (/r/method/[metric] via methodHref helper)
// as reachable too — they are linked at runtime from /r/[slug] metrics tables.
// Source: SITE FLOW BUILD/README.md "By-design URL-entry routes"
const ALLOWLIST = new Set([
  "/embed/cards/asking-rent", // iframe fragment
  "/embed/charts", // iframe fragment
  "/embed/footer-token", // iframe fragment
  "/embed/waitlist", // iframe fragment
  "/welcome", // email/funnel arrival
  "/claim", // email/funnel arrival
  "/login", // auth entry
  "/auth/auth-code-error", // auth error
  "/c/[id]", // share/print-only
  "/d/[...slug]", // share/print-only
  "/m/contacts/[token]", // tokenized manage link (email CTA)
  "/ops/data-inventory", // operator-facing (B6 relocates it — keep allowlisted until done)
  "/data-intel", // internal coverage doc — B6 noindexes/relocates (keep allowlisted until done)
  "/r/method/[metric]", // dynamic provenance links via methodHref helper
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively collect files matching a predicate. */
function walkFiles(dir, pred, results = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkFiles(full, pred, results);
    } else if (pred(entry, full)) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Convert an absolute page.tsx path to a route string.
 * Strips (group) segments and converts [dyn] segments as-is.
 */
function fileToRoute(absPath) {
  const appDir = join(ROOT, "app");
  let rel = relative(appDir, absPath).replace(/\\/g, "/");
  // Strip trailing /page.tsx or page.tsx
  if (rel.endsWith("/page.tsx")) rel = rel.slice(0, -"/page.tsx".length);
  else if (rel.endsWith("page.tsx")) rel = rel.slice(0, -"page.tsx".length);
  // Drop (group) segments
  const parts = rel.split("/").filter((seg) => seg && !(seg.startsWith("(") && seg.endsWith(")")));
  return "/" + parts.join("/");
}

/**
 * The literal prefix we expect in an href/push for this route
 * (up to the first dynamic segment).
 */
function linkPrefix(route) {
  const parts = [];
  for (const seg of route.replace(/^\//, "").split("/")) {
    if (seg.startsWith("[")) break;
    parts.push(seg);
  }
  return "/" + parts.join("/");
}

/**
 * The app subdir that "owns" this route (excluded from inbound search
 * so a page's own self-links don't count as inbound).
 */
function ownDir(route) {
  const segs = route
    .replace(/^\//, "")
    .split("/")
    .filter((s) => !s.startsWith("["));
  return "app" + (segs.length ? "/" + segs.join("/") : "");
}

// ---------------------------------------------------------------------------
// Link regex — mirrors connectivity-map.py LINK_RE
// href/to = "..." | router.push/replace("...") | redirect("...") | location.assign/href = "..."
// ---------------------------------------------------------------------------
const LINK_RE =
  /(?:href|to)\s*[:=]\s*[`"']([^`"'#?]+)|router\.(?:push|replace)\(\s*[`"']([^`"'#?]+)|redirect\(\s*[`"']([^`"'#?]+)|location\.(?:assign|href\s*=)\s*\(?\s*[`"']([^`"'#?]+)/g;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = new Set(process.argv.slice(2));
const showAll = args.has("--all");
const jsonMode = args.has("--json");

// 1) Enumerate all page.tsx files → routes
const appDir = join(ROOT, "app");
const pageFiles = walkFiles(appDir, (name) => name === "page.tsx");
const routes = [...new Set(pageFiles.map(fileToRoute))].sort();

// 2) Gather all source files from app/, components/, lib/
const SRC = [];
for (const base of ["app", "components", "lib"]) {
  const dir = join(ROOT, base);
  const files = walkFiles(dir, (name) => /\.(tsx?|jsx?)$/.test(name));
  for (const abs of files) {
    const rel = relative(ROOT, abs).replace(/\\/g, "/");
    let text;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    SRC.push({ rel, text });
  }
}

// 3) Classify each route
const results = {};
for (const route of routes) {
  const pref = linkPrefix(route);
  const odir = ownDir(route);

  const chromeHits = [];
  const bodyHits = [];

  for (const { rel, text } of SRC) {
    // Skip the route's own page implementation
    if (rel.startsWith(odir + "/") || rel === odir + "/page.tsx") continue;

    let found = false;

    // Reset lastIndex before each search
    LINK_RE.lastIndex = 0;
    let m;
    while ((m = LINK_RE.exec(text)) !== null) {
      const cand = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").replace(/\/$/, "") || "/";
      let ok;
      if (route === "/") {
        ok = cand === "/" || cand === "";
      } else if (route.includes("[")) {
        ok = cand === pref || cand.startsWith(pref + "/");
      } else {
        ok = cand === route || cand === route + "/";
      }
      if (ok) {
        found = true;
        break;
      }
    }

    // Also catch template-literal pushes like `/p/${id}` and arrival-builders
    if (!found && route.includes("[") && pref !== "/") {
      const escapedPref = pref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (
        new RegExp(escapedPref + "/\\$\\{").test(text) ||
        new RegExp(escapedPref + "/`").test(text)
      ) {
        found = true;
      }
    }

    if (found) {
      if (CHROME_FILES.has(rel)) {
        chromeHits.push(rel);
      } else {
        bodyHits.push(rel);
      }
    }
  }

  let status;
  if (chromeHits.length > 0) {
    status = "IN-CHROME";
  } else if (bodyHits.length > 0) {
    status = "body-link-only";
  } else {
    status = "ORPHAN";
  }

  results[route] = {
    status,
    chrome: [...new Set(chromeHits)].sort(),
    body: [...new Set(bodyHits)].sort().slice(0, 6),
  };
}

// 4) Categorise
const inChrome = routes.filter((r) => results[r].status === "IN-CHROME");
const bodyOnly = routes.filter((r) => results[r].status === "body-link-only");
const orphans = routes.filter((r) => results[r].status === "ORPHAN");
// NOTE: this is EVERY non-allowlisted orphan currently in the tree, not a diff vs
// origin/main. The push hook blocks while this is non-empty — a stricter, whole-tree
// policy — so keep the ALLOWLIST current (any known-but-pending orphan, e.g. /data-intel
// awaiting B6, belongs there) or an unrelated page.tsx push will be blocked too.
const newOrphans = orphans.filter((r) => !ALLOWLIST.has(r));

// 5) Output
if (jsonMode) {
  process.stdout.write(
    JSON.stringify(
      {
        summary: {
          total: routes.length,
          inChrome: inChrome.length,
          bodyOnly: bodyOnly.length,
          orphans: orphans.length,
          newOrphans: newOrphans.length,
        },
        routes: results,
        allowlist: [...ALLOWLIST].sort(),
        newOrphans,
      },
      null,
      2,
    ) + "\n",
  );
} else {
  const header = `ROUTES: ${routes.length} | in-chrome: ${inChrome.length} | body-link-only: ${bodyOnly.length} | ORPHANS: ${orphans.length}`;
  process.stdout.write(header + "\n\n");

  if (showAll) {
    for (const route of routes) {
      const v = results[route];
      const src =
        v.chrome.length > 0 ? v.chrome.join(",") : v.body.length > 0 ? v.body.join(",") : "-";
      const allowNote = ALLOWLIST.has(route) ? " [allowlisted]" : "";
      process.stdout.write(`  ${v.status.padEnd(16)} ${route.padEnd(34)} <- ${src}${allowNote}\n`);
    }
    process.stdout.write("\n");
    process.stdout.write("ORPHANS: " + JSON.stringify(orphans) + "\n");
    process.stdout.write("BODY-ONLY: " + JSON.stringify(bodyOnly) + "\n");
  }

  if (newOrphans.length > 0) {
    process.stdout.write(
      "\n" +
        "=".repeat(72) +
        "\n" +
        "ORPHAN pages with no inbound link and not in ALLOWLIST:\n" +
        newOrphans.map((r) => `  ${r}`).join("\n") +
        "\n\nadd an inbound link or allowlist it\n" +
        "=".repeat(72) +
        "\n",
    );
    process.exit(1);
  }
}

process.exit(0);
