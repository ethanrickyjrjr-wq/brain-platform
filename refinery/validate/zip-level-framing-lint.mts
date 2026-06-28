/**
 * ZIP-level framing lint — structural enforcement of the operator's locked rule
 * (memory feedback_no-zip-level-intelligence-framing): never frame the PRODUCT as
 * "ZIP-level intelligence". The moat is four-lane at ANY grain; "ZIP-level"
 * product framing kills lanes 2-4 (the user's upload, a named web source, a figure
 * the user gave). This makes the rule a wall, not a belief — "structural
 * guarantee, not AI virtue", the same mechanism display-leak.test.mts uses for the
 * freshness token.
 *
 * PRECISION (load-bearing): this flags ONLY product/moat framing — "ZIP-level"
 * followed by a value noun (intelligence / insights / analytics / platform /
 * product / offering). It deliberately does NOT flag legitimate GRAIN or CITATION
 * statements: "ZIP-level home-value index", "ZIP-level all-homes" (a Zillow source
 * citation), "ZIP-level monthly housing metrics", "at the ZIP level", "no ZIP-level
 * column". There are 79 such honest uses in the corpus; flagging them would force
 * rewording source-faithful citations (forbidden — see memory
 * feedback_derivable-is-not-source-faithful).
 */

export interface ZipLevelViolation {
  /** 1-based line number within the scanned text. */
  line: number;
  /** The matched "ZIP-level <noun>" substring. */
  text: string;
  /** Which pattern matched. */
  pattern: string;
}

export interface ZipLevelLintResult {
  ok: boolean;
  violations: ZipLevelViolation[];
}

/** "ZIP-level" / "ZIP level" immediately modifying a PRODUCT-VALUE noun. The value
 *  nouns are what turn a grain descriptor into a moat-killing product claim. */
const PATTERNS: { name: string; re: RegExp }[] = [
  {
    name: "zip-level product framing",
    re: /\bzip[- ]level\s+(intelligence|insights?|analytics|platform|product|offering)\b/i,
  },
];

export function lintZipLevelFraming(text: string): ZipLevelLintResult {
  const violations: ZipLevelViolation[] = [];
  if (typeof text !== "string" || text.length === 0) return { ok: true, violations };

  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const { name, re } of PATTERNS) {
      const m = re.exec(line);
      if (m) {
        violations.push({ line: i + 1, text: m[0], pattern: name });
      }
    }
  });

  return { ok: violations.length === 0, violations };
}
