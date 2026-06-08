#!/usr/bin/env node
// Auto-captures GHA workflow_run events into docs/cron-rebuild-failures.md
// and an optional sticky-issue feed. See plan:
// C:\Users\ethan\.claude\plans\just-set-up-cron-rebuild-failures-md-luminous-yeti.md
//
// Modes:
//   --mode=record-failure   On workflow_run.conclusion === 'failure'
//   --mode=maybe-resolve    On workflow_run.conclusion === 'success'
//                           AND workflow_run.event === 'schedule'
//
// Flags:
//   --dry-run               Print actions; mutate no files, no git, no issue.

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const LEDGER_PATH = resolve(process.cwd(), "docs/cron-rebuild-failures.md");
const START = "<!-- INCIDENT_TABLE_START -->";
const END = "<!-- INCIDENT_TABLE_END -->";
const SYMPTOM_RX =
  /\b(?:Error|FAILED|Traceback|exit code|KeyError|ModuleNotFoundError|TimeoutError|ReadTimeout|SSLError|relation [^ ]+ does not exist)[^\n]*/;

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const mode = argv.find((a) => a.startsWith("--mode="))?.slice(7);
if (mode !== "record-failure" && mode !== "maybe-resolve") {
  console.error("Usage: --mode=record-failure|maybe-resolve [--dry-run]");
  process.exit(2);
}

const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath) {
  console.error("GITHUB_EVENT_PATH not set");
  process.exit(2);
}
const run = JSON.parse(readFileSync(eventPath, "utf8")).workflow_run;
if (!run) {
  console.error("Event payload missing workflow_run");
  process.exit(2);
}

// Canonical ledger key: kebab-case filename (matches existing hand-typed convention).
// Human-readable name (run.name) is kept for issue-comment display.
const workflowPath = run.path || ""; // e.g. ".github/workflows/faf5-annual.yml"
const workflowName = (workflowPath.split("/").pop() || run.name || "unknown").replace(
  /\.ya?ml$/,
  "",
);
const workflowDisplayName = run.name || workflowName;
const runId = run.id;
const runUrl = run.html_url;
const conclusion = run.conclusion;
const triggerEvent = run.event;
const headBranch = run.head_branch;
const today = new Date().toISOString().slice(0, 10);
const issueNumber = process.env.CRON_INCIDENT_ISSUE_NUMBER || "";
// Machine-readable tag embedded in every discrete incident issue title so
// closeIncidentIssue() can find it without ambiguity.
const INCIDENT_TAG = `[cron-failure:${workflowName}]`;

if (mode === "record-failure") recordFailure();
else maybeResolve();

// ---------------------------------------------------------------------------

function recordFailure() {
  if (conclusion !== "failure") return log(`skip: conclusion is ${conclusion}`);
  if (headBranch && headBranch !== "main")
    return log(`skip: head_branch is ${headBranch}, not main`);

  const logTail = fetchLogTail(runId);
  const symptom = escapeCell(extractSymptom(logTail));
  const row = `| ${today} | \`${workflowName}\` | ${symptom} | _auto-captured; pending triage_ | OPEN | [run](${runUrl}) |`;

  if (dryRun) {
    log("DRY-RUN: would insert row:\n" + row);
    if (issueNumber) log(`DRY-RUN: would comment on issue #${issueNumber}`);
    log(
      `DRY-RUN: would open discrete issue titled "${INCIDENT_TAG} ${workflowDisplayName} — ${today}"`,
    );
    return;
  }

  insertRow(row);
  gitCommitAndPush(`docs(cron-failures): log ${workflowName} failure [skip ci]`, () =>
    insertRow(row),
  );
  if (issueNumber) postComment(buildFailureBody(logTail));
  openIncidentIssue(logTail);
}

