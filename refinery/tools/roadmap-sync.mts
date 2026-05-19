/**
 * Roadmap-Sync generator — "the descriptive layer of the roadmap."
 *
 * Walks the PACKS registry and `git log` and writes the auto-generated
 * sidecar `docs/roadmap-status.md`. The formal `docs/ontology-and-roadmap.md`
 * keeps the prescriptive sections (§6 NOW, §7 NEAR-TERM, §8 LONG-TERM); this
 * sidecar replaces what used to be §5.1 (live brains) + §5.2 (DAG) and adds
 * the self-policing "trigger-shaped commits since last roadmap touch" table.
 *
 * Mirrors the shape of `refinery/tools/semantic-ledger.mts`: synchronous, no
 * tests, deterministic byte-for-byte output, regenerated into git so the
 * diff is the audit trail.
 *
 * Run:
 *   npm run roadmap:sync     (== bun refinery/tools/roadmap-sync.mts)
 */

import { execSync } from "node:child_process";
import { writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { PACKS } from "../config/packs.mts";
import type { TrustTier } from "../types/pack.mts";

const OUTPUT_PATH = path.join(process.cwd(), "docs", "roadmap-status.md");
const LITTLEBIRD_SYNC_PATH = path.join(
  process.cwd(),
  "docs",
  "littlebird-notes",
  "latest-sync.md",
);
const ROADMAP_DOC = "docs/ontology-and-roadmap.md";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

function gitShortSha(): string {
  return git("rev-parse --short HEAD") || "(no git)";
}

function lastRoadmapDocTouch(): {
  sha: string;
  iso: string;
  subject: string;
} {
  const line = git(`log -1 --format=%h%x09%aI%x09%s -- ${ROADMAP_DOC}`);
  if (!line) return { sha: "(none)", iso: "(none)", subject: "(none)" };
  const [sha, iso, subject] = line.split("\t");
  return {
    sha: sha ?? "(none)",
    iso: iso ?? "(none)",
    subject: subject ?? "(none)",
  };
}

interface CommitInfo {
  sha: string;
  iso: string;
  subject: string;
  files: string[];
}

function commitsSinceLastRoadmapTouch(): CommitInfo[] {
  const last = lastRoadmapDocTouch();
  if (last.sha === "(none)") return [];
  const raw = git(`log ${last.sha}..HEAD --format=%h%x09%aI%x09%s --name-only`);
  if (!raw) return [];
  const out: CommitInfo[] = [];
  let cur: CommitInfo | null = null;
  for (const line of raw.split("\n")) {
    if (line.includes("\t")) {
      if (cur) out.push(cur);
      const [sha, iso, subject] = line.split("\t");
      cur = {
        sha: sha ?? "",
        iso: iso ?? "",
        subject: subject ?? "",
        files: [],
      };
    } else if (line.trim() && cur) {
      cur.files.push(line.trim());
    }
  }
  if (cur) out.push(cur);
  return out;
}

const TRIGGER_PREFIXES = [
  "refinery/packs/",
  "refinery/sources/",
  "refinery/types/",
  "refinery/constitution/",
  "refinery/lib/confidence",
  "refinery/lib/dag",
  "refinery/render/",
  "refinery/validate/",
];

function isTriggerShaped(files: readonly string[]): boolean {
  return files.some((f) => TRIGGER_PREFIXES.some((p) => f.startsWith(p)));
}

function fmt(items: readonly string[]): string {
  if (items.length === 0) return "_none_";
  return items.map((s) => `\`${s}\``).join(", ");
}

function escapeTable(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildHeader(): string {
  const last = lastRoadmapDocTouch();
  return [
    "# Roadmap Status — Current State (Auto-Generated)",
    "",
    "_The descriptive layer. Live brains, sources, edges, and commits since the last `ontology-and-roadmap.md` touch. Hand-edit `docs/ontology-and-roadmap.md` §6–§9 for forward strategy; this file is regenerated from code._",
    "",
    `**Generated:** ${new Date().toISOString()} (commit \`${gitShortSha()}\`)`,
    `**Last roadmap doc touch:** \`${last.sha}\` · ${last.iso} · ${escapeTable(last.subject)}`,
    "",
    "## Regenerate",
    "",
    "```",
    "npm run roadmap:sync",
    "```",
    "",
  ].join("\n");
}

function buildTldr(): string {
  const packs = Object.values(PACKS);
  const sourceCount = packs.reduce((n, p) => n + p.sources.length, 0);
  const trustTiers = new Set<TrustTier>();
  for (const p of packs)
    for (const s of p.sources) trustTiers.add(s.trust_tier);
  const domains = new Set(packs.map((p) => p.domain));
  const commits = commitsSinceLastRoadmapTouch();
  const triggers = commits.filter((c) => isTriggerShaped(c.files));
  return [
    "## TL;DR",
    "",
    `- **${packs.length}** brains in the runtime registry.`,
    `- **${sourceCount}** source connectors across **${trustTiers.size}** distinct trust tiers (${[
      ...trustTiers,
    ]
      .sort()
      .map((t) => `T${t}`)
      .join(", ")}).`,
    `- **${domains.size}** distinct domains: ${[...domains]
      .sort()
      .map((d) => `\`${d}\``)
      .join(", ")}.`,
    `- **${commits.length}** commits since the last roadmap-doc touch — **${triggers.length}** are trigger-shaped (touched packs/sources/types/constitution/confidence/dag/render/validate).`,
    "",
  ].join("\n");
}

function buildLiveBrains(): string {
  const packs = Object.values(PACKS)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  const lines = [
    "## Live Brains",
    "",
    "| Brain | Domain | Sources | Trust tiers | Input edges |",
    "| --- | --- | ---: | --- | ---: |",
  ];
  for (const p of packs) {
    const tiers = [...new Set(p.sources.map((s) => `T${s.trust_tier}`))].sort();
    lines.push(
      `| \`${p.id}\` | \`${p.domain}\` | ${p.sources.length} | ${
        tiers.join(", ") || "—"
      } | ${(p.input_brains ?? []).length} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function buildSources(): string {
  const packs = Object.values(PACKS)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  const out: string[] = ["## Source connectors per brain", ""];
  for (const p of packs) {
    out.push(`### \`${p.id}\``);
    out.push("");
    if (p.sources.length === 0) {
      out.push("_no sources_");
      out.push("");
      continue;
    }
    out.push("| source_id | trust_tier |");
    out.push("| --- | ---: |");
    for (const s of p.sources) {
      out.push(`| \`${s.source_id}\` | T${s.trust_tier} |`);
    }
    out.push("");
  }
  return out.join("\n");
}

