import { redirect } from "next/navigation";
import { resolveLocation } from "../../../refinery/lib/location-resolver.mts";
import { assembleLocationDossier, selectDossierLines } from "../../../lib/zip-dossier";
import {
  searchRoute,
  zipReportHref,
  identityForLocation,
  distinctChips,
} from "../../../lib/location-surface";
import { ReportShell, ReportHeader, ReportFooter } from "../_components/report-shell";
import {
  LocationSearchBox,
  IdentityCard,
  GrainChips,
  DossierCards,
  OutOfScopePanel,
} from "../_components/location-ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ q?: string | string[] }>;
}

function firstParam(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function SearchPage({ searchParams }: PageProps) {
  const q = firstParam((await searchParams).q).trim();

  // Empty box → the search landing.
  if (!q) redirect("/r");

  const loc = await resolveLocation(q);
  const route = searchRoute(loc);

  // A ZIP-resolving query goes to its canonical permalink (clean, shareable),
  // carrying did-you-mean context only when the resolve wasn't literal.
  if (route.kind === "redirect") {
    redirect(zipReportHref(route.zip, route.matched ? { q, matched: route.matched } : undefined));
  }

  // Out of the Southwest Florida footprint — a friendly page, never a 404.
  if (route.kind === "out-of-scope") {
    return (
      <ReportShell width="2xl">
        <ReportHeader title="Search">
          <div className="mt-5">
            <LocationSearchBox defaultValue={q} />
          </div>
        </ReportHeader>
        <OutOfScopePanel query={q} />
        <ReportFooter />
      </ReportShell>
    );
  }

  // County / corridor / region — no single ZIP permalink, so render the dossier
  // inline. /r/search?q=… IS the canonical URL for these.
  const dossier = await assembleLocationDossier(loc);
  const identity = identityForLocation(loc);
  const lines = selectDossierLines(dossier.lines, 2);
  const chips = distinctChips(lines);
  const freshnessToken = Object.values(dossier.freshness_tokens)[0];

  return (
    <ReportShell>
      <ReportHeader title="Southwest Florida data">
        <div className="mt-5">
          <LocationSearchBox defaultValue={q} />
        </div>
      </ReportHeader>

      <IdentityCard identity={identity} />
      <GrainChips chips={chips} />

      <DossierCards title={`What we hold for ${identity.headline}`} lines={lines} />

      {lines.length === 0 && (
        <p className="mt-8 text-sm text-gray-400">
          No covering reads for this area in the lake right now.
        </p>
      )}

      <ReportFooter freshnessToken={freshnessToken} />
    </ReportShell>
  );
}
