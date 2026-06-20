"use client";

import { useState } from "react";

/**
 * The funnel "Open your project" CTA (FINAL BOSS 05, Unit 3 / G-F1). POSTs the
 * prospect's arrival scope + brand to /api/prospect/open-project, which mints a
 * claim token and returns `/claim?t=…`; we then full-navigate there so the OTP
 * login → claim → ZIP-seeded, branded project flow takes over.
 *
 * setState is only ever called inside the click handler (an event, never an effect),
 * so the repo's react-hooks/set-state-in-effect rule does not apply.
 */
export function OpenProjectCta({
  zip,
  name,
  primary,
  secondary,
  logo,
}: {
  zip: string;
  name?: string;
  primary?: string;
  secondary?: string;
  logo?: string;
}) {
  const [state, setState] = useState<"idle" | "working" | "error">("idle");

  async function open() {
    setState("working");
    try {
      const brand: Record<string, string> = {};
      if (name) brand.company_name = name;
      if (primary) brand.primary = primary;
      if (secondary) brand.secondary = secondary;
      if (logo) brand.logo_url = logo;

      const res = await fetch("/api/prospect/open-project", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ zip, brand }),
      });
      if (!res.ok) {
        setState("error");
        return;
      }
      const { url } = (await res.json()) as { url?: string };
      if (url) {
        window.location.href = url; // full nav into the claim/login flow
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={open}
        disabled={state === "working"}
        className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition disabled:opacity-60"
        style={{ backgroundColor: "var(--brand-primary)" }}
      >
        {state === "working" ? "Opening…" : "Open your project →"}
      </button>
      {state === "error" ? (
        <p className="mt-2 text-sm text-red-400">
          Couldn’t open your project just now.{" "}
          <button type="button" onClick={open} className="underline hover:text-red-300">
            Try again
          </button>
        </p>
      ) : null}
    </div>
  );
}
