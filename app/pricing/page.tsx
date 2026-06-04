import type { Metadata } from "next";
import Link from "next/link";
import stats from "@/fixtures/stats.json";

export const metadata: Metadata = {
  title: "Pricing — SWFL Data Gulf",
  description:
    "Analyst-grade Southwest Florida data in your AI: housing values by ZIP and flood-risk (AAL) exposure for Lee & Collier. $49/mo.",
};

// Willingness-to-pay test (re-sequence move #2). The CTA points at a no-code
// Stripe Payment Link supplied via env so the operator can take the first
// dollar without any billing code shipping. Until the link is set, the CTA
// falls back to a contact mailto (manual access grant). On payment the operator
// issues an MCP bearer token via `MCP_ACCESS_TOKENS` (see app/api/mcp/auth.ts).
const PAYMENT_LINK = process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK;
const PRICE_USD = 49;

const INCLUDED = [
  `Home values by ZIP across all ${stats.swfl_zips} Lee & Collier ZIP codes`,
  `Flood-risk exposure (average annual loss) from ${stats.flood_records.toLocaleString()} FEMA NFIP records`,
  `${stats.corridors_tracked} commercial corridors with NNN asking rents`,
  "Answers in your AI — Claude, ChatGPT, Cursor — via one MCP connection",
  "Every number cited to source, freshness-stamped, no hallucinated figures",
];

export default function PricingPage() {
  return (
    <main className="min-h-dvh bg-[#0A1419] text-[#F0EDE6]">
      <section className="mx-auto flex max-w-3xl flex-col items-center px-6 py-24 text-center">
        <p className="mb-4 font-mono text-xs uppercase tracking-widest text-[#3DC9C0]">
          Southwest Florida · Lee &amp; Collier
        </p>
        <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
          The SWFL data your clients ask about — answered in your AI.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-[#B8B4A8]">
          Home values down to the ZIP and flood-risk exposure for any address in
          Lee &amp; Collier — cited, current, and delivered straight into the AI
          you already use. Built for realtors, lenders, and investors.
        </p>

        {/* Price card */}
        <div className="mt-12 w-full max-w-md rounded-xl border border-[#22414F] bg-[#152832] p-8 text-left">
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-semibold tabular-nums">
              ${PRICE_USD}
            </span>
            <span className="text-sm text-[#807E76]">/ month</span>
          </div>
          <p className="mt-1 text-xs text-[#807E76]">
            Cancel anytime. One connection, unlimited questions.
          </p>

          <ul className="mt-6 space-y-3">
            {INCLUDED.map((item) => (
              <li key={item} className="flex gap-3 text-sm text-[#F0EDE6]">
                <span aria-hidden className="text-[#3DC9C0]">
                  ✓
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>

          {PAYMENT_LINK ? (
            <a
              href={PAYMENT_LINK}
              className="mt-8 block rounded-lg bg-[#3DC9C0] px-6 py-3 text-center text-sm font-semibold text-[#0A1419] transition hover:bg-[#5fd8d0]"
            >
              Get access — ${PRICE_USD}/mo
            </a>
          ) : (
            <a
              href="mailto:support@swfldatagulf.com?subject=SWFL%20Data%20Gulf%20access"
              className="mt-8 block rounded-lg bg-[#3DC9C0] px-6 py-3 text-center text-sm font-semibold text-[#0A1419] transition hover:bg-[#5fd8d0]"
            >
              Request access
            </a>
          )}
          <p className="mt-3 text-center text-xs text-[#807E76]">
            Questions?{" "}
            <a
              href="mailto:support@swfldatagulf.com"
              className="text-[#3DC9C0] underline"
            >
              support@swfldatagulf.com
            </a>
          </p>
        </div>

        {/* Concrete example */}
        <div className="mt-12 w-full max-w-md rounded-lg border border-[#22414F] bg-[#0F1F27] p-5 text-left">
          <p className="font-mono text-xs uppercase tracking-widest text-[#807E76]">
            For example
          </p>
          <p className="mt-2 text-sm leading-relaxed text-[#B8B4A8]">
            <span className="text-[#F0EDE6]">
              “Is Fort Myers Beach a good buy?”
            </span>{" "}
            → ZIP 33931 carries ~$30,074/yr in average annual flood loss per
            insured property — a real carrying cost most listings never mention.
            That is the kind of answer this gets you, on demand.
          </p>
        </div>

        {/* What happens after */}
        <div className="mt-12 w-full max-w-md text-left">
          <p className="font-mono text-xs uppercase tracking-widest text-[#807E76]">
            After you subscribe
          </p>
          <p className="mt-2 text-sm leading-relaxed text-[#B8B4A8]">
            You get an access token and one command to connect it to your AI:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-[#22414F] bg-[#0A1419] p-4 text-xs text-[#3DC9C0]">
            <code>
              claude mcp add --transport http swfl{" "}
              https://www.swfldatagulf.com/api/mcp{"\n"}
              {"  "}--header &quot;Authorization: Bearer YOUR_TOKEN&quot;
            </code>
          </pre>
          <p className="mt-6 text-center text-xs text-[#807E76]">
            <Link href="/demo" className="text-[#3DC9C0] underline">
              See a live sample
            </Link>{" "}
            ·{" "}
            <Link href="/" className="text-[#3DC9C0] underline">
              How it works
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
