"use client";

import { useState } from "react";
import { useSession } from "@/lib/auth/use-session";
import type { ActionProposal } from "@/app/api/projects/[id]/action/route";

type Phase = "idle" | "loading" | "proposed" | "confirming" | "confirmed" | "error";

interface State {
  phase: Phase;
  input: string;
  proposal?: ActionProposal;
  nonce?: string;
  summary?: string;
  errorMsg?: string;
  result?: string;
  resultHref?: string;
}

/**
 * Authenticated project action bar (G1, Piece 2).
 *
 * Surfaces a PROPOSE→CONFIRM two-step for free-form project actions (schedule a send,
 * build a deliverable). Authed-only: hidden when the user is logged out. The `➜`
 * command-prompt aesthetic visually distinguishes this from the anonymous chat pill.
 */
export function ProjectActionBar({ projectId }: { projectId: string }) {
  const session = useSession();
  const [state, setState] = useState<State>({ phase: "idle", input: "" });

  if (!session?.authed) return null;

  async function propose() {
    const intent = state.input.trim();
    if (!intent) return;
    // Starting a new command clears any prior "view last deliverable" link.
    setState((s) => ({ ...s, phase: "loading", result: undefined, resultHref: undefined }));

    try {
      const res = await fetch(`/api/projects/${projectId}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 422 && data.type === "UNKNOWN") {
        setState((s) => ({ ...s, phase: "error", errorMsg: data.message as string }));
        return;
      }
      if (!res.ok) {
        setState((s) => ({
          ...s,
          phase: "error",
          errorMsg: (data.error as string) ?? "Something went wrong.",
        }));
        return;
      }
      setState((s) => ({
        ...s,
        phase: "proposed",
        proposal: data.proposal as ActionProposal,
        nonce: data.proposal_nonce as string | undefined,
        summary: data.summary as string,
      }));
    } catch {
      setState((s) => ({ ...s, phase: "error", errorMsg: "Network error — try again." }));
    }
  }

  async function confirm() {
    if (!state.proposal) return;
    setState((s) => ({ ...s, phase: "confirming" }));

    try {
      const res = await fetch(`/api/projects/${projectId}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmed: true,
          proposal: state.proposal,
          proposal_nonce: state.nonce,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setState((s) => ({
          ...s,
          phase: "error",
          errorMsg: (data.error as string) ?? "Confirm failed.",
        }));
        return;
      }

      const deliverableId =
        state.proposal?.action === "build_deliverable" && data.result?.deliverableId
          ? (data.result.deliverableId as string)
          : null;
      const resultLabel = deliverableId ? "Deliverable ready" : "Done";
      const resultHref = deliverableId ? `/p/${deliverableId}` : undefined;

      setState((s) => ({ ...s, phase: "confirmed", result: resultLabel, resultHref }));
      // Reset to idle so the user can issue another command — but KEEP resultHref so the
      // just-built deliverable stays one click away instead of vanishing (B3: no dead-end).
      setTimeout(
        () => setState((s) => ({ phase: "idle", input: "", resultHref: s.resultHref })),
        2000,
      );
    } catch {
      setState((s) => ({ ...s, phase: "error", errorMsg: "Network error — try again." }));
    }
  }

  function cancel() {
    setState({ phase: "idle", input: "" });
  }

  function retry() {
    setState((s) => ({ ...s, phase: "idle", errorMsg: undefined }));
  }

  return (
    <div className="print-hide mt-8">
      <p className="mb-2 text-[10px] uppercase tracking-widest text-gray-500">Assistant</p>

      {/* Input row — terminal command aesthetic */}
      {(state.phase === "idle" || state.phase === "error") && (
        <>
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#0d1e2b]/50 px-3 py-2.5 transition-colors focus-within:border-[#00d4aa]/40">
            <span className="select-none font-mono text-sm text-[#00d4aa]">➜</span>
            <input
              type="text"
              value={state.input}
              onChange={(e) =>
                setState((s) => ({ ...s, input: e.target.value, errorMsg: undefined }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && state.input.trim()) void propose();
              }}
              placeholder="Schedule a weekly email, build a market overview…"
              className="flex-1 bg-transparent text-sm text-[#f0ede6] placeholder-gray-600 outline-none"
            />
            {state.input.trim() && (
              <button
                type="button"
                onClick={() => void propose()}
                aria-label="Submit"
                className="text-xs text-[#00d4aa] hover:opacity-80"
              >
                →
              </button>
            )}
          </div>
          {/* Persistent link to the most recently built deliverable (survives the reset). */}
          {state.resultHref && (
            <a
              href={state.resultHref}
              className="mt-1.5 inline-block text-xs text-[#00d4aa] underline underline-offset-2 hover:opacity-80"
            >
              View last deliverable →
            </a>
          )}
        </>
      )}

      {state.phase === "error" && state.errorMsg && (
        <p className="mt-1.5 text-xs text-red-400">
          {state.errorMsg}{" "}
          <button type="button" onClick={retry} className="underline hover:opacity-80">
            Try again
          </button>
        </p>
      )}

      {/* Loading */}
      {state.phase === "loading" && (
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#0d1e2b]/50 px-3 py-2.5">
          <span className="select-none font-mono text-sm text-[#00d4aa]">➜</span>
          <span className="text-sm text-gray-500">Thinking…</span>
        </div>
      )}

      {/* Proposal card */}
      {(state.phase === "proposed" || state.phase === "confirming") && (
        <div className="animate-in fade-in rounded-xl border border-[#00d4aa]/30 bg-[#00d4aa]/5 p-4 duration-150">
          <p className="mb-0.5 text-[10px] uppercase tracking-widest text-[#00d4aa]">Proposed</p>
          <p className="text-sm text-[#f0ede6]">{state.summary}</p>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={state.phase === "confirming"}
              className="rounded-full bg-[#00d4aa] px-4 py-1.5 text-xs font-medium text-[#04121b] disabled:opacity-50"
            >
              {state.phase === "confirming" ? "Confirming…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={state.phase === "confirming"}
              className="text-xs text-gray-400 hover:text-white disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Confirmed */}
      {state.phase === "confirmed" && (
        <div className="flex items-center gap-2 rounded-xl border border-[#00d4aa]/20 bg-[#00d4aa]/5 px-3 py-2.5">
          <span className="text-sm text-[#00d4aa]">✓</span>
          {state.resultHref ? (
            <a
              href={state.resultHref}
              className="text-sm text-[#00d4aa] underline underline-offset-2 hover:opacity-80"
            >
              {state.result} →
            </a>
          ) : (
            <span className="text-sm text-[#f0ede6]">{state.result}</span>
          )}
        </div>
      )}
    </div>
  );
}
