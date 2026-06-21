import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Our Data — SWFL Data Gulf",
  description:
    "Southwest Florida property, permits, flood, CRE, labor, and tourism data — every number cited.",
  // Internal reference, never indexed.
  robots: { index: false, follow: false },
};

/**
 * /data-intel — PUBLIC route.
 *
 * This used to render `docs/data-sources/data-intel.md` VERBATIM to the open web — an
 * internal engineering map that leaked vendor contacts, "do not scrape" ToS notes,
 * internal `data_lake.*` table names, `.firecrawl/*` paths, and pipeline-breakage status
 * to anyone (and to search crawlers). That doc is internal-only (see SiteFooter). Until
 * B6 decides this route's fate (keep sanitized / kill / relocate to the ops repo), the
 * public page serves a clean pointer to the real, cited surfaces instead of the internal
 * doc. The doc itself is untouched in the repo for internal reference.
 */
export default function DataIntelPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold text-[var(--gulf-teal)]">
        Our data — every number cited
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-gray-400">
        SWFL Data Gulf covers Lee &amp; Collier counties — property values, permits, flood risk,
        commercial real estate, labor, and tourism — with every figure linked back to its source.
        Explore the live, cited reads:
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-4 text-sm">
        <Link
          href="/r"
          className="rounded-lg border border-white/10 px-4 py-2 text-[var(--gulf-teal)] transition-colors hover:bg-white/5"
        >
          Reports
        </Link>
        <Link
          href="/charts"
          className="rounded-lg border border-white/10 px-4 py-2 text-[var(--gulf-teal)] transition-colors hover:bg-white/5"
        >
          Charts
        </Link>
        <Link
          href="/map"
          className="rounded-lg border border-white/10 px-4 py-2 text-[var(--gulf-teal)] transition-colors hover:bg-white/5"
        >
          Map
        </Link>
        <Link
          href="/ask"
          className="rounded-lg border border-white/10 px-4 py-2 text-[var(--gulf-teal)] transition-colors hover:bg-white/5"
        >
          Ask AI
        </Link>
      </div>
    </main>
  );
}
