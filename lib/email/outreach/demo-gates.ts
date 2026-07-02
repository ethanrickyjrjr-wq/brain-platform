// lib/email/outreach/demo-gates.ts
//
// Mechanical pre-send gates for the funnel demo email (spec §8). A failing gate
// SKIPS the recipient and reports — it never silently "fixes" the email. Pure/DI
// (fetch injected) so every gate is unit-testable offline.

import { collectAllowedUrls, lintCompiledHtml } from "@/lib/deliverable/url-lint";
import type { DemoTouchContent } from "./demo-content";

export interface GateResult {
  ok: boolean;
  failures: string[];
}

/**
 * Gate 1 — the demo's whole pitch is THEIR brand: the row's primary AND accent
 * (each, when defined) must appear in the built HTML; a row with no primary at
 * all fails outright (house-branding a demo email defeats the demo).
 */
export function brandHexGate(
  html: string,
  brand: { primary?: string | null; accent?: string | null },
): GateResult {
  const failures: string[] = [];
  const haystack = html.toLowerCase();
  if (!brand.primary) {
    failures.push("no brand primary on row — demo emails require the prospect's brand");
  } else if (!haystack.includes(brand.primary.toLowerCase())) {
    failures.push(`brand primary ${brand.primary} missing from built HTML`);
  }
  if (brand.accent && !haystack.includes(brand.accent.toLowerCase())) {
    failures.push(`brand accent ${brand.accent} missing from built HTML`);
  }
  return { ok: failures.length === 0, failures };
}

/** Gate 2 — the logo must actually resolve to an image before we send it to a prospect. */
export async function logoGate(
  logoUrl: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<GateResult> {
  if (!logoUrl) return { ok: false, failures: ["no logo URL on row"] };
  try {
    const res = await fetchImpl(logoUrl, { method: "GET" });
    if (!res.ok) return { ok: false, failures: [`logo URL returned ${res.status}: ${logoUrl}`] };
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/"))
      return { ok: false, failures: [`logo URL is not an image (${type}): ${logoUrl}`] };
    return { ok: true, failures: [] };
  } catch (e) {
    return { ok: false, failures: [`logo URL fetch failed: ${logoUrl} (${String(e)})`] };
  }
}

/**
 * Gate 3 — URL allowlist: every href/src in the HTML must come from the content
 * object (arrival deep-links, hosted chart/logo) or be a platform/relative URL.
 * A minted URL aborts; deep-link prompt/ref params are platform links and pass.
 */
/** The per-recipient unsubscribe placeholder — replaced by buildBatchMessages at send
 *  time with a platform /api/unsubscribe URL. At gate time we substitute exactly that
 *  so the lint sees what a recipient will actually receive. */
const UNSUB_TOKEN = "{{{RESEND_UNSUBSCRIBE_URL}}}";
const UNSUB_STANDIN = "https://www.swfldatagulf.com/api/unsubscribe";

export function urlGate(
  html: string,
  content: DemoTouchContent,
  extraRoots: unknown[] = [],
): GateResult {
  const allowed = collectAllowedUrls(content, ...extraRoots);
  const result = lintCompiledHtml(html.split(UNSUB_TOKEN).join(UNSUB_STANDIN), allowed);
  return {
    ok: result.ok,
    failures: result.violations.map((v) => `disallowed ${v.attr} URL: ${v.url}`),
  };
}

const TAG_RE = /<[^>]*>/g;
const STYLE_BLOCK_RE = /<style[\s\S]*?<\/style>/gi;
// Multi-line HTML comments (shell header docs, mso conditional blocks) are not
// visible text — their numbers (600px max, 375px, PixelsPerInch 96) never reach
// a recipient's eyes and must not trip the gate.
const COMMENT_RE = /<!--[\s\S]*?-->/g;
const URL_RE = /https?:\/\/[^\s"'<>]+/gi;

/** Normalize a numeric token for comparison: strip $ , % and whitespace. */
function normNum(s: string): string {
  return s.replace(/[$,%\s]/g, "");
}

/**
 * Gate 4 — no-invention on OUTPUT: every visible number (2+ digits) in the built
 * HTML must be anchored to a figure the content produced. Operates on visible
 * text only (style blocks, tags/attributes, and URLs stripped), so px sizes and
 * hex colors never false-positive.
 */
export function anchoredNumbersGate(
  html: string,
  anchors: ReadonlyArray<string | number>,
): GateResult {
  const visible = html
    .replace(COMMENT_RE, " ")
    .replace(STYLE_BLOCK_RE, " ")
    .replace(TAG_RE, " ")
    .replace(URL_RE, " ");
  const anchorSet = new Set<string>();
  for (const a of anchors) {
    const norm = normNum(String(a));
    anchorSet.add(norm);
    // Anchor strings may embed several figures ("Median: $899,000 → $912,000").
    for (const m of norm.matchAll(/\d{2,}(?:\.\d+)?/g)) anchorSet.add(m[0]);
  }
  const failures: string[] = [];
  for (const m of visible.matchAll(/\d[\d,.$]*/g)) {
    const token = normNum(m[0]).replace(/\.$/, "");
    if (token.length < 2) continue; // single digits ("9 AM") are copy, not figures
    if (!/^\d/.test(token)) continue;
    if (anchorSet.has(token)) continue;
    // Split "1,240,000"-style groupings already normalized; also allow date parts of an anchored date.
    if ([...anchorSet].some((a) => a.includes(token))) continue;
    failures.push(`unanchored number in output: ${token}`);
  }
  return { ok: failures.length === 0, failures: [...new Set(failures)] };
}

/** Run all four gates; failures concatenate. No preview/send decision here — the runner owns that. */
export async function preSendGates(
  html: string,
  content: DemoTouchContent,
  brand: { primary?: string | null; accent?: string | null; logoUrl?: string | null },
  opts: {
    fetchImpl?: typeof fetch;
    extraAnchors?: Array<string | number>;
    extraRoots?: unknown[];
  } = {},
): Promise<GateResult> {
  const results = [
    brandHexGate(html, brand),
    await logoGate(brand.logoUrl, opts.fetchImpl),
    // Brand rides in the allowlist roots — the hosted logo URL is a legitimate src.
    urlGate(html, content, [brand, ...(opts.extraRoots ?? [])]),
    anchoredNumbersGate(html, [...content.anchors, ...(opts.extraAnchors ?? [])]),
  ];
  const failures = results.flatMap((r) => r.failures);
  return { ok: failures.length === 0, failures };
}
