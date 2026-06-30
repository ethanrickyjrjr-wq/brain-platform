"use client";
// components/email-lab/ScheduleSocialModal.tsx
//
// The paid grid-lab "Schedule this post" modal. A self-contained confirm flow (NOT a
// wrapper around SendWeeklyHandle — that's email/audience-scoped): pick publishable
// platforms (only ones with a connected account), cadence, day, and ET hour, then POST
// /api/social/schedule. The route writes one social_schedules recipe per platform with a
// frozen_post snapshot; the live cron worker fires it (gated by SOCIAL_PUBLISH_ENABLED).
// Nothing posts from here.

import { useEffect, useState } from "react";
import type { Platform } from "@/lib/social/types";
import type { SocialDraft } from "@/lib/email/social-calendar/types";
import type { SocialDesign } from "@/lib/social/design/types";
import { formatScheduleSendTime } from "@/lib/email/schedule-cadence";

interface ConnectedAccount {
  id: string;
  platform: Platform;
  account_name: string | null;
}

interface Props {
  draft: SocialDraft;
  projectId?: string;
  scopeKind?: string | null;
  scopeValue?: string | null;
  /** Exported canvas PNG URL — when set this is a frozen-image post (static, not re-rendered). */
  mediaUrl?: string | null;
  /** Canvas design JSON — stored on frozen_post.design for Phase-2 auto-refresh. */
  design?: SocialDesign | null;
  onClose: () => void;
}

type Cadence = "daily" | "weekly" | "monthly";

// Local label map — importing platformLabel from lib/social/channels/index.ts would pull
// the server-only OAuth + adapter code into this client bundle. The Platform union is
// published-first and breaking-change-gated, so a small map here can't silently drift.
const PLATFORM_LABEL: Record<Platform, string> = {
  x: "X",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  google_business: "Google Business",
};
const PUBLISHABLE: Platform[] = ["x", "facebook", "instagram", "linkedin", "google_business"];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOUR_OPTIONS = [
  { value: 7, label: "7am ET" },
  { value: 8, label: "8am ET" },
  { value: 9, label: "9am ET" },
  { value: 10, label: "10am ET" },
  { value: 12, label: "12pm ET" },
  { value: 17, label: "5pm ET" },
];

const PILL = "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors";
const PILL_ON = "border-gulf-teal bg-gulf-teal text-[#06231f]";
const PILL_OFF = "border-white/15 bg-white/5 text-white/60 hover:text-white/90";

