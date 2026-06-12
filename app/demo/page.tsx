import { CorridorRentChart, ZHVIAreaChart } from "@/components/charts";
import corridorRents from "@/fixtures/corridor-rents.json";
import zhviTrend from "@/fixtures/zhvi-trend.json";
import brainOutput from "@/fixtures/brain-output.json";
import stats from "@/fixtures/stats.json";
import type {
  CorridorEntry,
  JoinedCorridorRow,
  ZHVIMonth,
  ZHVITrendEntry,
  BrainOutput,
  VizStats,
} from "@/types/viz";

// Static fixture data — swap these imports for live fetch() calls
// when the Fiverr components are wired to the real API. Demo page renders
// the rent chart only; permits / centroid join is the embed page's job.
const corridorData: JoinedCorridorRow[] = (corridorRents as CorridorEntry[]).map((row) => ({
  ...row,
  permits: null,
  centroid: null,
}));
const zhviData = (zhviTrend as ZHVIMonth[]).filter(
  (row): row is ZHVITrendEntry =>
    row.cape_coral !== null && row.fort_myers !== null && row.naples !== null,
);
const brainData = brainOutput as BrainOutput;
const statsData = stats as VizStats;

export default function DemoPage() {
  return (
    <main className="min-h-dvh bg-[#0A1419] text-[#F0EDE6]">
      {/* SECTION 1 — Hero (DataStreamBg + headline) */}
      <section className="flex min-h-dvh flex-col items-center justify-center px-6">
        <p className="mb-4 font-mono text-xs uppercase tracking-widest text-[#3DC9C0]">
          Intelligence · {statsData.data_sources} verified sources
        </p>
        <h1 className="max-w-3xl text-center text-5xl font-semibold leading-tight tracking-tight">
          Real data makes AI real.
        </h1>
        <p className="mt-6 max-w-xl text-center text-lg text-[#B8B4A8]">
          {statsData.corridors_tracked} corridors. {statsData.swfl_zips} ZIP codes.{" "}
          {statsData.flood_records.toLocaleString()} flood records. One verified answer.
        </p>
        <p className="mt-4 font-mono text-xs text-[#807E76]">
          Confidence: {statsData.brain_confidence}% · {brainData.freshness_token}
        </p>
      </section>

      {/* SECTION 2 — Brain output conclusion */}
      <section className="border-t border-[#22414F] px-6 py-24">
        <div className="mx-auto max-w-2xl">
          <p className="mb-3 font-mono text-xs uppercase tracking-widest text-[#807E76]">
            Current conclusion
          </p>
          <p className="text-xl leading-relaxed text-[#F0EDE6]">{brainData.conclusion}</p>
          <div className="mt-4 flex gap-6">
            {brainData.caveats.map((c, i) => (
              <p key={i} className="text-xs text-[#807E76]">
                ⚠ {c}
              </p>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 3 — NNN Corridor Chart */}
      <section className="border-t border-[#22414F] px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <p className="mb-2 font-mono text-xs uppercase tracking-widest text-[#807E76]">
            Commercial corridors
          </p>
          <h2 className="mb-8 text-2xl font-semibold">NNN Asking Rent by Corridor</h2>
          <CorridorRentChart data={corridorData} />
          <p className="mt-3 font-mono text-xs text-[#807E76]">
            Source: SWFL corridor_profiles · Supabase · May 2026
          </p>
        </div>
      </section>

      {/* SECTION 4 — ZHVI Trend Chart */}
      <section className="border-t border-[#22414F] px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <p className="mb-2 font-mono text-xs uppercase tracking-widest text-[#807E76]">
            Home values
          </p>
          <h2 className="mb-8 text-2xl font-semibold">
            36-Month ZHVI Trend — Cape Coral · Fort Myers · Naples
          </h2>
          <ZHVIAreaChart data={zhviData} />
          <p className="mt-3 font-mono text-xs text-[#807E76]">
            Source: Zillow ZHVI · ZIP 33914 / 33908 / 34103 · Apr 2026
          </p>
        </div>
      </section>

      {/* SECTION 5 — Key Metrics Grid */}
      <section className="border-t border-[#22414F] px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <p className="mb-2 font-mono text-xs uppercase tracking-widest text-[#807E76]">
            Key metrics
          </p>
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3">
            {brainData.key_metrics.map((m) => (
              <div key={m.label} className="rounded border border-[#22414F] bg-[#152832] p-5">
                <p className="text-xs uppercase tracking-wider text-[#807E76]">{m.label}</p>
                <p className="mt-2 font-variant-numeric text-2xl font-semibold tabular-nums">
                  {m.value}
                </p>
                <p
                  className="mt-1 text-xs"
                  data-direction={
                    m.trend === "up" ? "bullish" : m.trend === "down" ? "bearish" : "neutral"
                  }
                >
                  {m.change_pct > 0 ? "+" : ""}
                  {m.change_pct}% vs prior period
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
