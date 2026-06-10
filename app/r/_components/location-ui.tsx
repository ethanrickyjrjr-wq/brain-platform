import Link from "next/link";
import type { ReactNode } from "react";
import { Chip, SectionTitle } from "./report-shell";
import type { LocationDossierLine } from "../../../lib/zip-dossier";
import type { IdentityModel } from "../../../lib/location-surface";

/**
 * §D3 human-surface chrome — the pieces a person sees BEFORE any metric.
 *
 * All server components (a plain GET <form>, presentational cards). The page
 * decisions live in the pure, tested `lib/location-surface.ts`; these only
 * render. Copy here is customer-clean: no "grain", no brain ids, no jargon.
 */

/** One search box, any input. Plain GET form → /r/search → resolveLocation.
 *  Works with JS off; a human's first move is typing, not crafting a URL. */
export function LocationSearchBox({
  defaultValue = "",
  placeholder = "ZIP, city, address, or county — e.g. 33931, Naples, Lee County",
  autoFocus = false,
}: {
  defaultValue?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <form action="/r/search" method="get" role="search" className="flex w-full gap-2">
      <input
        type="text"
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-label="Search a Southwest Florida location"
        autoComplete="off"
        autoFocus={autoFocus}
        className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-gray-500 focus:border-[#00d4aa]/60 focus:outline-none focus:ring-1 focus:ring-[#00d4aa]/40"
      />
      <button
        type="submit"
        className="btn-gradient inline-flex shrink-0 items-center rounded-lg px-5 py-3 text-sm font-semibold text-navy-dark transition-all hover:opacity-90"
      >
        Search
      </button>
    </form>
  );
}

/** The "where" confirmation — place · county · barrier — before any number. */
export function IdentityCard({ identity }: { identity: IdentityModel }) {
  return (
    <section className="mt-6 rounded-xl glass-card-modern border border-white/10 px-5 py-4">
      <h2 className="text-2xl font-semibold tracking-tight text-white">{identity.headline}</h2>
      {identity.subline && <p className="mt-1 text-sm text-gray-400">{identity.subline}</p>}
    </section>
  );
}

/** Plain-language coverage chips — "ZIP-level · County-wide · Region-wide".
 *  Never the word "grain". */
export function GrainChips({ chips }: { chips: { grain: string; label: string }[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wider text-gray-500">Coverage</span>
      {chips.map((c) => (
        <Chip key={c.grain}>{c.label}</Chip>
      ))}
    </div>
  );
}

/** A non-literal resolve, made visible + correctable (search again). */
export function DidYouMeanBanner({ message }: { message: string }) {
  return (
    <div className="mt-4 rounded-lg border border-[#d4b370]/30 bg-[#d4b370]/10 px-4 py-2.5 text-sm text-[#e7cf95]">
      {message}
    </div>
  );
}

/** A teal-vs-blue source link (teal = our lake, blue = outside web). */
function CardSourceLink({ url, label }: { url: string; label: string }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[#00d4aa] underline decoration-[#00d4aa]/40 underline-offset-2 hover:decoration-[#00d4aa]"
    >
      {label || "Source"}
    </a>
  );
}

/**
 * The county/metro/region rollup cards — every labeled "covers {place}" read,
 * BELOW the true-ZIP headline. Each card leads with its honest coverage label
 * so a county figure can never be misread as a ZIP-specific number.
 */
export function DossierCards({
  title = "Across the wider area",
  lines,
}: {
  title?: ReactNode;
  lines: LocationDossierLine[];
}) {
  if (lines.length === 0) return null;
  return (
    <section className="mt-10">
      <SectionTitle>{title}</SectionTitle>
      <div className="mt-4 space-y-3">
        {lines.map((l) => (
          <div
            key={l.brain_id}
            className="rounded-xl glass-card-modern border border-white/10 px-4 py-3"
          >
            <p className="text-xs font-medium uppercase tracking-wider text-[#00d4aa]">
              {l.coverage_label}
            </p>
            <p className="mt-1.5 text-sm leading-6 text-gray-200">{l.text}</p>
            {l.source_url && (
              <p className="mt-2 text-xs text-gray-500">
                <CardSourceLink url={l.source_url} label={l.source_citation} />
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** A friendly out-of-scope page — NEVER a bare 404 for a typed query. */
export function OutOfScopePanel({ query }: { query?: string }) {
  return (
    <section className="mt-8 rounded-xl glass-card-modern border border-white/10 px-6 py-8 text-center">
      <h2 className="text-xl font-semibold text-white">Outside our coverage</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-gray-400">
        {query ? (
          <>
            We couldn&rsquo;t place <span className="text-gray-200">&ldquo;{query}&rdquo;</span> in
            Southwest Florida.{" "}
          </>
        ) : null}
        We cover Southwest Florida — Lee &amp; Collier counties and their neighbors. Try a ZIP,
        city, or address.
      </p>
      <div className="mx-auto mt-5 max-w-lg">
        <LocationSearchBox defaultValue={query ?? ""} />
      </div>
      <p className="mt-4 text-xs text-gray-600">
        Examples:{" "}
        <Link href="/r/search?q=33931" className="text-[#00d4aa] hover:underline">
          33931
        </Link>{" "}
        ·{" "}
        <Link href="/r/search?q=Naples" className="text-[#00d4aa] hover:underline">
          Naples
        </Link>{" "}
        ·{" "}
        <Link href="/r/search?q=Lee%20County" className="text-[#00d4aa] hover:underline">
          Lee County
        </Link>
      </p>
    </section>
  );
}