function maybeResolve() {
  if (conclusion !== "success") return log(`skip: conclusion is ${conclusion}`);
  if (triggerEvent !== "schedule") return log(`skip: trigger is ${triggerEvent}, not schedule`);

  const before = readFileSync(LEDGER_PATH, "utf8");
  const after = flipMostRecentOpenRow(before, workflowName);
  if (!after) return log(`no OPEN row for ${workflowName}; nothing to resolve`);

  if (dryRun) {
    log(`DRY-RUN: would flip OPEN → RESOLVED (auto) for most-recent ${workflowName} row`);
    if (issueNumber) log(`DRY-RUN: would comment ✅ on issue #${issueNumber}`);
    log(`DRY-RUN: would close open incident issue tagged ${INCIDENT_TAG}`);
    return;
  }

  writeFileSync(LEDGER_PATH, after, "utf8");
  gitCommitAndPush(`docs(cron-failures): auto-resolve ${workflowName} [skip ci]`, () => {
    const fresh = readFileSync(LEDGER_PATH, "utf8");
    const reflipped = flipMostRecentOpenRow(fresh, workflowName);
    if (reflipped) writeFileSync(LEDGER_PATH, reflipped, "utf8");
  });
  if (issueNumber)
    postComment(
      `✅ **${workflowName}** auto-resolved — ${today}\n\nNext scheduled run succeeded: ${runUrl}`,
    );
  closeIncidentIssue();
}

// ---------- log + symptom ----------

function fetchLogTail(id) {
  try {
    const out = execSync(`gh run view ${id} --log-failed`, {
      encoding: "utf8",
      env: process.env,
      maxBuffer: 64 * 1024 * 1024,
    });
    return out.trim().split("\n").slice(-30).join("\n");
  } catch (e) {
    const oneLine = (e.message || "unknown").replace(/\s+/g, " ").slice(0, 200);
    return `(could not fetch logs: ${oneLine})`;
  }
}

function extractSymptom(text) {
  const m = text.match(SYMPTOM_RX);
  if (m) return m[0].slice(0, 160).trim();
  const lines = text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return (lines.at(-1) || "(no log content)").slice(0, 160);
}

function escapeCell(s) {
  return s.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

// ---------- ledger mutation ----------

function insertRow(row) {
  const text = readFileSync(LEDGER_PATH, "utf8");
  const startIdx = text.indexOf(START);
  if (startIdx < 0) throw new Error(`Sentinel ${START} not found in ledger`);
  const after = text.slice(startIdx);
  const sep = after.match(/^\| -+ \|.*$/m);
  if (!sep) throw new Error("Header separator row not found after START sentinel");
  const insertAt = startIdx + sep.index + sep[0].length;
  const updated = text.slice(0, insertAt) + "\n" + row + text.slice(insertAt);
  writeFileSync(LEDGER_PATH, updated, "utf8");
}

function flipMostRecentOpenRow(ledger, name) {
  const s = ledger.indexOf(START);
  const e = ledger.indexOf(END);
  if (s < 0 || e < 0 || e < s) return null;
  const block = ledger.slice(s, e);
  const lines = block.split("\n");
  const nameRx = new RegExp(`\\\`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\\``);
  // Status column is delimited by pipes with single-space padding: ` | OPEN | `.
  // Newest-first order: first match from the top wins.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("|")) continue;
    if (!nameRx.test(line)) continue;
    if (!/\|\s+OPEN\s+\|/.test(line)) continue;
    lines[i] = line.replace(/\|\s+OPEN\s+\|/, "| RESOLVED (auto) |");
    return ledger.slice(0, s) + lines.join("\n") + ledger.slice(e);
  }
  return null;
}

// ---------- git ----------

function gitCommitAndPush(message, reapplyOnConflict) {
  sh(`git config user.name "github-actions[bot]"`);
  sh(`git config user.email "github-actions[bot]@users.noreply.github.com"`);
  sh(`git add docs/cron-rebuild-failures.md`);
  try {
    sh(`git commit -m "${message.replace(/"/g, '\\"')}"`);
  } catch {
    log("nothing to commit; skipping push");
    return;
  }
  try {
    sh(`git push origin HEAD:main`);
  } catch {
    log("push rejected; rebasing and re-applying mutation");
    sh(`git fetch origin main`);
    sh(`git reset --hard origin/main`);
    reapplyOnConflict();
    sh(`git add docs/cron-rebuild-failures.md`);
    sh(`git commit -m "${message.replace(/"/g, '\\"')}"`);
    sh(`git push origin HEAD:main`);
  }
}

