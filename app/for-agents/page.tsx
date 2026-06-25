import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";

export const metadata: Metadata = {
  title: "For Agents",
  description:
    "A member-only market-intelligence workspace for licensed real estate agents in Southwest Florida. Every number is computed in code and tied to its source — never invented by an AI.",
};

const STEPS = [
  {
    n: "1",
    title: "Sign in",
    body: "Create your account with a one-time code sent to your email. No password to manage.",
  },
  {
    n: "2",
    title: "Connect your MLS",
    body: "Enter the MLS ID from your license. You see data scoped to your own membership — nothing more.",
  },
  {
    n: "3",
    title: "Work from real numbers",
    body: "Inventory, days on market, price trends, absorption, and price per square foot — answered from current data, every figure sourced.",
  },
];

const DIFFERENTIATORS = [
  {
    title: "Computed, not guessed",
    body: "Market math is calculated deterministically in code. The AI only turns the finished numbers into plain language — it never produces the figures itself. That removes the hallucination and drift that make AI untrustworthy for real decisions.",
  },
  {
    title: "Every number is cited",
    body: "Each figure names its source — our data, a named public dataset, or your own MLS. Nothing is a hedge-encoded estimate. If we can't source it, we don't state it.",
  },
  {
    title: "More than listings",
    body: "We combine licensed real-estate data with FEMA flood, FRED economics, freight, and county records, so you get the full Southwest Florida picture in one read.",
  },
];

const RESPONSIBILITY = [
  [
    "Member-only",
    "MLS data is shown only to verified, signed-in members. It is never exposed to the public.",
  ],
  [
    "Scoped to you",
    "You see data tied to your own MLS membership — not a redistributed feed of everyone's listings.",
  ],
  ["Attribution preserved", "Every metric keeps its source-MLS attribution intact."],
  [
    "No redistribution",
    "We do not resell or republish raw listing feeds as a standalone data product.",
  ],
  [
    "License-respecting",
    "We honor each data provider's license terms, including domain and IP restrictions and retention limits.",
  ],
];

export default function ForAgentsPage() {
  return (
    <PageShell width="content" className="py-16 leading-relaxed">
      {/* Hero */}
      <header className="max-w-2xl">
        <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          For licensed real estate agents
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">
          Southwest Florida market intelligence you can stand behind.
        </h1>
        <p className="mt-4 text-lg text-neutral-600 dark:text-neutral-300">
          A member-only workspace for licensed agents in Lee, Collier, Charlotte, Sarasota, Glades,
          and Hendry counties. Every number is computed in code and tied to its source — nothing is
          estimated or invented by an AI.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            href="/login"
            className="rounded-md bg-black px-5 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            Sign in
          </Link>
          <Link href="/settings/mls" className="text-sm font-medium underline underline-offset-4">
            Connect your MLS
          </Link>
        </div>
      </header>

      {/* How it works */}
      <section className="mt-20">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="rounded-lg border border-black/[.08] p-5 dark:border-white/[.145]"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900 text-sm font-semibold text-white dark:bg-white dark:text-black">
                {s.n}
              </div>
              <h3 className="mt-4 font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Why it's different */}
      <section className="mt-20">
        <h2 className="text-2xl font-semibold tracking-tight">Why agents trust the numbers</h2>
        <div className="mt-6 space-y-4">
          {DIFFERENTIATORS.map((d) => (
            <div
              key={d.title}
              className="rounded-lg border border-black/[.08] p-5 dark:border-white/[.145]"
            >
              <h3 className="font-semibold">{d.title}</h3>
              <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{d.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Data responsibility */}
      <section className="mt-20">
        <h2 className="text-2xl font-semibold tracking-tight">How we handle MLS data</h2>
        <p className="mt-3 max-w-2xl text-neutral-600 dark:text-neutral-300">
          Access to MLS-sourced data is gated to verified members and governed by each board&rsquo;s
          license. We built the platform to keep that data inside the wall, not pipe it to the
          public.
        </p>
        <dl className="mt-6 divide-y divide-black/[.08] dark:divide-white/[.145]">
          {RESPONSIBILITY.map(([term, def]) => (
            <div key={term} className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr] sm:gap-6">
              <dt className="font-semibold">{term}</dt>
              <dd className="text-sm text-neutral-600 dark:text-neutral-400">{def}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Closing CTA */}
      <section className="mt-20 rounded-xl border border-black/[.08] bg-neutral-50 p-8 dark:border-white/[.145] dark:bg-neutral-950">
        <h2 className="text-2xl font-semibold tracking-tight">Ready to connect?</h2>
        <p className="mt-2 max-w-xl text-neutral-600 dark:text-neutral-300">
          Sign in, connect your MLS, and start working from data you can cite.
        </p>
        <div className="mt-6">
          <Link
            href="/login"
            className="rounded-md bg-black px-5 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            Sign in
          </Link>
        </div>
        <p className="mt-6 text-sm text-neutral-500">
          Serving Lee, Collier, Charlotte, Sarasota, Glades, and Hendry counties.
        </p>
      </section>
    </PageShell>
  );
}
