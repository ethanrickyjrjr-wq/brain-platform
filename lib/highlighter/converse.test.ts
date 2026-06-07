import { test, expect } from "bun:test";
import { streamConverse, type ConverseHandlers } from "./converse";

// Build a ReadableStream<Uint8Array> from string chunks so a test controls the
// exact SSE-frame boundaries the reader sees.
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

// A fetch stub returning a controlled response (only `ok`/`status`/`body` are
// read by streamConverse).
function fakeFetch(res: {
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
}): typeof fetch {
  return (async () => res) as unknown as typeof fetch;
}

function collector() {
  const texts: string[] = [];
  const errors: string[] = [];
  const state: { reach?: string[]; done: boolean } = { done: false };
  const handlers: ConverseHandlers = {
    onText: (acc) => {
      texts.push(acc);
    },
    onReach: (r) => {
      state.reach = r;
    },
    onError: (m) => {
      errors.push(m);
    },
    onDone: () => {
      state.done = true;
    },
  };
  return { handlers, texts, errors, state };
}

test("accumulates text deltas and reports reach on done", async () => {
  const c = collector();
  const body = streamOf([
    `data: {"text":"Hello "}\n\n`,
    `data: {"text":"world"}\n\n`,
    `data: {"done":true,"reach":["cre-swfl"]}\n\n`,
  ]);
  await streamConverse(
    { reportId: "env-swfl", question: "what's up?" },
    c.handlers,
    fakeFetch({ ok: true, status: 200, body }),
  );
  // onText receives the ACCUMULATED answer each time, not the raw delta.
  expect(c.texts).toEqual(["Hello ", "Hello world"]);
  expect(c.state.reach).toEqual(["cre-swfl"]);
  expect(c.state.done).toBe(true);
  expect(c.errors).toEqual([]);
});

test("surfaces an error frame and stops processing further frames", async () => {
  const c = collector();
  const body = streamOf([
    `data: {"text":"partial"}\n\n`,
    `data: {"error":"boom"}\n\n`,
    `data: {"text":"after"}\n\n`,
  ]);
  await streamConverse(
    { reportId: "env-swfl", question: "q" },
    c.handlers,
    fakeFetch({ ok: true, status: 200, body }),
  );
  expect(c.errors).toEqual(["boom"]);
  // "after" must NOT be delivered — processing stops at the error frame.
  expect(c.texts).toEqual(["partial"]);
  expect(c.state.done).toBe(false);
});

test("reports a status error when the response is not ok", async () => {
  const c = collector();
  await streamConverse(
    { reportId: "env-swfl", question: "q" },
    c.handlers,
    fakeFetch({ ok: false, status: 503, body: null }),
  );
  expect(c.errors).toEqual(["Request failed (503)"]);
  expect(c.texts).toEqual([]);
});

test("reassembles a frame split across read chunks", async () => {
  const c = collector();
  const body = streamOf([
    `data: {"text":"Hel`,
    `lo"}\n\ndata: {"done":true,"reach":[]}\n\n`,
  ]);
  await streamConverse(
    { reportId: "env-swfl", question: "q" },
    c.handlers,
    fakeFetch({ ok: true, status: 200, body }),
  );
  expect(c.texts).toEqual(["Hello"]);
  expect(c.state.done).toBe(true);
});

test("skips the request entirely when the question is blank", async () => {
  const c = collector();
  let called = false;
  const spyFetch = (async () => {
    called = true;
    return { ok: true, status: 200, body: null };
  }) as unknown as typeof fetch;
  await streamConverse(
    { reportId: "env-swfl", question: "   " },
    c.handlers,
    spyFetch,
  );
  expect(called).toBe(false);
  expect(c.texts).toEqual([]);
  expect(c.errors).toEqual([]);
});
