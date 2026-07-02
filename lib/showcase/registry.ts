/**
 * Client-safe showcase registry for the pill panel (and, later, the homepage).
 * Display metadata + committed asset paths ONLY — no server imports, no fs, so
 * it's safe in the browser bundle (mirrors the old example-cards.ts contract).
 * Asset existence is guarded by registry.test.ts; slide order mirrors
 * scripts/capture-showcase.mjs. The tier/CTA slide is NOT listed here — the
 * overlay appends it as the final step.
 */

export interface ShowcaseSlide {
  /** Root-relative committed capture, e.g. "/showcase/<id>/step-1.webp". */
  image: string;
  title: string;
  /** What this piece does in the campaign. */
  whatsHappening: string;
  /** The concrete mechanics of how the AI built it. */
  howAiHandled: string;
  /** Optional "see the real email" target (root-relative, served from public/). */
  liveHref?: string;
  /** Optional named-source practice receipt, rendered as a footnote. */
  receipt?: string;
}

export interface Showcase {
  id: string;
  company: string;
  title: string;
  hook: string;
  /** Brand accent color for the card border + step rail highlight. */
  accent: string;
  thumb: string;
  disclosure: string;
  slides: ShowcaseSlide[];
}

export const SHOWCASES: Showcase[] = [
  {
    id: "listing-to-close",
    company: "Latitude 26 Estates · Naples",
    title: "Listing → Close: The Auto Email Plan",
    hook: "Five emails carry one $14.8M listing from teaser to sold — every number sourced.",
    accent: "#B98F45",
    thumb: "/showcase/listing-to-close/thumb.webp",
    disclosure:
      "Demonstration campaign — Latitude 26 Estates and its agent are fictional. The property, comp, and market data are real — SWFL Data Gulf (07/01/2026).",
    slides: [
      {
        image: "/showcase/listing-to-close/step-1.webp",
        title: "Coming Soon",
        whatsHappening:
          "The teaser builds a private-preview list before the sign goes up — scarcity first, address held back.",
        howAiHandled:
          "Counted the live for-sale inventory and found the angle itself: only 156 of Collier's 8,067 active homes sit at $10M+.",
        liveHref: "/showcase/listing-to-close/live/01-coming-soon.html",
      },
      {
        image: "/showcase/listing-to-close/step-2.webp",
        title: "New Listing",
        whatsHappening:
          "The full reveal: specs, price per square foot, and the neighborhood's home-value trend line.",
        howAiHandled:
          "Charted the ZIP's value index and wrote the honest read — the reset has stopped resetting — instead of a hype line.",
        liveHref: "/showcase/listing-to-close/live/02-new-listing.html",
      },
      {
        image: "/showcase/listing-to-close/step-3.webp",
        title: "Market Comps",
        whatsHappening:
          "Six live comparable estates with photos, links, and a price bar chart — the evidence email.",
        howAiHandled:
          "Picked six live comps in the same ZIP and computed each $/sq ft in code, then argued the premium straight: the case is the land.",
        liveHref: "/showcase/listing-to-close/live/03-comps.html",
        receipt: "Numbers, not adjectives — every figure traces to the listing feed snapshot.",
      },
      {
        image: "/showcase/listing-to-close/step-4.webp",
        title: "Under Contract",
        whatsHappening:
          "Momentum, made public: pending in 90 days while rival estates sit at 238 and 279 days.",
        howAiHandled:
          "Corroborated the story with the ZIP's own numbers — 85 pendings, 31 of them at $2M+ — to convert losing bidders into backup offers.",
        liveHref: "/showcase/listing-to-close/live/04-pending.html",
      },
      {
        image: "/showcase/listing-to-close/step-5.webp",
        title: "Sold",
        whatsHappening:
          "The closing announcement, set against that week's real wave of Naples estate sales — and it ends on a private-valuation ask.",
        howAiHandled:
          "Placed the close inside the actual sale wave it belonged to, then turned proof into the next lead.",
        liveHref: "/showcase/listing-to-close/live/05-sold.html",
      },
    ],
  },
  {
    id: "launch-blitz",
    company: "Cast & Coast Realty · Cape Coral",
    title: "Launch Weekend: Listing + Social Blitz",
    hook: "One mid-market listing launches with an agent-brand email and four social formats — same real numbers everywhere.",
    accent: "#0E7C86",
    thumb: "/showcase/launch-blitz/thumb.webp",
    disclosure:
      "Demonstration campaign — Cast & Coast Realty and Dani Vero are fictional (her portrait is AI-generated). The property, ZIP, and market data are real — SWFL Data Gulf listing feed (07/01/2026) and the linked listing detail page (07/02/2026).",
    slides: [
      {
        image: "/showcase/launch-blitz/step-1.webp",
        title: "Agent Brand Intro",
        whatsHappening:
          "A completely different brand and voice: the data-first Cape agent, introduced over the ZIP-by-ZIP asking-price chart and this weekend's launch.",
        howAiHandled:
          "Pulled the six Cape ZIP medians from 2,551 live listings, built the chart in the brand's own palette, and anchored it to a real $620,000 launch.",
        liveHref: "/showcase/launch-blitz/live/agent-intro.html",
        receipt:
          "One CTA per email — “give readers three things to click and they often click nothing” (Luxury Presence, 2026).",
      },
      {
        image: "/showcase/launch-blitz/step-2.webp",
        title: "Social Pack — 4 Formats",
        whatsHappening:
          "The same launch, cut for social: square feed, landscape link post, portrait feed, and 9:16 story — generated together with the email.",
        howAiHandled:
          "Led every caption with a data hook and mixed local + broad hashtags; the market chart travels into the link post unchanged.",
        liveHref: "/showcase/launch-blitz/live/social-pack.html",
        receipt:
          "Data-hook first lines and a local + broad hashtag mix are the current lead-generating pattern for agent social (The Close, 2026).",
      },
    ],
  },
  {
    id: "market-pulse",
    company: "Meridian South Advisory · Fort Myers",
    title: "The Market Pulse: Set It Once",
    hook: "Type the ask once — the monthly brief and its socials rebuild themselves from fresh data.",
    accent: "#C4551A",
    thumb: "/showcase/market-pulse/thumb.webp",
    disclosure:
      "Demonstration campaign — Meridian South Advisory is fictional. Every number is real — Zillow Home Value Index (through 05/31/2026) and SWFL Data Gulf listing feed (07/01/2026).",
    slides: [
      {
        image: "/showcase/market-pulse/step-1.webp",
        title: "The Ask",
        whatsHappening:
          "The entire setup is one typed sentence and a schedule — no template picking, no data wrangling.",
        howAiHandled:
          "Reads the ask, locks the schedule, and takes over sourcing, charting, and writing from here.",
        liveHref: "/showcase/market-pulse/live/ask.html",
      },
      {
        image: "/showcase/market-pulse/step-2.webp",
        title: "The Pulse Email",
        whatsHappening:
          "The monthly brief lands: every Fort Myers ZIP's April-to-May move, the market snapshot, and one honest read.",
        howAiHandled:
          "Computed all ten ZIP deltas in code, named the largest mover, and kept the voice factual — drifting, not dropping.",
        liveHref: "/showcase/market-pulse/live/pulse-email.html",
        receipt:
          "Market-update newsletters are the top-performing real-estate email type; single column, one CTA, subject under 40 characters (Luxury Presence, 2026).",
      },
      {
        image: "/showcase/market-pulse/step-3.webp",
        title: "The Social Cut",
        whatsHappening:
          "The same pulse, cut for feeds — the headline stat as a square card, the three-ZIP comparison as a link post.",
        howAiHandled:
          "Chose the single most clickable fact (the biggest ZIP move) for the square and kept every value identical to the email's.",
        liveHref: "/showcase/market-pulse/live/socials.html",
        receipt:
          "Serialized, recurring content keeps audiences returning — 57% of consumers want original series (Sprout Social, 2026).",
      },
      {
        image: "/showcase/market-pulse/step-4.webp",
        title: "Proof It Updates",
        whatsHappening:
          "April's edition next to May's: the highlighted values changed by themselves when the new month landed.",
        howAiHandled:
          "Rebuilt the brief from the fresh vintage — prose, chart, and source list — with zero keystrokes from the agent.",
        liveHref: "/showcase/market-pulse/live/vintages.html",
      },
    ],
  },
];
