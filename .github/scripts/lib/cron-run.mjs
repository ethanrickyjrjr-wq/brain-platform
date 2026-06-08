// Shared helpers for the cron-failure logger + healer.
// Extracted verbatim from log-cron-incident.mjs (no behaviour change) so both
// .github/scripts/log-cron-incident.mjs and .github/scripts/heal-cron-failure.mjs
// derive the workflow slug and fetch the failed-run log tail the same way.

import { execSync } from "node:child_process";

// Canonical ledger key: kebab-case workflow filename (matches the existing
// hand-typed convention). e.g. run.path ".github/workflows/faf5-annual.yml" -> "faf5-annual".
// Human-readable run.name is kept for issue-comment / title display.
export function deriveWorkflowName(run) {
  const workflowPath = run.path || "";
  const workflowName = (workflowPath.split("/").pop() || run.name || "unknown").replace(
    /\.ya?ml$/,
    "",
  );
  return { workflowName, workflowDisplayName: run.name || workflowName };
}

// Last `lines` lines of the failed jobs' logs for the given run id.
// Returns a short diagnostic string (never throws) if the logs can't be fetched.
export function fetchLogTail(id, lines = 30) {
  try {
    const out = execSync(`gh run view ${id} --log-failed`, {
      encoding: "utf8",
      env: process.env,
      maxBuffer: 64 * 1024 * 1024,
    });
    return out.trim().split("\n").slice(-lines).join("\n");
  } catch (e) {
    const oneLine = (e.message || "unknown").replace(/\s+/g, " ").slice(0, 200);
    return `(could not fetch logs: ${oneLine})`;
  }
}
