import type { Metadata } from "next";
import fs from "fs";
import path from "path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const metadata: Metadata = {
  title: "Data Intelligence Map — SWFL Data Gulf",
  description:
    "Every data source on the platform: what's live, what's partial, what's a known source, and what's still a gap.",
};

export default function DataIntelPage() {
  const content = fs.readFileSync(
    path.join(process.cwd(), "docs/data-intel.md"),
    "utf8",
  );

  return (
    <main className="mx-auto max-w-7xl px-6 py-16">
      <div className="prose prose-invert prose-sm max-w-none prose-table:text-xs prose-td:py-1.5 prose-th:py-1.5 prose-headings:text-[var(--gulf-teal)] prose-a:text-[var(--gulf-teal)] prose-code:text-[var(--gulf-teal)] prose-code:bg-[var(--gulf-slate)] prose-code:px-1 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </main>
  );
}