function buildDagEdges(): string {
  const packs = Object.values(PACKS)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  const edges: Array<{ from: string; to: string; type: string }> = [];
  for (const p of packs) {
    for (const e of p.input_brains ?? []) {
      edges.push({ from: e.id, to: p.id, type: e.edge_type });
    }
  }
  edges.sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to));
  const out: string[] = [
    "## Brain DAG (edges)",
    "",
    "Every edge: `upstream → downstream (edge_type)`. Edge types: `input | constraint | veto | modifier` (`refinery/types/pack.mts` → `BrainEdgeType`).",
    "",
  ];
  if (edges.length === 0) {
    out.push("_no edges_");
    out.push("");
    return out.join("\n");
  }
  out.push("| Upstream | Downstream | Edge type |");
  out.push("| --- | --- | --- |");
  for (const e of edges) {
    out.push(`| \`${e.from}\` | \`${e.to}\` | **${e.type}** |`);
  }
  out.push("");
  return out.join("\n");
}

function buildDomainCoverage(): string {
  const byDomain = new Map<string, string[]>();
  for (const p of Object.values(PACKS)) {
    const arr = byDomain.get(p.domain) ?? [];
    arr.push(p.id);
    byDomain.set(p.domain, arr);
  }
  const out: string[] = [
    "## Domain coverage",
    "",
    "| Domain | Brain count | Brain IDs |",
    "| --- | ---: | --- |",
  ];
  for (const d of [...byDomain.keys()].sort()) {
    const ids = byDomain.get(d)!.slice().sort();
    out.push(`| \`${d}\` | ${ids.length} | ${fmt(ids)} |`);
  }
  out.push("");
  out.push(
    "_The `BrainDomain` union (`real-estate | finance | environmental | demographics | logistics | hospitality | macro`) defines the seven roadmap slots. Any domain not listed above is currently empty._",
  );
  out.push("");
  return out.join("\n");
}

function buildCommitsSince(): string {
  const commits = commitsSinceLastRoadmapTouch();
  const out: string[] = ["## Commits since last roadmap doc touch", ""];
  if (commits.length === 0) {
    out.push("_None — the doc is current with HEAD._");
    out.push("");
    return out.join("\n");
  }
  out.push("| SHA | Date | Subject |");
  out.push("| --- | --- | --- |");
  for (const c of commits) {
    out.push(
      `| \`${c.sha}\` | ${c.iso.slice(0, 10)} | ${escapeTable(c.subject)} |`,
    );
  }
  out.push("");
  return out.join("\n");
}

