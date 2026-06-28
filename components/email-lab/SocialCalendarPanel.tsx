"use client";
import type { CalendarDay, SocialDraft, WeeklyCalendar } from "@/lib/email/social-calendar/types";
import type { EmailDoc } from "@/lib/email/doc/types";

export interface SocialCalendarPanelProps {
  state: "idle" | "loading" | "ready" | "error";
  calendar: WeeklyCalendar | null;
  expandedDay: CalendarDay | null;
  onGenerate: () => void;
  onToggleDay: (d: CalendarDay) => void;
  onCopyCaption: (draft: SocialDraft) => void;
  onLoadCard: (card: EmailDoc) => void;
}

export function SocialCalendarPanel({
  state,
  calendar,
  expandedDay,
  onGenerate,
  onToggleDay,
  onCopyCaption,
  onLoadCard,
}: SocialCalendarPanelProps) {
  return (
    <div className="mt-2 space-y-2">
      <button
        type="button"
        onClick={onGenerate}
        disabled={state === "loading"}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-gulf-teal py-2 text-sm font-semibold text-[#070f14] transition-colors hover:bg-[#17a3b3] disabled:opacity-40"
      >
        {state === "loading" ? (
          <>
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#070f14]/30 border-t-[#070f14]" />
            Generating week…
          </>
        ) : (
          "Generate Week"
        )}
      </button>

      {state === "error" && (
        <p className="text-[11px] text-amber-300/80">
          Couldn&apos;t generate this week — try again.
        </p>
      )}

      {state === "ready" && (calendar?.webRefreshed?.length ?? 0) > 0 && (
        <p className="text-[10px] text-white/35">
          Found fresher data for: {calendar!.webRefreshed!.join(", ")}
        </p>
      )}

      {state === "ready" &&
        calendar?.posts.map((p) => {
          const open = expandedDay === p.day;
          return (
            <div key={p.day} className="rounded-md border border-white/8 bg-white/4">
              <button
                type="button"
                onClick={() => onToggleDay(p.day)}
                className="w-full px-3 py-2 text-left"
              >
                <span className="block text-xs font-medium text-white/75">{p.theme}</span>
                <span className="block truncate text-[10px] text-white/35">
                  {p.caption.slice(0, 80)}
                </span>
              </button>
              {open && (
                <div className="space-y-2 border-t border-white/8 px-3 py-2">
                  <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-white/70">
                    {p.caption}
                  </p>
                  {p.hashtags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {p.hashtags.map((h) => (
                        <span
                          key={h}
                          className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-white/55"
                        >
                          #{h}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => onCopyCaption(p)}
                      className="flex-1 rounded border border-white/10 px-2 py-1 text-[11px] text-white/60 hover:text-white/90"
                    >
                      Copy Caption
                    </button>
                    <button
                      type="button"
                      onClick={() => onLoadCard(p.card)}
                      className="flex-1 rounded border border-gulf-teal/30 bg-gulf-teal/10 px-2 py-1 text-[11px] text-gulf-teal hover:bg-gulf-teal/20"
                    >
                      Load Card
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
