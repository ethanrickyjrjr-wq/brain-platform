// lib/email/outreach/targets.ts
//
// Parse the operator's cold-outreach target list (a CSV) into validated rows.
// Pure — no I/O, no network. The CLI reads the file and hands the text here.
//
// Columns (header row optional, case-insensitive): email, name, domain, zip.
//   - email  (required) the recipient address
//   - domain (optional) their website, for per-recipient brand scraping (enrichBrand)
//   - name   (optional) display/company name; falls back to the scraped company_name
//   - zip    (optional) the recipient's market ZIP — the report scope + click-back seed
//
// Validation is shape-only here (email looks like an address, zip is 5 digits). The
// 6-county MOAT gate (resolveZip) is applied downstream in the composer, alongside the
// real report assembly — keeping this module dependency-free and trivially testable.

export interface OutreachTarget {
  email: string;
  name?: string;
  domain?: string;
  zip?: string;
}

export interface ParsedTargets {
  rows: OutreachTarget[];
  /** Per-line problems (1-based line numbers, matching the source file). */
  errors: Array<{ line: number; reason: string; raw: string }>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_RE = /^\d{5}$/;
const KNOWN_COLS = new Set(["email", "name", "domain", "zip"]);

/** Split one CSV line honoring double-quoted fields (commas + "" escapes inside). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Normalize a domain: strip scheme, path, and a leading www. (lowercased). */
function normalizeDomain(raw: string): string | undefined {
  const d = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  return d || undefined;
}

/**
 * Parse a CSV target list. The first row is treated as a header ONLY if every
 * non-empty cell names a known column; otherwise it is parsed as data in the
 * default column order (email, name, domain, zip). Blank lines are skipped.
 */
export function parseTargetsCsv(text: string): ParsedTargets {
  const rows: OutreachTarget[] = [];
  const errors: ParsedTargets["errors"] = [];
  const seen = new Set<string>();

  const lines = text.split(/\r?\n/);
  // Detect a header: first non-empty line whose cells are all known column names.
  let order = ["email", "name", "domain", "zip"];
  let startIdx = 0;
  const firstNonEmpty = lines.findIndex((l) => l.trim() !== "");
  if (firstNonEmpty !== -1) {
    const cells = splitCsvLine(lines[firstNonEmpty]).map((c) => c.toLowerCase());
    if (cells.length > 0 && cells.every((c) => c === "" || KNOWN_COLS.has(c))) {
      order = cells;
      startIdx = firstNonEmpty + 1;
    }
  }

  for (let i = startIdx; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "") continue;
    const cells = splitCsvLine(raw);
    const rec: Record<string, string> = {};
    order.forEach((col, idx) => {
      if (col && cells[idx] !== undefined) rec[col] = cells[idx];
    });

    const email = (rec.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      errors.push({ line: i + 1, reason: `invalid email "${rec.email ?? ""}"`, raw });
      continue;
    }
    if (seen.has(email)) {
      errors.push({ line: i + 1, reason: `duplicate email "${email}"`, raw });
      continue;
    }

    const zip = (rec.zip ?? "").trim();
    if (zip && !ZIP_RE.test(zip)) {
      errors.push({ line: i + 1, reason: `invalid zip "${zip}" (need 5 digits)`, raw });
      continue;
    }

    seen.add(email);
    const target: OutreachTarget = { email };
    const name = (rec.name ?? "").trim();
    if (name) target.name = name;
    const domain = rec.domain ? normalizeDomain(rec.domain) : undefined;
    if (domain) target.domain = domain;
    if (zip) target.zip = zip;
    rows.push(target);
  }

  return { rows, errors };
}
