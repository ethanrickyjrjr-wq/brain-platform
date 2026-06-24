import { cookies } from "next/headers";
import { PageShell } from "@/components/PageShell";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Buyer-intent alert — SWFL Data Gulf" };

interface AlertDetail {
  id: number;
  contact_email: string;
  contact_name: string | null;
  contact_tags: string[];
  parsed_zip: string | null;
  parsed_place: string | null;
  parsed_topic: string | null;
  raw_reply: string | null;
  answer_sent: boolean;
  created_at: string;
  read_at: string | null;
}

function topicLine(r: AlertDetail): string {
  const where = r.parsed_place ?? (r.parsed_zip ? `ZIP ${r.parsed_zip}` : null);
  if (where && r.parsed_topic) return `${where} — ${r.parsed_topic}`;
  return where ?? r.parsed_topic ?? "a question about the market";
}

export default async function AlertDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/alerts/${id}`);

  // RLS scopes this to the owner — another agent's id resolves to no row (404).
  const { data } = await supabase
    .from("buyer_intent_events")
    .select(
      "id, contact_email, contact_name, contact_tags, parsed_zip, parsed_place, parsed_topic, raw_reply, answer_sent, created_at, read_at",
    )
    .eq("id", id)
    .maybeSingle();
  const alert = data as AlertDetail | null;
  if (!alert) notFound();

  // Best-effort mark-as-read on view (RLS-scoped; ignore failures).
  if (!alert.read_at) {
    await supabase
      .from("buyer_intent_events")
      .update({ read_at: new Date().toISOString() })
      .eq("id", alert.id);
  }

  return (
    <PageShell width="narrow">
      <Link href="/alerts" className="text-xs text-gray-400 hover:text-[#00d4aa]">
        ← All alerts
      </Link>

      <h1 className="mt-4 text-xl font-semibold text-white">
        {alert.contact_name || alert.contact_email}
      </h1>
      <p className="mt-1 text-sm text-gray-400">
        asked about <span className="text-white">{topicLine(alert)}</span> ·{" "}
        {new Date(alert.created_at).toLocaleString()}
      </p>

      {alert.contact_tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {alert.contact_tags.map((t) => (
            <span
              key={t}
              className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-gray-300"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      <section className="mt-6">
        <h2 className="text-xs uppercase tracking-wide text-gray-500">Their reply</h2>
        <p className="mt-2 whitespace-pre-wrap rounded-xl border border-white/10 bg-[#0d1e2b]/80 px-4 py-3 text-sm text-gray-200">
          {alert.raw_reply || "(no text)"}
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-xs uppercase tracking-wide text-gray-500">What we did</h2>
        <p className="mt-2 text-sm text-gray-300">
          {alert.answer_sent
            ? "We sent them a grounded, cited answer on your behalf — and kept the reply-to monitored so a follow-up still reaches you."
            : "We did not auto-reply to this one (it may be a forwarded email, an out-of-office, or past the auto-reply limit). Reach out yourself to take the lead."}
        </p>
        <a
          href={`mailto:${alert.contact_email}`}
          className="mt-4 inline-block rounded-xl border border-[#00d4aa]/40 px-4 py-2 text-sm font-medium text-[#00d4aa] transition-colors hover:bg-[#00d4aa]/10"
        >
          Reply to {alert.contact_email}
        </a>
      </section>
    </PageShell>
  );
}
