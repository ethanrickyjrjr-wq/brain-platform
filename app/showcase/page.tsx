import type { Metadata } from "next";
import { ShowcaseGrid } from "./ShowcaseGrid";
import { PageShell } from "@/components/PageShell";

export const metadata: Metadata = {
  title: "Visual Templates — SWFL Data Gulf",
  description:
    "The visual reports SWFL Data Gulf can build with your data — corridor positioning, franchise survival, flood exposure, freight nowcast, seasonal exposure, and storm-year timelines.",
};

export default function ShowcasePage() {
  return (
    <PageShell width="wide" className="py-16">
      <header className="mb-12">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-gulf-teal">
          SWFL Data Gulf · Visual Templates
        </span>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
          What we can build for you
        </h1>
        <p className="mt-3 max-w-2xl text-text-secondary">
          Every card below renders from live SWFL data — real corridors, SBA outcomes, FEMA flood
          layers, FDOT freight. Preview any one with sample data, then ask the AI to build it
          against your scope.
        </p>
      </header>

      <ShowcaseGrid />

      <section className="mt-14 rounded-xl border border-gulf-haze bg-gulf-deep px-6 py-8 text-center">
        <h2 className="text-xl font-semibold text-text-primary">
          Want one of these with your data?
        </h2>
        <p className="mt-2 text-text-secondary">
          Ask the AI — it pulls the live numbers for your ZIP, corridor, or county and fills the
          template for you.
        </p>
        <a
          href="/ask"
          className="mt-5 inline-block rounded-md bg-gulf-teal px-5 py-2.5 font-medium text-text-on-accent transition-opacity hover:opacity-90"
        >
          Ask the AI →
        </a>
      </section>
    </PageShell>
  );
}
