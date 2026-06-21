#!/usr/bin/env node
// PreToolUse hook (matcher: Bash). The ENFORCEMENT the verify-before-claim rule
// never had.
//
// Every other pre-push gate in this repo checks CODE (lockfile, vocab orphans,
// pack/catalog drift, ingest guards) or CI. NONE of them check that anyone
// actually read the live ANSWER. That gap is the entire reason the "assistant
// deflects an in-scope SWFL question" bug was declared fixed ~23 times across 23
// days and shipped anyway: each fix was committed + logged as done WITHOUT an
// observed live answer. The rule that should have stopped it
// (feedback_checks-prod-evidence-not-dev-attestation: "wait for the runtime
// signal", verification-before-completion: "evidence before assertions") existed
// — but it was honor-system with no hook. This is the hook.
//
// It is different on purpose: it inspects a captured live ANSWER's TEXT, not the
// diff. And it is recursive — if you cannot produce a non-deflecting live answer,
// it blocks YOU from shipping "the fix", which is exactly the lie it exists to
// stop.
//
// Trigger:  a commit ahead of upstream touches an ANSWER-PATH file AND a commit
//           message or the SESSION_LOG entry claims a fix/answer/deflection win.
// Require:  >= 1 proof record ADDED to verification/answer-proofs.jsonl in this
//           push that is recent, carries a real number, and whose `answer` is
//           free of every deflection phrase.
// Block:    exit 2 (loud) when the claim is made without valid proof.
// Override: ALLOW_ANSWER_FIX_WITHOUT_PROOF=1 (logged) — for a genuine non-answer
//           refactor that trips the claim heuristic.
//
// Fail-OPEN on internal/exec errors (a broken hook must never wedge every push);
// fail-CLOSED on the one thing it is for: a fix-claim with no live proof.

import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const BANNER = "=".repeat(72);
const PROOF_LEDGER = "verification/answer-proofs.jsonl";
const PROOF_MAX_AGE_DAYS = 3;
const ANSWER_MIN_LEN = 120;

// Files whose change can alter what the assistant ANSWERS (vs. deflects). These
// are the answer-vs-deflect surfaces the forensics found: conversation + report +
// welcome grounding, the grounded-answer floor, the rules-of-engagement block that
// rides in every payload, and the master rollup that decides whether a region-wide
// price/rent number even exists to answer from.
const ANSWER_PATH = [
  /^lib\/assistant\//,
  /^lib\/highlighter\/grounding\.ts$/,
  /^lib\/highlighter\/report-grounding\.ts$/,
  /^lib\/welcome\/grounded\.ts$/,
  /^lib\/welcome\/answer\.ts$/,
  /^lib\/grounded-answer\.ts$/,
  /^lib\/place-context\.ts$/,
  /^refinery\/lib\/rules-of-engagement\.mts$/,
  /^refinery\/packs\/master\.mts$/,
  /^app\/api\/assistant\//,
  /^app\/api\/converse\//,
  /^app\/api\/welcome\/chat\//,
];

// The deflection vocabulary this whole bug class is made of — pulled verbatim from
// the 2026-06-21 screenshot + the prior "fixed" commit bodies. If a captured answer
// contains any of these, it is NOT proof of a fix; it IS the bug.
export const DEFLECTION_PHRASES = [
  "i don't have",
  "i do not have",
  "don't have current",
  "do not have current",
  // NOTE: bare "at the regional level" was REMOVED — it false-positives on a
  // LEGIT answer ("prices fell at the regional level, down 3.5%"). The deflection
  // is the NEGATION context ("I don't have … at the regional level"), so we pin
  // the negated variants instead and keep coverage of the screenshot via the
  // "i don't have" phrase above.
  "don't have current home price and rent drivers at the regional level",
  "don't have that at the regional level",
  "do not have that at the regional level",
  "no region read at the regional level",
  "not region-wide",
  "not region wide",
  "sits at the zip and county level",
  "tracked per zip",
  "here's what i can pull",
  "here is what i can pull",
  "what i can pull for you",
  "offer to pull",
  "want it for a specific zip",
  "give me a zip",
  "give me a place",
  "which zip or area",
  "point me at which",
  "name a place first",
  "wasn't broken out",
  "was not broken out",
  "can't source",
  "cannot source",
  "tier-2 summary",
  "tier 2 summary",
  "not a metric i hold",
  "not something i hold",
  "don't know what's driving",
  "i don't hold",
  "i do not hold",
  // --- variants observed LIVE on prod 2026-06-21 (the model demands a place /
  // claims no region read instead of answering). These deflect with DIFFERENT
  // words than the screenshot, and the first phrase-list above passed them as
  // "clean" — so they are pinned here from real captured answers, not guessed. ---
  "i need to know which",
  "need to know which county",
  "need to know which area",
  "which county or zip",
  "which area are you asking",
  "which area you're asking",
  "i need to narrow",
  "need to narrow this down",
  "would you like me to focus on",
  "not a unified swfl",
  "tracked per zip code",
  "does not cover residential",
  "narrow this down",
];