function buildTriggerShapedCommits(): string {
  const triggers = commitsSinceLastRoadmapTouch().filter((c) =>
    isTriggerShaped(c.files),
  );
  const out: string[] = [
    "## Trigger-shaped commits since last roadmap doc touch",
    "",
    "Per §10 of `ontology-and-roadmap.md`, commits that touch `refinery/packs/`, `refinery/sources/`, `refinery/types/`, `refinery/constitution/`, `refinery/lib/confidence`, `refinery/lib/dag`, `refinery/render/`, or `refinery/validate/` *should have* triggered a roadmap update. The list below is what's currently un-reflected in the prescriptive doc.",
    "",
  ];
  if (triggers.length === 0) {
    out.push(
      "_None — every trigger-shaped commit since the last touch has been reflected._",
    );
    out.push("");
    return out.join("\n");
  }
  out.push("| SHA | Date | Subject | Trigger files (sample) |");
  out.push("| --- | --- | --- | --- |");
  for (const c of triggers) {
    const trigFiles = c.files
      .filter((f) => TRIGGER_PREFIXES.some((p) => f.startsWith(p)))
      .slice(0, 3);
    out.push(
      `| \`${c.sha}\` | ${c.iso.slice(0, 10)} | ${escapeTable(c.subject)} | ${fmt(trigFiles)} |`,
    );
  }
  out.push("");
  return out.join("\n");
}

function buildFooter(): string {
  return [
    "---",
    "",
    "**Notes**",
    "",
    "- This file is generated; do not edit by hand.",
    "- Hand-edit `docs/ontology-and-roadmap.md` §6 (NOW), §7 (NEAR-TERM), §8 (LONG-TERM) for forward strategy.",
    "- Regenerate after any roadmap-shaped commit: `npm run roadmap:sync`.",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// LittleBird sync
// ---------------------------------------------------------------------------

function lsNewestFirst(dir: string): string {
  try {
    return (
      readdirSync(dir)
        .map((name) => {
          try {
            return { name, mtime: statSync(path.join(dir, name)).mtime };
          } catch {
            return { name, mtime: new Date(0) };
          }
        })
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
        .map((e) => `  ${e.name}`)
        .join("\n") || "  (empty)"
    );
  } catch {
    return "  (not found)";
  }
}

function buildLittlebirdSync(): string {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const log15 = git("log --oneline -15");
  const status = git("status --short") || "(clean)";
  const plans = lsNewestFirst(path.join(homedir(), ".claude", "plans"));
  const sessions = lsNewestFirst(path.join(process.cwd(), "docs", "sessions"));
  const handoffs = lsNewestFirst(path.join(process.cwd(), "docs", "handoffs"));
  const ingestScripts = Object.entries(
    JSON.parse(execSync("cat package.json", { encoding: "utf-8" }))
      .scripts as Record<string, string>,
  )
    .filter(([k]) => k.startsWith("ingest:"))
    .map(([k, v]) => `  ${k.padEnd(32)} → ${v}`)
    .join("\n");

  return [
    "# Ground-Truth Sync",
    "",
    `> Generated: ${ts}`,
    `> Source: \`npm run roadmap:sync\``,
    `> **LB: read this file, not chat memory, for current repo state.**`,
    "",
    "---",
    "",
    "## Last 15 Commits",
    "",
    "```",
    log15,
    "```",
    "",
    "## Working Tree Status",
    "",
    "```",
    status,
    "```",
    "",
    "## Plans Directory (`~/.claude/plans/`) — newest first",
    "",
    plans,
    "",
    "## In-Repo Session Docs (`docs/sessions/`) — newest first",
    "",
    sessions,
    "",
    "## In-Repo Handoffs (`docs/handoffs/`) — newest first",
    "",
    handoffs,
    "",
    "## Defined Ingest Pipelines",
    "",
    "```",
    ingestScripts,
    "```",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const md = [
    buildHeader(),
    buildTldr(),
    buildLiveBrains(),
    buildSources(),
    buildDagEdges(),
    buildDomainCoverage(),
    buildCommitsSince(),
    buildTriggerShapedCommits(),
    buildFooter(),
  ].join("\n");

  writeFileSync(OUTPUT_PATH, md, "utf-8");
  console.log(`[roadmap-sync] wrote ${OUTPUT_PATH} (${md.length} bytes)`);

  const lbSync = buildLittlebirdSync();
  writeFileSync(LITTLEBIRD_SYNC_PATH, lbSync, "utf-8");
  console.log(`[roadmap-sync] wrote ${LITTLEBIRD_SYNC_PATH}`);
}

main();
