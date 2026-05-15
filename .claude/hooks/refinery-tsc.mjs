#!/usr/bin/env node
import { spawnSync } from "node:child_process";

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    process.exit(0);
  }

  const candidates = [
    payload?.tool_input?.file_path,
    ...(Array.isArray(payload?.tool_input?.file_paths)
      ? payload.tool_input.file_paths
      : []),
  ].filter((p) => typeof p === "string" && p.length > 0);

  const touchesRefinery = candidates.some((p) =>
    p.replace(/\\/g, "/").includes("refinery/"),
  );

  if (!touchesRefinery) process.exit(0);

  const result = spawnSync("npx", ["tsc", "--noEmit"], {
    encoding: "utf8",
    shell: true,
  });

  const combined =
    (result.stdout?.toString() ?? "") + (result.stderr?.toString() ?? "");
  const capped = combined.split("\n").slice(0, 20).join("\n");

  if (capped.trim().length > 0) {
    process.stdout.write(capped + "\n");
  }
});
