#!/usr/bin/env node
/**
 * annotate-plan.mjs — PostToolUse hook + retroactive CLI
 *
 * Hook mode : receives tool JSON on stdin (file_path from Write/Edit)
 * CLI mode  : node .claude/hooks/annotate-plan.mjs <path-to-plan.md>
 *
 * For each plan file in docs/superpowers/plans/:
 *   1. Parse all **Files:** blocks across tasks
 *   2. Cluster tasks that share files (union-find)
 *   3. Assign a color emoji per cluster
 *   4. Prefix shared-file lines in the File Map + task Files: blocks
 *   5. Score complexity → inject "Recommended model" badge in header
 *   6. Append ## Parallel Safety table at bottom (after all tasks)
 *
 * Idempotent — safe to run multiple times on the same file.
 */

import fs from "node:fs";
import path from "node:path";

const COLORS = ["🔴", "🟡", "🟢", "🔵", "🟣", "🟠", "🩷", "🟤", "⚫", "⚪"];
const OPUS_KEYWORDS = [
  "migration",
  "refactor",
  "schema",
  "architecture",
  "breaking",
  "redesign",
  "overhaul",
];
const PLANS_SEGMENT = "/docs/superpowers/plans/";
const COLOR_RE = new RegExp(`^([ \\t]*- )(?:${COLORS.map(escRe).join("|")}) `);

// ── entry ─────────────────────────────────────────────────────────────────────

async function main() {
  let filePath;

  if (process.argv[2]) {
    filePath = process.argv[2];
  } else {
    const raw = await readStdin();
    let p;
    try {
      p = JSON.parse(raw || "{}");
    } catch {
      process.exit(0);
    }
    filePath = p?.tool_input?.file_path;
    if (!filePath) process.exit(0);
  }

  const abs = path.resolve(process.cwd(), filePath);
  const norm = abs.split(path.sep).join("/");
  if (!norm.includes(PLANS_SEGMENT) || !norm.endsWith(".md")) process.exit(0);

  let src;
  try {
    src = fs.readFileSync(abs, "utf8");
  } catch {
    process.exit(0);
  }

  try {
    const out = annotate(src);
    if (out !== src) {
      fs.writeFileSync(abs, out, "utf8");
      if (process.argv[2]) process.stdout.write(`✓ annotated: ${filePath}\n`);
    } else {
      if (process.argv[2]) process.stdout.write(`  no changes: ${filePath}\n`);
    }
  } catch (e) {
    if (process.argv[2]) process.stderr.write(`annotation error: ${e.message}\n`);
  }

  process.exit(0);
}

function readStdin() {
  return new Promise((res) => {
    let b = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (b += c));
    process.stdin.on("end", () => res(b));
  });
}

// ── annotate ──────────────────────────────────────────────────────────────────

function annotate(src) {
  const lines = src.split("\n");

  const tasks = parseTasks(lines);
  if (tasks.length === 0) return src;

  const fileToTasks = buildFileToTasks(tasks);
  const { taskToGroup, groups } = buildGroups(
    tasks.map((t) => t.num),
    fileToTasks,
  );
  const conflictGroups = groups.filter((g) => g.tasks.length > 1);

  // Assign a color to each conflict group
  const groupToColor = new Map();
  conflictGroups.forEach((g, i) => groupToColor.set(g.id, COLORS[i % COLORS.length]));

  // Map file path → color (only for files shared by >1 task)
  const fileToColor = new Map();
  for (const [file, tnums] of fileToTasks) {
    if (tnums.length > 1) {
      const color = groupToColor.get(taskToGroup.get(tnums[0]));
      if (color) fileToColor.set(file, color);
    }
  }

  const modelLine = scoreModel(src, tasks, conflictGroups);
  const cleaned = strip(lines);
  return rebuild(cleaned, fileToColor, modelLine, conflictGroups, groupToColor, fileToTasks).join(
    "\n",
  );
}

