/**
 * prove-deflection.mts — PROVE the deflection fix on the live answer path with
 * real Haiku calls.
 *
 * Question under test: "What's driving SWFL home prices and rents right now?"
 *
 * This reconstructs the OUTSIDE/analyst system prompt EXACTLY the way
 * lib/assistant/conversation-path.ts#buildOutsideSystem does (the no-location
 * analyst branch that grounds on the region-wide master read), then calls Haiku
 * 20× for the FIXED config and 20× for the BASELINE config, scoring every answer
 * with the EXACT detectors from .claude/hooks/check-answer-fix-proof.mjs
 * (findDeflection + findLeak).
 *
 *   FIXED    = working-tree brains/master.md (region price+rent in key_metrics)
 *              + edited OUTSIDE_SYSTEM + edited welcomeGroundedSpeakLine
 *              + edited RULES_OF_ENGAGEMENT (MM/DD/YYYY, never the raw token)
 *   BASELINE = HEAD brains/master.md (NO region price/rent headline)
 *              + pre-fix OUTSIDE_SYSTEM + pre-fix speak line
 *              + pre-fix RULES_OF_ENGAGEMENT (quote freshness_token once)
 *
 * Prod model/params mirrored verbatim from lib/assistant/stream.ts#streamAnswer:
 *   model claude-haiku-4-5 (TRIAGE_MODEL), max_tokens 700 (GROUNDED_MAX_TOKENS),
 *   NO temperature param → Anthropic API default (1.0), system + messages.
 *
 * Run:  bun run scripts/prove-deflection.mts
 * (Bun auto-loads ANTHROPIC_API_KEY from .env.local.)
 */
import { execSync } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import { TRIAGE_MODEL } from "../refinery/agents/anthropic.mts";
import { parseBrainMarkdown } from "../refinery/render/speaker.mts";
import { buildDossier } from "../lib/fetch-brain";
import { renderBlock, type GroundingBlock } from "../lib/highlighter/grounding";
import { buildPlaceContext } from "../lib/place-context";
import { FORMAT_RULE, freshnessDirective } from "../lib/assistant/system-prompt";
// EXACT detectors the push-gate uses — imported, never re-implemented.
import { findDeflection, findLeak } from "../.claude/hooks/check-answer-fix-proof.mjs";

const QUESTION = "What's driving SWFL home prices and rents right now?";
const ROLLS = 20;
const MAX_TOKENS = 700; // GROUNDED_MAX_TOKENS in conversation-path.ts
const fs = await import("node:fs/promises");

// ---------------------------------------------------------------------------
// FIXED prompt atoms (current working tree — verbatim from the edited source)
// ---------------------------------------------------------------------------
const OUTSIDE_SYSTEM_FIXED =
  "You are a Southwest Florida market analyst helping this person build a cited, " +
  "client-ready project. The data covers Lee, Collier, Charlotte, Glades, Hendry, and " +
  "Sarasota counties — prices, permits, flood risk, tourism, and the local economy, down " +
  "to the ZIP and named place. Answer the question directly and usefully, in plain prose, " +
  "from the cited data below. You CAN file answers into their " +
  "project: when they save something it lands in their briefcase to build into a " +
  "client-ready deliverable — point them to the 'File this answer' link when it would " +
  "help, but do not pitch and do not steer the conversation toward a product. " +
  "ANSWER FIRST: a region-wide Southwest Florida question (e.g. what's driving prices " +
  "and rents right now) is answerable from the region-wide data below — answer it with " +
  "the real numbers FIRST. A SWFL-wide read is a real, complete answer, never a reason " +
  "to demand a ZIP. Only ask for a specific ZIP or town if the user explicitly wants one " +
  "place, and offer that as a next step AFTER you have answered — never as a precondition " +
  "for answering, and never guess a place they did not name.\n\n" +
  "NEVER invent a Southwest Florida number — no flood loss, sale price, rate, or count " +
  "from memory or a guess; every figure must come from the cited data. If a specific " +
  "figure genuinely is not in the data at ANY grain, say what you DO hold and offer to " +
  "pull the specific one — never fabricate. But never refuse a region-wide question the " +
  "region-wide data below can answer, and never make the user name a place before you " +
  "answer.\n\n" +
  "Be a sharp, direct local operator, not a salesperson. Never use internal jargon " +
  '(no "master", "brain", "payload", "grain", "dossier"). ' +
  "When the project context shows significant metric changes, lead with what changed " +
  "and by how much before asking what the user wants to do.\n\n" +
  "When the context includes Nearby events, weave the highest-scored one naturally " +
  "into your analysis — e.g. 'a Walmart supercenter permit just filed 1.1 miles north; " +
  "that's a potential traffic driver' or 'the McDonald's closure 0.8 miles away removes " +
  "a traffic anchor.' Do not list events mechanically; lead with the highest-score event " +
  "and mention others only if directly relevant. A permit_filed event is not confirmed — " +
  "say 'a permit was filed', not 'it's opening.' Never surface an event the user " +
  "dismissed from their project.";

