"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** Fire-and-forget failure beacon (mirrors ImportDraftOnLogin's reportImportFailure)
 *  so a dropped claim is visible in usage_events, never a silent swallow. */
function reportClaimFailure(reason: string) {
  void fetch("/api/meter", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "claim_failed", report_id: "", reach: [reason] }),
  }).catch(() => {});
}

/**
 * Auto-claim on return from login. On mount (ONCE — a ref one-shots it so React
 * StrictMode's double-invoke can't double-POST), POST the token to /api/claim and
 * route to the new project.
 *
 * setState is called ONLY inside the async callback, AFTER an await — never
 * synchronously in the effect body (this repo treats react-hooks/set-state-in-effect
 * as a hard error). The initial "working" UI is the useState default, set with no
 * effect-time setState.
 */
export function ClaimOnLogin({ token }: { token: string }) {
  const router = useRouter();
  const ran = useRef(false);
  const [state, setState] = useState<"working" | "expired" | "error">("working");

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (res.status === 410) {
          setState("expired");
          return;
        }
        if (!res.ok) {
          reportClaimFailure("server_rejected");
          setState("error");
          return;
        }
        const { id } = (await res.json()) as { id?: string };
        if (id) {
          router.replace(`/project/${id}`); // the editor; immediately rebuildable
        } else {
          reportClaimFailure("no_id");
          setState("error");
        }
      } catch {
        reportClaimFailure("network_error");
        setState("error");
      }
    })();
  }, [router, token]);

  if (state === "expired") {
    return (
      <p className="mt-4 text-sm text-amber-400">
        This link has expired. Ask your AI to hand off again to get a fresh one.
      </p>
    );
  }
  if (state === "error") {
    return (
      <p className="mt-4 text-sm text-red-400">
        Something went wrong claiming your work.{" "}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="underline hover:text-red-300"
        >
          Try again
        </button>
      </p>
    );
  }
  return (
    <p className="mt-4 flex items-center gap-2 text-sm text-gray-400">
      <span className="h-2 w-2 animate-pulse rounded-full bg-[#0a8078]" aria-hidden />
      Claiming your work…
    </p>
  );
}
