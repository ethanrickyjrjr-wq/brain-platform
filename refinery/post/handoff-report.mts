import { promises as fs } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type { BrainOutput } from "../types/brain-output.mts";

export interface HandoffEntry {
  packId: string;
  written: boolean;
  brainPath: string;
  brainOutput: BrainOutput;
}

function safeGitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function renderSection(
  target: string,
  entries: HandoffEntry[],
  now: string,
  sha: string,
): string {
  const rows = entries
    .map((e) => {
      const o = e.brainOutput;
      return `| ${e.packId} | ${o.version} | ${o.confidence.toFixed(2)} | ${o.trust_tier} | ${o.relevance.half_life_hours} | ${o.caveats.length} | ${e.written ? "yes" : "dry-run"} |`;
    })
    .join("\n");
  const caveatLines = entries.flatMap((e) =>
    e.brainOutput.caveats.map((c) => `- **${e.packId}**: ${c}`),
  );
  return [
    `## Handoff — ${now} (target: ${target}, sha: ${sha})`,
    "",
    "| Pack | Version | Confidence | Trust tier | Relevance (h) | Caveats | Written |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    rows,
    "",
    "### Notable caveats",
    caveatLines.length > 0 ? caveatLines.join("\n") : "_(none)_",
    "",
  ].join("\n");
}

export async function writeHandoffReport(
  target: string,
  entries: HandoffEntry[],
  outPath = "docs/HANDOFF.md",
): Promise<string> {
  const section = renderSection(
    target,
    entries,
    new Date().toISOString(),
    safeGitSha(),
  );
  const existing = await fs.readFile(outPath, "utf8").catch(() => "");
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const body = existing ? section + "\n---\n\n" + existing : section;
  await fs.writeFile(outPath, body);
  return outPath;
}
