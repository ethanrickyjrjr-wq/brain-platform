/**
 * lib/deliverable/narrative-lint.ts — the moat enforcement (Session 6, task-04).
 *
 * Three INDEPENDENT gates on the customer-facing assembled narrative. Anchoring
 * alone is not enough; each gate catches a different fabrication mode.
 *
 *  [LB-R2] number gate — EXACT-equality anchoring. Every numeric token in the
 *    fact prose (exec_summary + section titles/intros) must equal a snapshot
 *    value VERBATIM after format-normalization only ($30,074 == 30074,
 *    +60bps == 60). NOT the 5%/0.05 chart-render tolerance — a number 5% off the
 *    cited figure is a fabrication that a tolerance would wave through. "about
 *    $30K" for a $30,074 fact fails the same way an invented number does:
 *    verbatim-or-fail unifies R2 with the no-smoothing rule. inference_notes are
 *    EXEMPT from this gate — they carry conditional projections, governed by the
 *    falsifier requirement below instead.
 *
 *  [LB-R3] grounded / no-smoothing gate —
 *    (a) no SMOOTHING_TOKENS (numeric_softening + prose_confidence_translation,
 *        the single-source ban list in refinery/lib/smoothing-tokens.mts) in any
 *        narrative prose;
 *    (b) fact prose may not forward-forecast — a future-trend clause ("rents
 *        will keep climbing") belongs in an inference_note, not a cited fact;
 *    (c) every inference_note must carry an explicit falsifier (THE-GOAL: a
 *        speculation is a conditional IF/THEN + falsifier, never a flat call).
 *    NOTE: refinery/render/speaker.mts exports `isGroundedConditional`, but it
 *    takes a STRUCTURED {condition, falsifier} claim, not prose — it cannot be
 *    applied to a narrative string. This module reuses the importable no-smoothing
 *    surface (SMOOTHING_TOKENS) and implements the prose-level grounded checks
 *    that mirror that symbol's intent.
 *
 *  [ADDED] jargon gate — strip internal vocabulary (master/brain/payload/grain/
 *    dossier). Cosmetic backstop; NOT a substitute for the two gates above.
 *
 * The build route (task-03) calls this BEFORE persisting: on any violation it
 * regenerates once with the violations named, then hard-strips offending
 * sentences via the returned `stripped` narrative.
 */

import type { Narrative } from "./templates";
import { SMOOTHING_TOKENS } from "../../refinery/lib/smoothing-tokens.mts";
import type { ReconciliationVerdict } from "../reconcile/types";

// ---------------------------------------------------------------------------
// Number normalization + exact anchoring
// ---------------------------------------------------------------------------

/** Normalize a numeric token for verbatim comparison: unify the unicode minus,
 *  drop $, commas, %, bps, and any other non-digit decoration. Decimal digits
 *  are preserved exactly ("28.40" stays "28.40" — a rounded "28.4" must NOT
 *  match, per verbatim-or-fail). */
export function normalizeNumber(raw: string): string {
  const ascii = raw.replace(/−/g, "-"); // MINUS SIGN U+2212 → ASCII hyphen
  const cleaned = ascii.replace(/[^\d.-]/g, "");
  if (!/\d/.test(cleaned)) return "";
  return cleaned;
}

/** EXACT equality against the snapshot anchor set. No tolerance band. */
export function anchorsExactly(token: string, anchors: ReadonlySet<string>): boolean {
  const n = normalizeNumber(token);
  if (n === "") return false;
  return anchors.has(n);
}

// A numeric token: optional sign/currency, digit groups, optional decimal,
// optional %/bps unit. Matches "$30,074", "+60bps", "−201,983", "4.8%", "28.40".
const NUMBER_TOKEN = /[-−+]?\$?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|bps|basis points))?/g;

/** A bare 4-digit year (1900–2099) with no currency/percent/bps unit is a
 *  calendar reference, not a data figure — exempt it from the number gate so a
 *  narrative may say "through 2027" without a false fabrication flag. */
function isBareYear(token: string): boolean {
  if (/[$%]|bps|basis points/i.test(token)) return false;
  return /^(?:19|20)\d{2}$/.test(normalizeNumber(token));
}