const RULES_FIXED = `RULES OF ENGAGEMENT — SWFL Data Gulf
1. CITE: no source in this payload → no claim.
2. [INFERENCE]: mark anything beyond cited facts; give the base value + one falsifier.
3. GRAIN: answer at the grain held; a gap = offer to pull, never invent.
4. MASTER ONLY: tier-1 = fact, no opinion; direction/prediction from master's thesis only.
5. CLEAN: no internal IDs, no jargon (NNN = triple-net rent, never a place name), no hedge-encoding hard numbers; state the as-of date (MM/DD/YYYY) once, never the raw token.
6. PLACES: SWFL; named places = Florida, not elsewhere; zoom on named spot.
7. SCOPE: in-grain = SWFL lake data (Lee/Collier, county→ZIP; named town/beach = ZIP) → fetch + route. Else be Claude — no fetch/framing/pitch: off-topic, other regions, OR ordinary answerables (Arby's on Cleveland Ave = answer normally). GUARD: never invent a SWFL number below ZIP.`;

// welcomeGroundedSpeakLine(token, "analyst") — FIXED (working tree)
function speakLineFixed(token?: string): string {
  const close =
    "When the user wants to keep an answer, tell them they can save it with the 'File this answer' link and build it into a client-ready deliverable in their project. Do not pitch.";
  const absentLine =
    "If a region-wide figure is on a line above, answer with it directly. Only when a SPECIFIC figure the user asked for is not on any line above do you say you don't have it at that grain and offer to pull it — never demand a ZIP before answering a question the lines above already cover.";
  return (
    "\n\nANSWER ONLY FROM THE DATA ABOVE. Every Southwest Florida number you state must appear " +
    "verbatim on a line above, with its source. You are a data reader, not an analyst: relay the cited " +
    "values exactly as written. Do NOT do arithmetic, averaging, totaling, rounding, per-unit " +
    "(per-month, per-square-foot) derivation, or comparison math on these numbers — any number you " +
    "derive is a fabrication even when its inputs are sourced. " +
    absentLine +
    " Never estimate, never use outside knowledge " +
    "for a Southwest Florida figure, and never say 'typically', 'generally', 'roughly', or 'around' " +
    "about a number. When a line is labeled with a coverage scope (for example 'Lee county-wide — " +
    "covers 33913'), carry that label when you relay it — never present a county-wide or regional figure " +
    "as the specific place's own number. " +
    (token ? freshnessDirective(token) + " " : "") +
    close +
    " Plain text only — no markdown. Never say 'master', 'brain', 'payload', 'grain', or 'dossier'."
  );
}

// ---------------------------------------------------------------------------
// BASELINE prompt atoms (git show HEAD — the pre-fix source, verbatim)
// ---------------------------------------------------------------------------
const OUTSIDE_SYSTEM_BASELINE =
  "You are a Southwest Florida market analyst helping this person build a cited, " +
  "client-ready project. The data covers Lee, Collier, Charlotte, Glades, Hendry, and " +
  "Sarasota counties — prices, permits, flood risk, tourism, and the local economy, down " +
  "to the ZIP and named place. Answer the question directly and usefully, in plain prose, " +
  "from the cited data below. You CAN file answers into their " +
  "project: when they save something it lands in their briefcase to build into a " +
  "client-ready deliverable — point them to the 'File this answer' link when it would " +
  "help, but do not pitch and do not steer the conversation toward a product. When no " +
  "place is named yet and the question needs one, ask which ZIP or area they mean — do " +
  "not guess.\n\n" +
  "NEVER invent a Southwest Florida number — no flood loss, sale price, rate, or count " +
  "from memory or a guess; every figure must come from the cited data. If you don't hold " +
  "a number at the grain asked, say so plainly and offer to pull it — never fabricate.\n\n" +
  "Be a sharp, direct local operator, not a salesperson. Never use internal jargon " +
  '(no "master", "brain", "payload", "grain", "dossier"). ' +
  "When the project context shows significant metric changes, lead with what changed " +
  "and by how much before asking what the user wants to do.\n\n" +
  "When the context includes Nearby events, weave the highest-scored one naturally " +
  "into your analysis — e.g. 'a Walmart supercenter permit just filed 1.1 miles north; " +
  "that's a potential traffic driver' or 'the McDonald's closure 0.8 miles away removes " +
  "a traffic anchor.' Do not list events mechanically; lead with the highest-score event " +
  "and mention others only if directly relevant. A permit_filed event is not confirmed — " +
  "say 'a permit was filed', not 'it's opening.' Never surface an event the user " +
  "dismissed from their project.";

