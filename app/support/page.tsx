import type { Metadata } from "next";
import { PageShell } from "@/components/PageShell";

export const metadata: Metadata = {
  title: "Support — SWFL Data Gulf",
  description:
    "Get help with SWFL Data Gulf — data questions, access issues, API support, and feedback.",
};

export default function SupportPage() {
  return (
    <PageShell width="narrow" className="leading-relaxed py-16">
      <h1 className="text-3xl font-semibold mb-2">Support</h1>
      <p className="text-sm text-neutral-500 mb-8">
        We&rsquo;re a small team. We read every message.
      </p>

      <section className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold mb-2">Email us</h2>
          <p>
            For data questions, access issues, API problems, or anything else — reach us at{" "}
            <a href="mailto:support@swfldatagulf.com" className="underline underline-offset-2">
              support@swfldatagulf.com
            </a>
            . We aim to respond within one business day.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-2">What to include</h2>
          <ul className="list-disc list-inside space-y-1 text-neutral-400">
            <li>The brain or corridor you were asking about</li>
            <li>The question or prompt you used</li>
            <li>What you expected vs. what you got</li>
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-2">Data corrections</h2>
          <p>
            If you spot a number that looks wrong, tell us the source you&rsquo;re comparing
            against. Every metric in SWFL Data Gulf has a citation — if ours disagrees with yours,
            we want to know.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-2">Privacy and terms</h2>
          <p>
            See our{" "}
            <a href="/privacy" className="underline underline-offset-2">
              Privacy Policy
            </a>{" "}
            and{" "}
            <a href="/terms" className="underline underline-offset-2">
              Terms of Service
            </a>
            .
          </p>
        </div>
      </section>
    </PageShell>
  );
}
