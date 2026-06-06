/**
 * Bundle the SWFL MCP-App View into a single self-contained HTML file.
 *
 * The host renders the View in a sandboxed iframe whose CSP blocks external
 * loads, so EVERYTHING (the ext-apps SDK + our widget) is inlined into one
 * <script>. Output path is the one app/api/mcp/server.ts reads and
 * next.config.ts ships via outputFileTracingIncludes.
 *
 * Run: bun mcp-widget/build.mts
 */
import { join } from "node:path";

const ROOT = process.cwd();
const ENTRY = join(ROOT, "mcp-widget/src/widget.ts");
const OUT_HTML = join(
  ROOT,
  "docs/fiverr-briefs/assets/Chat-Charts-Standalone.html",
);

const result = await Bun.build({
  entrypoints: [ENTRY],
  target: "browser",
  minify: true,
  format: "iife",
  define: { "process.env.NODE_ENV": '"production"' },
});

if (!result.success) {
  console.error("[widget-build] bundle FAILED:");
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const js = await result.outputs[0].text();

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SWFL Data Gulf</title>
<style>
  html,body{margin:0;padding:0;background:transparent}
  *{box-sizing:border-box}
</style>
</head>
<body>
<script>${js}</script>
</body>
</html>`;

await Bun.write(OUT_HTML, html);
console.log(
  `[widget-build] OK — ${(js.length / 1024).toFixed(1)}KB JS inlined → ${OUT_HTML}`,
);