// Exported (Plan C-4, B4) so the reconciliation `ttl` gate reuses the ONE
// numeric tokenizer instead of forking a parallel regex.
export function extractNumbers(text: string): string[] {
  return (text.match(NUMBER_TOKEN) ?? []).map((t) => t.trim()).filter(Boolean);
}

function buildAnchorSet(snapshotNumbers: ReadonlyArray<string | number>): Set<string> {
  const set = new Set<string>();
  for (const entry of snapshotNumbers) {
    const s = String(entry);
    for (const tok of extractNumbers(s)) {
      const n = normalizeNumber(tok);
      if (n) set.add(n);
    }
    const whole = normalizeNumber(s);
    if (whole) set.add(whole);
  }
  return set;
}

// ---------------------------------------------------------------------------
// Gate patterns
// ---------------------------------------------------------------------------

const SMOOTHING_PHRASES: string[] = [
  ...SMOOTHING_TOKENS.numeric_softening,
  ...SMOOTHING_TOKENS.prose_confidence_translation,
];

const JARGON_WORDS = ["master", "brain", "payload", "grain", "dossier"] as const;
// Allow an optional plural / possessive so "payloads", "brains", "master's" all
// trip the gate (adversarial review: bare `\b` let plurals through).
const JARGON_RE = new RegExp(`\\b(${JARGON_WORDS.join("|")})(?:s|'s|’s)?\\b`, "i");

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A forward-looking forecast in FACT prose. Two shapes:
//  (a) a future MODAL followed (same clause) by a market-trend verb;
//  (b) MODAL-LESS forward indicators an adversary uses to dodge (a): "upward
//      trajectory", "momentum is building", "anticipate", "poised to", "trending
//      higher", "on pace to", "further increases". Fact prose states cited facts;
//      any forecast belongs in an inference_note with a falsifier.
const FORECAST_MODAL_RE =
  /\b(?:will|going to|likely to|poised to|set to|expected to|continue to|keep)\b[^.?!]*\b(?:climb|rise|ris|grow|increase|fall|drop|declin|decreas|tighten|soften|surg|cool|accelerat|keep|continu|outpac|outrun|appreciat|rall)/i;
const FORECAST_INDICATOR_RE =
  /\b(?:upward trajectory|downward trajectory|(?:building|gaining|losing|strong)\s+momentum|momentum\s+is\s+building|trending\s+(?:up|down|higher|lower)|headed\s+(?:higher|lower|up|down)|on\s+(?:pace|track)\s+to|anticipate[sd]?|poised\s+to|gaining\s+steam|further\s+(?:increase|increases|gains|growth|declines|appreciation))\b/i;

function isForecast(sentence: string): boolean {
  return FORECAST_MODAL_RE.test(sentence) || FORECAST_INDICATOR_RE.test(sentence);
}

// Spelled-out magnitude / compound numbers. The numeral gate only sees digits,
// so an LLM that writes "thirty-one thousand" would bypass the whole moat. Fact
// prose must cite figures as verbatim numerals from the snapshot, never spelled
// out. Bare small words ("one", "two") are NOT flagged — too common in prose —
// only magnitudes (hundred+) and hyphenated compounds.
const LEXICAL_NUMBER_RE =
  /\b(?:hundred|thousand|million|billion|trillion)\b|\b(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)-(?:one|two|three|four|five|six|seven|eight|nine)\b/i;

// A 4-digit year is exempt from the number gate ONLY in a temporal context
// ("through 2027", "as of 2026"). A year-shaped integer used as a COUNT
// ("2025 parcels") has no temporal cue → it must anchor like any other figure.
function yearHasTemporalContext(sentence: string, token: string): boolean {
  const re = new RegExp(
    `\\b(?:in|by|through|since|until|during|over|after|before|as of|year|fiscal|fy|q[1-4]|end of|early|late|mid)\\s+${escapeRe(token)}\\b`,
    "i",
  );
  if (re.test(sentence)) return true;
  // Year directly followed by sentence-end / quarter / season is also temporal.
  const trailing = new RegExp(`${escapeRe(token)}\\s*(?:[.,;:)]|$|q[1-4]|quarter|season)`, "i");
  return trailing.test(sentence);
}

