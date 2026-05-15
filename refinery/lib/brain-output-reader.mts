import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BrainOutput } from "../types/brain-output.mts";

/**
 * Read a rendered brain's `--- OUTPUT ---` JSON block from local disk.
 *
 * Used by BrainInputSource (for the thin-pipe consumption) AND by Stage 4
 * (for upstream-confidence propagation). One parser, one error surface —
 * keeps the "what is a valid upstream OUTPUT block" definition in one file.
 *
 * `kind: "missing"` covers missing file, no reference fence, no OUTPUT
 * section, malformed JSON, and shape errors uniformly so callers can pattern
 * match on the four states (`fresh-ok` is the only happy path).
 */

const BRAINS_DIR = path.join(process.cwd(), "brains");

export type BrainOutputRead =
  | { kind: "ok"; output: BrainOutput }
  | { kind: "missing"; reason: string };

function normalizeEol(s: string): string {
  return s.replace(/\r\n/g, "\n");
}

function frontmatterValue(md: string, key: string): string | null {
  const fm = md.match(/^(?:<!--[\s\S]*?-->\s*)?---\n([\s\S]*?)\n---\n/);
  if (!fm) return null;
  for (const line of fm[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    if (line.slice(0, idx).trim() === key) return line.slice(idx + 1).trim();
  }
  return null;
}

export async function readBrainOutput(
  brainId: string,
): Promise<BrainOutputRead> {
  const filePath = path.join(BRAINS_DIR, `${brainId}.md`);
  let md: string;
  try {
    md = normalizeEol(await readFile(filePath, "utf-8"));
  } catch {
    return { kind: "missing", reason: `file ${filePath} not found` };
  }

  const brainIdInFile = frontmatterValue(md, "brain_id");
  if (brainIdInFile !== brainId) {
    return {
      kind: "missing",
      reason: `frontmatter brain_id "${brainIdInFile}" does not match expected "${brainId}"`,
    };
  }

  const block = md.match(/```reference\n([\s\S]*?)\n```/);
  if (!block) {
    return { kind: "missing", reason: "no ```reference fence" };
  }
  const lines = block[1].split("\n");
  const start = lines.indexOf("--- OUTPUT ---");
  if (start === -1) {
    return {
      kind: "missing",
      reason:
        "no --- OUTPUT --- section (upstream rendered with pre-Phase-B refinery)",
    };
  }
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^--- .* ---$/.test(lines[i])) break;
    body.push(lines[i]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.join("\n").trim());
  } catch (e) {
    return {
      kind: "missing",
      reason: `--- OUTPUT --- is not valid JSON: ${(e as Error).message}`,
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { kind: "missing", reason: "--- OUTPUT --- must be a JSON object" };
  }

  const o = parsed as Record<string, unknown>;
  const shapeErr =
    typeof o.brain_id !== "string"
      ? "brain_id missing"
      : typeof o.version !== "number"
        ? "version missing"
        : typeof o.refined_at !== "string"
          ? "refined_at missing"
          : typeof o.confidence !== "number"
            ? "confidence missing"
            : null;
  if (shapeErr) {
    return {
      kind: "missing",
      reason: `--- OUTPUT --- shape error: ${shapeErr}`,
    };
  }

  return { kind: "ok", output: parsed as BrainOutput };
}
