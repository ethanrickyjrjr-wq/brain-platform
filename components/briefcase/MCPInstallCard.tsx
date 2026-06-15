"use client";

import { useState } from "react";

/** The rung-0 free path: run the cited data inside the user's own Claude. */
const MCP_CMD = "claude mcp add --transport http swfl https://www.swfldatagulf.com/api/mcp";

/**
 * Small in-panel MCP-install affordance (A-5). The landing-page MCPInstall is a
 * full <section>, not a popup — so the panel shows this compact copy-the-command
 * card instead. No auth, no build cost to us (runs on the user's own plan).
 */
export function MCPInstallCard() {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard?.writeText(MCP_CMD).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {},
    );
  }

  return (
    <div className="rounded-lg border border-[#0a8078]/40 bg-[#0f1d24] p-3">
      <p className="mb-2 text-[11px] text-gray-300">
        Use it free inside your own Claude — paste this once:
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-black/40 px-2 py-1.5 font-mono text-[10px] text-[#0a8078]">
          {MCP_CMD}
        </code>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded border border-[#0a8078]/60 px-2 py-1 text-[10px] font-semibold text-[#0a8078] transition-colors hover:bg-[#0a8078]/15"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
    </div>
  );
}
