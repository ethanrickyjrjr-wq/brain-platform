import { test, expect } from "bun:test";
import { ResoClient } from "./client";

const makeFetch = (pages: unknown[][]) => {
  let call = 0;
  return async (_url: string, _opts?: RequestInit): Promise<Response> => {
    const page = pages[call++] ?? [];
    return new Response(JSON.stringify({ value: page }), { status: 200 });
  };
};

test("paginates until an empty page is returned", async () => {
  process.env.RESO_BASE_URL_SWFL_MLS = "https://sandbox.example.com";
  process.env.RESO_TOKEN_SWFL_MLS = "tok-test";

  const items200 = Array.from({ length: 200 }, (_, i) => ({ ListingKey: `K${i}` }));
  const items50 = Array.from({ length: 50 }, (_, i) => ({ ListingKey: `L${i}` }));
  const client = new ResoClient("swfl_mls", makeFetch([items200, items50]) as typeof fetch);
  const results = await client.get("Property", { $select: "ListingKey" });

  expect(results.length).toBe(250);
});

test("throws on non-ok HTTP response", async () => {
  process.env.RESO_BASE_URL_SWFL_MLS = "https://sandbox.example.com";
  process.env.RESO_TOKEN_SWFL_MLS = "tok-test";

  const mockFetch = async (): Promise<Response> => new Response("Unauthorized", { status: 401 });
  const client = new ResoClient("swfl_mls", mockFetch as typeof fetch);
  await expect(client.get("Property", {})).rejects.toThrow("401");
});

test("throws when env vars are missing for a board", () => {
  const savedUrl = process.env.RESO_BASE_URL_NABOR;
  const savedTok = process.env.RESO_TOKEN_NABOR;
  delete process.env.RESO_BASE_URL_NABOR;
  delete process.env.RESO_TOKEN_NABOR;

  expect(() => new ResoClient("nabor")).toThrow("env vars not configured");

  if (savedUrl) process.env.RESO_BASE_URL_NABOR = savedUrl;
  if (savedTok) process.env.RESO_TOKEN_NABOR = savedTok;
});