const CLAIM_RE =
  /\b(fix(ed|es)?|kill(ed|s)?|resolv(e|ed|es)|stop(s|ped)?\s+(deflect|refus)|never\s+dead.?end|answer.?first|deflect(ion)?|grounded?|in.?scope|region.?wide)\b/i;

export function isGitPush(cmd) {
  return /(^|\s|&&|;|\|\|)\s*git\s+push(\s|$)/.test(cmd) || /safe-push(\.mjs)?\b/.test(cmd);
}

export function isAnswerPathFile(p) {
  return ANSWER_PATH.some((re) => re.test(p));
}

export function hasFixClaim(text) {
  return CLAIM_RE.test(String(text || ""));
}

export function findDeflection(answer) {
  const a = String(answer || "").toLowerCase();
  for (const phrase of DEFLECTION_PHRASES) {
    if (a.includes(phrase)) return phrase;
  }
  return null;
}

// Recurring ask #9: the raw freshness token (SWFL-####-v##-YYYYMMDD) stays
// INTERNAL; the user only ever sees the as-of date as MM/DD/YYYY. A "fixed"
// answer that leaks the raw token OR a bare YYYYMMDD "backwards" date is not
// clean — the 2026-06-21 live capture shipped exactly this in the place frame
// and the prior phrase-only check sailed past it.
const RAW_TOKEN_RE = /SWFL-\d+-v\d+-\d{8}/i;
const BACKWARDS_DATE_RE = /(?<!\d)20\d\d(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])(?!\d)/;

export function findLeak(answer) {
  const a = String(answer || "");
  const t = a.match(RAW_TOKEN_RE);
  if (t) return t[0];
  const d = a.match(BACKWARDS_DATE_RE);
  if (d) return d[0];
  return null;
}

// proofs: array of parsed records. nowMs: Date.now(). Returns {ok, reason, used}.
// This is the pure core — unit-tested directly so the gate's verdict is provable
// without a git state.
export function validateProofs(proofs, nowMs) {
  if (!Array.isArray(proofs) || proofs.length === 0) {
    return { ok: false, reason: `no proof record added to ${PROOF_LEDGER} in this push` };
  }
  const maxAge = PROOF_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  for (const p of proofs) {
    const answer = String(p?.answer ?? "");
    const q = String(p?.question ?? "");
    if (!q.trim()) return { ok: false, reason: "a proof is missing `question`" };
    if (answer.length < ANSWER_MIN_LEN) {
      return {
        ok: false,
        reason: `a proof answer is too short (${answer.length} < ${ANSWER_MIN_LEN} chars) — not a real answer`,
      };
    }
    const bad = findDeflection(answer);
    if (bad) {
      return {
        ok: false,
        reason: `a proof answer still DEFLECTS — it contains "${bad}". That is the bug, not proof of a fix.`,
      };
    }
    const leak = findLeak(answer);
    if (leak) {
      return {
        ok: false,
        reason: `a proof answer LEAKS an internal token / backwards date "${leak}" — show the as-of date as MM/DD/YYYY and keep the raw token internal (ask #9).`,
      };
    }
    if (!/\d/.test(answer)) {
      return {
        ok: false,
        reason: "a proof answer carries no number — a real SWFL answer cites figures",
      };
    }
    const ts = Date.parse(p?.observed_at ?? "");
    if (Number.isNaN(ts)) {
      return { ok: false, reason: "a proof is missing a valid `observed_at` ISO timestamp" };
    }
    if (nowMs - ts > maxAge) {
      return {
        ok: false,
        reason: `a proof is stale (observed_at older than ${PROOF_MAX_AGE_DAYS}d) — re-capture against the current build`,
      };
    }
  }
  return {
    ok: true,
    reason: `validated ${proofs.length} live answer proof(s)`,
    used: proofs.length,
  };
}

