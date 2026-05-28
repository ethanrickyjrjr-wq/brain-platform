import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // /ops is a self-contained dashboard. No image optimization needed.
  reactStrictMode: true,
  // This is a standalone project (Vercel Root Directory = ops). Pin the file-
  // tracing root to ops so Next doesn't infer the parent repo (which has its
  // own bun.lock) as the workspace root.
  outputFileTracingRoot: path.join(process.cwd()),
};

export default nextConfig;
