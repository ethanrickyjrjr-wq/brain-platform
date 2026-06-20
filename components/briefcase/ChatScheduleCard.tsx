"use client";

import { useCallback, useEffect, useState } from "react";
import { formatScheduleSendTime } from "@/lib/email/schedule-cadence";

/**
 * Task 5 — the in-chat "Send weekly" card. Appears under a briefcase-chat answer
 * grounded on an in-scope ZIP, turning a question into a recurring grounded report.
 *
 * Two modes by context:
 *  - No project (the global pill's default) → the LOGIN-CAPTURE CTA. Per the locked
 *    monetization model, build/preview is free and the SEND is the gated, login-capture
 *    moment — so an anon/unscoped user is invited to sign in + save, NOT blocked.
 *  - On a project (`projectId` from the /project/[id] route) → the real flow: pick
 *    cadence/day/audience → propose (the no-LLM `fromScope` branch, reusing Task 7's
 *    recipe lane) → confirm → one `email_schedules` row (fresh data each run).
 *
 * Managing/pausing a schedule lives on the project surfaces (Task 6's SendWeeklyHandle);
 * this card is the launch point, deliberately lean.
 */

interface Props {
  zip: string;
  placeName: string;
  /** Derived from /project/[id]; null for the global pill (→ login-capture CTA). */
  projectId: string | null;
}

const DAY_OPTIONS = [
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
];
const HOUR_OPTIONS = [
  { label: "7am", value: 7 },
  { label: "9am", value: 9 },
  { label: "noon", value: 12 },
  { label: "5pm", value: 17 },
];

type Step =
  | { name: "loading" }
  | { name: "signin" }
  | { name: "already" }
  | { name: "idle" }
  | { name: "picker" }
  | { name: "proposing" }
  | {
      name: "confirm";
      summary: string;
      proposal: unknown;
      nonce: string | null;
      nextRunAt: string | null;
    }
  | { name: "confirming" }
  | { name: "success"; summary: string }
  | { name: "error"; message: string };

const BTN =
  "rounded-full border border-[#0a8078]/60 px-3 py-1 text-[11px] font-medium text-[#0a8078] transition-colors hover:bg-[#0a8078]/10 disabled:opacity-50";
const BTN_GO =
  "rounded-full bg-[#0a8078] px-3 py-1 text-[11px] font-semibold text-navy-dark transition-opacity hover:opacity-90 disabled:opacity-50";
const BTN_GHOST = "rounded-full px-2 py-1 text-[11px] text-gray-500 hover:text-gray-300";

