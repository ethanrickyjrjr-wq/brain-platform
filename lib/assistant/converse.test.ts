import { test, expect } from "bun:test";
import { streamConverse, splitFollowupTail, type ConverseHandlers } from "./converse";

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
  const state: {
    reach?: string[];
    followups?: string[];
    place?: { zip?: string; name?: string };
    placeToken?: string;
    done: boolean;
  } = { done: false };
  const handlers: ConverseHandlers = {
    onText: (acc) => {
      texts.push(acc);
    },
    onReach: (r) => {
      state.reach = r;
    },
    onFollowups: (f) => {
      state.followups = f;
    },
    onPlace: (p, token) => {
      state.place = p;
      state.placeToken = token;
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

test("chart frame sets chart state; following text accumulates with no JSON leak into prose", async () => {
  // Verification gap (chart-adapter migration): the SSE stream emits a chart
  // frame (a ChartSpec) BEFORE the text deltas. The chart must land on the chart
  // handler and the answer prose must accumulate cleanly — the chart JSON must
  // never bleed into the displayed text.
  const charts: unknown[] = [];
  const c = collector();
  const handlers: ConverseHandlers = { ...c.handlers, onChart: (ch) => charts.push(ch) };
  const spec = {
    frameId: "corridor-scatter",
    title: "SWFL Corridor Market Scatter",
    columns: ["vacancy_pct", "nnn_asking_rent_per_sqft", "corridor"],
    rows: [],
    asOf: "2026-06-30",
    options: { data: [{ id: "x", permits: { headline_z: 1.2, n_current: 18 } }] },
  };
  const body = streamOf([
    `data: ${JSON.stringify({ chart: spec })}\n\n`,
    `data: {"text":"hello"}\n\n`,
    `data: {"done":true}\n\n`,
  ]);
  await streamConverse(
    { reportId: "cre-swfl", question: "show me the scatter" },
    handlers,
    fakeFetch({ ok: true, status: 200, body }),
  );
  expect(charts).toHaveLength(1);
  expect((charts[0] as { frameId: string }).frameId).toBe("corridor-scatter");
  // n_current survives the wire (the field the old flat-columns plan dropped).
  expect(
    (charts[0] as { options: { data: { permits: { n_current: number } }[] } }).options.data[0]
      .permits.n_current,
  ).toBe(18);
  // The answer is exactly the text delta — no chart JSON, no "frameId" leak.
  expect(c.texts).toEqual(["hello"]);
  expect(c.texts.join("")).not.toContain("frameId");
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
  const body = streamOf([`data: {"text":"Hel`, `lo"}\n\ndata: {"done":true,"reach":[]}\n\n`]);
  await streamConverse(
    { reportId: "env-swfl", question: "q" },
    c.handlers,
    fakeFetch({ ok: true, status: 200, body }),
  );
  expect(c.texts).toEqual(["Hello"]);
  expect(c.state.done).toBe(true);
});

test("sends slug in the POST body when provided, omits it when not", async () => {
  type ConverseBody = { report_id?: string; fact?: string; slug?: string; question: string };
  // Capture the request body the stub receives, return a minimal done frame.
  function capturingFetch(sink: { body?: ConverseBody }): typeof fetch {
    return (async (_url: string, init: RequestInit) => {
      sink.body = JSON.parse(init.body as string) as ConverseBody;
      return { ok: true, status: 200, body: streamOf([`data: {"done":true,"reach":[]}\n\n`]) };
    }) as unknown as typeof fetch;
  }

  const withSlug: { body?: ConverseBody } = {};
  await streamConverse(
    {
      reportId: "cre-swfl",
      fact: "$27.51",
      slug: "asking_rent_psf_median",
      question: "break it down",
    },
    collector().handlers,
    capturingFetch(withSlug),
  );
  expect(withSlug.body?.slug).toBe("asking_rent_psf_median");

  const noSlug: { body?: ConverseBody } = {};
  await streamConverse(
    { reportId: "cre-swfl", fact: "$27.51", question: "break it down" },
    collector().handlers,
    capturingFetch(noSlug),
  );
  // JSON.stringify drops an undefined value — the key must be absent, not null.
  expect("slug" in (noSlug.body ?? {})).toBe(false);
});

test("OFF-report (no reportId) omits report_id entirely → the conversation path", async () => {
  // The headline of the universal-highlighter lift: an off-report selection sends NO
  // report_id, so the engine's isReportRequest is false and it answers as OUTSIDE AI.
  type Body = { report_id?: string; context?: string; question?: string };
  let captured: Body = {};
  const capturingFetch = (async (_url: string, init: RequestInit) => {
    captured = JSON.parse(init.body as string) as Body;
    return { ok: true, status: 200, body: streamOf([`data: {"done":true,"reach":[]}\n\n`]) };
  }) as unknown as typeof fetch;
  await streamConverse(
    { question: "what's the flood outlook here?" },
    collector().handlers,
    capturingFetch,
  );
  // The key must be ABSENT (JSON.stringify drops undefined), not null/empty.
  expect("report_id" in captured).toBe(false);
  expect(captured.context).toBe("outside");
});

test("captures the prelude place frame off-report (grounded ZIP + freshness)", async () => {
  const c = collector();
  const body = streamOf([
    `data: ${JSON.stringify({
      type: "place",
      place: { zip: "33931", name: "Fort Myers Beach" },
      freshness_token: "SWFL-7421-v5-20260622",
    })}\n\n`,
    `data: {"text":"Fort Myers Beach carries elevated flood loss."}\n\n`,
    `data: {"done":true,"reach":[]}\n\n`,
  ]);
  await streamConverse(
    { question: "flood outlook for FMB?" },
    c.handlers,
    fakeFetch({ ok: true, status: 200, body }),
  );
  expect(c.state.place).toEqual({ zip: "33931", name: "Fort Myers Beach" });
  expect(c.state.placeToken).toBe("SWFL-7421-v5-20260622");
  // The place frame must not leak into the displayed prose.
  expect(c.texts.at(-1)).toBe("Fort Myers Beach carries elevated flood loss.");
});

test("skips the request entirely when the question is blank", async () => {
  const c = collector();
  let called = false;
  const spyFetch = (async () => {
    called = true;
    return { ok: true, status: 200, body: null };
  }) as unknown as typeof fetch;
  await streamConverse({ reportId: "env-swfl", question: "   " }, c.handlers, spyFetch);
  expect(called).toBe(false);
  expect(c.texts).toEqual([]);
  expect(c.errors).toEqual([]);
});

// ── Real-time follow-ups tail ────────────────────────────────────────────────

test("sends selectionType/is_realtime/from_chip in the POST body", async () => {
  type Body = { selection_type?: string; is_realtime?: boolean; from_chip?: boolean };
  let captured: Body = {};
  const capturingFetch = (async (_url: string, init: RequestInit) => {
    captured = JSON.parse(init.body as string) as Body;
    return { ok: true, status: 200, body: streamOf([`data: {"done":true,"reach":[]}\n\n`]) };
  }) as unknown as typeof fetch;
  await streamConverse(
    {
      reportId: "env-swfl",
      question: "q",
      selectionType: "metric",
      isRealtime: true,
      fromChip: true,
    },
    collector().handlers,
    capturingFetch,
  );
  expect(captured.selection_type).toBe("metric");
  expect(captured.is_realtime).toBe(true);
  expect(captured.from_chip).toBe(true);
});

test("splits the ⟦FOLLOWUPS⟧ tail off the answer and reports it as chips", async () => {
  const c = collector();
  const body = streamOf([
    `data: {"text":"Lee leads.\\n\\n"}\n\n`,
    `data: {"text":"⟦FOLLOWUPS⟧ How does Collier compare? | What's driving it? | Is it seasonal?"}\n\n`,
    `data: {"done":true,"reach":[]}\n\n`,
  ]);
  await streamConverse(
    { reportId: "env-swfl", question: "q" },
    c.handlers,
    fakeFetch({ ok: true, status: 200, body }),
  );
  // The displayed answer never contains the marker or the questions.
  expect(c.texts.every((t) => !t.includes("⟦FOLLOWUPS⟧"))).toBe(true);
  expect(c.texts.at(-1)).toBe("Lee leads.");
  expect(c.state.followups).toEqual([
    "How does Collier compare?",
    "What's driving it?",
    "Is it seasonal?",
  ]);
});

test("no marker → followups empty, full answer shown", async () => {
  const c = collector();
  const body = streamOf([
    `data: {"text":"Just an answer, no tail."}\n\n`,
    `data: {"done":true,"reach":[]}\n\n`,
  ]);
  await streamConverse(
    { reportId: "env-swfl", question: "q" },
    c.handlers,
    fakeFetch({ ok: true, status: 200, body }),
  );
  expect(c.texts.at(-1)).toBe("Just an answer, no tail.");
  expect(c.state.followups).toEqual([]);
});

test("splitFollowupTail hides a partial marker streamed across chunks (no leak)", () => {
  // Simulate the accumulator growing one fragment at a time through the marker.
  const fragments = ["Answer.", "Answer.\n\n⟦FOLL", "Answer.\n\n⟦FOLLOWUPS⟧ a | b"];
  const visibles = fragments.map((acc) => splitFollowupTail(acc).visible);
  // No intermediate visible state ever exposes a partial or full marker.
  expect(visibles.every((v) => !v.includes("⟦"))).toBe(true);
  expect(visibles).toEqual(["Answer.", "Answer.", "Answer."]);
  expect(splitFollowupTail(fragments[2]).followups).toEqual(["a", "b"]);
});

test("sends project context (context/project_id/pageContext/briefcase) when provided, omits them off-project", async () => {
  type Body = { context?: string; project_id?: string; pageContext?: string; briefcase?: string };

  // PROJECT context — all four fields ride the body.
  const inProject: { body?: Body } = {};
  const projFetch = (async (_url: string, init: RequestInit) => {
    inProject.body = JSON.parse(init.body as string) as Body;
    return { ok: true, status: 200, body: streamOf([`data: {"done":true,"reach":[]}\n\n`]) };
  }) as unknown as typeof fetch;
  await streamConverse(
    {
      question: "how does this project look?",
      context: "project",
      projectId: "proj-123",
      pageContext: 'their project "Cape Coral CRE"',
      briefcase: "The user has already saved these…",
    },
    collector().handlers,
    projFetch,
  );
  expect(inProject.body?.context).toBe("project");
  expect(inProject.body?.project_id).toBe("proj-123");
  expect(inProject.body?.pageContext).toBe('their project "Cape Coral CRE"');
  expect(inProject.body?.briefcase).toBe("The user has already saved these…");

  // No project fields → context defaults to "outside" and the keys are ABSENT (not null).
  const off: { body?: Body } = {};
  const offFetch = (async (_url: string, init: RequestInit) => {
    off.body = JSON.parse(init.body as string) as Body;
    return { ok: true, status: 200, body: streamOf([`data: {"done":true,"reach":[]}\n\n`]) };
  }) as unknown as typeof fetch;
  await streamConverse({ question: "general q" }, collector().handlers, offFetch);
  expect(off.body?.context).toBe("outside");
  expect("project_id" in (off.body ?? {})).toBe(false);
  expect("pageContext" in (off.body ?? {})).toBe(false);
  expect("briefcase" in (off.body ?? {})).toBe(false);
});
