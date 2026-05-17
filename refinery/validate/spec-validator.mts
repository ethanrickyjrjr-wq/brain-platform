/**
 * Asserts a rendered Master Index conforms to brain-url-spec-v1.md (v1.2).
 * Pure function, no I/O. Stage 4 runs this before writing to brains/ —
 * if it fails, the run aborts and the existing pack is left intact.
 */

import { freshnessToken, parseFreshnessComment } from "../lib/freshness.mts";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const REQUIRED_FRONTMATTER = [
  "brain_id",
  "version",
  "refined_at",
  "freshness_token",
  "ttl_seconds",
  "context_type",
  "scope",
];
const FORBIDDEN_FRONTMATTER = ["authority", "identity"];
const REQUIRED_SECTIONS = [
  "--- HOW THE USER LIKES TO WORK ---",
  "--- CITATION TABLE ---",
  "--- SAVED FACTS ---",
  "--- OUTPUT ---",
  "--- ACTIVE PROJECTS ---",
  "--- RECENT NOTES ---",
];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const BRAIN_DIRECTIONS = new Set(["bullish", "bearish", "neutral", "mixed"]);
const DECAY_CURVES = new Set(["hours", "days", "weeks", "months", "permanent"]);
const TRUST_TIERS = new Set([1, 2, 3, 4]);
const BRAIN_EDGE_TYPES = new Set(["input", "constraint", "veto", "modifier"]);

