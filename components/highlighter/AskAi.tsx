"use client";

import { useState } from "react";
import { AskAiFab } from "./AskAiFab";
import { AskAiDock } from "./AskAiDock";

// Owns the open state for the report-scoped Ask-AI surface: a sticky FAB plus
// the draggable/resizable dock it toggles. Mounted once by HighlighterLayer.

export function AskAi({
  reportId,
  conclusion,
  freshnessToken,
}: {
  reportId: string;
  conclusion?: string;
  freshnessToken?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <AskAiFab open={open} onClick={() => setOpen((o) => !o)} />
      {open && (
        <AskAiDock
          reportId={reportId}
          conclusion={conclusion}
          freshnessToken={freshnessToken}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
