// Proof that the answer-fix-proof gate actually bites.
// Run: node .claude/hooks/check-answer-fix-proof.test.mjs
import assert from "node:assert";
import {
  isGitPush,
  isAnswerPathFile,
  hasFixClaim,
  findDeflection,
  findLeak,
  validateProofs,
} from "./check-answer-fix-proof.mjs";

const NOW = Date.parse("2026-06-21T18:00:00Z");
const FRESH = "2026-06-21T17:30:00Z";
const STALE = "2026-06-10T00:00:00Z";

// A clean, region-wide, numeric, non-deflecting answer (what a real fix produces).
const GOOD =
  "Region-wide, SWFL home values are running about $385,000 (Zillow ZHVI, Apr 2026), " +
  "up 2.4% year over year, while asking rents sit near $2,150/mo. The drivers: new permits " +
  "are down 11% and for-sale inventory is up 18% across Lee and Collier, both cooling price growth.";

// The actual screenshot answer (the bug).
const SCREENSHOT =
  "I don't have current home price and rent drivers at the regional level in my live dataset. " +
  "The strongest read sits at the ZIP and county level, not region-wide. Here's what I can pull for you:";

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    console.log("  PASS  " + name);
    pass++;
  } catch (e) {
    console.log("  FAIL  " + name + " — " + e.message);
    fail++;
  }
}

// --- triggers ---
check("isGitPush matches git push + safe-push, not git status", () => {
  assert.equal(isGitPush("git push origin HEAD:main"), true);
  assert.equal(isGitPush("node scripts/safe-push.mjs"), true);
  assert.equal(isGitPush("git status"), false);
});

check("isAnswerPathFile flags the conversation path + master rollup, not random files", () => {
  assert.equal(isAnswerPathFile("lib/assistant/conversation-path.ts"), true);
  assert.equal(isAnswerPathFile("refinery/packs/master.mts"), true);
  assert.equal(isAnswerPathFile("app/api/assistant/route.ts"), true);
  assert.equal(isAnswerPathFile("components/Button.tsx"), false);
  assert.equal(isAnswerPathFile("refinery/packs/housing-swfl.mts"), false);
});

check("hasFixClaim catches fix/deflect/region-wide language, ignores chores", () => {
  assert.equal(hasFixClaim("fix(assistant): stop region-wide deflection"), true);
  assert.equal(hasFixClaim("feat: never dead-end on an in-scope ask"), true);
  assert.equal(hasFixClaim("chore: bump deps"), false);
});

// --- the core differentiator: deflection detection on answer TEXT ---
check("findDeflection catches the literal screenshot answer", () => {
  assert.ok(findDeflection(SCREENSHOT), "screenshot answer should be flagged as a deflection");
});

check("findDeflection passes a real region-wide numeric answer", () => {
  assert.equal(findDeflection(GOOD), null);
});

// De-blunt regression: a LEGIT answer that merely uses "at the regional level"
// as a descriptive frame (not a "I don't have …" refusal) must NOT be flagged.
// The bare phrase used to false-positive this; it was replaced with negation
// variants.
check("findDeflection does NOT flag a legit 'at the regional level' answer", () => {
  assert.equal(
    findDeflection("Prices fell sharply at the regional level, down 3.5% to $400,000."),
    null,
  );
});

// …but the screenshot-style refusal that reaches for the same phrase in a
// "I don't have that at the regional level" construction IS still a deflection.
check("findDeflection STILL flags 'I don't have that at the regional level'", () => {
  assert.ok(
    findDeflection("I don't have that at the regional level — give me a ZIP."),
    "negated regional-level refusal should be flagged",
  );
});

// Real deflections captured LIVE from prod 2026-06-21 — these used DIFFERENT
// words than the screenshot and a naive list passed them. Pin them.
check("findDeflection catches the live-observed prod deflections", () => {
  const live = [
    "I can give you the housing reads I hold, but I need to know which county or ZIP you're asking about.",
    "I need to know which area you're asking about. Home prices are tracked per ZIP code and by county.",
    "I need to narrow this down—which county or ZIP would you like me to focus on?",
    "The data I hold does NOT cover residential rental rates at a region-wide grain — not a unified SWFL rent read.",
  ];
  for (const a of live) assert.ok(findDeflection(a), `should flag: ${a.slice(0, 40)}…`);
});

// --- ask #9: raw token / backwards date leak (the thing I walked past) ---
check("findLeak catches raw token + backwards YYYYMMDD, passes MM/DD/YYYY", () => {
  assert.ok(findLeak("Region-wide values are up, as of SWFL-7421-v83-20260620."), "raw token");
  assert.ok(findLeak("Freshest read 20260620 across the region."), "bare YYYYMMDD");
  // A clean answer: MM/DD/YYYY date, commas in money, year-month data period — no leak.
  assert.equal(
    findLeak("Region-wide values ~$685,330 as of 06/20/2026; latest monthly read (2026-03)."),
    null,
  );
});

check("BLOCK: proof answer leaks a raw token even if it otherwise answers", () => {
  const v = validateProofs(
    [{ question: "q", answer: GOOD + " (token SWFL-7421-v83-20260620)", observed_at: FRESH }],
    NOW,
  );
  assert.equal(v.ok, false);
  assert.match(v.reason, /LEAKS/);
});

// --- validateProofs: the block/pass matrix ---
check("BLOCK: no proof at all", () => {
  assert.equal(validateProofs([], NOW).ok, false);
});

check("BLOCK: proof answer still deflects", () => {
  const v = validateProofs(
    [{ question: "what's driving prices?", answer: SCREENSHOT, observed_at: FRESH }],
    NOW,
  );
  assert.equal(v.ok, false);
  assert.match(v.reason, /DEFLECT/);
});

check("BLOCK: proof answer carries no number", () => {
  const noNumber =
    "Prices are broadly rising across the region and rents are climbing as well, " +
    "driven by permit and inventory dynamics over the recent period here in southwest Florida.";
  const v = validateProofs([{ question: "q", answer: noNumber, observed_at: FRESH }], NOW);
  assert.equal(v.ok, false);
  assert.match(v.reason, /no number/);
});

check("BLOCK: proof is stale (older than 3 days)", () => {
  const v = validateProofs([{ question: "q", answer: GOOD, observed_at: STALE }], NOW);
  assert.equal(v.ok, false);
  assert.match(v.reason, /stale/);
});

check("BLOCK: proof answer too short", () => {
  const v = validateProofs([{ question: "q", answer: "Up 2.4%.", observed_at: FRESH }], NOW);
  assert.equal(v.ok, false);
  assert.match(v.reason, /too short/);
});

check("PASS: fresh, numeric, non-deflecting region-wide answer", () => {
  const v = validateProofs(
    [
      {
        question: "What's driving SWFL home prices and rents right now?",
        answer: GOOD,
        observed_at: FRESH,
        endpoint: "/api/assistant",
      },
    ],
    NOW,
  );
  assert.equal(v.ok, true, v.reason);
});

console.log(`\n${fail === 0 ? "ALL GREEN ✅" : "FAILURES ❌"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
