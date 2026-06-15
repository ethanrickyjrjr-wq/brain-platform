/**
 * Client-safe example-card metadata for the logged-out pill panel (A-5). Just the
 * display fields + the /p/<id> slug — NO server imports, so it's safe in the browser
 * bundle (lib/deliverable/examples.ts pulls the Anthropic SDK and must NOT be
 * imported client-side). The ids MUST match the build scenarios in
 * lib/deliverable/examples.ts (cross-checked in examples.test.ts) so every card opens
 * a real, cron-rebuilt /p/example-* deliverable.
 */

export interface ExampleCard {
  /** Matches EXAMPLE_SCENARIOS[].id and the /p/<id> slug. */
  id: string;
  title: string;
  blurb: string;
}

export const EXAMPLE_CARDS: ExampleCard[] = [
  {
    id: "example-one-pager",
    title: "SWFL Housing One-Pager",
    blurb: "Median price, velocity & supply",
  },
  {
    id: "example-market-overview",
    title: "SWFL Market Overview",
    blurb: "County unemployment & wages",
  },
  {
    id: "example-bov-lite",
    title: "Commercial BOV (lite)",
    blurb: "Cap rates, vacancy, asking rent",
  },
  {
    id: "example-client-email",
    title: "Workforce Demand Email",
    blurb: "Top sectors & construction labor",
  },
];
