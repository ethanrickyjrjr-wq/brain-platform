import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy — SWFL Data Lake",
  description:
    "What we collect, how we use it, and who we share with for the SWFL Data Lake waitlist and read-only API.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 leading-relaxed">
      <h1 className="text-3xl font-semibold mb-2">Privacy</h1>
      <p className="text-sm text-neutral-500 mb-8">Updated 2026-05-24</p>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">What we collect</h2>
        <p>
          If you join the waitlist, we store the email address and interest tags
          you submit. The read-only API (<code>/api/b</code>,{" "}
          <code>/api/mcp</code>) logs request paths, response codes, and
          timestamps for operational debugging. We do not set tracking cookies
          and do not run third-party analytics.
        </p>

        <h2 className="text-xl font-semibold">How we use it</h2>
        <p>
          Email addresses are used only to notify you when the items you checked
          ship — new data lakes, vault, Slack delivery, document export, or
          sharper numbers. One email per update. Interest tags let us send only
          the updates you asked for.
        </p>

        <h2 className="text-xl font-semibold">Who we share with</h2>
        <p>
          Nobody. Your email and interest tags stay on our Supabase. We do not
          sell, share, or feed them to any third party, advertiser, or AI
          training pipeline.
        </p>

        <h2 className="text-xl font-semibold">How to unsubscribe</h2>
        <p>
          Reply to any email from us with the word &ldquo;unsubscribe&rdquo; and
          we will delete your row.
        </p>

        <h2 className="text-xl font-semibold">Contact</h2>
        <p>
          Questions about this policy: reply to any email from the waitlist, or
          open an issue on the project repository.
        </p>
      </section>
    </main>
  );
}
