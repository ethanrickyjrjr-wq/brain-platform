import { readFile } from "node:fs/promises";
import { PageShell } from "@/components/PageShell";
import path from "node:path";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOCS_DIR = path.join(process.cwd(), "docs");

interface PageProps {
  params: Promise<{ slug: string[] }>;
}

async function loadDoc(slugParts: string[]): Promise<string | null> {
  // Only allow .md files; no path traversal
  const joined = slugParts.join("/");
  if (joined.includes("..") || /[^a-zA-Z0-9/_\-.]/.test(joined)) return null;
  const filePath = path.join(DOCS_DIR, joined.endsWith(".md") ? joined : `${joined}.md`);
  // Ensure resolved path stays inside DOCS_DIR
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(DOCS_DIR))) return null;
  try {
    return await readFile(resolved, "utf-8");
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const title = slug[slug.length - 1].replace(/-/g, " ").replace(/\.md$/, "");
  return { title };
}

export default async function DocPage({ params }: PageProps) {
  const { slug } = await params;
  const content = await loadDoc(slug);
  if (!content) notFound();

  const title = slug[slug.length - 1].replace(/-/g, " ").replace(/\.md$/, "");
  const breadcrumb = slug.join(" / ").replace(/\.md$/, "");

  return (
    <div className="min-h-dvh bg-white font-sans text-zinc-900">
      <PageShell>
        <header className="border-b border-zinc-200 pb-6">
          <p className="text-xs uppercase tracking-wider text-zinc-400">{breadcrumb}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl capitalize">
            {title}
          </h1>
        </header>
        <article className="mt-8 prose prose-zinc max-w-none prose-headings:font-semibold prose-a:text-blue-600 prose-code:bg-zinc-100 prose-code:px-1 prose-code:rounded prose-pre:bg-zinc-950 prose-pre:text-zinc-100">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </article>
      </PageShell>
    </div>
  );
}
