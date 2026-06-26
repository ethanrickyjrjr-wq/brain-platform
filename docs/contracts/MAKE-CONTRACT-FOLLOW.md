# How to make THE CONTRACT follow every session (Sonnet: install this)

This is the answer to "how can a contract follow on our MCP but not here?" — it CAN. On the MCP, the
response-contract rides in the response content. Here, the equivalent is a **SessionStart hook**: a script
that fires at the start of every session and prints text into context. This repo already uses that exact
mechanism for `print-session-log.mjs` and `print-kickoff.mjs`. We add one more that prints the contract.

The agent is not allowed to install its own session hooks (a guardrail blocked it). So install these two
edits yourself / with Sonnet.

## STEP 1 — create `.claude/hooks/print-contract.mjs` with this exact content

```js
#!/usr/bin/env node
// SessionStart hook — prints THE CONTRACT at the top of every session, so it
// "follows along" like the MCP response-contract rides every response. Rules are
// EMBEDDED so it prints even if .claude/CONTRACT.md is moved. Never blocks startup.

const CONTRACT = `
========================================================================
THE CONTRACT — read before doing anything. Rules > plans. (.claude/CONTRACT.md)
========================================================================
1. USE WHAT'S ON — DON'T REBUILD IT. The platform is LIVE (master, lib/assistant/*,
   the email builder, the lake). Before writing ANY new module/pipeline/engine/table,
   PROVE it doesn't already exist — probe the live code FIRST. Default = feed/wire an
   existing surface, never recreate it. Rebuilding what exists is the #1 failure.
2. NO NEW SURFACE WITHOUT A YES. No new file/module/pipeline/cron/table without the
   operator's explicit go-ahead. Subtraction over addition.
3. NEVER FABRICATE A VERIFIABLE VALUE — FETCH OR SAMPLE IT. Every value is VERIFIED
   (fetched/sampled this session + cited) or INFERRED (marked + falsifier). No "pretty
   sure." Colors: read the brand page or sample the logo pixels. Numbers: query the lake.
4. STOP — DON'T SPIN. Unsure, or scope grows past a few files → STOP and ask in ONE line.
   Never generate work to look busy. Re-read the operator's actual words; never assume intent.
5. NOTHING OUTWARD WITHOUT APPROVAL. No send/push/PR/irreversible action without explicit
   approval — and a rendered PREVIEW first for anything he'll see. Triggers are the operator's.
========================================================================
`;

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  try {
    process.stdout.write(CONTRACT);
  } catch {
    // never block session start
  }
});
```

## STEP 2 — register it in `.claude/settings.json`

In `hooks.SessionStart[0].hooks`, add this as the FIRST entry (so the contract prints before everything):

```json
{ "type": "command", "command": "node .claude/hooks/print-contract.mjs" }
```

So the array becomes:

```json
"SessionStart": [
  { "matcher": "", "hooks": [
    { "type": "command", "command": "node .claude/hooks/print-contract.mjs" },
    { "type": "command", "command": "node .claude/hooks/check-build-context.mjs" },
    { "type": "command", "command": "node .claude/hooks/print-session-log.mjs" },
    { "type": "command", "command": "node .claude/hooks/print-kickoff.mjs" },
    { "type": "command", "command": "serena-hooks activate --client=claude-code" }
  ]}
]
```

That's it. Every session now opens with the contract in context — it follows along, enforced by the same
hook system that already prints the session log. Canonical contract text lives in `.claude/CONTRACT.md`;
the hook embeds a copy so it cannot silently stop printing.
```
