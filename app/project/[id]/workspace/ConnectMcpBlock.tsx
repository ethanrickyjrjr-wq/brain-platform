"use client";

import { useState } from "react";

type McpClient = "desktop" | "cursor" | "cline" | "windsurf" | "other";

const MCP_PILLS: { id: McpClient; label: string }[] = [
  { id: "desktop", label: "Claude Desktop" },
  { id: "cursor", label: "Cursor" },
  { id: "cline", label: "Cline" },
  { id: "windsurf", label: "Windsurf" },
  { id: "other", label: "Other" },
];

function buildSnippet(client: McpClient, key: string): string {
  const url = "https://www.swfldatagulf.com/api/mcp";
  switch (client) {
    case "windsurf":
      // Windsurf uses `serverUrl`, not `url` — verified from docs.windsurf.com
      return JSON.stringify(
        { mcpServers: { "swfl-project": { serverUrl: url, headers: { "X-Project-Key": key } } } },
        null,
        2,
      );
    case "cline":
      // Cline supports optional disabled/autoApprove fields
      return JSON.stringify(
        {
          mcpServers: {
            "swfl-project": {
              url,
              headers: { "X-Project-Key": key },
              disabled: false,
              autoApprove: [],
            },
          },
        },
        null,
        2,
      );
    case "other":
      return `Endpoint:  ${url}\nTransport: Streamable HTTP\nHeader:    X-Project-Key: ${key}`;
    default:
      // Claude Desktop and Cursor share the same shape
      return JSON.stringify(
        { mcpServers: { "swfl-project": { url, headers: { "X-Project-Key": key } } } },
        null,
        2,
      );
  }
}

const CLIENT_INSTRUCTIONS: Record<McpClient, { instruction: string; note?: string }> = {
  desktop: {
    instruction: "Settings → Developer → Edit Config",
    note: "Paste into the JSON file, restart Claude Desktop.",
  },
  cursor: {
    instruction: "Edit ~/.cursor/mcp.json (global) or .cursor/mcp.json (project)",
    note: "Or: Cursor Settings → MCP → Add new server.",
  },
  cline: {
    instruction: "MCP Servers icon → Configure tab → Edit JSON",
    note: "CLI users: ~/.cline/mcp.json",
  },
  windsurf: {
    instruction: "Edit ~/.codeium/windsurf/mcp_config.json",
    note: "Windsurf uses serverUrl — not url. This snippet has the right key.",
  },
  other: {
    instruction: "Paste the endpoint and header into your client’s MCP settings.",
  },
};

/** "Connect your AI" — mint / regenerate (= revoke) / clear the per-project key,
 *  and show the copy-paste connect snippet. The key scopes ONE project,
 *  write-only-into-items; regenerate invalidates the old key instantly. Moved
 *  verbatim from the monolith (Piece 1 §A). Collapse/dismiss via `ui_state` = §E. */
export function ConnectMcpBlock({
  projectId,
  initialKey,
}: {
  projectId: string;
  initialKey: string | null;
}) {
  const [key, setKey] = useState<string | null>(initialKey);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [client, setClient] = useState<McpClient>("desktop");

  async function mint() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/mcp-key`, { method: "POST" });
      const json = (await res.json().catch(() => null)) as { mcp_key?: string } | null;
      if (res.ok && json?.mcp_key) setKey(json.mcp_key);
      else setError("Could not generate a key. Try again.");
    } catch {
      setError("Could not generate a key. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/mcp-key`, { method: "DELETE" });
      if (res.ok) setKey(null);
      else setError("Could not revoke the key. Try again.");
    } catch {
      setError("Could not revoke the key. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const snippet = key ? buildSnippet(client, key) : "";
  const { instruction, note } = CLIENT_INSTRUCTIONS[client];

  async function copy() {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  }

  function selectClient(next: McpClient) {
    setClient(next);
    setCopied(false);
  }

  return (
    <section className="mt-8 rounded-xl border border-white/10 bg-[#0d1e2b]/50 p-4">
      <h2 className="text-sm font-semibold text-white">Connect your AI</h2>
      <p className="mt-1 text-xs text-gray-500">
        Give your AI a key scoped to <span className="text-gray-300">this project only</span> — it
        can add items and trigger builds, but can’t read your other projects. Regenerate any time to
        revoke.
      </p>

      {!key ? (
        <button
          type="button"
          disabled={busy}
          onClick={mint}
          className="mt-3 rounded-full bg-[#00d4aa] px-4 py-2 text-sm font-medium text-[#04121b] disabled:opacity-40"
        >
          {busy ? "Generating…" : "Generate key"}
        </button>
      ) : (
        <div className="mt-3">
          {/* Client pills */}
          <div className="flex flex-wrap gap-1">
            {MCP_PILLS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => selectClient(p.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  client === p.id
                    ? "bg-[#00d4aa] text-[#04121b]"
                    : "border border-white/10 text-gray-400 hover:text-gray-200"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Instruction */}
          <p className="mt-3 text-xs text-gray-400">
            <span className="text-gray-300">{instruction}</span>
            {note && <span className="ml-1 text-gray-500">— {note}</span>}
          </p>

          {/* Snippet */}
          <pre className="mt-2 overflow-x-auto rounded-lg border border-white/10 bg-[#04121b] p-3 text-[11px] leading-relaxed text-gray-200">
            {snippet}
          </pre>

          <p className="mt-1 text-[11px] text-gray-500">
            Key travels as a header only — never appears in chats or tool-call logs.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copy}
              className="rounded-full bg-[#00d4aa] px-4 py-1.5 text-xs font-medium text-[#04121b]"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={mint}
              className="rounded-full border border-[#00d4aa]/40 px-4 py-1.5 text-xs font-medium text-[#00d4aa] disabled:opacity-40"
            >
              Regenerate (revokes old)
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={revoke}
              className="rounded-full border border-white/10 px-4 py-1.5 text-xs text-red-400 disabled:opacity-40"
            >
              Revoke
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </section>
  );
}
