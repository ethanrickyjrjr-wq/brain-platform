import type { WelcomeState } from "@/lib/welcome/frames";

import { CitationList } from "@/components/CitationList";
import { FreshnessBadge } from "./FreshnessBadge";
import { MetricCard } from "./MetricCard";
import { MetricCardSkeleton } from "./MetricCardSkeleton";
import { ZipEcho } from "./ZipEcho";

/**
 * The grounded answer. Split reveal: the ZIP echo + skeleton cards mount the
 * instant a read starts; cards pop to real values when {answer} lands; the
 * one-line synthesis streams underneath with a blinking cursor. Numbers feel
 * looked-up (they are), the narrative feels reasoned (it streams).
 */
export function AnswerBlock({ state }: { state: WelcomeState }) {
  const { status, zip, place, answer, prose, error, sources } = state;
  if (status === "idle") return null;

  return (
    <>
      <div className="mt-6 space-y-5 rounded-xl border border-gulf-haze bg-gulf-deep p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {zip ? <ZipEcho zip={zip} name={place?.name} /> : null}
          {answer ? <FreshnessBadge token={answer.freshness_token} /> : null}
        </div>

        {status === "error" ? (
          <p className="text-sm text-sunset-coral">{error}</p>
        ) : (
          <>
            {answer ? (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {answer.metrics.map((m) => (
                  <MetricCard key={m.key} metric={m} />
                ))}
              </div>
            ) : status === "awaiting" ? (
              // Skeletons only while the read is in flight with no cards yet. If a
              // grounded answer streams prose-only (no {answer} frame), they clear
              // once text starts — graceful degradation, never a stuck spinner.
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {Array.from({ length: 4 }, (_, i) => (
                  <MetricCardSkeleton key={i} />
                ))}
              </div>
            ) : null}

            {prose ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
                {prose}
                {status === "streaming" ? (
                  <span
                    className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-[var(--brand-primary,#3DC9C0)] align-middle"
                    aria-hidden
                  />
                ) : null}
              </p>
            ) : null}
          </>
        )}
      </div>
      {/* Lane-3 web-verified citations — THE one collapsed, click-to-open Sources box
        (CitationList is the single locked root; never rebuild it). Each line names the
        figure it backs and links to the publisher; empty → renders nothing. */}
      {sources.length > 0 ? (
        <CitationList
          sources={sources.map((s) => ({
            // A figure source shows "label: value — host"; a provenance-only source
            // (no value, e.g. comp homepage citations) shows just the label.
            label:
              s.value != null
                ? `${s.label}: ${s.value.toLocaleString("en-US")} — ${s.domain}`
                : s.label,
            url: s.url,
          }))}
        />
      ) : null}
    </>
  );
}
