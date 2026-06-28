// lib/email/og-image.ts
//
// Best-effort hero-photo resolver for the Email Lab fill. Given a listing /
// agent-website URL, fetch the page and pull its og:image (the hero photo every
// site sets for link previews). A pure parser + a thin, guarded fetch wrapper.
// NEVER throws — a photo is a bonus, exactly like the chart.
//
// Reality (verified 2026-06-28 with a browser UA): a plain server fetch returns
// og:image for an agent's own site and many MLS/Redfin pages (HTTP 200), but the
// big portals block bots — Zillow 403, Realtor.com 429. For those the photo comes
// from the agent's RESO Media feed (next layer), not from here. So this lane is
// "their website / a fetchable listing page", and it degrades silently otherwise.

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 1_500_000; // <head> meta tags live early; 1.5MB is plenty

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

/** Every http(s) URL in a blob of text, in order, de-duplicated. Trailing
 *  sentence punctuation is trimmed so "see https://x.com/y." → "https://x.com/y". */
export function extractUrls(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(URL_RE)) {
    const u = m[0].replace(/[.,;!?]+$/, "");
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&#x2f;/gi, "/")
    .replace(/&#47;/g, "/")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

/** Pull a <meta> tag's `content` for a given property/name key, attribute-order
 *  agnostic (content may sit before or after the property/name attribute). */
function metaContent(html: string, key: string): string | null {
  const tag = html.match(
    new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${key}["'][^>]*>`, "i"),
  )?.[0];
  if (!tag) return null;
  const content = tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
  return content ? decodeEntities(content.trim()) : null;
}

/** Pure: the hero image URL from page HTML (og:image → twitter:image), resolved
 *  to an absolute URL against `baseUrl`. Returns null when none / unparseable. */
export function parseOgImage(html: string, baseUrl: string): string | null {
  if (!html) return null;
  const raw = metaContent(html, "og:image") ?? metaContent(html, "twitter:image");
  if (!raw) return null;
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return null;
  }
}

/** Pure: og:title, else <title>, for a sensible default alt/caption. */
export function parseTitle(html: string): string | undefined {
  const og = metaContent(html, "og:title");
  if (og) return og;
  const t = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  return t ? decodeEntities(t.trim()) : undefined;
}

/** Block obvious SSRF targets (localhost / private ranges / single-label hosts). */
function isSafePublicUrl(u: URL): boolean {
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || !h.includes(".")) return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (h === "::1" || /^(fe80|fc|fd)/.test(h)) return false;
  return true;
}

export interface OgImageResult {
  image: string;
  title?: string;
}

/** Best-effort: fetch a URL and return its hero photo (og:image). Guarded,
 *  timed out, content-type checked. NEVER throws — null on any failure/block. */
export async function fetchOgImage(rawUrl: string): Promise<OgImageResult | null> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!isSafePublicUrl(u)) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(u.toString(), {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": BROWSER_UA, accept: "text/html,*/*" },
    });
    if (!res.ok) return null;
    if (!(res.headers.get("content-type") ?? "").includes("html")) return null;
    const html = (await res.text()).slice(0, MAX_HTML_BYTES);
    const image = parseOgImage(html, u.toString());
    return image ? { image, title: parseTitle(html) } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
