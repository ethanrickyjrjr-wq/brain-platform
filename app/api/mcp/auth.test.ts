import { test, beforeEach, afterEach } from "bun:test";
import assert from "node:assert/strict";
import { assertAuthorized } from "./auth";

const ORIGINAL = process.env.MCP_ACCESS_TOKENS;

beforeEach(() => {
  delete process.env.MCP_ACCESS_TOKENS;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.MCP_ACCESS_TOKENS;
  else process.env.MCP_ACCESS_TOKENS = ORIGINAL;
});

function req(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return new Request("https://www.swfldatagulf.com/api/mcp", {
    method: "POST",
    headers,
  });
}

test("unconfigured → open (null), byte-identical to v1 no-op", async () => {
  const result = await assertAuthorized(req());
  assert.equal(result, null);
});

test("empty/whitespace token list → still open", async () => {
  process.env.MCP_ACCESS_TOKENS = " , ,  ";
  const result = await assertAuthorized(req());
  assert.equal(result, null);
});

test("configured + valid bearer token → authorized (null)", async () => {
  process.env.MCP_ACCESS_TOKENS = "tok_live_abc,tok_live_def";
  const result = await assertAuthorized(req("Bearer tok_live_def"));
  assert.equal(result, null);
});

test("configured + bearer is case-insensitive on the scheme", async () => {
  process.env.MCP_ACCESS_TOKENS = "tok_live_abc";
  const result = await assertAuthorized(req("bearer tok_live_abc"));
  assert.equal(result, null);
});

test("configured + missing header → 401", async () => {
  process.env.MCP_ACCESS_TOKENS = "tok_live_abc";
  const result = await assertAuthorized(req());
  assert.ok(result instanceof Response);
  assert.equal(result.status, 401);
  assert.match(result.headers.get("www-authenticate") ?? "", /Bearer/);
});

test("configured + unknown token → 401", async () => {
  process.env.MCP_ACCESS_TOKENS = "tok_live_abc";
  const result = await assertAuthorized(req("Bearer tok_wrong"));
  assert.ok(result instanceof Response);
  assert.equal(result.status, 401);
});

test("configured + malformed header (no Bearer scheme) → 401", async () => {
  process.env.MCP_ACCESS_TOKENS = "tok_live_abc";
  const result = await assertAuthorized(req("tok_live_abc"));
  assert.ok(result instanceof Response);
  assert.equal(result.status, 401);
});
