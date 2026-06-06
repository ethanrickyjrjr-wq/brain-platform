// refinery/lib/master-frontmatter.mts
//
// Shared frontmatter reader for brain .md files. Extracted so the freeze
// watchdog (refinery/tools/check-master-freeze.mts) and the upstream OUTPUT
// reader (refinery/lib/brain-output-reader.mts) parse frontmatter through ONE
// surface instead of three drifting copies.
//
// The key behavior the watchdog depends on: distinguish "file missing"
// (ENOENT → null, a legitimate cold start the caller fails closed on) from
// "file exists but its frontmatter can't be parsed" (THROW — a real defect that
// must surface loudly, not be silently swallowed as "missing"). A non-ENOENT
// I/O error (EACCES, EISDIR, …) is re-thrown for the same reason.

import { readFile } from "node:fs/promises";

/**
 * Pull a frontmatter scalar from a brain .md (tolerates a leading FRESHNESS
 * HTML comment). Normalizes CRLF internally so callers don't have to. Returns
 * null when there is no `---` fence OR the key is absent.
 */
export function frontmatterValue(md: string, key: string): string | null {
  const fm = md
    .replace(/\r\n/g, "\n")
    .match(/^(?:<!--[\s\S]*?-->\s*)?---\n([\s\S]*?)\n---\n/);
  if (!fm) return null;
  for (const line of fm[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    if (line.slice(0, idx).trim() === key) return line.slice(idx + 1).trim();
  }
  return null;
}

/**
 * Fallback master TTL, used ONLY if master.md omits `ttl_seconds`. SOURCE OF
 * TRUTH for the 7-day master TTL: refinery/packs/master.mts:239
 * (`ttl_seconds: 604800`). renderFrontmatter always writes the field, so this is
 * belt-and-suspenders; the on-disk value is authoritative when present.
 */
export const MASTER_TTL_FALLBACK_SECONDS = 604_800;

/**
 * Read master.md's `refined_at` + `ttl_seconds` from disk.
 *
 *  - File missing (ENOENT)              → returns null (cold start / removed).
 *  - Any other I/O error (EACCES, …)    → re-throws the original fs error.
 *  - File exists but frontmatter has no parseable `refined_at`
 *    (malformed fence or missing key)   → throws (a defect, not "missing").
 *
 * `refinedAt` is returned verbatim — date validity is the watchdog's decision
 * (it already fails closed on an unparseable value), keeping this layer dumb I/O.
 */
export async function readMasterFrontmatter(
  masterPath: string,
): Promise<{ refinedAt: string; ttlSeconds: number } | null> {
  let md: string;
  try {
    md = await readFile(masterPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err; // EACCES / EISDIR / … must NOT be masked as "missing".
  }

  const refinedAt = frontmatterValue(md, "refined_at");
  if (refinedAt === null) {
    throw new Error(
      `master frontmatter at ${masterPath} is unparseable: no refined_at ` +
        `(malformed fence or missing key). This is a defect, not a cold start.`,
    );
  }

  const ttlStr = frontmatterValue(md, "ttl_seconds");
  const ttl = ttlStr ? parseInt(ttlStr, 10) : NaN;
  return {
    refinedAt,
    ttlSeconds: Number.isFinite(ttl) ? ttl : MASTER_TTL_FALLBACK_SECONDS,
  };
}
