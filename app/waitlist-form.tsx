"use client";

import { useState } from "react";

const INTERESTS = [
  {
    id: "new-lakes",
    label: "New data lakes",
    description: "Tampa, Miami, statewide Florida.",
  },
  {
    id: "vault",
    label: "Your own vault",
    description: "Save what your Claude figures out, so the next conversation builds on the last.",
  },
  {
    id: "sharper-numbers",
    label: "Sharper numbers",
    description: "New sources, tighter confidence math, contradiction surfacing.",
  },
  {
    id: "slack",
    label: "Delivered to Slack",
    description: "Your team sees the read without leaving the channel.",
  },
  {
    id: "documents",
    label: "Reports as documents",
    description: "Ask Claude for a sourced PDF or doc, get one.",
  },
];

export default function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "duplicate" | "error">(
    "idle",
  );

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, interests: Array.from(checked) }),
      });
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const data = await res.json();
      setStatus(data.already_subscribed ? "duplicate" : "done");
    } catch {
      setStatus("error");
    }
  }

  if (status === "done" || status === "duplicate") {
    return (
      <p
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 15,
          color: "#0a8078",
        }}
      >
        {status === "done" ? "You're on the list." : "You're already on the list."}
      </p>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="your@email.com"
        disabled={status === "submitting"}
        style={{
          background: "#152832",
          border: "1px solid #22414F",
          color: "#F0EDE6",
          padding: "12px 16px",
          borderRadius: 6,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 14,
          outline: "none",
          maxWidth: 360,
        }}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {INTERESTS.map((item) => (
          <label
            key={item.id}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={checked.has(item.id)}
              onChange={() => toggle(item.id)}
              style={{ marginTop: 3, accentColor: "#0a8078", flexShrink: 0 }}
            />
            <span>
              <span style={{ color: "#F0EDE6", fontSize: 14 }}>{item.label}</span>
              <span style={{ color: "#8BAAB8", fontSize: 13, display: "block" }}>
                {item.description}
              </span>
            </span>
          </label>
        ))}
      </div>

      <div>
        <button
          type="submit"
          disabled={status === "submitting"}
          style={{
            background: "rgba(61,201,192,0.12)",
            border: "1px solid #0a8078",
            color: "#0a8078",
            padding: "10px 24px",
            borderRadius: 6,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 14,
            cursor: status === "submitting" ? "wait" : "pointer",
          }}
        >
          {status === "submitting" ? "Adding…" : "Join the list"}
        </button>
        {status === "error" && (
          <p style={{ color: "#E08158", fontSize: 13, marginTop: 8 }}>
            Something went wrong. Try again in a moment.
          </p>
        )}
      </div>

      <p style={{ color: "#8BAAB8", fontSize: 12, margin: 0 }}>
        Your email and interests stay on our infrastructure. We don&apos;t sell, share, or feed them
        to any third party.{" "}
        <a href="/privacy" style={{ color: "#8BAAB8", textDecoration: "underline" }}>
          Privacy policy.
        </a>
      </p>
    </form>
  );
}