export function ScheduleSocialModal({
  draft,
  projectId,
  scopeKind,
  scopeValue,
  mediaUrl,
  design,
  onClose,
}: Props) {
  const [accounts, setAccounts] = useState<ConnectedAccount[] | null>(null);
  const [selected, setSelected] = useState<Set<Platform>>(new Set());
  const [cadence, setCadence] = useState<Cadence>("weekly");
  const [dayOfWeek, setDayOfWeek] = useState(1); // Monday — never 0/null (a null next_run_at row never fires)
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [sendHour, setSendHour] = useState(9);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    when: string;
    scheduled: Platform[];
    skipped: Platform[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load the caller's connected publishable accounts (gates platform selection).
  useEffect(() => {
    fetch("/api/social/schedule")
      .then((r) => (r.ok ? r.json() : { accounts: [] }))
      .then((data: { accounts?: ConnectedAccount[] }) => setAccounts(data.accounts ?? []))
      .catch(() => setAccounts([]));
  }, []);

  const connectedPlatforms = new Set((accounts ?? []).map((a) => a.platform));
  const returnPath =
    typeof window !== "undefined" ? window.location.pathname + window.location.search : "/";

  function toggle(p: Platform) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function confirm() {
    if (submitting || selected.size === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/social/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          post: draft,
          platforms: [...selected],
          cadence,
          day_of_week: cadence === "weekly" ? dayOfWeek : undefined,
          day_of_month: cadence === "monthly" ? dayOfMonth : undefined,
          send_hour_et: sendHour,
          scope_kind: scopeKind ?? undefined,
          scope_value: scopeValue ?? undefined,
          mediaUrl: mediaUrl ?? undefined,
          design: design ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(
          data.error === "no_connected_account"
            ? "Connect one of those accounts first."
            : "Couldn't schedule — try again.",
        );
        return;
      }
      setResult({
        when: formatScheduleSendTime(data.next_run_at),
        scheduled: data.scheduled ?? [],
        skipped: data.skipped ?? [],
      });
    } catch {
      setError("Something went wrong — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0a1822] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Schedule this post</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white/40 transition-colors hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* ── Success ── */}
        {result ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-gulf-teal/30 bg-gulf-teal/10 px-3 py-2.5 text-xs text-gulf-teal">
              ✓ Scheduled to {result.scheduled.map((p) => PLATFORM_LABEL[p]).join(", ")}
              {result.when ? ` — first post ${result.when}` : ""}.{" "}
              {mediaUrl
                ? "It posts your designed image on your cadence."
                : "It re-posts on your cadence with fresh data each time."}
            </div>
            {result.skipped.length > 0 && (
              <p className="text-[11px] text-amber-300/80">
                Couldn&apos;t schedule {result.skipped.map((p) => PLATFORM_LABEL[p]).join(", ")} —
                connect those accounts first.
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-lg bg-gulf-teal py-2 text-sm font-semibold text-[#070f14] transition-colors hover:bg-[#17a3b3]"
            >
              Done
            </button>
          </div>
        ) : accounts === null ? (
          <p className="py-6 text-center text-xs text-white/40">Loading your accounts…</p>
        ) : connectedPlatforms.size === 0 ? (
          /* ── Empty state — nothing connected ── */
          <div className="space-y-3">
            <p className="text-xs text-white/60">
              Connect a social account to schedule posts. It opens a secure sign-in with the
              platform — nothing posts until you schedule it.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {PUBLISHABLE.map((p) => (
                <a
                  key={p}
                  href={`/api/social/connect/${p}/start?return=${encodeURIComponent(returnPath)}`}
                  className={`${PILL} ${PILL_OFF}`}
                >
                  Connect {PLATFORM_LABEL[p]}
                </a>
              ))}
            </div>
          </div>
        ) : (
          /* ── Compose ── */
          <div className="space-y-4">
            <p className="line-clamp-2 rounded-md border border-white/8 bg-white/4 px-2.5 py-2 text-[11px] text-white/55">
              {draft.caption}
            </p>

            {/* Platforms */}
            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-[0.15em] text-white/35">
                Post to
              </p>
              <div className="flex flex-wrap gap-1.5">
                {PUBLISHABLE.filter((p) => connectedPlatforms.has(p)).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => toggle(p)}
                    className={`${PILL} ${selected.has(p) ? PILL_ON : PILL_OFF}`}
                  >
                    {PLATFORM_LABEL[p]}
                  </button>
                ))}
              </div>
              {PUBLISHABLE.some((p) => !connectedPlatforms.has(p)) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-white/30">
                  <span>Connect more:</span>
                  {PUBLISHABLE.filter((p) => !connectedPlatforms.has(p)).map((p) => (
                    <a
                      key={p}
                      href={`/api/social/connect/${p}/start?return=${encodeURIComponent(returnPath)}`}
                      className="text-gulf-teal/70 hover:text-gulf-teal"
                    >
                      {PLATFORM_LABEL[p]}
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* Cadence */}
            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-[0.15em] text-white/35">Repeat</p>
              <div className="flex gap-1.5">
                {(["daily", "weekly", "monthly"] as Cadence[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCadence(c)}
                    className={`${PILL} flex-1 capitalize ${cadence === c ? PILL_ON : PILL_OFF}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* Daily-duplicate honesty note — frozen canvas image is byte-identical each fire */}
            {mediaUrl && cadence === "daily" && (
              <p className="text-[10px] text-amber-300/70">
                Heads up: posting the same image daily may be flagged as a duplicate by some
                networks (e.g. X).
              </p>
            )}

            {/* Day-of-week (weekly) */}
            {cadence === "weekly" && (
              <div>
                <p className="mb-1.5 text-[10px] uppercase tracking-[0.15em] text-white/35">Day</p>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map((d, i) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDayOfWeek(i)}
                      className={`${PILL} ${dayOfWeek === i ? PILL_ON : PILL_OFF}`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Day-of-month (monthly) */}
            {cadence === "monthly" && (
              <label className="block">
                <span className="mb-1.5 block text-[10px] uppercase tracking-[0.15em] text-white/35">
                  Day of month (1–28)
                </span>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={dayOfMonth}
                  onChange={(e) =>
                    setDayOfMonth(Math.min(28, Math.max(1, Number(e.target.value) || 1)))
                  }
                  className="w-24 rounded border border-white/15 bg-white/5 px-2 py-1.5 text-xs text-white/80 focus:border-gulf-teal/50 focus:outline-none"
                />
              </label>
            )}

            {/* Hour */}
            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-[0.15em] text-white/35">Time</p>
              <div className="flex flex-wrap gap-1.5">
                {HOUR_OPTIONS.map((h) => (
                  <button
                    key={h.value}
                    type="button"
                    onClick={() => setSendHour(h.value)}
                    className={`${PILL} ${sendHour === h.value ? PILL_ON : PILL_OFF}`}
                  >
                    {h.label}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-[11px] text-amber-300/80">{error}</p>}

            <button
              type="button"
              onClick={confirm}
              disabled={submitting || selected.size === 0}
              className="w-full rounded-lg bg-gulf-teal py-2 text-sm font-semibold text-[#070f14] transition-colors hover:bg-[#17a3b3] disabled:opacity-40"
            >
              {submitting ? "Scheduling…" : "Schedule post"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
