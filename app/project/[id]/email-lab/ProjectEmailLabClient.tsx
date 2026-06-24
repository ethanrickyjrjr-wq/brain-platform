"use client";

import Link from "next/link";
import { useState } from "react";
import { EmailLabShell } from "@/components/email-lab/EmailLabShell";
import { SEED_DOCS } from "@/lib/email/doc/default-docs";

interface Props {
  projectId: string;
  projectTitle: string;
  /** Project branding mapped to email tokens by the page (PRIMARY, ACCENT,
   *  COMPANY_NAME, AGENT_*, CTA_URL, …). The shell applies these onto the doc's
   *  globalStyle + brand-bearing blocks. */
  initialTokens: Record<string, string>;
  scope?: { kind: string; value: string };
}

// Project-scoped Email Lab — block canvas with the project's brand + lake scope.
// Auto-fills on mount so the user lands on a real, brand-applied email.
export function ProjectEmailLabClient({ projectId, projectTitle, initialTokens, scope }: Props) {
  const [initialDoc] = useState(() => SEED_DOCS[0].build());

  const scopeLabel = scope
    ? `${scope.kind === "zip" ? "ZIP " : ""}${scope.value}`
    : "Southwest Florida";
  const effectiveScope = scope ?? { kind: "region", value: "swfl" };
  const aiPrompt = `Market spotlight email for ${scopeLabel} — fill in realistic market context and agent copy`;

  return (
    <EmailLabShell
      initialDoc={initialDoc}
      brandTokens={initialTokens}
      scope={effectiveScope}
      initialAiPrompt={aiPrompt}
      autoGenerate
      aiPlaceholder={`e.g. Listing announcement for ${scopeLabel} — 3BR condo, pool view, under market…`}
      headerSlot={
        <>
          <Link
            href={`/project/${projectId}`}
            className="mb-2 flex items-center gap-1.5 text-[10px] text-white/35 transition-colors hover:text-white/60"
          >
            ← {projectTitle}
          </Link>
          <p className="text-sm font-semibold text-white/80">Email Lab</p>
          <p className="mt-0.5 text-[10px] text-[#1BB8C9]">
            {scope ? `Scope: ${scopeLabel}` : "Southwest Florida"} · real data enabled
          </p>
        </>
      }
    />
  );
}
