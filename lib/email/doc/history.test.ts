import { test, expect } from "bun:test";
import { initHistory, pushDoc, undo, redo, canUndo, canRedo, HISTORY_LIMIT } from "./history";
import type { EmailDoc } from "./types";

const doc = (n: number): EmailDoc => ({
  globalStyle: {
    primaryColor: "#000",
    accentColor: "#111",
    fontFamily: "MODERN_SANS",
    textColor: "#222",
    backdropColor: "#fff",
  },
  blocks: [{ id: `block_${n}`, type: "text", props: { body: String(n) } }],
});

test("init has no past/future", () => {
  const h = initHistory(doc(0));
  expect(canUndo(h)).toBe(false);
  expect(canRedo(h)).toBe(false);
});

test("push → undo → redo round-trips the present", () => {
  let h = initHistory(doc(0));
  h = pushDoc(h, doc(1));
  expect(h.present.blocks[0].props.body).toBe("1");
  h = undo(h);
  expect(h.present.blocks[0].props.body).toBe("0");
  expect(canRedo(h)).toBe(true);
  h = redo(h);
  expect(h.present.blocks[0].props.body).toBe("1");
});

test("a new push after undo clears the redo stack", () => {
  let h = initHistory(doc(0));
  h = pushDoc(h, doc(1));
  h = undo(h);
  h = pushDoc(h, doc(2));
  expect(canRedo(h)).toBe(false);
  expect(h.present.blocks[0].props.body).toBe("2");
});

test("undo/redo at the boundaries are no-ops", () => {
  let h = initHistory(doc(0));
  expect(undo(h)).toBe(h);
  h = pushDoc(h, doc(1));
  h = redo(h);
  expect(h.present.blocks[0].props.body).toBe("1");
});

test("history is capped at HISTORY_LIMIT frames", () => {
  let h = initHistory(doc(0));
  for (let i = 1; i <= HISTORY_LIMIT + 10; i++) h = pushDoc(h, doc(i));
  expect(h.past.length).toBe(HISTORY_LIMIT);
});
