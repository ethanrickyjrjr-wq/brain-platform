#!/usr/bin/env node
// SessionStart hook — prints the KICKOFF BLOCK (last ship · open checks ·
// build queue) after the session log. Delegates to scripts/session-kickoff.mjs
// so the live-data logic (Supabase fetch, queue parse) lives outside hooks/.

import { execSync } from "node:child_process";
import { resolve } from "node:path";

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  try {
    const out = execSync(
      `node ${resolve(process.cwd(), "scripts/session-kickoff.mjs")}`,
      { timeout: 12000, encoding: "utf8" },
    );
    process.stdout.write(out);
  } catch {
    // never block session start
  }
});
