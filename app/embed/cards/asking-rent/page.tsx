import fs from "node:fs/promises";
import path from "node:path";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import {
  HBarChart,
  type HBarCorridor,
  type HBarTier,
} from "@/components/charts/HBarChart";
import type { CorridorEntry } from "@/types/viz";

export const dynamic = "force-static";
export const revalidate = 3600;

const TOP_N = 5;
const BOTTOM_N = 2;
const BULLISH_MULTIPLIER = 1.2;
const BEARISH_MULTIPLIER = 0.7;
const DETAIL_HREF = "/r/cre-swfl";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

async function loadCorridors(): Promise<CorridorEntry[]> {
  const file = path.join(process.cwd(), "fixtures", "corridor-rents.json");
  const raw = await fs.readFile(file, "utf-8");
  return JSON.parse(raw) as CorridorEntry[];
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function tierFor(value: number, median: number): HBarTier {
  if (value >= median * BULLISH_MULTIPLIER) return "bullish";
  if (value <= median * BEARISH_MULTIPLIER) return "bearish";
  return "neutral";
}

export default async function AskingRentCardPage() {
  const all = await loadCorridors();

  const ranked = all
    .filter(
      (c): c is CorridorEntry & { nnn_asking_rent_per_sqft: number } =>
        typeof c.nnn_asking_rent_per_sqft === "number",
    )
    .sort((a, b) => b.nnn_asking_rent_per_sqft - a.nnn_asking_rent_per_sqft);

  const total = ranked.length;
  const marketValues = ranked.map((c) => c.nnn_asking_rent_per_sqft);
  const marketMedian = medianOf(marketValues);
  const marketRange = {
    min: marketValues[marketValues.length - 1],
    max: marketValues[0],
  };

  const top = ranked.slice(0, TOP_N);
  const bottom = ranked.slice(-BOTTOM_N);
  const shown = [...top, ...bottom];

  const corridors: HBarCorridor[] = shown.map((c) => ({
    name: c.name,
    value: c.nnn_asking_rent_per_sqft,
    tier: tierFor(c.nnn_asking_rent_per_sqft, marketMedian),
  }));

  return (
    <main
      className={`${plexSans.variable} ${plexMono.variable}`}
      style={{
        background: "#0f1923",
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily:
          "var(--font-plex-sans), ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <HBarChart
        title="Asking rent (NNN, $/sqft)"
        corridors={corridors}
        median={marketMedian}
        range={marketRange}
        eyebrow={`${corridors.length} of ${total} corridors`}
        separatorAfter={TOP_N}
        separatorLabel={`${BOTTOM_N} lowest of ${total}`}
        detailHref={DETAIL_HREF}
        detailLabel={`View all ${total} corridors →`}
      />
    </main>
  );
}
