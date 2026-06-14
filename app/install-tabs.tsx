"use client";

import { useState } from "react";

const COMMAND = "claude mcp add --transport http swfl https://www.swfldatagulf.com/api/mcp";

const JSON_CONFIG = JSON.stringify(
  {
    mcpServers: {
      swfl: { url: "https://www.swfldatagulf.com/api/mcp", transport: "http" },
    },
  },
  null,
  2,
);

const TABS = ["Claude CLI", "Claude Desktop", "Cursor", "Windsurf"] as const;
type Tab = (typeof TABS)[number];

export default function InstallTabs() {
  const [active, setActive] = useState<Tab>("Claude CLI");
  const [copied, setCopied] = useState(false);

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div>
      {/* Tab row */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActive(tab)}
            style={{
              background: active === tab ? "rgba(61,201,192,0.12)" : "transparent",
              border: `1px solid ${active === tab ? "#0a8078" : "#22414F"}`,
              color: active === tab ? "#0a8078" : "#8BAAB8",
              padding: "6px 16px",
              borderRadius: 6,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 13,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {active === "Claude CLI" && (
        <div>
          <div
            style={{
              background: "#152832",
              border: "1px solid #22414F",
              borderRadius: 8,
              padding: "16px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <code
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 14,
                color: "#F0EDE6",
                wordBreak: "break-all",
              }}
            >
              {COMMAND}
            </code>
            <button
              onClick={() => copy(COMMAND)}
              style={{
                flexShrink: 0,
                background: copied ? "rgba(61,201,192,0.2)" : "rgba(61,201,192,0.12)",
                border: "1px solid #0a8078",
                color: "#0a8078",
                padding: "6px 14px",
                borderRadius: 6,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 13,
                cursor: "pointer",
                minWidth: 72,
              }}
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <p style={{ color: "#8BAAB8", fontSize: 13, marginTop: 8 }}>
            Run this in your terminal where Claude Code is installed.
          </p>
        </div>
      )}

      {active === "Claude Desktop" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <ol
            style={{
              color: "#B8CDD8",
              fontSize: 14,
              lineHeight: 1.7,
              paddingLeft: 20,
              margin: 0,
            }}
          >
            <li>Open Claude Desktop → Settings → Developer → Edit Config</li>
            <li>
              Add to{" "}
              <code
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  color: "#F0EDE6",
                }}
              >
                mcpServers
              </code>
              :
            </li>
          </ol>
          <CodeBlock text={JSON_CONFIG} />
          <ol
            start={3}
            style={{
              color: "#B8CDD8",
              fontSize: 14,
              lineHeight: 1.7,
              paddingLeft: 20,
              margin: 0,
            }}
          >
            <li>Save and restart Claude Desktop.</li>
          </ol>
          <div style={{ color: "#8BAAB8", fontSize: 13 }}>
            Config file location — <span style={{ color: "#B8CDD8" }}>macOS:</span>{" "}
            <code
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              ~/Library/Application Support/Claude/claude_desktop_config.json
            </code>
            {" · "}
            <span style={{ color: "#B8CDD8" }}>Windows:</span>{" "}
            <code
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              %APPDATA%\Claude\claude_desktop_config.json
            </code>
          </div>
        </div>
      )}

      {active === "Cursor" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <ol
            style={{
              color: "#B8CDD8",
              fontSize: 14,
              lineHeight: 1.7,
              paddingLeft: 20,
              margin: 0,
            }}
          >
            <li>Cursor Settings → Features → MCP → Add server. Or paste into the config file:</li>
          </ol>
          <CodeBlock text={JSON_CONFIG} />
          <ol
            start={2}
            style={{
              color: "#B8CDD8",
              fontSize: 14,
              lineHeight: 1.7,
              paddingLeft: 20,
              margin: 0,
            }}
          >
            <li>Reload Cursor.</li>
          </ol>
          <div style={{ color: "#8BAAB8", fontSize: 13 }}>
            Config file — <span style={{ color: "#B8CDD8" }}>macOS/Linux:</span>{" "}
            <code
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              ~/.cursor/mcp.json
            </code>
            {" · "}
            <span style={{ color: "#B8CDD8" }}>Windows:</span>{" "}
            <code
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              %USERPROFILE%\.cursor\mcp.json
            </code>
          </div>
        </div>
      )}

      {active === "Windsurf" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <ol
            style={{
              color: "#B8CDD8",
              fontSize: 14,
              lineHeight: 1.7,
              paddingLeft: 20,
              margin: 0,
            }}
          >
            <li>Windsurf Settings → Cascade → MCP Servers → Add. Or paste into the config file:</li>
          </ol>
          <CodeBlock text={JSON_CONFIG} />
          <ol
            start={2}
            style={{
              color: "#B8CDD8",
              fontSize: 14,
              lineHeight: 1.7,
              paddingLeft: 20,
              margin: 0,
            }}
          >
            <li>Reload Windsurf.</li>
          </ol>
          <div style={{ color: "#8BAAB8", fontSize: 13 }}>
            Config file — <span style={{ color: "#B8CDD8" }}>macOS/Linux:</span>{" "}
            <code
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              ~/.codeium/windsurf/mcp_config.json
            </code>
            {" · "}
            <span style={{ color: "#B8CDD8" }}>Windows:</span>{" "}
            <code
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              %USERPROFILE%\.codeium\windsurf\mcp_config.json
            </code>
          </div>
        </div>
      )}
    </div>
  );
}

function CodeBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div style={{ position: "relative" }}>
      <pre
        style={{
          background: "#152832",
          border: "1px solid #22414F",
          borderRadius: 8,
          padding: "14px 16px",
          margin: 0,
          overflowX: "auto",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 13,
          color: "#F0EDE6",
          lineHeight: 1.6,
        }}
      >
        {text}
      </pre>
      <button
        onClick={copy}
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          background: copied ? "rgba(61,201,192,0.2)" : "rgba(61,201,192,0.10)",
          border: "1px solid #0a8078",
          color: "#0a8078",
          padding: "4px 10px",
          borderRadius: 4,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
          cursor: "pointer",
          minWidth: 60,
        }}
      >
        {copied ? "✓" : "Copy"}
      </button>
    </div>
  );
}
