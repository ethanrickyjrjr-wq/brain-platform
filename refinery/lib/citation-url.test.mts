import { test, beforeEach, afterEach } from "bun:test";
import assert from "node:assert/strict";
import { buildSourceCitationUrl } from "./citation-url.mts";

const ORIGINAL_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL;

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

afterEach(() => {
  if (ORIGINAL_ORIGIN === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_ORIGIN;
});

test("buildSourceCitationUrl falls back to production origin when NEXT_PUBLIC_SITE_URL is unset", () => {
  const url = buildSourceCitationUrl("fl_dor_tdt_collections", {
    label: "Florida DOR TDT collections",
    source: "Florida DOR",
    brain: "tourism-tdt",
  });
  assert.ok(
    url.startsWith(
      "https://www.swfldatagulf.com/r/source/fl_dor_tdt_collections?",
    ),
    `expected prod fallback origin; got ${url}`,
  );
});

test("buildSourceCitationUrl honors NEXT_PUBLIC_SITE_URL when set", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  const url = buildSourceCitationUrl("fl_dor_tdt_collections", {
    label: "x",
    source: "y",
    brain: "tourism-tdt",
  });
  assert.ok(
    url.startsWith("http://localhost:3000/r/source/fl_dor_tdt_collections?"),
    `expected localhost origin; got ${url}`,
  );
});

test("buildSourceCitationUrl strips a single trailing slash from the origin", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000/";
  const url = buildSourceCitationUrl("t", {
    label: "a",
    source: "b",
    brain: "c",
  });
  assert.ok(url.startsWith("http://localhost:3000/r/source/t?"));
  assert.ok(!url.startsWith("http://localhost:3000//r/"));
});

test("buildSourceCitationUrl URL-encodes label and source values with spaces and ampersands", () => {
  const url = buildSourceCitationUrl("fl_dor_tdt_collections", {
    label: "Florida DOR & TDT collections",
    source: "Florida DOR",
    brain: "tourism-tdt",
  });
  const u = new URL(url);
  assert.equal(u.searchParams.get("label"), "Florida DOR & TDT collections");
  assert.equal(u.searchParams.get("source"), "Florida DOR");
  assert.equal(u.searchParams.get("brain"), "tourism-tdt");
});

test("buildSourceCitationUrl includes date_col when provided", () => {
  const url = buildSourceCitationUrl("fl_dor_tdt_collections", {
    label: "x",
    source: "y",
    brain: "tourism-tdt",
    date_col: "period_yyyymm",
  });
  assert.equal(new URL(url).searchParams.get("date_col"), "period_yyyymm");
});

test("buildSourceCitationUrl omits doc when not provided", () => {
  const url = buildSourceCitationUrl("t", {
    label: "a",
    source: "b",
    brain: "c",
  });
  assert.equal(new URL(url).searchParams.get("doc"), null);
});

test("buildSourceCitationUrl includes doc when provided", () => {
  const url = buildSourceCitationUrl("t", {
    label: "a",
    source: "b",
    brain: "c",
    doc: "https://floridarevenue.com/taxes/Pages/distributions.aspx",
  });
  assert.equal(
    new URL(url).searchParams.get("doc"),
    "https://floridarevenue.com/taxes/Pages/distributions.aspx",
  );
});

test("buildSourceCitationUrl emits parameters in stable order: label, source, brain, date_col, doc", () => {
  const url = buildSourceCitationUrl("t", {
    label: "a",
    source: "b",
    brain: "c",
    date_col: "period_yyyymm",
    doc: "https://example.com/d",
  });
  const query = url.split("?")[1] ?? "";
  const keys = query.split("&").map((kv) => kv.split("=")[0]);
  assert.deepEqual(keys, ["label", "source", "brain", "date_col", "doc"]);
});
