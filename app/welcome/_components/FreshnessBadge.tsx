import { parseFreshnessDate } from "@/lib/welcome/frames";

/** Prominent "Data as of {date}" surface — the freshness token is the proof the
 *  read is live, so it rides up top, never buried. */
export function FreshnessBadge({ token }: { token: string }) {
  const date = parseFreshnessDate(token);
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-[var(--brand-primary,#0a8078)]/30 bg-[var(--brand-primary,#0a8078)]/10 px-3 py-1">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand-primary,#0a8078)]" aria-hidden />
      <span className="text-xs font-medium text-text-secondary">Data as of {date ?? "—"}</span>
    </div>
  );
}
