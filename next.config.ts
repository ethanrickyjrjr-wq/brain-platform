import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @resvg/resvg-js is a native (napi) addon; Turbopack cannot place its .node
  // binary in an ESM chunk. Opt it out of bundling so the App Route /api/social/
  // render/[format] requires it natively at runtime (the documented fix for
  // native node addons). Build 02 — social image rasterizer.
  serverExternalPackages: ["@resvg/resvg-js"],
  outputFileTracingIncludes: {
    // NOTE: the /api/mcp chart-widget bundle is intentionally NOT shipped — the
    // tool is text-only (see app/api/mcp/server.ts; MCP App widget blocked by the
    // open host bug claude-ai-mcp#61/#165). Restore the line shipping
    // "./docs/fiverr-briefs/assets/Chat-Charts-Standalone.html" when re-enabling.
    "/data-intel": ["./docs/data-intel.md"],
    // The render route reads template shells from disk at runtime — bundle them
    // into the serverless function (otherwise renderHtmlTemplate 500s in prod).
    "/api/templates/render": ["./templates/html/**/*.html"],
    // The data-readiness cron reads the per-metric tolerances yaml from disk at
    // runtime — bundle it so loadTolerances finds the real config rather than
    // falling back to built-in defaults (the read is via process.cwd()).
    "/api/cron/data-readiness": ["./ingest/data-verification-tolerances.yaml"],
  },
  async redirects() {
    return [
      {
        source: "/connect",
        destination: "/",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/embed/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
          { key: "X-Frame-Options", value: "ALLOWALL" },
        ],
      },
    ];
  },
};

export default nextConfig;
