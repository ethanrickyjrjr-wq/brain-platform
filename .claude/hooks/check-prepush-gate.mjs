#!/usr/bin/env node
// PreToolUse hook (matcher: Bash). Blocks `git push` when one of the three
// recurring nightly-rebuild breakers is about to ship. Each of these has
// aborted the daily rebuild more than once; the prevention used to live only in
// prose (CLAUDE.md / docs/cron-rebuild-failures.md "Recurring Patterns"). This
// hook enforces it locally so the failure never reaches GHA.
//
//   1. LOCKFILE  — package.json dependency map changed but bun.lock did not
//                  → `bun install --frozen-lockfile` fails in CI in <1s.
//   2. VOCAB/ALIAS — a corridor rename or pack/vocab edit that orphans a slug on
//                  pack "master", or a corridor slug missing its alias.
//   3. SECRETS   — (advisory only) a new pipeline/workflow that may reference a
//                  secret not yet wired into the workflow `env:` block.
//
// Design notes:
//   • Fail-CLOSED on a real gate violation (exit 2 blocks the push).
//   • Fail-OPEN on an internal error (missing bun, git quirk) — a broken hook
//     must never wedge every push. We warn and allow.
//   • Runs alongside check-session-log-on-push.mjs; both must pass.

import { execSync } from "node:child_process";

const BANNER = "=".repeat(72);

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    process.exit(0); // not our shape
  }
  const cmd = String(payload?.tool_input?.command ?? "");
  if (!isGitPush(cmd)) process.exit(0);

  // Comparison base: upstream if set, else origin/main. Mirrors the session-log hook.
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
  try {
    const ahead = sh(`git rev-list --count ${base}..HEAD`);
    if (ahead === "0") process.exit(0); // nothing to push
    changed = sh(`git diff --name-only ${base}..HEAD`)
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    process.exit(0); // git quirk — allow
  }

  // ---- Gate 1: lockfile drift ------------------------------------------------
  const pkgChanged = changed.includes("package.json");
  const lockChanged = changed.includes("bun.lock");
  if (pkgChanged && !lockChanged && depsChanged(base)) {
    block(
      "LOCKFILE — package.json dependencies changed but bun.lock did not",
      `A dependency add/remove/bump landed without regenerating the lockfile.\n` +
        `CI runs \`bun install --frozen-lockfile\`, detects the drift, and exits in\n` +
        `under 1s with \`error: lockfile had changes, but lockfile is frozen\` —\n` +
        `silently blocking the entire daily rebuild.\n\n` +
        `Fix:\n` +
        `  bun install && git add bun.lock && git commit -m "fix(lockfile): regenerate bun.lock"\n` +
        `(or \`--amend\` into the dep change), then retry the push.`,
    );
  }

  // ---- Gate 2: vocab orphans / corridor-alias desync ------------------------
  const vocabTouched = changed.some(
    (f) =>
      f.startsWith("refinery/packs/") ||
      f.startsWith("refinery/vocab/") ||
      f === "refinery/lib/corridor-aliases.mts" ||
      f.startsWith("fixtures/corridor-") ||
      f === "brains/master.md",
  );
  if (vocabTouched) {
    const alias = run("bun test refinery/lib/corridor-aliases.test.mts");
    if (alias.ran && alias.code !== 0) {
      block(
        "VOCAB/ALIAS — corridor-alias coverage test failed",
        `A corridor slug is missing its entry in refinery/lib/corridor-aliases.mts.\n` +
          `This is the corridor-rename breaker (CI goes red the moment master rebuilds).\n` +
          `Add the one-line alias per renamed corridor, then retry.\n\n` +
          truncate(alias.out),
      );
    }
    const vocab = run("bun refinery/tools/check-vocab-coverage.mts");
    if (vocab.ran && vocab.code !== 0) {
      block(
        "VOCAB/ALIAS — master emits a slug not registered in the vocabulary",
        `pack "master" claims a metric slug that does not resolve in\n` +
          `refinery/vocab/brain-vocabulary.json — the orphan-concept error that\n` +
          `aborts the nightly rebuild.\n\n` +
          truncate(vocab.out),
      );
    }
  }

  // ---- Gate 3: secret-wiring reminder (advisory, never blocks) --------------
  const touchedPipelineOrWorkflow = changed.some(
    (f) =>
      f.startsWith(".github/workflows/") ||
      (f.startsWith("ingest/") &&
        (/pipeline.*\.py$/.test(f) || /source/.test(f))),
  );
  if (touchedPipelineOrWorkflow) {
    process.stdout.write(
      `\n[pre-push gate] NOTE: you touched a pipeline or workflow. If it reads a\n` +
        `new secret, confirm the secret is in EVERY workflow \`env:\` block that\n` +
        `invokes that pipeline — \`gh secret set\` alone does not expose it to the\n` +
        `job. (Recurring breaker: FRED/S3/Firecrawl keys, docs/cron-rebuild-failures.md.)\n`,
    );
  }

  process.exit(0);
});

// Match both the raw `git push` and the mandated `node scripts/safe-push.mjs`
// wrapper. safe-push runs `git push` in a child process the Bash PreToolUse hook
// can't intercept, so matching the wrapper command here is the only way the gate
// fires on the path operators are actually told to use.
function isGitPush(cmd) {
  return (
    /(^|\s|&&|;|\|\|)\s*git\s+push(\s|$)/.test(cmd) ||
    /safe-push(\.mjs)?\b/.test(cmd)
  );
}

function sh(c) {
  return execSync(c, { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
}

// Run a command, capturing combined output and exit code. `ran:false` means the
// command could not be spawned at all (e.g. bun not on PATH) — caller fails open.
function run(c) {
  try {
    const out = execSync(c, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    return { ran: true, code: 0, out };
  } catch (err) {
    if (typeof err?.status !== "number") {
      // Spawn failure, not a test failure — fail open with a warning.
      process.stdout.write(
        `\n[pre-push gate] WARN: could not run \`${c}\` (${err?.code ?? "unknown"}); ` +
          `skipping this check.\n`,
      );
      return { ran: false, code: 0, out: "" };
    }
    return {
      ran: true,
      code: err.status,
      out: `${err.stdout ?? ""}${err.stderr ?? ""}`,
    };
  }
}

function truncate(s, max = 2000) {
  const t = String(s || "").trim();
  return t.length > max ? `${t.slice(0, max)}\n… (truncated)` : t;
}

function block(title, body) {
  const msg = `\n${BANNER}\nPUSH BLOCKED — ${title}\n${BANNER}\n${body}\n${BANNER}\n`;
  process.stdout.write(msg);
  process.stderr.write(msg);
  process.exit(2);
}

// True if any of package.json's dependency maps differ between base and HEAD.
// A scripts-only / metadata-only edit returns false → no false lockfile block.
function depsChanged(base) {
  const keys = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ];
  let basePkg, headPkg;
  try {
    basePkg = JSON.parse(sh(`git show ${base}:package.json`));
    headPkg = JSON.parse(sh(`git show HEAD:package.json`));
  } catch {
    // Can't read one side (new file, parse error) — be conservative and treat
    // a package.json change as dep-affecting so the lockfile rule still fires.
    return true;
  }
  for (const k of keys) {
    if (
      JSON.stringify(basePkg?.[k] ?? {}) !== JSON.stringify(headPkg?.[k] ?? {})
    ) {
      return true;
    }
  }
  return false;
}
