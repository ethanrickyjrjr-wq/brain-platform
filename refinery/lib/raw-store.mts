import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const CACHE_DIR = path.join(process.cwd(), ".refinery-cache");

async function packDir(packId: string): Promise<string> {
  const dir = path.join(CACHE_DIR, packId);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Snapshot a raw fetch to .refinery-cache/ — "raw text never lost".
 * Every refined artifact downstream is regenerable from this.
 */
export async function snapshotRaw(
  packId: string,
  sourceId: string,
  raw: unknown,
): Promise<string> {
  const file = path.join(await packDir(packId), `${sourceId}.raw.json`);
  await writeFile(file, JSON.stringify(raw, null, 2), "utf-8");
  return file;
}

/**
 * Write a per-stage artifact so each stage is independently re-runnable
 * (agents communicate via stored state, not direct calls).
 */
export async function writeStage(
  packId: string,
  stage: string,
  data: unknown,
): Promise<string> {
  const file = path.join(await packDir(packId), `${stage}.json`);
  await writeFile(file, JSON.stringify(data, null, 2), "utf-8");
  return file;
}
