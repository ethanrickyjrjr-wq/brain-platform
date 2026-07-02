// lib/email/lab/canvas-pref.ts
// Cockpit D2 — per-project canvas preference. Grid is the DEFAULT (per-section
// AI editing is the editing story); block is the opt-in fallback.

export type EmailCanvas = "grid" | "block";
export type SwitchChoice = "save" | "discard" | "cancel";

export function emailCanvasPref(
  uiState: { email_canvas?: unknown } | null | undefined,
): EmailCanvas {
  return uiState?.email_canvas === "block" ? "block" : "grid";
}

export function nextCanvasAfterChoice(current: EmailCanvas, choice: SwitchChoice): EmailCanvas {
  if (choice === "cancel") return current;
  return current === "grid" ? "block" : "grid";
}
