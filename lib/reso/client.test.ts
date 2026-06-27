import { test, expect, spyOn, afterEach } from "bun:test";

let fetchSpy: ReturnType<typeof spyOn> | undefined;

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
  delete process.env.RESO_BASE_URL_SWFL_MLS;
  delete process.env.RESO_TOKEN_SWFL_MLS;
});

test("paginates until an empty page is returned", async () => {
  process.env.RESO_BASE_URL_SWFL_MLS = "https://sandbox.example.com";
  process.env.RESO_TOKEN_SWFL_MLS = "tok-test";

  const items200 = Array.from({ length: 200 }, (_, i) => ({ ListingKey: `K${i}` }));
  const items50 = Array.from({ length: 50 }, (_, i) => ({ ListingKey: `L${i}` }));
  let call = 0;
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => {
    const page = [items200, items50][call++] ?? [];
    return new Response(JSON.stringify({ value: page }), { status: 200 });
  });

  const { ResoClient } = await import("./client");
  const client = new ResoClient("swfl_mls");
  const results = await client.get("Property", { $select: "ListingKey" });
  expect(results.length).toBe(250);
});

test("throws on non-ok HTTP response", async () => {
  process.env.RESO_BASE_URL_SWFL_MLS = "https://sandbox.example.com";
  process.env.RESO_TOKEN_SWFL_MLS = "tok-test";

  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response("Unauthorized", { status: 401 }),
  );

  const { ResoClient } = await import("./client");
  const client = new ResoClient("swfl_mls");
  await expect(client.get("Property", {})).rejects.toThrow("401");
});

test("throws when env vars are missing for a board", async () => {
  const savedUrl = process.env.RESO_BASE_URL_NABOR;
  const savedTok = process.env.RESO_TOKEN_NABOR;
  delete process.env.RESO_BASE_URL_NABOR;
  delete process.env.RESO_TOKEN_NABOR;

  const { ResoClient } = await import("./client");
  expect(() => new ResoClient("nabor")).toThrow("env vars not configured");

  if (savedUrl) process.env.RESO_BASE_URL_NABOR = savedUrl;
  if (savedTok) process.env.RESO_TOKEN_NABOR = savedTok;
});