export function ChatScheduleCard({ zip, placeName, projectId }: Props) {
  const [audiences, setAudiences] = useState<{ slug: string; contact_count: number }[]>([]);
  const [audienceSlug, setAudienceSlug] = useState("");
  const [day, setDay] = useState(1);
  const [hour, setHour] = useState(7);
  const [step, setStep] = useState<Step>(projectId ? { name: "loading" } : { name: "signin" });

  // Project mode: probe send-status — it doubles as the auth check (401 → sign-in CTA)
  // and tells us whether a schedule already exists for this ZIP.
  useEffect(() => {
    if (!projectId) return;
    const params = new URLSearchParams({ projectId, scopeKind: "zip", scopeValue: zip });
    fetch(`/api/email/send-status?${params}`)
      .then((r) => {
        if (r.status === 401) return null;
        return r.ok ? r.json() : null;
      })
      .then(
        (
          data: {
            audiences?: { slug: string; contact_count: number }[];
            schedule?: unknown;
          } | null,
        ) => {
          if (data === null) return setStep({ name: "signin" });
          setAudiences(data.audiences ?? []);
          setStep(data.schedule ? { name: "already" } : { name: "idle" });
        },
      )
      .catch(() => setStep({ name: "idle" }));
  }, [projectId, zip]);

  const propose = useCallback(async () => {
    setStep({ name: "proposing" });
    try {
      const res = await fetch("/api/email/schedule-command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          fromScope: {
            scope_kind: "zip",
            scope_value: zip,
            cadence: "weekly",
            day_of_week: day,
            send_hour_et: hour,
            audience_slug: audienceSlug || undefined,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) return setStep({ name: "signin" });
      if (!res.ok || data.error) throw new Error(data.error || "couldn't set that up");
      if (data.needsClarification) return setStep({ name: "error", message: data.message });
      setStep({
        name: "confirm",
        summary: data.summary as string,
        proposal: data.proposal,
        nonce: (data.proposal_nonce as string) ?? null,
        nextRunAt: (data.next_run_at as string) ?? null,
      });
    } catch (e) {
      setStep({ name: "error", message: e instanceof Error ? e.message : "Something went wrong." });
    }
  }, [projectId, zip, day, hour, audienceSlug]);

  const confirm = useCallback(
    async (proposal: unknown, nonce: string | null, summary: string) => {
      setStep({ name: "confirming" });
      try {
        const body: Record<string, unknown> = { projectId, confirm: true, proposal };
        if (nonce) body.proposal_nonce = nonce;
        const res = await fetch("/api/email/schedule-command", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) throw new Error(data.error || "couldn't confirm");
        setStep({ name: "success", summary });
      } catch (e) {
        setStep({ name: "error", message: e instanceof Error ? e.message : "Couldn't confirm." });
      }
    },
    [projectId],
  );

  // ── render ──
  const shell = "mt-2 rounded-lg border border-[#0a8078]/30 bg-[#0a8078]/5 px-3 py-2";
  const place = placeName || `ZIP ${zip}`;

  if (step.name === "loading") return null;

  if (step.name === "signin") {
    return (
      <div className={shell}>
        <p className="text-[11px] text-gray-300">📧 Get {place} market updates in your inbox.</p>
        <a
          href={`/login?next=/project`}
          className="mt-1.5 inline-block rounded-full bg-[#0a8078] px-3 py-1 text-[11px] font-semibold text-navy-dark"
        >
          Sign in to set up weekly sends
        </a>
      </div>
    );
  }

  if (step.name === "already") {
    return (
      <div className={shell}>
        <p className="text-[11px] text-[#0a8078]">✓ You’re already getting {place} weekly.</p>
        <a href={`/project/${projectId}`} className="text-[11px] text-gray-500 underline">
          Manage on your project
        </a>
      </div>
    );
  }

  if (step.name === "success") {
    return (
      <div className={shell}>
        <p className="text-[11px] text-[#0a8078]">✓ {step.summary}</p>
        <p className="text-[10px] text-gray-500">
          Fresh data each send — re-fetched, never frozen.
        </p>
      </div>
    );
  }

  if (step.name === "error") {
    return (
      <div className="mt-2 flex items-center gap-2">
        <p className="text-[11px] text-red-400">{step.message}</p>
        <button type="button" className={BTN_GHOST} onClick={() => setStep({ name: "idle" })}>
          Try again
        </button>
      </div>
    );
  }

  if (step.name === "proposing" || step.name === "confirming") {
    return <p className="mt-2 text-[11px] text-gray-400">Setting up…</p>;
  }

  if (step.name === "confirm") {
    const { summary, proposal, nonce, nextRunAt } = step;
    const firstSend = nextRunAt ? formatScheduleSendTime(nextRunAt) : "";
    const count = audiences.find((a) => a.slug === audienceSlug)?.contact_count;
    return (
      <div className={shell}>
        <p className="text-[11px] text-gray-200">{summary}</p>
        {firstSend && (
          <p className="mt-1 text-[10px] text-gray-400">
            First email: {firstSend}
            {typeof count === "number" && count > 0
              ? ` · to ${count} contact${count === 1 ? "" : "s"}`
              : ""}
          </p>
        )}
        <div className="mt-1.5 flex gap-2">
          <button
            type="button"
            className={BTN_GO}
            onClick={() => void confirm(proposal, nonce, summary)}
          >
            Confirm
          </button>
          <button type="button" className={BTN_GHOST} onClick={() => setStep({ name: "idle" })}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (step.name === "idle") {
    return (
      <button type="button" className={`${BTN} mt-2`} onClick={() => setStep({ name: "picker" })}>
        📧 Get {place} weekly
      </button>
    );
  }

  // picker
  return (
    <div className={shell}>
      <p className="mb-1.5 text-[11px] font-medium text-gray-300">When should {place} go out?</p>
      <div className="mb-1.5 flex flex-wrap gap-1">
        {DAY_OPTIONS.map((d) => (
          <button
            key={d.value}
            type="button"
            onClick={() => setDay(d.value)}
            className={day === d.value ? BTN_GO : BTN}
          >
            {d.label}
          </button>
        ))}
      </div>
      <div className="mb-1.5 flex flex-wrap gap-1">
        {HOUR_OPTIONS.map((h) => (
          <button
            key={h.value}
            type="button"
            onClick={() => setHour(h.value)}
            className={hour === h.value ? BTN_GO : BTN}
          >
            {h.label}
          </button>
        ))}
      </div>
      {audiences.length > 0 && (
        <select
          value={audienceSlug}
          onChange={(e) => setAudienceSlug(e.target.value)}
          className="mb-1.5 w-full rounded-lg border border-white/10 bg-[#0d1e2b] px-2 py-1 text-[11px] text-white"
        >
          <option value="" className="bg-[#0f1d24]">
            Choose recipients later
          </option>
          {audiences.map((a) => (
            <option key={a.slug} value={a.slug} className="bg-[#0f1d24]">
              {a.slug}
              {a.contact_count > 0 ? ` (${a.contact_count})` : ""}
            </option>
          ))}
        </select>
      )}
      <div className="flex gap-2">
        <button type="button" className={BTN_GO} onClick={() => void propose()}>
          Set up weekly →
        </button>
        <button type="button" className={BTN_GHOST} onClick={() => setStep({ name: "idle" })}>
          Cancel
        </button>
      </div>
    </div>
  );
}
