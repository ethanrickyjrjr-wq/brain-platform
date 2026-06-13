import type { Metadata } from "next";
import { SWFL_BRAND_PRIMARY, SWFL_BRAND_SECONDARY } from "@/lib/templates/manifest";
import WelcomeChat from "./WelcomeChat";

export const metadata: Metadata = {
  title: "Welcome — SWFL Data Gulf",
};

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
function safeHex(value: string | undefined, fallback: string): string {
  return value && HEX_RE.test(value) ? value : fallback;
}
function safeUrl(value: string | undefined): string | null {
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : null;
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
 * PHASE 1: the chat is a STUB. The four prompt buttons link to /pricing for now.
 * Phase 2 wires them to a live, non-report-scoped /api/welcome/chat endpoint and
 * routes the conversion prompts (2 + 4) through the paywall on the "yes" step.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const name = first(params.name);
  const primary = safeHex(first(params.primary), SWFL_BRAND_PRIMARY);
  const secondary = safeHex(first(params.secondary), SWFL_BRAND_SECONDARY);
  const logo = safeUrl(first(params.logo));

  return (
    <main
      className="mx-auto min-h-dvh max-w-3xl px-6 py-16"
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

      <h1 className="text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
        Welcome{name ? `, ${name}` : ""}
      </h1>
      <p className="mt-3 max-w-xl text-text-secondary">
        Ask anything about Southwest Florida real estate, permits, flood risk, freight, or the local
        economy — grounded in live, cited data. Start with a prompt below.
      </p>

      <WelcomeChat />
    </main>
  );
}
