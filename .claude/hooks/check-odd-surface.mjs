#!/usr/bin/env node
// PostToolUse hook (matcher: Edit|Write — covers BOTH a patch Edit and a full
// Write, so a cadence_registry rewrite can't slip past). WARN-ONLY trigger for
// Operation Dumbo Drop (ODD) readiness — the mechanical half of the "build ODD
// into every un-auto-ingestable build" rule (CLAUDE.md, Brain Factory section;
// plan docs/superpowers/plans/2026-06-05-operation-dumbo-drop.md).
//
// A CLAUDE.md line is read once at session start and still needs the session to
// make the association "I'm editing cadence_registry → ODD applies" — a step
// that drops under time pressure. This fires DETERMINISTICALLY at the moment an
// edit touches the real ODD surface, closing that gap. Same "enforce the rule
// mechanically, not as prose" move as check-project-path.mjs (Rule 8).
//
// Design:
//   • NEVER blocks. exit 0 always — additive/warn-only, so it respects RULE 3 C2
//     (no new mandatory pre-materialization gate). It gates AWARENESS, not the
//     materialization path.
//   • Fires the reminder ONLY when the edited path is on the ODD trigger surface:
//     ingest/cadence_registry.yaml, anything under ingest/pipelines/, or a
//     sweep-output.json. Silent for every other edit (no banner noise).
//   • Fail-OPEN (exit 0, silent) on any internal error — a broken nudge must
//     never interfere with a legitimate edit.

import path from "node:path";

const WIN = process.platform === "win32";

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    process.exit(0); // not our shape — silent allow
  }
  const fp = payload?.tool_input?.file_path;
  if (typeof fp !== "string" || fp.length === 0) process.exit(0);

  let norm;
  try {
    norm = path.resolve(process.cwd(), fp);
    norm = (WIN ? norm.toLowerCase() : norm).split(path.sep).join("/");
  } catch {
    process.exit(0); // can't resolve — fail open
  }

  if (!onOddSurface(norm)) process.exit(0); // not the trigger surface — silent

  const bar = "─".repeat(72);
  process.stdout.write(
    `\n${bar}\n` +
      `[ODD nudge] You touched an Operation Dumbo Drop surface.\n` +
      `  If this dataset/brain's source CAN'T be auto-ingested (rotating-URL PDF,\n` +
      `  paywall, manual portal, hand-keyed) → ship the ODD-ready scaffold in THIS\n` +
      `  PR so a manual drop is a zero-code graduation: empty-tolerant consumer +\n` +
      `  parked cadence entry (probe-excluded) + Tier-1 cold target + source_tag\n` +
      `  provenance + idempotent merge. Canonical: marketbeat_swfl.\n` +
      `  Plan: docs/superpowers/plans/2026-06-05-operation-dumbo-drop.md\n` +
      `  If the source HAS a real cron, ignore this — ODD doesn't apply.\n` +
      `${bar}\n`,
  );
  process.exit(0); // warn-only — never block
});

// True when the (forward-slashed, lowercased-on-Win) absolute path is on the ODD
// trigger surface. Segment-aware so a lookalike filename elsewhere doesn't match.
function onOddSurface(p) {
  if (p.endsWith("/ingest/cadence_registry.yaml")) return true;
  if (p.includes("/ingest/pipelines/")) return true;
  if (p.endsWith("/sweep-output.json")) return true;
  return false;
}
