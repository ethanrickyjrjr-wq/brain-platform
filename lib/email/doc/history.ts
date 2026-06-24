// lib/email/doc/history.ts — bounded undo/redo for the block canvas (Card 11).
// Pure functions; no React. Every canvas mutation (edit/add/delete/reorder/AI
// fill) goes through pushDoc. Keystroke edits should coalesce upstream (push on
// blur / idle) so undo steps stay meaningful (spec → Undo/redo).
import type { EmailDoc } from "./types";

export interface DocHistory {
  past: EmailDoc[];
  present: EmailDoc;
  future: EmailDoc[];
}

/** Max retained frames (spec: cap at 50). */
export const HISTORY_LIMIT = 50;

export function initHistory(doc: EmailDoc): DocHistory {
  return { past: [], present: doc, future: [] };
}

/** Commit a new present; drops the redo stack; trims to the last HISTORY_LIMIT. */
export function pushDoc(h: DocHistory, next: EmailDoc): DocHistory {
  return {
    past: [...h.past, h.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
  };
}

export function undo(h: DocHistory): DocHistory {
  if (h.past.length === 0) return h;
  const present = h.past[h.past.length - 1];
  return {
    past: h.past.slice(0, -1),
    present,
    future: [h.present, ...h.future],
  };
}

export function redo(h: DocHistory): DocHistory {
  if (h.future.length === 0) return h;
  return {
    past: [...h.past, h.present],
    present: h.future[0],
    future: h.future.slice(1),
  };
}

export const canUndo = (h: DocHistory): boolean => h.past.length > 0;
export const canRedo = (h: DocHistory): boolean => h.future.length > 0;
