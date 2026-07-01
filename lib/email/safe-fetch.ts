// lib/email/safe-fetch.ts
//
// Real-SSRF-safe fetch for user-supplied listing URLs. isSafePublicUrl (og-image.ts)
// only pattern-matches the initial hostname — a domain whose A-record resolves to a
// private IP passes it, and it doesn't re-check on redirect, so a later 302 to
// 169.254.169.254 (cloud metadata) or 127.0.0.1 gets followed anyway under
// redirect:"follow". This module closes both gaps: resolve-then-check the DNS answer,
// and reject any redirect outright rather than following it.
import { lookup } from "node:dns/promises";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const DEFAULT_TIMEOUT_MS = 9000;

/** Pure: true when `address` (IPv4, IPv6, or an IPv4-mapped IPv6 literal) is loopback,
 *  RFC1918 private, link-local (incl. the 169.254.169.254 cloud metadata address),
 *  CGNAT, 0.0.0.0/8, or an IPv6 ULA/link-local range. */
export function isPrivateOrReservedIp(address: string): boolean {
  const a = address.toLowerCase().trim();
  const v4 = a.startsWith("::ffff:") ? a.slice(7) : a;

  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(v4)) {
    const octets = v4.split(".").map(Number);
    if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return true; // malformed -> unsafe
    const [o1, o2] = octets;
    if (o1 === 127) return true; // 127.0.0.0/8 loopback
    if (o1 === 10) return true; // 10.0.0.0/8
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true; // 172.16.0.0/12
    if (o1 === 192 && o2 === 168) return true; // 192.168.0.0/16
    if (o1 === 169 && o2 === 254) return true; // 169.254.0.0/16 (incl. cloud metadata)
    if (o1 === 100 && o2 >= 64 && o2 <= 127) return true; // 100.64.0.0/10 CGNAT
    if (o1 === 0) return true; // 0.0.0.0/8
    return false;
  }

  if (a === "::1") return true; // IPv6 loopback
  if (/^fe[89ab][0-9a-f]:/.test(a)) return true; // fe80::/10 link-local
  if (/^f[cd][0-9a-f]{2}:/.test(a)) return true; // fc00::/7 ULA
  return false;
}

/** DNS-resolved addresses for one hostname — the shape safeListingUrl needs, decoupled
 *  from node:dns's overloaded typings so a test can inject a fake without fighting them. */
type LookupAllFn = (hostname: string) => Promise<{ address: string }[]>;

/**
 * https-only; rejects localhost/.local/single-label hosts (same posture as og-image.ts's
 * isSafePublicUrl); then resolves the hostname and rejects if ANY resolved address is
 * private/reserved — the piece a hostname-pattern check alone misses (a domain whose
 * A-record points at an internal IP passes pattern matching, fails this).
 */
export async function safeListingUrl(
  rawUrl: string,
  lookupFn: LookupAllFn = (h) => lookup(h, { all: true }),
): Promise<URL | null> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;

  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || !h.includes(".")) return null;

  let addrs: { address: string }[];
  try {
    addrs = await lookupFn(h);
  } catch {
    return null;
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateOrReservedIp(a.address))) return null;

  return u;
}

/**
 * Guarded fetch for a user-supplied listing URL. Fetches with redirect:"manual" and
 * rejects any 3xx response outright rather than following it — sidesteps re-validating
 * each redirect hop at the cost of not following a legitimate redirecting listing URL
 * (documented trade-off: most pasted listing URLs are already the final resolved URL).
 * Residual risk, deliberately deferred: full DNS-rebinding connection pinning (so a
 * second DNS lookup at connect time can't return a different, private address) is not
 * built — the DNS-resolve check above closes the practical gap (a malicious host
 * record); the TOCTOU race against the runtime's own connection-time resolution is a
 * much smaller residual window. NEVER throws — null on any guard/network failure.
 */
export async function safeFetchPublicUrl(
  rawUrl: string,
  opts: { timeoutMs?: number; accept?: string } = {},
): Promise<Response | null> {
  const u = await safeListingUrl(rawUrl);
  if (!u) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(u.toString(), {
      method: "GET",
      redirect: "manual",
      signal: ctrl.signal,
      headers: { "user-agent": BROWSER_UA, accept: opts.accept ?? "text/html,*/*" },
    });
    if (res.status >= 300 && res.status < 400) return null; // never follow a redirect hop
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
