"use client";

import { useCallback, useEffect, useState } from "react";

export type FactType = "metric" | "place";

export interface SelectedFact {
  text: string;
  rect: DOMRect;
  factType: FactType;
}

/** Classify a selection: a number/currency/percent reads as a "metric", else
 *  a "place" (ZIP names, corridors, towns). Pure so it could be unit-tested. */
export function classifyFact(text: string): FactType {
  const cleaned = text.replace(/[\s,$%]/g, "").replace(/[+\-]/g, "");
  // A metric if, after stripping currency/percent/commas/sign, what's left is
  // numeric (allow a trailing unit like "k"/"m" or a decimal).
  if (/^\d+(\.\d+)?[kmb]?$/i.test(cleaned)) return "metric";
  // Mixed numeric tokens (e.g. "$30,074/yr", "6.2%") — has a digit run.
  if (/[\d][\d,.]*\s*(%|\/yr|bps)/i.test(text)) return "metric";
  return "place";
}

const SUPPRESS_CLOSEST =
  "input, textarea, [contenteditable], #highlighter-popup, #ask-ai-dock";

function selectionIsSuppressed(sel: Selection): boolean {
  if (sel.rangeCount === 0) return true;
  const node = sel.anchorNode;
  if (!node) return true;
  const el =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  if (!el) return true;
  return el.closest(SUPPRESS_CLOSEST) !== null;
}

/**
 * Widen a selection range outward to cover a whole numeric figure when it lands
 * inside one. Dragging across part of "$525,000" (or "$30,074/yr", "-9.7%",
 * "+60bps") snaps to the entire token. Returns a widened Range, or null when
 * the selection isn't inside a single-text-node number (e.g. a place name), so
 * the caller leaves the selection alone.
 */
function expandRangeToNumber(range: Range): Range | null {
  const node = range.startContainer;
  // Only the common case: a selection that lives inside one text node.
  if (node.nodeType !== Node.TEXT_NODE || range.endContainer !== node)
    return null;
  const text = node.textContent ?? "";
  let start = range.startOffset;
  let end = range.endOffset;
  const NUM = /[0-9.,$%+\-/]/; // currency, percent, ratio, sign, decimals
  // Grow left/right over number characters...
  while (start > 0 && NUM.test(text[start - 1])) start--;
  while (end < text.length && NUM.test(text[end])) end++;
  // ...then a short trailing unit run (k / m / b / bps / yr / sf / mo).
  for (let u = 0; u < 4 && end < text.length && /[a-zA-Z]/.test(text[end]); u++)
    end++;
  // Drop a trailing sentence period / dangling comma.
  while (end > start && /[.,]/.test(text[end - 1])) end--;
  const widened = text.slice(start, end);
  // Bail unless we captured a digit AND actually grew the original selection.
  if (!/\d/.test(widened)) return null;
  if (start === range.startOffset && end === range.endOffset) return null;
  try {
    const r = document.createRange();
    r.setStart(node, start);
    r.setEnd(node, end);
    return r;
  } catch {
    return null;
  }
}

/**
 * Desktop text-selection → fact snapshot. On `mouseup`/`keyup` we wait 10ms for
 * the selection to settle, then snapshot the selected text, its bounding rect,
 * and a coarse fact type. Selections inside form fields, contenteditable, or
 * the popup itself are ignored so the user can type a question without the
 * popup re-triggering. An empty/collapsed selection clears to `null`.
 */
export function useHighlight() {
  const [fact, setFact] = useState<SelectedFact | null>(null);

  const clear = useCallback(() => setFact(null), []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    function snapshot() {
      const sel = typeof window !== "undefined" ? window.getSelection() : null;
      if (!sel || sel.isCollapsed || selectionIsSuppressed(sel)) {
        // Clear the popup ONLY on a real collapse in page content. When focus
        // moves into our popup/composer (suppressed), the page selection
        // collapses too — but the user is typing a question, NOT dismissing it.
        // Clearing here is the "popup vanishes mid-compose" bug. Outside-click
        // and Esc still close it via the popup's own handlers.
        if ((!sel || sel.isCollapsed) && !(sel && selectionIsSuppressed(sel))) {
          setFact(null);
        }
        return;
      }
      let range: Range;
      try {
        range = sel.getRangeAt(0);
      } catch {
        return;
      }
      // Snap a partial number selection out to the whole figure: dragging
      // across "525" in "$525,000" (or "30,074/yr", "-9.7%", "+60bps") grabs
      // the entire token. Only ever widens; leaves place names untouched.
      const widened = expandRangeToNumber(range);
      if (widened) {
        sel.removeAllRanges();
        sel.addRange(widened);
        range = widened;
      }
      const text = sel.toString().trim();
      if (!text) {
        setFact(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      setFact({ text, rect, factType: classifyFact(text) });
    }

    function onSettle() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(snapshot, 10);
    }

    let selTimer: ReturnType<typeof setTimeout> | null = null;
    function onSelectionChange() {
      // Touch double-tap / long-press fires `selectionchange` but not always
      // `mouseup`/`keyup`; debounce so we snapshot once the selection settles.
      // snapshot() reuses the same suppression + number-snap + don't-clear-while-
      // composing logic as the desktop path.
      if (selTimer) clearTimeout(selTimer);
      selTimer = setTimeout(snapshot, 300);
    }

    document.addEventListener("mouseup", onSettle);
    document.addEventListener("keyup", onSettle);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      if (timer) clearTimeout(timer);
      if (selTimer) clearTimeout(selTimer);
      document.removeEventListener("mouseup", onSettle);
      document.removeEventListener("keyup", onSettle);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, []);

  return { fact, clear };
}