// ── parse tasks ───────────────────────────────────────────────────────────────

function parseTasks(lines) {
  const TASK_HDR = /^#{2,3}\s+Task\s+(\d+)[:\s]/;
  const tasks = [];
  let cur = null;
  let inFiles = false;

  for (const line of lines) {
    const m = TASK_HDR.exec(line);
    if (m) {
      cur = { num: parseInt(m[1]), files: [] };
      tasks.push(cur);
      inFiles = false;
      continue;
    }
    if (!cur) continue;
    if (/^\*\*Files:\*\*/.test(line)) {
      inFiles = true;
      continue;
    }
    if (inFiles) {
      if (/^\*\*/.test(line) || /^- \[/.test(line) || /^#{2,3}/.test(line)) {
        inFiles = false;
      } else {
        const f = extractFile(line);
        if (f) cur.files.push(f);
      }
    }
  }
  return tasks;
}

function extractFile(line) {
  // Matches: - [emoji] [Label: ] `path[:lines]`
  const m = line.match(/^[ \t]*-[ \t]+(?:[^\`]*?:\s*)?`([^`]+)`/);
  return m ? normFile(m[1]) : null;
}

function normFile(f) {
  return f.replace(/:\d+[-\d]*$/, "").trim();
}

// ── conflict groups (union-find) ──────────────────────────────────────────────

function buildFileToTasks(tasks) {
  const map = new Map();
  for (const t of tasks) {
    for (const f of t.files) {
      if (!map.has(f)) map.set(f, []);
      if (!map.get(f).includes(t.num)) map.get(f).push(t.num);
    }
  }
  return map;
}

function buildGroups(nums, fileToTasks) {
  const parent = new Map(nums.map((n) => [n, n]));
  function find(x) {
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)));
    return parent.get(x);
  }
  function union(a, b) {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  for (const tnums of fileToTasks.values()) {
    for (let i = 1; i < tnums.length; i++) union(tnums[0], tnums[i]);
  }
  const gmap = new Map();
  for (const n of nums) {
    const r = find(n);
    if (!gmap.has(r)) gmap.set(r, []);
    gmap.get(r).push(n);
  }
  const taskToGroup = new Map();
  const groups = [];
  for (const [id, tlist] of gmap) {
    groups.push({ id, tasks: tlist.sort((a, b) => a - b) });
    for (const t of tlist) taskToGroup.set(t, id);
  }
  return { taskToGroup, groups };
}

// ── model scoring ─────────────────────────────────────────────────────────────

function scoreModel(src, tasks, conflictGroups) {
  let score = 0;
  const reasons = [];
  const lower = src.toLowerCase();

  if (tasks.length > 8) {
    score += 2;
    reasons.push(`${tasks.length} tasks`);
  } else if (tasks.length > 5) {
    score += 1;
    reasons.push(`${tasks.length} tasks`);
  }

  const allFiles = new Set(tasks.flatMap((t) => t.files));
  if (allFiles.size > 10) {
    score += 2;
    reasons.push(`${allFiles.size} files`);
  } else if (allFiles.size > 6) {
    score += 1;
    reasons.push(`${allFiles.size} files`);
  }

  if (conflictGroups.length > 3) {
    score += 2;
    reasons.push(`${conflictGroups.length} conflict groups`);
  } else if (conflictGroups.length > 1) {
    score += 1;
    reasons.push(`${conflictGroups.length} conflict groups`);
  }

  const hits = OPUS_KEYWORDS.filter((k) => lower.includes(k));
  if (hits.length) {
    score += Math.min(hits.length, 3);
    reasons.push(`keywords: ${hits.slice(0, 3).join(", ")}`);
  }

  const model = score >= 4 ? "🧠 Opus" : "⚡ Sonnet";
  const detail = reasons.length ? ` — ${reasons.join(", ")}` : "";
  return `> **Recommended model:** ${model}${detail}`;
}

// ── strip existing annotations (idempotent) ───────────────────────────────────

function strip(lines) {
  // Find and remove the Parallel Safety section (always at bottom, preceded by ---)
  let cutAt = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^## Parallel Safety/.test(lines[i])) {
      let j = i - 1;
      while (j >= 0 && lines[j] === "") j--;
      cutAt = j >= 0 && lines[j] === "---" ? j : i;
      break;
    }
  }

  const result = [];
  for (let i = 0; i < cutAt; i++) {
    const line = lines[i];
    if (/^> \*\*Recommended model:\*\*/.test(line)) continue;
    result.push(line.replace(COLOR_RE, "$1")); // strip color prefix if present
  }

  while (result.length && result[result.length - 1] === "") result.pop();
  return result;
}

// ── rebuild with annotations ──────────────────────────────────────────────────

function rebuild(lines, fileToColor, modelLine, conflictGroups, groupToColor, fileToTasks) {
  const result = [];
  let injectedModel = false;
  let inFileMap = false;
  let inFilesBlock = false;

  for (const line of lines) {
    // Inject model rec immediately after the agentic workers blockquote line
    if (!injectedModel && /^> \*\*For agentic workers:\*\*/.test(line)) {
      result.push(line);
      result.push(modelLine);
      injectedModel = true;
      continue;
    }

    // Track ## File Map section (ends at ---)
    if (/^## File Map/.test(line)) {
      inFileMap = true;
    }
    if (inFileMap && line === "---") {
      inFileMap = false;
    }

    // Track **Files:** block inside a task
    if (/^\*\*Files:\*\*/.test(line)) {
      inFilesBlock = true;
      result.push(line);
      continue;
    }
    if (inFilesBlock) {
      if (/^\*\*/.test(line) || /^- \[/.test(line) || /^#{2,3}/.test(line)) {
        inFilesBlock = false;
        // fall through to push this line normally
      } else {
        result.push(colorLine(line, fileToColor));
        continue;
      }
    }

    // Color bare file lines inside the File Map section
    if (inFileMap && /^[ \t]*- `/.test(line)) {
      result.push(colorLine(line, fileToColor));
      continue;
    }

    result.push(line);
  }

  // Fallback: inject model rec after h1 if no agentic workers line found
  if (!injectedModel) {
    for (let i = 0; i < result.length; i++) {
      if (/^# /.test(result[i])) {
        result.splice(i + 1, 0, "", modelLine);
        break;
      }
    }
  }

  // Append Parallel Safety table at the bottom
  if (conflictGroups.length > 0) {
    result.push("", "---", "", "## Parallel Safety", "");
    result.push(
      "> Tasks sharing a color badge touch overlapping files and **cannot run in parallel**.",
      "",
    );
    result.push("| Group | Tasks | Shared Files |");
    result.push("|-------|-------|--------------|");
    for (const g of conflictGroups) {
      const color = groupToColor.get(g.id);
      const taskList = g.tasks.map((n) => `Task ${n}`).join(", ");
      const sharedFiles = [...fileToTasks.entries()]
        .filter(([, tnums]) => tnums.length > 1 && tnums.some((t) => g.tasks.includes(t)))
        .map(([f]) => `\`${f}\``)
        .join(", ");
      result.push(`| ${color} | ${taskList} | ${sharedFiles} |`);
    }
    result.push("");
    result.push("Tasks with no color badge have no file conflicts — safe to parallelize freely.");
  }

  result.push("");
  return result;
}

function colorLine(line, fileToColor) {
  if (fileToColor.size === 0) return line;
  const m = line.match(/^([ \t]*-[ \t]+(?:[^`]*?:\s*)?)`([^`]+)`/);
  if (!m) return line;
  const color = fileToColor.get(normFile(m[2]));
  if (!color) return line;
  // Insert color right after the leading "- " (before any label like "Create:")
  return line.replace(/^([ \t]*-[ \t]+)/, `$1${color} `);
}

function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main().catch(() => process.exit(0));