const RULES_BASELINE = `RULES OF ENGAGEMENT — SWFL Data Gulf
1. CITE: no source in this payload → no claim.
2. [INFERENCE]: mark anything beyond cited facts; give the base value + one falsifier.
3. GRAIN: answer at the grain held; a gap = offer to pull, never invent.
4. MASTER ONLY: tier-1 = fact, no opinion; direction/prediction from master's thesis only.
5. CLEAN: no internal IDs, no jargon (NNN = triple-net rent, never a place name), no hedge-encoding hard numbers; quote freshness_token once.
6. PLACES: SWFL; named places = Florida, not elsewhere; zoom on named spot.
7. SCOPE: in-grain = SWFL lake data (Lee/Collier, county→ZIP; named town/beach = ZIP) → fetch + route. Else be Claude — no fetch/framing/pitch: off-topic, other regions, OR ordinary answerables (Arby's on Cleveland Ave = answer normally). GUARD: never invent a SWFL number below ZIP.`;

// welcomeGroundedSpeakLine(token, "analyst") — BASELINE (pre-fix: a single
// gap-and-offer line for BOTH voices, and "quote freshness_token once" rules
// licensed the raw token leak).
function speakLineBaseline(token?: string): string {
  const close =
    "When the user wants to keep an answer, tell them they can save it with the 'File this answer' link and build it into a client-ready deliverable in their project. Do not pitch.";
  return (
    "\n\nANSWER ONLY FROM THE DATA ABOVE. Every Southwest Florida number you state must appear " +
    "verbatim on a line above, with its source. You are a data reader, not an analyst: relay the cited " +
    "values exactly as written. Do NOT do arithmetic, averaging, totaling, rounding, per-unit " +
    "(per-month, per-square-foot) derivation, or comparison math on these numbers — any number you " +
    "derive is a fabrication even when its inputs are sourced. If a figure is not on a line above, say " +
    "you don't have it at that grain and offer to pull it. Never estimate, never use outside knowledge " +
    "for a Southwest Florida figure, and never say 'typically', 'generally', 'roughly', or 'around' " +
    "about a number. When a line is labeled with a coverage scope (for example 'Lee county-wide — " +
    "covers 33913'), carry that label when you relay it — never present a county-wide or regional figure " +
    "as the specific place's own number. " +
    // BASELINE leak license: the pre-fix surface quoted the RAW token in prose.
    (token
      ? `State the data's recency exactly once by quoting the freshness token ${token}. `
      : "") +
    close +
    " Plain text only — no markdown. Never say 'master', 'brain', 'payload', 'grain', or 'dossier'."
  );
}

// ---------------------------------------------------------------------------
// buildOutsideSystem reconstruction (no-location analyst branch). Mirrors
// conversation-path.ts: buildPlaceContext + FORMAT_RULE + OUTSIDE_SYSTEM +
// "=== RULES OF ENGAGEMENT ===" + RULES + "=== LIVE ... DATA ... ===" +
// renderBlock(masterBlock) + speakLine(token).
// The question names no in-scope ZIP/town, so buildPlaceContext("") === "" and
// routeChart() is not vacancy/asking-rent/scatter → master-only grounding (no
// cre-swfl block). Verified against routeChart on the question below.
// ---------------------------------------------------------------------------
function buildSystem(
  masterMd: string,
  creMd: string,
  variant: "fixed" | "baseline",
): { system: string; token: string } {
  const brain = parseBrainMarkdown(masterMd);
  const token = brain.freshness_token;
  const blocks: GroundingBlock[] = [
    {
      label: "Southwest Florida (region-wide)",
      dossier: buildDossier(brain.output, token),
    },
  ];
  // routeChart(QUESTION) === { scope: "asking-rent" } → prod's buildOutsideSystem
  // pushes the cre-swfl corridor block too. Mirror it (cre-swfl.md is untouched by
  // the fix; prod reads working-tree disk for it in both states).
  const cre = parseBrainMarkdown(creMd);
  blocks.push({
    label: "SWFL commercial corridors",
    dossier: buildDossier(cre.output, cre.freshness_token),
  });
  const OUTSIDE = variant === "fixed" ? OUTSIDE_SYSTEM_FIXED : OUTSIDE_SYSTEM_BASELINE;
  const RULES = variant === "fixed" ? RULES_FIXED : RULES_BASELINE;
  const speakLine = variant === "fixed" ? speakLineFixed(token) : speakLineBaseline(token);
  const system =
    buildPlaceContext(QUESTION) +
    FORMAT_RULE +
    OUTSIDE +
    "\n\n=== RULES OF ENGAGEMENT ===\n" +
    RULES +
    "\n\n=== LIVE SOUTHWEST FLORIDA DATA — ANSWER ONLY FROM THIS ===\n\n" +
    blocks.map(renderBlock).join("\n\n") +
    speakLine;
  return { system, token };
}

