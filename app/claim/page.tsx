import { cookies } from "next/headers";
import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { createClient } from "@/utils/supabase/server";
import { peekClaimToken } from "@/lib/claim/claim-store";
import { ClaimOnLogin } from "./_components/ClaimOnLogin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Claim your work — SWFL Data Gulf" };

/**
 * /claim?t=<token> — the carry-back landing (Plan B, B-3b).
 *
 * Shows a logged-out user a NON-consuming preview of what they're about to bring
 * over, routes them through the EXISTING OTP login via `next=`, and auto-claims on
 * return (the client POST in <ClaimOnLogin/>). GET never mutates: it only peeks +
 * renders. The base64url token survives the two redirect hops intact.
 */

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <div className="rounded-2xl border border-white/10 bg-[#0d1e2b]/80 p-6">{children}</div>
    </main>
  );
}

/** Customer-clean plural labels for the preview (no internal kind ids). */
const KIND_LABEL: Record<string, string> = {
  metric: "figures",
  qa: "answers",
  note: "notes",
  report: "reports",
  chart: "charts",
  source: "sources",
  table_slice: "tables",
  frame: "frames",
  file: "files",
};

export default async function ClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const token = typeof t === "string" ? t : "";

  if (!token) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-white">Invalid claim link</h1>
        <p className="mt-2 text-sm text-gray-400">
          This link is missing its token. Ask your AI to hand off again.
        </p>
      </Shell>
    );
  }

  const peek = await peekClaimToken(token); // read-only, never consumes
  if (!peek || peek.expired) {
    const alreadyClaimed = peek?.consumed === true;
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-white">
          {alreadyClaimed ? "Already claimed" : "This link has expired"}
        </h1>
        <p className="mt-2 text-sm text-gray-400">
          {alreadyClaimed
            ? "This work has already been brought to the web. Sign in to see your project."
            : "Carry-back links last about 15 minutes. Ask your AI to hand off again to get a fresh one."}
        </p>
      </Shell>
    );
  }

  const {
    data: { user },
  } = await createClient(await cookies()).auth.getUser();

  const itemWord = peek.itemCount === 1 ? "item" : "items";
  const kinds = peek.kinds.map((k) => KIND_LABEL[k] ?? k).join(", ");

  if (!user) {
    const next = `/claim?t=${token}`;
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-white">
          {peek.title || "Continue your work on the web"}
        </h1>
        <p className="mt-2 text-sm text-gray-400">
          Sign in to bring over {peek.itemCount} {itemWord}
          {kinds ? ` (${kinds})` : ""} you assembled with your AI — then refine and build a polished
          deliverable.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(next)}`}
          className="mt-5 inline-flex items-center justify-center rounded-xl bg-[#0a8078] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0a8078]/80"
        >
          Sign in to claim
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-lg font-semibold text-white">{peek.title || "Claiming your work"}</h1>
      <p className="mt-2 text-sm text-gray-400">
        Bringing over {peek.itemCount} {itemWord}
        {kinds ? ` (${kinds})` : ""}…
      </p>
      <ClaimOnLogin token={token} />
    </Shell>
  );
}
