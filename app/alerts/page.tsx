import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Buyer-intent alerts — SWFL Data Gulf" };

interface AlertRow {
  id: number;
  contact_email: string;
  contact_name: string | null;
  parsed_zip: string | null;
  parsed_place: string | null;
  parsed_topic: string | null;
  answer_sent: boolean;
  created_at: string;
  read_at: string | null;
}

function topicLine(r: AlertRow): string {
  const where = r.parsed_place ?? (r.parsed_zip ? `ZIP ${r.parsed_zip}` : null);
  if (where && r.parsed_topic) return `${where} — ${r.parsed_topic}`;
  return where ?? r.parsed_topic ?? "a question about the market";
}

export default async function AlertsPage() {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/alerts");

  const { data } = await supabase
    .from("buyer_intent_events")
    .select(
      "id, contact_email, contact_name, parsed_zip, parsed_place, parsed_topic, answer_sent, created_at, read_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  const alerts = (data as AlertRow[] | null) ?? [];

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">Buyer-intent alerts</h1>
        <Link href="/project" className="text-xs text-gray-400 hover:text-[#0a8078]">
          Your projects →
        </Link>
      </div>

      {alerts.length === 0 ? (
        <p className="text-sm text-gray-400">
          No replies yet. When a client replies to one of your branded market-data emails, the warm
          lead shows up here — who asked, what about, and the cited answer we sent on your behalf.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {alerts.map((a) => (
            <li key={a.id}>
              <Link
                href={`/alerts/${a.id}`}
                className={`flex items-center justify-between rounded-xl border px-4 py-3 transition-colors hover:border-[#0a8078]/40 ${
                  a.read_at
                    ? "border-white/10 bg-[#0d1e2b]/60"
                    : "border-[#0a8078]/30 bg-[#0d1e2b]/90"
                }`}
              >
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-white">
                    {a.contact_name || a.contact_email}
                  </span>
                  <span className="text-xs text-gray-400">{topicLine(a)}</span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <span className="text-xs text-gray-500">
                    {new Date(a.created_at).toLocaleDateString()}
                  </span>
                  <span
                    className={`text-[10px] uppercase tracking-wide ${
                      a.answer_sent ? "text-[#0a8078]" : "text-amber-400"
                    }`}
                  >
                    {a.answer_sent ? "auto-answered" : "needs you"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
