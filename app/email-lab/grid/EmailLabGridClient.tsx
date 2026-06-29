"use client";

import { useState } from "react";
import { EmailLabGridShell } from "@/components/email-lab/EmailLabGridShell";
import { seedById, SEED_DOCS } from "@/lib/email/doc/default-docs";

// Standalone PAID-tier grid lab (the north star) — no project scope yet, so you
// can play with it before Stripe gating exists. Opens on a pre-positioned grid
// seed so the first load already LOOKS like the north star; degrades to the
// first linear seed (stacked) if the grid seeds aren't present.
export function EmailLabGridClient() {
  const [initialDoc] = useState(() => (seedById("luxury-market-report") ?? SEED_DOCS[0]).build());

  return (
    <EmailLabGridShell
      initialDoc={initialDoc}
      headerSlot={
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-white/85">Email</span>
          <span className="text-gulf-teal">Lab</span>
          <span className="rounded bg-gulf-teal/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gulf-teal">
            Grid · paid
          </span>
        </span>
      }
    />
  );
}
