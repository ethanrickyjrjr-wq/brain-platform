/**
 * Color legend for report pages — the two-color system the operator locked:
 *   • OUR computed figures render in data-blue (#4f9cf9)
 *   • anything that links out to an OUTSIDE source keeps the teal hyperlink
 *     color (#00d4aa)
 * Shown at the bottom of every /r/ read so a first-time reader can tell our own
 * numbers from the outside sources they're verified against at a glance.
 *
 * Color only works HERE (we own the CSS). The MCP connector answer is plain
 * Markdown — no text color, inline HTML stripped — so in chat the same split is
 * carried by "it's a link (outside) vs it's a plain figure (ours)", not color.
 */
export function ColorLegend() {
  return (
    <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-xs text-gray-400">
      <span className="font-medium uppercase tracking-wider text-gray-500">
        How to read the numbers
      </span>
      <span className="flex items-center gap-1.5">
        <span className="font-mono font-medium text-[#4f9cf9]">123.4</span>
        <span>= our own SWFL Data Gulf figure</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="text-[#00d4aa] underline decoration-[#00d4aa]/40 underline-offset-2">
          source
        </span>
        <span>= outside source — click to verify</span>
      </span>
    </div>
  );
}