function parseFrontmatter(md: string): Record<string, string> | null {
  // Tolerate one leading `<!-- FRESHNESS ... -->` HTML comment before the `---`.
  const m = md.match(/^(?:<!--[\s\S]*?-->\s*)?---\n([\s\S]*?)\n---\n/);
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
  }

  // --- freshness guard ---
  // The doc must start with a `<!-- FRESHNESS ... -->` comment, and the
  // comment + the `freshness_token` field must agree with each other and
  // with `version` / `refined_at`. This keeps the two copies of the token
  // (comment + frontmatter) from silently drifting apart.
  if (fm) {
    const firstLine = md.split("\n", 1)[0];
    const comment = parseFreshnessComment(firstLine);
    if (!comment) {
      errors.push(
        "Document must start with a `<!-- FRESHNESS: v{n} | Token: ... -->` comment.",
      );
    } else {
      const version = Number(fm.version);
      if (!Number.isInteger(version)) {
        errors.push(`Frontmatter version "${fm.version}" is not an integer.`);
      } else {
        if (comment.version !== version) {
          errors.push(
            `FRESHNESS comment version v${comment.version} does not match frontmatter version ${version}.`,
          );
        }
        if (fm.freshness_token && comment.token !== fm.freshness_token) {
          errors.push(
            `FRESHNESS comment token "${comment.token}" does not match frontmatter freshness_token "${fm.freshness_token}".`,
          );
        }
        if (fm.freshness_token && fm.refined_at) {
          const expected = freshnessToken(version, fm.refined_at);
          if (fm.freshness_token !== expected) {
            errors.push(
              `freshness_token "${fm.freshness_token}" does not match version/refined_at — expected "${expected}".`,
            );
          }
        }
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

  // --- output block (BrainOutput JSON) ---
  const outputSection = extractSection(ref, "--- OUTPUT ---");
  if (outputSection !== null) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(outputSection);
    } catch (e) {
      errors.push(`--- OUTPUT --- is not valid JSON: ${(e as Error).message}`);
    }
    if (parsed !== null) {
      if (typeof parsed !== "object" || Array.isArray(parsed)) {
        errors.push("--- OUTPUT --- must be a JSON object.");
      } else {
        const o = parsed as Record<string, unknown>;
        for (const field of ["brain_id", "refined_at", "conclusion"]) {
          if (
            typeof o[field] !== "string" ||
            (o[field] as string).length === 0
          ) {
            errors.push(
              `--- OUTPUT --- missing/empty required string field: ${field}`,
            );
          }
        }
        if (typeof o.version !== "number" || !Number.isInteger(o.version)) {
          errors.push("--- OUTPUT --- field version must be an integer.");
        }
        if (
          typeof o.confidence !== "number" ||
          o.confidence < 0 ||
          o.confidence > 1
        ) {
          errors.push(
            "--- OUTPUT --- field confidence must be a number in [0, 1].",
          );
        }
        if (!Array.isArray(o.key_metrics)) {
          errors.push("--- OUTPUT --- field key_metrics must be an array.");
        } else {
          (o.key_metrics as unknown[]).forEach((km, i) => {
            const m = km as Record<string, unknown>;
            if (typeof m?.metric !== "string") {
              errors.push(
                `--- OUTPUT --- key_metrics[${i}].metric must be a string.`,
              );
            }
            if (typeof m?.value !== "number") {
              errors.push(
                `--- OUTPUT --- key_metrics[${i}].value must be a number.`,
              );
            }
            if (
              m?.direction !== "rising" &&
              m?.direction !== "falling" &&
              m?.direction !== "stable"
            ) {
              errors.push(
                `--- OUTPUT --- key_metrics[${i}].direction must be "rising"|"falling"|"stable".`,
              );
            }
            if (typeof m?.label !== "string") {
              errors.push(
                `--- OUTPUT --- key_metrics[${i}].label must be a string.`,
              );
            }
            // Optional per-metric provenance (P2). Absent is fine for legacy
            // packs; when present, every sub-field is required and well-typed.
            if (m?.source !== undefined) {
              const s = m.source as Record<string, unknown>;
              if (typeof s !== "object" || s === null || Array.isArray(s)) {
                errors.push(
                  `--- OUTPUT --- key_metrics[${i}].source must be an object when present.`,
                );
              } else {
                if (typeof s.url !== "string" || s.url.length === 0) {
                  errors.push(
                    `--- OUTPUT --- key_metrics[${i}].source.url must be a non-empty string.`,
                  );
                }
                if (
                  typeof s.fetched_at !== "string" ||
                  !ISO_TIMESTAMP.test(s.fetched_at)
                ) {
                  errors.push(
                    `--- OUTPUT --- key_metrics[${i}].source.fetched_at must be an ISO 8601 timestamp.`,
                  );
                }
                if (
                  typeof s.tier !== "number" ||
                  !TRUST_TIERS.has(s.tier as number)
                ) {
                  errors.push(
                    `--- OUTPUT --- key_metrics[${i}].source.tier must be 1, 2, 3, or 4.`,
                  );
                }
                if (typeof s.citation !== "string" || s.citation.length === 0) {
                  errors.push(
                    `--- OUTPUT --- key_metrics[${i}].source.citation must be a non-empty string.`,
                  );
                }
              }
            }
          });
        }
        if (!Array.isArray(o.caveats)) {
          errors.push("--- OUTPUT --- field caveats must be an array.");
        } else {
          (o.caveats as unknown[]).forEach((c, i) => {
            if (typeof c !== "string") {
              errors.push(`--- OUTPUT --- caveats[${i}] must be a string.`);
            }
          });
        }

        // --- v3 fields (spec docs/v3-synthesis-spec.md §1) ---
        if (!BRAIN_DIRECTIONS.has(o.direction as string)) {
          errors.push(
            `--- OUTPUT --- field direction must be one of "bullish"|"bearish"|"neutral"|"mixed", got ${JSON.stringify(o.direction)}.`,
          );
        }
        if (
          typeof o.magnitude !== "number" ||
          o.magnitude < 0 ||
          o.magnitude > 1
        ) {
          errors.push(
            "--- OUTPUT --- field magnitude must be a number in [0, 1].",
          );
        }
        // overrides + contradicts stay as string[]; drivers lifted to
        // BrainDriver[] in P5 Group B (per-driver edge_type from the DAG).
        for (const field of ["overrides", "contradicts"] as const) {
          if (!Array.isArray(o[field])) {
            errors.push(`--- OUTPUT --- field ${field} must be an array.`);
          } else {
            (o[field] as unknown[]).forEach((v, i) => {
              if (typeof v !== "string") {
                errors.push(`--- OUTPUT --- ${field}[${i}] must be a string.`);
              }
            });
          }
        }
        if (!Array.isArray(o.drivers)) {
          errors.push("--- OUTPUT --- field drivers must be an array.");
        } else {
          (o.drivers as unknown[]).forEach((d, i) => {
            if (!d || typeof d !== "object" || Array.isArray(d)) {
              errors.push(
                `--- OUTPUT --- drivers[${i}] must be an object {brain_id, edge_type}.`,
              );
              return;
            }
            const driver = d as Record<string, unknown>;
            if (typeof driver.brain_id !== "string" || driver.brain_id === "") {
              errors.push(
                `--- OUTPUT --- drivers[${i}].brain_id must be a non-empty string.`,
              );
            }
            if (!BRAIN_EDGE_TYPES.has(driver.edge_type as string)) {
              errors.push(
                `--- OUTPUT --- drivers[${i}].edge_type must be one of "input"|"constraint"|"veto"|"modifier", got ${JSON.stringify(driver.edge_type)}.`,
              );
            }
          });
        }
        if (
          typeof o.trust_tier !== "number" ||
          !TRUST_TIERS.has(o.trust_tier as number)
        ) {
          errors.push("--- OUTPUT --- field trust_tier must be 1, 2, 3, or 4.");
        }
        if (
          typeof o.upstream_count !== "number" ||
          !Number.isInteger(o.upstream_count) ||
          o.upstream_count < 0
        ) {
          errors.push(
            "--- OUTPUT --- field upstream_count must be a non-negative integer.",
          );
        }
        const rel = o.relevance as Record<string, unknown> | undefined;
        if (!rel || typeof rel !== "object" || Array.isArray(rel)) {
          errors.push(
            "--- OUTPUT --- field relevance must be an object with decay_curve, half_life_hours, computed_at.",
          );
        } else {
          if (!DECAY_CURVES.has(rel.decay_curve as string)) {
            errors.push(
              `--- OUTPUT --- relevance.decay_curve must be "hours"|"days"|"weeks"|"months"|"permanent", got ${JSON.stringify(rel.decay_curve)}.`,
            );
          }
          if (
            typeof rel.half_life_hours !== "number" ||
            rel.half_life_hours < 0 ||
            !Number.isFinite(rel.half_life_hours)
          ) {
            errors.push(
              "--- OUTPUT --- relevance.half_life_hours must be a non-negative finite number.",
            );
          }
          if (
            typeof rel.computed_at !== "string" ||
            !ISO_TIMESTAMP.test(rel.computed_at)
          ) {
            errors.push(
              `--- OUTPUT --- relevance.computed_at must be an ISO 8601 timestamp, got ${JSON.stringify(rel.computed_at)}.`,
            );
          }
        }
        if (o.exogenous_signals !== undefined) {
          if (!Array.isArray(o.exogenous_signals)) {
            errors.push(
              "--- OUTPUT --- field exogenous_signals must be an array when present.",
            );
          }
          // Per-element shape validation is deferred until Week 6-8 when the
          // Context Signal Brain starts emitting them. v1: only `[]` ever ships.
        }

        // Cross-check against frontmatter — drift between the two copies of
        // brain_id / version / refined_at would corrupt the chain.
        if (fm) {
          if (
            typeof o.brain_id === "string" &&
            fm.brain_id &&
            o.brain_id !== fm.brain_id
          ) {
            errors.push(
              `--- OUTPUT --- brain_id "${o.brain_id}" does not match frontmatter "${fm.brain_id}".`,
            );
          }
          if (
            typeof o.version === "number" &&
            fm.version &&
            String(o.version) !== fm.version
          ) {
            errors.push(
              `--- OUTPUT --- version ${o.version} does not match frontmatter ${fm.version}.`,
            );
          }
          if (
            typeof o.refined_at === "string" &&
            fm.refined_at &&
            o.refined_at !== fm.refined_at
          ) {
            errors.push(
              `--- OUTPUT --- refined_at "${o.refined_at}" does not match frontmatter "${fm.refined_at}".`,
            );
          }
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
