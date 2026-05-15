/**
 * Asserts a rendered Master Index conforms to brain-url-spec-v1.md (v1.1).
 * Pure function, no I/O. Stage 4 runs this before writing to brains/ —
 * if it fails, the run aborts and the existing pack is left intact.
 */

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const REQUIRED_FRONTMATTER = [
  "brain_id",
  "version",
  "refined_at",
  "ttl_seconds",
  "context_type",
  "scope",
  "freshness_token",
];
const FORBIDDEN_FRONTMATTER = ["authority", "identity"];
const REQUIRED_SECTIONS = [
  "--- HOW THE USER LIKES TO WORK ---",
  "--- CITATION TABLE ---",
  "--- SAVED FACTS ---",
  "--- ACTIVE PROJECTS ---",
  "--- RECENT NOTES ---",
];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseFrontmatter(md: string): Record<string, string> | null {
  // Loosen to tolerate leading HTML comments
  const m = md.trimStart().match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const fm: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return fm;
}

function extractReferenceBlocks(md: string): string[] {
  const blocks: string[] = [];
  const re = /```reference\n([\s\S]*?)\n```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) blocks.push(m[1]);
  return blocks;
}

/** Capture a `--- SECTION ---` body up to the next section header (or block end). */
function extractSection(refBlock: string, header: string): string | null {
  const lines = refBlock.split("\n");
  const start = lines.indexOf(header);
  if (start === -1) return null;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^--- .* ---$/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join("\n").trim();
}

export function validateSpec(md: string): ValidationResult {
  const errors: string[] = [];

  // --- freshness comment check ---
  if (!md.trimStart().startsWith('<!-- FRESHNESS:')) {
    errors.push("Missing leading FRESHNESS HTML comment.");
  }

  // --- frontmatter ---
  const fm = parseFrontmatter(md);
  if (!fm) {
    errors.push("No YAML frontmatter found (document must start with `---`).");
  } else {
    for (const k of REQUIRED_FRONTMATTER) {
      if (!(k in fm)) errors.push(`Frontmatter missing required key: ${k}`);
    }
    for (const k of FORBIDDEN_FRONTMATTER) {
      if (k in fm) {
        errors.push(
          `Frontmatter contains forbidden key: ${k} (spec v1.1 forbids it).`,
        );
      }
    }
    if (fm.context_type && fm.context_type !== "user_saved_reference") {
      errors.push(
        `context_type must be "user_saved_reference", got "${fm.context_type}".`,
      );
    }
    
    // Cross-check token with comment
    const commentMatch = md.match(/<!-- FRESHNESS: v(\d+) \| Token: (.*?) -->/);
    if (commentMatch) {
      const commentToken = commentMatch[2];
      if (fm.freshness_token !== commentToken) {
        errors.push(`Freshness token mismatch: frontmatter has "${fm.freshness_token}" but comment has "${commentToken}".`);
      }
    }
  }

  // --- reference block ---
  const blocks = extractReferenceBlocks(md);
  if (blocks.length === 0) {
    errors.push("No ```reference fenced block found.");
    return { ok: false, errors };
  }
  if (blocks.length > 1) {
    errors.push(
      `Expected exactly one \`\`\`reference block, found ${blocks.length}.`,
    );
  }
  const ref = blocks[0];

  for (const h of REQUIRED_SECTIONS) {
    if (!ref.includes(h)) errors.push(`Reference block missing section: ${h}`);
  }

  // --- citation table ---
  const citationIds = new Set<string>();
  const citationSection = extractSection(ref, "--- CITATION TABLE ---");
  if (citationSection !== null) {
    const rows = citationSection
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (rows.length === 0) {
      errors.push("CITATION TABLE is empty.");
    } else {
      const header = rows[0].split("|").map((c) => c.trim());
      if (header.join(",") !== "id,source,verified,expires") {
        errors.push(
          `CITATION TABLE header must be "id | source | verified | expires", got "${rows[0]}".`,
        );
      }
      for (const row of rows.slice(1)) {
        const cols = row.split("|").map((c) => c.trim());
        if (cols.length !== 4) {
          errors.push(
            `CITATION TABLE row needs 4 columns, got ${cols.length}: "${row}"`,
          );
          continue;
        }
        const [id, , verified, expires] = cols;
        citationIds.add(id);
        if (!ISO_DATE.test(verified)) {
          errors.push(
            `CITATION row "${id}": verified "${verified}" is not an ISO date.`,
          );
        }
        if (expires !== "never" && !ISO_DATE.test(expires)) {
          errors.push(
            `CITATION row "${id}": expires "${expires}" must be an ISO date or "never".`,
          );
        }
      }
    }
  }

  // --- saved facts ---
  const factsSection = extractSection(ref, "--- SAVED FACTS ---");
  if (factsSection !== null) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(factsSection);
    } catch (e) {
      errors.push(`SAVED FACTS is not valid JSON: ${(e as Error).message}`);
    }
    if (parsed !== null) {
      if (!Array.isArray(parsed)) {
        errors.push("SAVED FACTS must be a JSON array.");
      } else {
        parsed.forEach((f, i) => {
          const obj = f as Record<string, unknown>;
          for (const field of ["id", "topic", "fact", "value", "src", "date"]) {
            if (typeof obj?.[field] !== "string") {
              errors.push(
                `SAVED FACTS[${i}] missing/invalid string field: ${field}`,
              );
            }
          }
          if (
            typeof obj?.src === "string" &&
            citationIds.size > 0 &&
            !citationIds.has(obj.src)
          ) {
            errors.push(
              `SAVED FACTS[${i}] src "${obj.src}" does not resolve to a citation id.`,
            );
          }
          if (typeof obj?.date === "string" && !ISO_DATE.test(obj.date)) {
            errors.push(
              `SAVED FACTS[${i}] date "${obj.date}" is not an ISO date.`,
            );
          }
        });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
