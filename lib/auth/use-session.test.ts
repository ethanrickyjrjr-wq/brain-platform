import { test, expect } from "bun:test";
import { fetchSession } from "./use-session";

test("fetchSession parses authed/userId from a 200 /api/me response", async () => {
  const fakeFetch = async () =>
    new Response(JSON.stringify({ authed: true, userId: "u1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  expect(await fetchSession(fakeFetch as typeof fetch)).toEqual({
    authed: true,
    userId: "u1",
  });
});

test("fetchSession returns { authed: false } on a thrown/network error", async () => {
  const fakeFetch = async () => {
    throw new Error("network down");
  };
  expect(await fetchSession(fakeFetch as typeof fetch)).toEqual({ authed: false });
});

test("fetchSession returns { authed: false } on a non-OK response", async () => {
  const fakeFetch = async () => new Response("nope", { status: 500 });
  expect(await fetchSession(fakeFetch as typeof fetch)).toEqual({ authed: false });
});

test("fetchSession returns { authed: false } on malformed JSON", async () => {
  const fakeFetch = async () =>
    new Response("{not json", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  expect(await fetchSession(fakeFetch as typeof fetch)).toEqual({ authed: false });
});
