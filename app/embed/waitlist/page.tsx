"use client";

import { useState } from "react";

export default function EmbedWaitlistPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setStatus(res.ok ? "done" : "error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <main
      style={{
        background: "#0A1419",
        color: "#F0EDE6",
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {status === "done" ? (
        <p
          style={{
            color: "#0a8078",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 16,
          }}
        >
          ✓ You&apos;re on the list. We&apos;ll be in touch.
        </p>
      ) : (
        <form onSubmit={submit} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
              width: 280,
            }}
          />
          <button
            type="submit"
            disabled={status === "submitting"}
            style={{
              background: "rgba(61,201,192,0.12)",
              border: "1px solid #0a8078",
              color: "#0a8078",
              padding: "12px 22px",
              borderRadius: 6,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 14,
              cursor: status === "submitting" ? "wait" : "pointer",
            }}
          >
            {status === "submitting" ? "Adding…" : "Notify me →"}
          </button>
          {status === "error" && (
            <p style={{ color: "#E08158", fontSize: 13, width: "100%" }}>
              Something went wrong. Try again in a moment.
            </p>
          )}
        </form>
      )}
    </main>
  );
}