// ---------- issue comments ----------

function buildFailureBody(logTail) {
  const repo = process.env.GITHUB_REPOSITORY || "";
  const ledgerUrl = repo
    ? `https://github.com/${repo}/blob/main/docs/cron-rebuild-failures.md`
    : "docs/cron-rebuild-failures.md";
  return [
    `**${workflowDisplayName}** (\`${workflowName}\`) failed — ${today}`,
    ``,
    `- Run: ${runUrl}`,
    `- Status: \`OPEN\` (auto-captured)`,
    `- Ledger: ${ledgerUrl}`,
    ``,
    `<details><summary>log tail (last 30 lines)</summary>`,
    ``,
    "```",
    logTail.slice(-4000),
    "```",
    `</details>`,
  ].join("\n");
}

function postComment(body) {
  const tmp = resolve(process.cwd(), `_incident-comment-${Date.now()}.md`);
  writeFileSync(tmp, body, "utf8");
  try {
    sh(`gh issue comment ${issueNumber} -F "${tmp}"`);
  } finally {
    try {
      unlinkSync(tmp);
    } catch {}
  }
}

// ---------- discrete incident issues (GitHub Projects) ----------

function openIncidentIssue(logTail) {
  const title = `${INCIDENT_TAG} ${workflowDisplayName} — ${today}`;
  const body = [
    `**${workflowDisplayName}** failed on \`${today}\`.`,
    ``,
    `- Run: ${runUrl}`,
    `- Workflow: \`${workflowName}\``,
    ``,
    `<details><summary>log tail (last 30 lines)</summary>`,
    ``,
    "```",
    logTail.slice(-4000),
    "```",
    `</details>`,
    ``,
    `_Auto-opened by log-cron-incident. Will auto-close when the next scheduled run succeeds._`,
  ].join("\n");
  const tmp = resolve(process.cwd(), `_incident-issue-body.md`);
  writeFileSync(tmp, body, "utf8");
  try {
    const out = execSync(
      `gh issue create --title "${title.replace(/"/g, '\\"')}" --label "cron-failure" --body-file "${tmp}"`,
      { encoding: "utf8", env: process.env },
    );
    const issueUrl = out.trim();
    log(`opened incident issue: ${issueUrl}`);
    // Add directly to the Ops Incidents project (project 3, owner ethanrickyjrjr-wq)
    try {
      const repo = process.env.GITHUB_REPOSITORY || "";
      const owner = repo.split("/")[0] || "ethanrickyjrjr-wq";
      execSync(`gh project item-add 3 --owner ${owner} --url "${issueUrl}"`, {
        encoding: "utf8",
        env: process.env,
      });
      log(`added to Ops Incidents project`);
    } catch (e) {
      log(`could not add to project: ${e.message}`);
    }
  } catch (e) {
    log(`could not open incident issue: ${e.message}`);
  } finally {
    try {
      unlinkSync(tmp);
    } catch {}
  }
}

function closeIncidentIssue() {
  try {
    const out = execSync(
      `gh issue list --label "cron-failure" --state open --search "${INCIDENT_TAG} in:title" --json number --limit 1`,
      { encoding: "utf8", env: process.env },
    );
    const issues = JSON.parse(out.trim() || "[]");
    if (!issues.length) return log(`no open incident issue for ${workflowName}`);
    const num = issues[0].number;
    sh(`gh issue close ${num} --comment "Auto-resolved: next scheduled run succeeded ${runUrl}"`);
    log(`closed incident issue #${num}`);
  } catch (e) {
    log(`could not close incident issue: ${e.message}`);
  }
}

// ---------- shell ----------

function sh(cmd) {
  execSync(cmd, { stdio: "inherit", env: process.env });
}

function log(msg) {
  console.log(`[log-cron-incident] ${msg}`);
}