function sh(c) {
  return execSync(c, { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
}

function main(raw) {
  let payload;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    process.exit(0); // not our shape
  }
  const cmd = String(payload?.tool_input?.command ?? "");
  if (!isGitPush(cmd)) process.exit(0);

  // Comparison base: upstream if set, else origin/main. Mirrors the other hooks.
  let base = "";
  try {
    base = sh("git rev-parse --abbrev-ref --symbolic-full-name @{u}");
  } catch {
    try {
      sh("git rev-parse --verify origin/main");
      base = "origin/main";
    } catch {
      process.exit(0); // can't enforce — allow
    }
  }

  let changed = [];
  let subjects = "";
  let sessionLogDiff = "";
  let proofs = [];
  try {
    const ahead = sh(`git rev-list --count ${base}..HEAD`);
    if (ahead === "0") process.exit(0); // nothing to push
    changed = sh(`git diff --name-only ${base}..HEAD`)
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    subjects = sh(`git log --format=%s%n%b ${base}..HEAD`);
    try {
      sessionLogDiff = sh(`git diff ${base}..HEAD -- SESSION_LOG.md`);
    } catch {
      /* no session-log change — fine */
    }
    // Proof records ADDED in this push (added `+` lines only — an old proof can't
    // rubber-stamp a new fix).
    try {
      const added = sh(`git diff ${base}..HEAD -- ${PROOF_LEDGER}`)
        .split("\n")
        .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
        .map((l) => l.slice(1).trim())
        .filter(Boolean);
      for (const line of added) {
        try {
          proofs.push(JSON.parse(line));
        } catch {
          /* skip malformed line */
        }
      }
    } catch {
      /* no proof ledger touched — proofs stays empty */
    }
  } catch {
    process.exit(0); // can't read git state — fail open
  }

  const touchedAnswerPath = changed.filter(isAnswerPathFile);
  if (touchedAnswerPath.length === 0) process.exit(0); // not an answer-path change

  const claims = hasFixClaim(subjects) || hasFixClaim(sessionLogDiff);
  if (!claims) process.exit(0); // answer-path touched but no fix-claim — allow (pure refactor)

  // Override (logged).
  if (process.env.ALLOW_ANSWER_FIX_WITHOUT_PROOF === "1") {
    process.stderr.write(
      `⚠️  answer-fix-proof gate OVERRIDDEN (ALLOW_ANSWER_FIX_WITHOUT_PROOF=1) for: ${touchedAnswerPath.join(", ")}\n`,
    );
    process.exit(0);
  }

  const verdict = validateProofs(proofs, Date.now());
  if (verdict.ok) {
    process.stderr.write(
      `✅ answer-fix-proof: ${verdict.reason} for ${touchedAnswerPath.join(", ")}\n`,
    );
    process.exit(0);
  }

  // BLOCK.
  const msg =
    `\n${BANNER}\n` +
    `PUSH BLOCKED — answer-path fix CLAIMED without live proof\n` +
    `${BANNER}\n` +
    `You changed an answer-path file and a commit/log claims a fix:\n` +
    `  ${touchedAnswerPath.join("\n  ")}\n\n` +
    `Reason: ${verdict.reason}\n\n` +
    `This gate exists because this exact bug class ("the assistant deflects an\n` +
    `in-scope question") was declared fixed ~23 times and shipped anyway — each\n` +
    `time committed + logged as done WITHOUT anyone reading the live answer.\n\n` +
    `To push, append ONE json line to ${PROOF_LEDGER} (in this push) capturing a\n` +
    `REAL answer observed from the running assistant:\n` +
    `  {"question":"...","answer":"<full live answer text>","endpoint":"/api/assistant",\n` +
    `   "observed_at":"<ISO 8601, within ${PROOF_MAX_AGE_DAYS}d>","commit_claim":"what this proves"}\n\n` +
    `The answer must carry a real number and must NOT contain a deflection phrase\n` +
    `(e.g. "here's what I can pull", "not region-wide", "offer to pull").\n` +
    `If you cannot produce a non-deflecting live answer, the fix is NOT done —\n` +
    `that is the gate working, not a false alarm.\n` +
    `Override (logged) only for a non-answer refactor: ALLOW_ANSWER_FIX_WITHOUT_PROOF=1\n` +
    `${BANNER}\n`;
  process.stdout.write(msg);
  process.stderr.write(msg);
  process.exit(2);
}

// Only run when invoked directly (not when imported by the test).
const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => main(raw));
}
