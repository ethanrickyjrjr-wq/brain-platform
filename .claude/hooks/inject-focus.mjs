#!/usr/bin/env node
// UserPromptSubmit hook — the focus system's dev-session salience layer.
//
// WHY: CLAUDE.md is ~600 lines and MEMORY indexes ~80 facts, so when an answer is
// generated NOTHING fires. The operator re-corrects the same handful of beliefs
// every session (MM/DD/YYYY dates, "not ZIP-only", plain-text answers, no jargon,
// never invent). This hook makes those rules SALIENT on every prompt by adding
// them to context, instead of hoping the always-on giant file is read.
//
// CONTRACT (verified live 2026-06-28, code.claude.com/docs/en/hooks):
//   - UserPromptSubmit stdin JSON carries `prompt` (+ session_id, cwd, …).
//   - Exit 0 + `hookSpecificOutput.additionalContext` → string added to context
//     every turn, discreetly (wrapped in a system-reminder; not a chat message).
//   - Exit 2 BLOCKS + erases the prompt — we NEVER do that. Always exit 0.
//   - 30s timeout, runs before every prompt → must be fast, NO network/DB.
//   - Phrase as factual reminders, not imperative system commands (imperative
//     phrasing trips prompt-injection defenses and gets surfaced to the user).
//   - Output ≤ 10k chars; resume REPLAYS saved text → keep it static (no
//     timestamps). That is why TODAY.md is POINTED at, never inlined.
//
// NO keyword router: a topic router misfires constantly (injects email notes on
// any prompt that merely says "email"). The rules are always-on; "go deep on an
// area" is handled by the area subagents + location-scoped CLAUDE.md.
//
// Rules live in operator-editable `_ASSISTANT/RULES.md` so wording changes in ONE
// plain-text place without touching this script; DEFAULT_RULES is the fallback.
//
// Fail-OPEN: any error → exit 0 silently. A broken focus hook must never wedge a
// prompt.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Directories that carry a location-scoped CLAUDE.md (Class-B conventions). */
export const AREA_DIRS = ["ingest/", "refinery/packs/", "lib/email/", "lib/assistant/"];

/** The Class-A canon — the cross-cutting beliefs the operator repeats. Factual
 *  reminders, NOT imperative system commands. Fallback when _ASSISTANT/RULES.md
 *  is absent; that file (when present) overrides this verbatim. */
export const DEFAULT_RULES = `FOCUS — the rules that get repeated. Honor them before answering.
1. Never invent a number. Every figure names a real source, filled in this order: our data → the user's upload → a named web source → a figure the user gave. An invented number (no source) is the only hard block; a gap is filled from the next lane, never refused.
2. As-of dates are written MM/DD/YYYY, stated once — never the raw SWFL-…-YYYYMMDD token.
3. The moat is four-lane at ANY grain — never frame the product as "ZIP-level". Grain and source are both unconstrained.
4. Charts: we build charts from real data — bar/table from any brain, plus live-web (cited), the user's upload, and figures the user states. If a shape isn't built yet, offer the bar/table version or chart ideas — never tell a user we can't chart something.
5. Answers carry no system nouns, internal IDs, or jargon (no master/brain-id/§/pack ids; NNN = triple-net rent, never a place name).
6. Answers are plain text — no blockquotes, no tables (they break copy-paste). Code fences are for commands only.
7. Probe our code first (RULE 0.5), research the outside answer with crawl4ai not memory (RULE 0.4). If unsure, use /advisor — never guess.`;

/** Load the hard rules: the operator's file wins; fall back to DEFAULT_RULES when
 *  the file is missing or blank. `read` is injectable for testing. */
export function loadRules({ read }) {
  let text;
  try {
    text = read();
  } catch {
    return DEFAULT_RULES;
  }
  if (typeof text !== "string" || text.trim().length === 0) return DEFAULT_RULES;
  return text.trim();
}

/** Build the additionalContext string: the rules + a one-line pointer to the area
 *  CLAUDE.md files + (only when present) a pointer to TODAY.md. POINTERS, never
 *  paste — keeps it small and static so resume-replay never goes stale. */
export function buildAdditionalContext({ rulesText, todayExists }) {
  const areaPointer =
    "Area conventions load by location — when editing one of these, read its CLAUDE.md: " +
    AREA_DIRS.map((d) => `${d}CLAUDE.md`).join(", ") +
    ".";
  const lines = [rulesText, "", areaPointer];
  if (todayExists) {
    lines.push("What's in flight this session: see _ASSISTANT/TODAY.md (open checks, last ship).");
  }
  return lines.join("\n");
}

/** The exact UserPromptSubmit JSON output. Exit 0 with this on stdout → the
 *  additionalContext is added to context. No `decision` → the prompt proceeds. */
export function buildHookOutput({ rulesText, todayExists }) {
  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: buildAdditionalContext({ rulesText, todayExists }),
    },
  };
}

/** Drain stdin (the harness pipes the event JSON in) then emit the focus context.
 *  We don't route on the prompt, so the content is static; draining stdin avoids a
 *  broken pipe. Fail-open on any error. */
function main() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    try {
      const root = process.cwd();
      const rulesText = loadRules({
        read: () => readFileSync(resolve(root, "_ASSISTANT", "RULES.md"), "utf8"),
      });
      const todayExists = existsSync(resolve(root, "_ASSISTANT", "TODAY.md"));
      process.stdout.write(JSON.stringify(buildHookOutput({ rulesText, todayExists })));
    } catch {
      // fail-open: never wedge a prompt.
    }
    process.exit(0);
  });
  // If stdin never ends (no pipe), still emit after a tick so the hook can't hang.
  process.stdin.on("error", () => process.exit(0));
}

// Run only when invoked directly (not when imported by the test).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
