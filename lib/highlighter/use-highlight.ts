"use client";

import { useCallback, useEffect, useState } from "react";

export type FactType = "metric" | "place";

export interface SelectedFact {
  text: string;
  rect: DOMRect;
  factType: FactType;
  /** Row-level label from the nearest <tr> first cell, or nearest heading. */
  context?: string;
  /** Metric slug when the selection is a known key_metric value (chip/row path).
   *  Undefined for free text selections — those fall to the converse floor. */
  slug?: string;
  /** "fact" = specific metric/phrase; "section" = large selection (>25 words). */
  mode: "fact" | "section";
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
  "input, textarea, [contenteditable], #highlighter-popup, #ask-ai-dock, #briefcase-tray";
const MAX_WORDS = 40;
const DOUBLE_TAP_WINDOW_MS = 10_000;
const DOUBLE_TAP_FUZZ = 5;

function selectionIsSuppressed(sel: Selection): boolean {
  if (sel.rangeCount === 0) return true;
  const node = sel.anchorNode;
  if (!node) return true;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!el) return true;
  return el.closest(SUPPRESS_CLOSEST) !== null;
}

/**
 * Snap the start of a selection backward to the nearest word boundary when the
 * drag began mid-word. Only applies within a single text node and only ever
 * extends — never shortens. Returns null when already at a boundary.
 */
function expandRangeToWordStart(range: Range): Range | null {
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent ?? "";
  let start = range.startOffset;
  if (start === 0 || !/\w/.test(text[start - 1])) return null;
  while (start > 0 && /\w/.test(text[start - 1])) start--;
  try {
    const r = document.createRange();
    r.setStart(node, start);
    r.setEnd(range.endContainer, range.endOffset);
    return r;
  } catch {
    return null;
  }
}

/**
 * Snap the end of a selection forward to the nearest word boundary when the
 * drag released mid-word. Only applies within a single text node and only ever
 * extends — never shortens. Returns null when already at a boundary.
 */
function expandRangeToWordEnd(range: Range): Range | null {
  const node = range.endContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent ?? "";
  let end = range.endOffset;
  if (end >= text.length || !/\w/.test(text[end])) return null;
  while (end < text.length && /\w/.test(text[end])) end++;
  try {
    const r = document.createRange();
    r.setStart(range.startContainer, range.startOffset);
    r.setEnd(node, end);
    return r;
  } catch {
    return null;
  }
}

/**
 * Return false for selections that aren't worth surfacing as a popup:
 * too short, unclosed-paren fragments ("national macro (be"), or purely
 * punctuation/whitespace. Caller should clear the DOM selection on false.
 */
function isWorthySelection(text: string): boolean {
  if (text.length < 4) return false;
  if (!/[a-zA-Z0-9]/.test(text)) return false;
  // Unclosed parenthesis = mid-drag fragment
  const opens = (text.match(/\(/g) ?? []).length;
  const closes = (text.match(/\)/g) ?? []).length;
  if (opens > closes) return false;
  return true;
}

/**
 * When a drag crosses <tr> row boundaries in a table, snap the selection to a
 * single row. Whichever row contributes more text wins; if both are within 1.5×
 * of each other the end row wins (user's drag destination = intent). Returns
 * null when the range is already within one row (no snap needed).
 */
function snapCrossRowSelection(range: Range): Range | null {
  const startEl =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as Element)
      : (range.startContainer as Text).parentElement;
  const endEl =
    range.endContainer.nodeType === Node.ELEMENT_NODE
      ? (range.endContainer as Element)
      : (range.endContainer as Text).parentElement;

  const startRow = startEl?.closest("tr");
  const endRow = endEl?.closest("tr");
  if (!startRow || !endRow || startRow === endRow) return null;

  try {
    // Measure text from each row within the current range.
    const r1 = document.createRange();
    r1.setStart(range.startContainer, range.startOffset);
    r1.setEndAfter(startRow);
    const startLen = r1.toString().trim().length;

    const r2 = document.createRange();
    r2.setStartBefore(endRow);
    r2.setEnd(range.endContainer, range.endOffset);
    const endLen = r2.toString().trim().length;

    const snapped = document.createRange();
    if (startLen > endLen * 1.5) {
      // Start row clearly dominates — keep start row portion only.
      snapped.setStart(range.startContainer, range.startOffset);
      snapped.setEndAfter(startRow);
    } else {
      // End row dominates or both are comparable — snap to end row.
      snapped.setStartBefore(endRow);
      snapped.setEnd(range.endContainer, range.endOffset);
    }
    return snapped;
  } catch {
    return null;
  }
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
  if (node.nodeType !== Node.TEXT_NODE || range.endContainer !== node) return null;
  const text = node.textContent ?? "";
  let start = range.startOffset;
  let end = range.endOffset;
  const NUM = /[0-9.,$%+\-/]/; // currency, percent, ratio, sign, decimals
  // Grow left/right over number characters...
  while (start > 0 && NUM.test(text[start - 1])) start--;
  while (end < text.length && NUM.test(text[end])) end++;
  // ...then a short trailing unit run (k / m / b / bps / yr / sf / mo).
  for (let u = 0; u < 4 && end < text.length && /[a-zA-Z]/.test(text[end]); u++) end++;
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
 * Walk up from the selection anchor to extract the metric label that owns the
 * selected value. Strategy: nearest <tr> → first <td>/<th> text (covers the key-
 * metrics table). Fallback: the nearest preceding sibling heading within any
 * ancestor, for prose sections. Returns undefined when no label is found.
 */
