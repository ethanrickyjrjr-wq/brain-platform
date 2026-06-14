/**
 * Source legend — the operator-locked key at the foot of every /r/ report.
 * Matches SourceLink's origin coloring exactly:
 *   teal #0a8078 = SWFL Data Gulf (our own data / pages)
 *   blue #60a5fa = Websites (outside sources — City Pulse, news, agencies)
 */
export function ColorLegend() {
  return (
    <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-xs text-gray-400">
      <span className="font-medium uppercase tracking-wider text-gray-500">Sources</span>
      <span className="flex items-center gap-1.5">
        <span className="text-[#0a8078] underline decoration-[#0a8078]/40 underline-offset-2">
          SWFL Data Gulf
        </span>
        <span>our own data</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="text-[#60a5fa] underline decoration-[#60a5fa]/40 underline-offset-2">
          Websites
        </span>
        <span>outside sources</span>
      </span>
    </div>
  );
}
