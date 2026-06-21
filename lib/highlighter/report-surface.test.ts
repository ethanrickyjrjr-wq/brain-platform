import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Glob } from "bun";
import {
  buildReportId,
  parseReportId,
  REPORT_SURFACE_KINDS,
  type ReportSurfaceKind,
} from "./report-surface";
import { resolveReportGrounding } from "./report-grounding";

const REPO_ROOT = path.join(import.meta.dir, "..", "..");

// ---------------------------------------------------------------------------
// Contract: buildReportId / parseReportId round-trip
// ---------------------------------------------------------------------------

test("brain ids stay bare and round-trip", () => {
  expect(buildReportId("brain", "master")).toBe("master");
  expect(parseReportId("master")).toEqual({ kind: "brain", id: "master" });
  expect(parseReportId("home-values-swfl")).toEqual({ kind: "brain", id: "home-values-swfl" });
});

test("synthetic surfaces namespace and round-trip", () => {
  const cases: Array<[ReportSurfaceKind, string]> = [
    ["zip", "33931"],
    ["corridor", "us-41-fort-myers"],
    ["method", "cap_rate_median"],
    ["source", "rsw_passengers"],
  ];
  for (const [kind, id] of cases) {
    const encoded = buildReportId(kind, id);
    expect(encoded).toBe(`${kind}:${id}`);
    expect(parseReportId(encoded)).toEqual({ kind, id });
  }
});

test("an unknown prefix decodes as a bare brain slug (back-compat)", () => {
  // A future/legacy id with a `foo:` prefix is NOT a known kind → treated as a
  // brain slug, exactly as before the contract existed. (fetchBrain then 404s it,
  // which is correct — it is genuinely unknown.)
  expect(parseReportId("foo:bar")).toEqual({ kind: "brain", id: "foo:bar" });
});

// ---------------------------------------------------------------------------
// Resolver: every surface kind grounds on a real dossier (no 404 from a known
// kind). This reads brains/*.md from disk — Node/Bun runtime, repo cwd.
// ---------------------------------------------------------------------------

test("resolveReportGrounding returns a real block + token for every kind", async () => {
  const ids: Record<ReportSurfaceKind, string> = {
    brain: "master",
    zip: buildReportId("zip", "33931"),
    corridor: buildReportId("corridor", "us-41-fort-myers"),
    method: buildReportId("method", "cap_rate_median"),
    source: buildReportId("source", "rsw_passengers"),
  };
  for (const kind of REPORT_SURFACE_KINDS) {
    const g = await resolveReportGrounding(ids[kind], { origin: "https://www.swfldatagulf.com" });
    expect(g.blocks.length).toBeGreaterThan(0);
    expect(g.blocks[0].dossier).toBeTruthy();
    expect(typeof g.freshnessToken).toBe("string");
    expect(g.freshnessToken.length).toBeGreaterThan(0);
  }
});

// ---------------------------------------------------------------------------
// THE GUARD — this is the test that ends the 404 class. Every page that mounts
// the Ask-AI dock (HighlighterLayer) must declare its surface via buildReportId,
// so converse can always resolve its reportId. The single exception is the
// canonical brain report page `app/r/[slug]/page.tsx`, whose `[slug]` param IS a
// brain slug (the bare = brain contract). A new synthetic page that mounts the
// dock with a raw expression fails here BEFORE it can 404 in production.
// ---------------------------------------------------------------------------

test("GUARD: every dock-mounting report page declares its surface kind", () => {
  const glob = new Glob("app/r/**/page.tsx");
  const offenders: string[] = [];

  for (const rel of glob.scanSync(REPO_ROOT)) {
    const src = readFileSync(path.join(REPO_ROOT, rel), "utf-8");
    if (!src.includes("HighlighterLayer")) continue;

    const norm = rel.replace(/\\/g, "/");
    // The one allowed bare-slug mount: the canonical brain report page.
    const isBrainSlugPage = norm.endsWith("app/r/[slug]/page.tsx");

    // Find each reportId={...} expression the page passes to the dock.
    const matches = [...src.matchAll(/reportId=\{([^}]*)\}/g)].map((m) => m[1].trim());
    expect(matches.length).toBeGreaterThan(0); // it mounts the dock → must pass a reportId

    for (const expr of matches) {
      const ok = expr.startsWith("buildReportId(") || (isBrainSlugPage && expr === "slug");
      if (!ok) offenders.push(`${norm}: reportId={${expr}}`);
    }
  }

  expect(offenders).toEqual([]);
});