// ---------------------------------------------------------------------------
async function callHaiku(client: Anthropic, system: string): Promise<string> {
  const res = await client.messages.create({
    model: TRIAGE_MODEL, // claude-haiku-4-5
    max_tokens: MAX_TOKENS,
    // NO temperature param → API default (1.0), exactly as streamAnswer does.
    system,
    messages: [{ role: "user", content: QUESTION }],
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

interface Scored {
  answer: string;
  deflect: string | null;
  leak: string | null;
  bad: boolean;
}

async function runBatch(client: Anthropic, system: string, rolls: number): Promise<Scored[]> {
  const out: Scored[] = [];
  for (let i = 0; i < rolls; i++) {
    let answer = "";
    try {
      answer = await callHaiku(client, system);
    } catch (e) {
      answer = `__ERROR__: ${(e as Error).message}`;
    }
    const deflect = findDeflection(answer);
    const leak = findLeak(answer);
    out.push({ answer, deflect, leak, bad: Boolean(deflect || leak) });
    process.stderr.write(out[i].bad ? "x" : ".");
  }
  process.stderr.write("\n");
  return out;
}

// ---------------------------------------------------------------------------
async function main() {
  const keyLoaded = Boolean(process.env.ANTHROPIC_API_KEY);
  if (!keyLoaded) {
    console.log(
      JSON.stringify({
        key_loaded: false,
        reason: "ANTHROPIC_API_KEY not in process.env — run with `bun run` so .env.local loads",
      }),
    );
    return;
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // FIXED master.md = working tree on disk.
  const fixedMaster = await fs.readFile("brains/master.md", "utf-8");
  // BASELINE master.md = HEAD version (NO region price/rent headline).
  const baselineMaster = execSync("git show HEAD:brains/master.md", {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });

  // cre-swfl.md: untouched by the fix; prod reads working-tree disk for both states.
  const creMaster = await fs.readFile("brains/cre-swfl.md", "utf-8");

  const fixed = buildSystem(fixedMaster, creMaster, "fixed");
  const baseline = buildSystem(baselineMaster, creMaster, "baseline");

  // observed_at: captured from a real `date -u` call (NOT invented). On Windows the
  // bare `date` resolves to cmd's interactive date prompt, so invoke bash's coreutils
  // date explicitly.
  const observedAt = execSync('bash -lc "date -u +%Y-%m-%dT%H:%M:%SZ"', {
    encoding: "utf-8",
  }).trim();

  process.stderr.write(`BASELINE (HEAD master v? token ${baseline.token}):\n`);
  const baseResults = await runBatch(client, baseline.system, ROLLS);
  process.stderr.write(`FIXED (working-tree master token ${fixed.token}):\n`);
  const fixedResults = await runBatch(client, fixed.system, ROLLS);

  const baseBad = baseResults.filter((r) => r.bad).length;
  const fixedBad = fixedResults.filter((r) => r.bad).length;

  const firstBaseBad = baseResults.find((r) => r.bad) ?? baseResults[0];
  const firstFixedClean = fixedResults.find((r) => !r.bad);

  const report = {
    key_loaded: true,
    observed_at: observedAt,
    model: TRIAGE_MODEL,
    harness_path: "scripts/prove-deflection.mts",
    question: QUESTION,
    baseline_token: baseline.token,
    fixed_token: fixed.token,
    baseline_rolls: ROLLS,
    baseline_bad: baseBad,
    baseline_bad_rate: baseBad / ROLLS,
    fixed_rolls: ROLLS,
    fixed_bad: fixedBad,
    fixed_bad_rate: fixedBad / ROLLS,
    worked: fixedBad === 0,
    sample_baseline_bad: {
      answer: firstBaseBad.answer,
      deflect: firstBaseBad.deflect,
      leak: firstBaseBad.leak,
    },
    sample_fixed_clean: firstFixedClean ? { answer: firstFixedClean.answer } : null,
    baseline_breakdown: baseResults.map((r) => ({
      bad: r.bad,
      deflect: r.deflect,
      leak: r.leak,
    })),
    fixed_breakdown: fixedResults.map((r) => ({
      bad: r.bad,
      deflect: r.deflect,
      leak: r.leak,
    })),
    // Full text of every BAD fixed answer — so a substring false-positive
    // (e.g. "prices fell at the regional level") can be told from a true deflection.
    fixed_bad_answers: fixedResults.filter((r) => r.bad).map((r) => r.answer),
    // A pool of clean fixed answers to choose a proof_record from.
    fixed_clean_answers: fixedResults.filter((r) => !r.bad).map((r) => r.answer),
  };
  await fs.writeFile("scripts/.prove-deflection-result.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
