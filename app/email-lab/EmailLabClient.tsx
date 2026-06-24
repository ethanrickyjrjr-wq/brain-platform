"use client";

import { useState } from "react";
import { EmailLabShell } from "@/components/email-lab/EmailLabShell";
import { SEED_DOCS } from "@/lib/email/doc/default-docs";

// Standalone Email Lab — block canvas, no project scope. The shared shell holds
// all behavior (Card 40); this only seeds the opening doc + the panel header.
export function EmailLabClient() {
  const [initialDoc] = useState(() => SEED_DOCS[0].build());

  return (
    <EmailLabShell
      initialDoc={initialDoc}
      headerSlot={
        <>
          <p className="mb-0.5 text-[10px] uppercase tracking-[0.2em] text-white/30">Email Lab</p>
          <p className="text-sm font-semibold text-white/80">Design Surface</p>
        </>
      }
    />
  );
}
