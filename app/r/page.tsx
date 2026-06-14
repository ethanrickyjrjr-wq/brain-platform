import Link from "next/link";
import { ReportShell, ReportHeader, ReportFooter } from "./_components/report-shell";
import { LocationSearchBox } from "./_components/location-ui";

export const dynamic = "force-static";

export const metadata = {
  title: "Search Southwest Florida — SWFL Data Gulf",
  description:
    "Type any Southwest Florida location — ZIP, city, address, corridor, or county — and see every dataset that covers it, at the grain we hold it.",
};

const EXAMPLES: { label: string; q: string }[] = [
  { label: "33931 — Fort Myers Beach", q: "33931" },
  { label: "Naples", q: "Naples" },
  { label: "Bonita Springs", q: "Bonita Springs" },
  { label: "Lee County", q: "Lee County" },
  { label: "North Naples", q: "North Naples" },
];

export default function ReportIndexPage() {
  return (
    <ReportShell width="2xl">
      <ReportHeader title="Search Southwest Florida">
        <p className="mt-3 max-w-xl text-base leading-7 text-gray-300">
          Type a ZIP, city, address, corridor, or county. We&rsquo;ll show every dataset that covers
          it — housing, flood risk, permits, traffic, jobs, and more — at the level we actually hold
          it, never finer.
        </p>
        <div className="mt-6">
          <LocationSearchBox autoFocus />
        </div>
      </ReportHeader>

      <section className="mt-8">
        <p className="text-xs uppercase tracking-wider text-gray-500">Try one</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <Link
              key={e.q}
              href={`/r/search?q=${encodeURIComponent(e.q)}`}
              className="rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-sm text-gray-200 transition-colors hover:border-[#0a8078]/50 hover:text-white"
            >
              {e.label}
            </Link>
          ))}
        </div>
      </section>

      <ReportFooter note="We cover the six-county Southwest Florida footprint — Lee, Collier, Charlotte, Glades, Hendry, and Sarasota." />
    </ReportShell>
  );
}
