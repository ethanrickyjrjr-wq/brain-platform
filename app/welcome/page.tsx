import type { Metadata } from "next";
import { SWFL_BRAND_PRIMARY, SWFL_BRAND_SECONDARY } from "@/lib/templates/manifest";
import { safeLogoUrl } from "@/lib/welcome/logo-allowlist";
import { resolveZip } from "@/refinery/lib/zip-resolver.mts";
import WelcomeChat from "./WelcomeChat";
import { OpenProjectCta } from "./_components/OpenProjectCta";

export const metadata: Metadata = {
  title: "Welcome — SWFL Data Gulf",
};

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
function safeHex(value: string | undefined, fallback: string): string {
  return value && HEX_RE.test(value) ? value : fallback;
}
function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Personalized arrival page.
 *
 * Reads `?name=&primary=&secondary=&logo=` (produced by buildArrivalUrl in
 * Phase 2's prospect-enrichment flow). Brand colors are injected as CSS vars on
 * the page wrapper; everything falls back to SWFL defaults when params are absent.
 *
 * The ZIP hero drives the grounded answer (cited metric cards — fixture frames via
 * /api/welcome/demo under ?demo=1, else the live /api/welcome/chat grounding); the
 * conversational chat carries the recurring-email hook. Conversion routes to /billing.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const name = first(params.name);
  const rawPrimary = first(params.primary);
  const rawSecondary = first(params.secondary);
  const primary = safeHex(rawPrimary, SWFL_BRAND_PRIMARY);
  const secondary = safeHex(rawSecondary, SWFL_BRAND_SECONDARY);
  const logo = safeLogoUrl(first(params.logo));
  const demo = first(params.demo) === "1";

  // Funnel arrival (G-F1): a prospect lands with `?zip=` carrying their scope. When
  // it's in the 6-county MOAT, reframe the page as "your project, ready to act on" —
  // an action-first offer + the Projects handoff, not a generic market-read demo.
  const zipRaw = first(params.zip);
  const zip = zipRaw && /^\d{5}$/.test(zipRaw) ? zipRaw : undefined;
  const zipRes = zip ? resolveZip(zip) : null;
  const offerPlace = zipRes?.in_scope ? (zipRes.places[0]?.place ?? null) : null;

  return (
    <main
      className="mx-auto min-h-dvh max-w-6xl px-6 py-16"
      style={{ "--brand-primary": primary, "--brand-secondary": secondary } as React.CSSProperties}
    >
      <header className="mb-10 flex items-center gap-4">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary external prospect logo URL
          <img src={logo} alt={name ? `${name} logo` : "logo"} className="h-10 w-auto" />
        ) : (
          <span className="font-mono text-sm font-semibold tracking-widest text-gulf-teal">
            SWFL DATA GULF
          </span>
        )}
      </header>

      {offerPlace && zip ? (
        <section
          className="rounded-2xl border border-white/10 p-6"
          style={{ backgroundColor: "color-mix(in srgb, var(--brand-primary) 8%, transparent)" }}
        >
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary sm:text-3xl">
            Your {offerPlace} read is ready{name ? `, ${name}` : ""}.
          </h1>
          <p className="mt-3 max-w-xl text-text-secondary">
            Send it to your clients weekly, or make changes — it’s your project, ready to act on.
          </p>
          <OpenProjectCta
            zip={zip}
            name={name}
            primary={rawPrimary}
            secondary={rawSecondary}
            logo={logo ?? undefined}
          />
        </section>
      ) : (
        <>
          <h1 className="text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
            Welcome{name ? `, ${name}` : ""}
          </h1>
          <p className="mt-3 max-w-xl text-text-secondary">
            Ask anything about Southwest Florida real estate, permits, flood risk, freight, or the
            local economy — grounded in live, cited data. Start with a prompt below.
          </p>
        </>
      )}

      <WelcomeChat demo={demo} />
    </main>
  );
}