// ---------------------------------------------------------------------------
// Violations
// ---------------------------------------------------------------------------

export type Gate = "number" | "smoothing" | "grounded" | "jargon" | "ttl";

export interface NarrativeViolation {
  gate: Gate;
  location: "exec_summary" | "section_title" | "section_intro" | "inference_note";
  sectionIndex?: number;
  noteIndex?: number;
  token?: string;
  sentence: string;
  reason: string;
}

export interface NarrativeLintResult {
  ok: boolean;
  violations: NarrativeViolation[];
  /** The narrative with every offending sentence / note removed. */
  stripped: Narrative;
}

// Split prose into sentences. A sentence ends at .!? that is followed by
// whitespace or end-of-string; a decimal point ("$28.40", "4.8%") is followed by
// a digit, so it is NOT treated as a boundary and numbers survive intact.
function splitSentences(text: string): string[] {
  return (text.match(/[\s\S]+?(?:[.!?]+(?=\s|$)|$)/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

interface GateOpts {
  numbers: boolean; // apply the exact-number gate
  forecast: boolean; // apply the fact-prose forecast gate
}

/**
 * Lint one piece of FACT prose (exec_summary, a section title, or a section
 * intro). Returns the violations AND the text with offending sentences removed.
 */
function lintFactText(
  text: string,
  location: NarrativeViolation["location"],
  anchors: ReadonlySet<string>,
  opts: GateOpts,
  sectionIndex?: number,
): { violations: NarrativeViolation[]; kept: string } {
  const violations: NarrativeViolation[] = [];
  const keptSentences: string[] = [];

  for (const sentence of splitSentences(text)) {
    const sentenceViolations: NarrativeViolation[] = [];

    if (opts.numbers) {
      for (const token of extractNumbers(sentence)) {
        if (isBareYear(token) && yearHasTemporalContext(sentence, token)) continue;
        if (!anchorsExactly(token, anchors)) {
          sentenceViolations.push({
            gate: "number",
            location,
            sectionIndex,
            token: token.trim(),
            sentence,
            reason: `number ${token.trim()} is not present verbatim in any filed item`,
          });
        }
      }
      if (LEXICAL_NUMBER_RE.test(sentence)) {
        sentenceViolations.push({
          gate: "number",
          location,
          sectionIndex,
          sentence,
          reason:
            "spelled-out number — figures must be cited as verbatim numerals from a filed item",
        });
      }
    }

    for (const phrase of SMOOTHING_PHRASES) {
      if (new RegExp(`\\b${escapeRe(phrase)}\\b`, "i").test(sentence)) {
        sentenceViolations.push({
          gate: "smoothing",
          location,
          sectionIndex,
          token: phrase,
          sentence,
          reason: `smoothing language "${phrase}" re-encodes a deterministic value`,
        });
      }
    }

    if (opts.forecast && isForecast(sentence)) {
      sentenceViolations.push({
        gate: "grounded",
        location,
        sectionIndex,
        sentence,
        reason:
          "forward-looking forecast in fact prose — move to an inference note with a falsifier",
      });
    }

    const jargon = sentence.match(JARGON_RE);
    if (jargon) {
      sentenceViolations.push({
        gate: "jargon",
        location,
        sectionIndex,
        token: jargon[1],
        sentence,
        reason: `internal jargon "${jargon[1]}" must not reach a customer deliverable`,
      });
    }

    if (sentenceViolations.length > 0) {
      violations.push(...sentenceViolations);
      // drop the offending sentence
    } else {
      keptSentences.push(sentence);
    }
  }

  return { violations, kept: keptSentences.join(" ") };
}

/**
 * Lint the assembled narrative. `snapshotNumbers` is every numeric value present
 * in the deliverable's frozen item snapshot (raw value strings or numbers).
 */
export function lintDeliverableNarrative(
  narrative: Narrative,
  snapshotNumbers: ReadonlyArray<string | number>,
): NarrativeLintResult {
  const anchors = buildAnchorSet(snapshotNumbers);
  const violations: NarrativeViolation[] = [];

  // exec_summary — full fact gates
  const exec = lintFactText(narrative.exec_summary, "exec_summary", anchors, {
    numbers: true,
    forecast: true,
  });
  violations.push(...exec.violations);

  // sections — title + intro are both customer-facing fact prose
  const strippedSections: Narrative["sections"] = [];
  narrative.sections.forEach((section, i) => {
    const title = lintFactText(
      section.title,
      "section_title",
      anchors,
      { numbers: true, forecast: true },
      i,
    );
    const intro = lintFactText(
      section.intro,
      "section_intro",
      anchors,
      { numbers: true, forecast: true },
      i,
    );
    violations.push(...title.violations, ...intro.violations);
    strippedSections.push({ title: title.kept, intro: intro.kept });
  });

  // inference_notes — EXEMPT from the exact-number gate (projections allowed),
  // but must carry a falsifier and stay free of smoothing / jargon.
  const strippedNotes: string[] = [];
  narrative.inference_notes.forEach((note, noteIndex) => {
    const noteViolations: NarrativeViolation[] = [];

    // Require an actual falsifier clause ("falsifier: <something>"), not merely
    // the word "falsifier" — the substring trick ("no falsifier provided") must
    // not pass.
    if (!/falsifier\s*:\s*\S/i.test(note)) {
      noteViolations.push({
        gate: "grounded",
        location: "inference_note",
        noteIndex,
        sentence: note,
        reason:
          "inference note has no falsifier clause — speculation must state 'falsifier: <condition>'",
      });
    }

    // Notes are exempt from EXACT anchoring (projections carry free numbers), but
    // a note that cites numbers yet anchors NONE of them is laundering a pure
    // fabrication — it must build on at least one cited (anchored) base figure.
    const noteNums = extractNumbers(note).filter((t) => !isBareYear(t));
    if (noteNums.length > 0 && !noteNums.some((t) => anchorsExactly(t, anchors))) {
      noteViolations.push({
        gate: "number",
        location: "inference_note",
        noteIndex,
        sentence: note,
        reason:
          "inference note cites numbers but none anchor to a filed item — name the cited base it builds on",
      });
    }
    for (const phrase of SMOOTHING_PHRASES) {
      if (new RegExp(`\\b${escapeRe(phrase)}\\b`, "i").test(note)) {
        noteViolations.push({
          gate: "smoothing",
          location: "inference_note",
          noteIndex,
          token: phrase,
          sentence: note,
          reason: `smoothing language "${phrase}" in inference note`,
        });
      }
    }
    const jargon = note.match(JARGON_RE);
    if (jargon) {
      noteViolations.push({
        gate: "jargon",
        location: "inference_note",
        noteIndex,
        token: jargon[1],
        sentence: note,
        reason: `internal jargon "${jargon[1]}" in inference note`,
      });
    }

    if (noteViolations.length > 0) {
      violations.push(...noteViolations);
      // drop the whole offending note
    } else {
      strippedNotes.push(note);
    }
  });

  const stripped: Narrative = {
    exec_summary: exec.kept,
    sections: strippedSections,
    inference_notes: strippedNotes,
  };

  return { ok: violations.length === 0, violations, stripped };
}

// ---------------------------------------------------------------------------
// Plan C-4 — the verdict-aware "ttl" gate (single enforcement seam, flag-gated)
// ---------------------------------------------------------------------------

/**
 * Lane-3 freshness gate. Scans the SAME customer fact prose the number gate
 * covers (exec_summary + section titles/intros — NOT inference_notes, which are
 * exempt projections) and fires a `"ttl"` violation for every sentence that
 * asserts a figure our reconciliation could NOT stand behind: a number whose
 * verdict is `cannot_assert_stale` (held but past its TTL). The comparator (C-2)
 * withholds values deterministically; THIS lint is the only thing that
 * strips/refuses a number from customer prose — the single seam (RULE 3 C2), no
 * second censor in the materialization path.
 *
 * Reuses `extractNumbers` + `normalizeNumber` (verbatim discipline) — never a
 * fork. `now` is reserved: the verdicts already encode freshness as of their
 * computation, so this gate reads `verdict.status` rather than re-deriving.
 *
 * Wired into `build.ts` ONLY behind `RECONCILE_TTL_GATE_ENABLED` (default OFF).
 */
export function lintVerdictFreshness(
  narrative: Narrative,
  verdicts: ReadonlyArray<ReconciliationVerdict>,
  now?: string,
): NarrativeViolation[] {
  void now;
  // Figures we must not assert as a current fact — the asserted value of every
  // `cannot_assert_stale` verdict. Numbers and categoricals are tracked
  // separately because the comparator (and normalizeNumber) treat them
  // differently. A value any FRESH verdict legitimately cites is removed from the
  // stale set, so a fresh figure is never stripped because it shares a number
  // with an unrelated stale one (value-collision guard).
  const staleNumbers = new Set<string>();
  const staleLabels = new Set<string>(); // case/space-normalized categorical values
  const freshNumbers = new Set<string>();
  for (const v of verdicts) {
    const isStale = v.status === "cannot_assert_stale";
    const n = normalizeNumber(v.theirs.value);
    if (n) {
      (isStale ? staleNumbers : freshNumbers).add(n);
    } else if (isStale) {
      const label = v.theirs.value.trim().toLowerCase().replace(/\s+/g, " ");
      if (label) staleLabels.add(label);
    }
  }
  for (const n of freshNumbers) staleNumbers.delete(n);
  if (staleNumbers.size === 0 && staleLabels.size === 0) return [];

  const violations: NarrativeViolation[] = [];
  const push = (
    location: NarrativeViolation["location"],
    sectionIndex: number | undefined,
    token: string,
    sentence: string,
  ): void => {
    violations.push({
      gate: "ttl",
      location,
      sectionIndex,
      token,
      sentence,
      reason: `${token} is past its freshness TTL — refuse to assert; cite the lake fact + its freshness, or drop it`,
    });
  };

  const scan = (
    text: string,
    location: NarrativeViolation["location"],
    sectionIndex?: number,
  ): void => {
    for (const sentence of splitSentences(text)) {
      let flagged = false;
      for (const token of extractNumbers(sentence)) {
        const n = normalizeNumber(token);
        if (n && staleNumbers.has(n)) {
          push(location, sectionIndex, token.trim(), sentence);
          flagged = true;
        }
      }
      // Categorical stale values (e.g. a past-TTL "Barrier island") carry no
      // digit, so the numeric pass misses them — match the normalized phrase.
      if (!flagged && staleLabels.size > 0) {
        const norm = sentence.toLowerCase().replace(/\s+/g, " ");
        for (const label of staleLabels) {
          if (norm.includes(label)) {
            push(location, sectionIndex, label, sentence);
            break;
          }
        }
      }
    }
  };

  scan(narrative.exec_summary, "exec_summary");
  narrative.sections.forEach((section, i) => {
    scan(section.title, "section_title", i);
    scan(section.intro, "section_intro", i);
  });
  return violations;
}

/**
 * Hard-strip every fact-prose sentence flagged by the given violations
 * (exec_summary + section titles/intros). Used by `build.ts` to drop stale `ttl`
 * sentences in the same hard-strip step as the standard gates, since
 * `lintDeliverableNarrative`'s own `stripped` does not know about verdict-level
 * violations. inference_notes are left intact (the gate never targets them).
 */
export function stripVerdictSentences(
  narrative: Narrative,
  violations: ReadonlyArray<NarrativeViolation>,
): Narrative {
  const offending = new Set(violations.map((v) => v.sentence));
  const keep = (text: string): string =>
    splitSentences(text)
      .filter((s) => !offending.has(s))
      .join(" ");
  return {
    exec_summary: keep(narrative.exec_summary),
    sections: narrative.sections.map((s) => ({
      title: keep(s.title),
      intro: keep(s.intro),
    })),
    inference_notes: narrative.inference_notes,
  };
}
