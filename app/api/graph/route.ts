import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  const filePath = path.join(process.cwd(), "graphify-out", "graph.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  return new NextResponse(raw, {
    headers: { "Content-Type": "application/json" },
  });
}
