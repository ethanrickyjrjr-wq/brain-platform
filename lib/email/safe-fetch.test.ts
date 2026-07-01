import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { isPrivateOrReservedIp, safeListingUrl, safeFetchPublicUrl } from "./safe-fetch";

describe("isPrivateOrReservedIp — pure table", () => {
  const cases: [string, boolean][] = [
    ["127.0.0.1", true], // loopback
    ["10.1.2.3", true], // RFC1918 10/8
    ["172.16.0.5", true], // RFC1918 172.16/12
    ["172.31.255.255", true], // RFC1918 172.16/12 upper bound
    ["192.168.1.1", true], // RFC1918 192.168/16
    ["169.254.169.254", true], // link-local — cloud metadata address
    ["169.254.0.1", true], // link-local
    ["100.64.0.1", true], // CGNAT
    ["100.127.255.255", true], // CGNAT upper bound
    ["0.0.0.1", true], // 0.0.0.0/8
    ["::1", true], // IPv6 loopback
    ["fc00::1", true], // IPv6 ULA
    ["fd12:3456::1", true], // IPv6 ULA
    ["fe80::1", true], // IPv6 link-local
    ["::ffff:127.0.0.1", true], // IPv4-mapped loopback
    ["8.8.8.8", false], // public
    ["93.184.216.34", false], // public
    ["2606:4700:4700::1111", false], // public IPv6
    ["172.32.0.1", false], // just outside 172.16/12
  ];
  for (const [address, expected] of cases) {
    test(`${address} -> ${expected}`, () => {
      expect(isPrivateOrReservedIp(address)).toBe(expected);
    });
  }
});

describe("safeListingUrl — https-only + DNS-resolved guard", () => {
  test("rejects http", async () => {
    expect(await safeListingUrl("http://example.com/listing")).toBeNull();
  });

  test("rejects localhost / .local / single-label hosts", async () => {
    expect(await safeListingUrl("https://localhost/x")).toBeNull();
    expect(await safeListingUrl("https://myhost.local/x")).toBeNull();
    expect(await safeListingUrl("https://intranet/x")).toBeNull();
  });

  test("rejects an IP-literal private host (real lookup, no mock — IP literals resolve locally)", async () => {
    expect(await safeListingUrl("https://127.0.0.1/listing")).toBeNull();
  });

  test("passes an IP-literal public host (real lookup, no mock)", async () => {
    const u = await safeListingUrl("https://8.8.8.8/listing");
    expect(u).not.toBeNull();
    expect(u!.hostname).toBe("8.8.8.8");
  });

  test("rejects a domain whose resolved A-record is private (injected lookup)", async () => {
    const u = await safeListingUrl("https://evil.example.com/listing", async () => [
      { address: "127.0.0.1" },
    ]);
    expect(u).toBeNull();
  });

  test("passes a domain whose resolved A-record is public (injected lookup)", async () => {
    const u = await safeListingUrl("https://good.example.com/listing", async () => [
      { address: "93.184.216.34" },
    ]);
    expect(u).not.toBeNull();
    expect(u!.hostname).toBe("good.example.com");
  });

  test("rejects when ANY resolved address is private (multi-A-record host)", async () => {
    const u = await safeListingUrl("https://mixed.example.com/listing", async () => [
      { address: "93.184.216.34" },
      { address: "169.254.169.254" },
    ]);
    expect(u).toBeNull();
  });
});

describe("safeFetchPublicUrl — manual redirect, rejects any 3xx outright", () => {
  let fetchSpy: ReturnType<typeof spyOn>;
  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  test("rejects a 3xx response outright and never follows it", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(null, { status: 302, headers: { location: "https://169.254.169.254/" } }),
    );
    const res = await safeFetchPublicUrl("https://8.8.8.8/listing");
    expect(res).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1); // the redirect target is never fetched
  });

  test("passes a 200 response through", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response("<html>ok</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    const res = await safeFetchPublicUrl("https://8.8.8.8/listing");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(await res!.text()).toBe("<html>ok</html>");
  });

  test("returns null and never calls fetch when the guard rejects first (bad protocol)", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("should never be called");
    });
    const res = await safeFetchPublicUrl("http://not-https.example.com/listing");
    expect(res).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