function extractRowContext(node: Node): string | undefined {
  const el: Element | null =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : (node as Text).parentElement;
  if (!el) return undefined;

  // Table row: the first cell is the metric label.
  const row = el.closest("tr");
  if (row) {
    const firstCell = row.querySelector("td, th");
    const label = firstCell?.textContent?.trim();
    if (label) return label;
  }

  // Prose fallback: nearest preceding heading among ancestors.
  let cursor: Element | null = el;
  while (cursor) {
    let sib: Element | null = cursor.previousElementSibling;
    while (sib) {
      if (/^h[1-6]$/i.test(sib.tagName)) {
        const h = sib.textContent?.trim();
        if (h) return h;
      }
      sib = sib.previousElementSibling;
    }
    cursor = cursor.parentElement;
  }
  return undefined;
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
    let lastSuppressedWordCount: number | null = null;
    let lastSuppressedAt: number | null = null;

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
      // Snap a number selection to the whole figure, then try word-boundary
      // snap for text. Only one of these will ever apply to a given selection.
      const widened = expandRangeToNumber(range);
      if (widened) {
        sel.removeAllRanges();
        sel.addRange(widened);
        range = widened;
      } else {
        const wordSnapped = expandRangeToWordEnd(range);
        if (wordSnapped) {
          sel.removeAllRanges();
          sel.addRange(wordSnapped);
          range = wordSnapped;
        }
        // Snap start to word boundary (partial-word drag from the left edge).
        const startSnapped = expandRangeToWordStart(range);
        if (startSnapped) {
          sel.removeAllRanges();
          sel.addRange(startSnapped);
          range = startSnapped;
        }
      }
      // Snap cross-row table selections to a single row.
      const rowSnapped = snapCrossRowSelection(range);
      if (rowSnapped) {
        sel.removeAllRanges();
        sel.addRange(rowSnapped);
        range = rowSnapped;
      }

      const text = sel.toString().trim();
      // Reject garbage selections — clear visually so user knows it
      // didn't register rather than surfacing a broken popup.
      if (!text || !isWorthySelection(text)) {
        sel.removeAllRanges();
        setFact(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      const context = extractRowContext(range.startContainer);
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      // Suppress popup on accidental large sweeps. A second selection of
      // similar size (±5 words) within 10 s is treated as intentional.
      if (wordCount > MAX_WORDS) {
        const now = Date.now();
        const withinWindow =
          lastSuppressedAt !== null && now - lastSuppressedAt <= DOUBLE_TAP_WINDOW_MS;
        const similarSize =
          lastSuppressedWordCount !== null &&
          Math.abs(wordCount - lastSuppressedWordCount) <= DOUBLE_TAP_FUZZ;
        if (withinWindow && similarSize) {
          lastSuppressedWordCount = null;
          lastSuppressedAt = null;
        } else {
          lastSuppressedWordCount = wordCount;
          lastSuppressedAt = now;
          // Don't clear the DOM selection — user can still copy the text.
          setFact(null);
          return;
        }
      } else {
        lastSuppressedWordCount = null;
        lastSuppressedAt = null;
      }
      const mode: "fact" | "section" = wordCount > 25 ? "section" : "fact";
      setFact({ text, rect, factType: classifyFact(text), context, mode });
    }

    // Track mouse-button and touch state so selectionchange never fires a
    // snapshot mid-drag — the popup must only appear after the gesture ends.
    let mouseIsDown = false;
    let touchIsActive = false;
    let selTimer: ReturnType<typeof setTimeout> | null = null;

    function onMouseDown() {
      mouseIsDown = true;
    }
    function onMouseUp(e: MouseEvent) {
      mouseIsDown = false;
      const target = e.target as Element | null;
      if (target?.closest('button, [role="tab"]')) {
        window.getSelection()?.removeAllRanges();
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(snapshot, 10);
    }
    function onKeyUp(e: KeyboardEvent) {
      // Esc is handled by the popup itself — don't re-snapshot or the popup
      // immediately re-opens from the still-visible DOM selection.
      if (e.key === "Escape") return;
      // Debounce at 200ms so shift+arrow sequences don't fire on every keystroke.
      if (timer) clearTimeout(timer);
      timer = setTimeout(snapshot, 200);
    }
    function onTouchStart() {
      touchIsActive = true;
    }
    function onTouchEnd() {
      touchIsActive = false;
      // Fire snapshot 600ms after the finger lifts to let handles settle.
      if (selTimer) clearTimeout(selTimer);
      selTimer = setTimeout(snapshot, 600);
    }
    function onSelectionChange() {
      // Skip mid-drag on desktop (mouseIsDown) and during touch gestures.
      if (mouseIsDown || touchIsActive) return;
      if (selTimer) clearTimeout(selTimer);
      selTimer = setTimeout(snapshot, 600);
    }

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      if (timer) clearTimeout(timer);
      if (selTimer) clearTimeout(selTimer);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, []);

  return { fact, clear };
}
