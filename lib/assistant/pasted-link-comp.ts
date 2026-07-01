// lib/assistant/pasted-link-comp.ts
//
// Increment 3 of the on-demand comp helper: a user who pastes a listing link in an
// authenticated conversation gets that property folded in as one cited comp. Gated to
// analyst (authenticated) users — `allowFetch` is threaded in by the caller from
// `analyst`, never read from an ambient flag, so the guard can't be silently bypassed
// by a future caller. Every failure mode (fetch not permitted / fetch failed / no price
// / zip missing / zip outside Lee-Collier) resolves to a needs[] ask, never a guess —
// the same no-invention floor as compHelper.
import { looksLikeCompAsk } from "./comp-helper";
import type { CompDeps, PriceKind, RenderComp } from "./comp-helper";
import { extractUrls } from "@/lib/email/og-image";
import { fetchListingFacts, type ListingFacts } from "@/lib/email/listing-scrape";
import { hostOf } from "@/lib/assistant/web-fallback";
import { resolveZip } from "@/refinery/lib/zip-resolver.mts";
import type { WelcomeSource } from "@/lib/welcome/frames";

const CANT_OPEN =
  "I can't open links directly here — reply with the address and price and I'll add it as a comp.";
const COULDNT_READ =
  "I couldn't read that link — reply with the address and price and I'll add it as a comp.";
const OUT_OF_FOOTPRINT =
  "I couldn't confirm that's a Lee or Collier property with a price — reply with the address and price and I'll add it as a comp.";

/** Cheap gate: comp-ish wording (looksLikeCompAsk) AND at least one pasted URL. A bare
 *  link with no comp-ish wording does not trigger this lane in v1 (documented
 *  limitation — the message still gets a normal answer, never a silent drop). */
export function looksLikePastedListingLink(question: string): boolean {
  return looksLikeCompAsk(question) && extractUrls(question).length > 0;
}

/** "$650,000" / "3" -> a number; undefined/unparseable -> null. Never invents a value. */
function numOrNull(s: string | undefined): number | null {
  if (!s) return null;
  const digits = s.replace(/[^0-9.]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

/** The one WelcomeSource this lane ever emits: the listing site's homepage, never the
 *  pasted permalink. `domain` (www-stripped) mirrors compSources()'s label convention;
 *  `url` keeps the page's real hostname verbatim (may or may not carry "www"). */
function homepageSource(sourceUrl: string): WelcomeSource {
  const u = new URL(sourceUrl);
  const domain = hostOf(sourceUrl);
  return { label: domain, domain, url: `${u.protocol}//${u.hostname}` };
}

/** A scraped listing page price is a current ask, never a confirmed sale — always
 *  priceKind:"last_list", never a sold price. */
function toRenderComp(facts: ListingFacts): RenderComp {
  const priceKind: PriceKind = "last_list";
  return {
    addressLine: facts.address ?? facts.city ?? "",
    city: facts.city ?? "",
    beds: numOrNull(facts.beds),
    baths: numOrNull(facts.baths),
    sqft: numOrNull(facts.sqft),
    status: "active",
    price: numOrNull(facts.price),
    priceKind,
    priceDate: null,
  };
}

export interface PastedLinkResult {
  comp: RenderComp | null;
  source: WelcomeSource | null;
  needs: string[];
}

/**
 * Run the pasted-link comp lane for one question. Fetch-free by construction unless
 * `allowFetch` is true (the caller resolves this from `analyst`) — a public/
 * unauthenticated caller can never trigger a network call, even if this function is
 * reached by mistake. Never throws.
 */
export async function pastedLinkComp(
  question: string,
  allowFetch: boolean,
  deps: CompDeps = {},
): Promise<PastedLinkResult> {
  const none = (needs: string[] = []): PastedLinkResult => ({ comp: null, source: null, needs });

  if (!looksLikePastedListingLink(question)) return none();
  if (!allowFetch) return none([CANT_OPEN]);

  const [url] = extractUrls(question);
  const fetchFacts = deps.fetchPastedFacts ?? fetchListingFacts;
  const facts = await fetchFacts(url);
  if (!facts || !facts.price) return none([COULDNT_READ]);

  if (!facts.zip) return none([OUT_OF_FOOTPRINT]);
  const county = resolveZip(facts.zip).primary_county;
  if (county !== "12071" && county !== "12021") return none([OUT_OF_FOOTPRINT]);

  return { comp: toRenderComp(facts), source: homepageSource(facts.sourceUrl), needs: [] };
}
