import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — SWFL Data Gulf",
  description:
    "Terms of service for the SWFL Data Gulf MCP server and website.",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 leading-relaxed">
      <h1 className="text-3xl font-semibold mb-2">Terms of Service</h1>
      <p className="text-sm text-neutral-500 mb-8">Effective 2026-05-25</p>

      <section className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">1. Service</h2>
          <p>
            SWFL Data Gulf is a read-only data service operated by SWFL Data
            Gulf. It provides analyst-grade public data about Southwest Florida
            (Lee, Collier, and Charlotte counties) via a Model Context Protocol
            (MCP) server at{" "}
            <code className="text-sm">
              https://www.swfldatagulf.com/api/mcp
            </code>{" "}
            and a web interface at{" "}
            <code className="text-sm">https://www.swfldatagulf.com</code>.
          </p>
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-semibold">2. Use</h2>
          <p>
            You may use this service for personal, research, and commercial
            purposes. You may not resell, republish, or redistribute the raw
            data feeds as a standalone data product. You may not use the service
            to generate automated bulk requests that degrade performance for
            other users.
          </p>
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-semibold">3. Data accuracy</h2>
          <p>
            All data is sourced from federal, state, and public datasets. Every
            numeric claim includes a source citation. We do not guarantee the
            accuracy, completeness, or timeliness of the data. Do not rely
            solely on this service for financial, legal, or investment
            decisions.
          </p>
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-semibold">4. Availability</h2>
          <p>
            The service is provided as-is with no uptime guarantee. We may
            modify, suspend, or discontinue the service at any time without
            notice.
          </p>
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-semibold">
            5. Waitlist and communications
          </h2>
          <p>
            If you submit your email via the waitlist, you agree to receive
            update emails from SWFL Data Gulf. You can unsubscribe at any time
            by replying with the word &ldquo;unsubscribe.&rdquo; See our{" "}
            <a href="/privacy" className="underline">
              Privacy Policy
            </a>{" "}
            for full data handling details.
          </p>
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-semibold">6. Liability</h2>
          <p>
            To the maximum extent permitted by law, SWFL Data Gulf is not liable
            for any direct, indirect, incidental, or consequential damages
            arising from your use of this service.
          </p>
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-semibold">7. Contact</h2>
          <p>
            Questions about these terms: reply to any email from the waitlist or
            reach out via the support channel on{" "}
            <a href="/" className="underline">
              swfldatagulf.com
            </a>
            .
          </p>
        </div>
      </section>
    </main>
  );
}
