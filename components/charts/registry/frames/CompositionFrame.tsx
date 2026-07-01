import type { ChartSpec, ChartTheme } from "../chart-spec";
import { extendPalette } from "@/lib/charts/palette";

/**
 * CompositionFrame — generic segmented / stacked bar showing parts of a whole,
 * with an optional magnitude callout (e.g. "357× flood multiplier").
 *
 * Parameterized for any domain; the flood/SFHA exposure composition is the
 * reference use-case but `segments` and `callout` are fully caller-supplied.
 *
 * spec.options shape:
 *   segments: Array<{ label: string; valuePct: number; color?: string }>
 *   callout?: string   — big-bold emphasis text, e.g. "357× AAL multiplier"
 *
 * Rendering is pure Tailwind + inline CSS widths; no chart library required.
 */

export interface CompositionSegment {
  label: string;
  valuePct: number;
  color?: string;
}

export interface CompositionData {
  segments: CompositionSegment[];
  callout: string | undefined;
}

/**
 * Pure data-adapter — the only logic tested unit-style.
 * Exported so tests can import it without a DOM environment.
 */
export function extractCompositionData(options: Record<string, unknown>): CompositionData {
  const rawSegments = options.segments;
  const callout = typeof options.callout === "string" ? options.callout : undefined;

  if (!Array.isArray(rawSegments)) {
    return { segments: [], callout };
  }

  const segments: CompositionSegment[] = rawSegments
    .filter(
      (s): s is Record<string, unknown> => s !== null && typeof s === "object" && !Array.isArray(s),
    )
    .map((s) => ({
      label: typeof s.label === "string" ? s.label : "",
      valuePct: typeof s.valuePct === "number" ? s.valuePct : 0,
      color: typeof s.color === "string" ? s.color : undefined,
    }));

  return { segments, callout };
}

// CompositionFrame renders on a dark neutral-900 (#171717) canvas.
const COMPOSITION_BG = "#171717";

/**
 * Resolved fill per segment: explicit seg.color wins, else on-brand distinct
 * extras from extendPalette (grayscale-distinct, visible on the dark canvas).
 * Pure + DOM-free so it can be unit-tested without jsdom.
 */
export function resolveCompositionColors(
  segments: { color?: string }[],
  theme?: ChartTheme,
): string[] {
  const anchor = theme?.accent ?? theme?.primary ?? "#3dc9c0";
  const gen = extendPalette([anchor], segments.length, { background: COMPOSITION_BG });
  return segments.map((s, i) => s.color ?? gen[i] ?? anchor);
}

export function CompositionFrame({ spec }: { spec: ChartSpec }) {
  const { segments, callout } = extractCompositionData(spec.options ?? {});
  const colors = resolveCompositionColors(segments, spec.theme);

  return (
    <div className="flex h-full flex-col gap-4 bg-neutral-900 p-6 text-white">
      {/* Title */}
      <h2 className="text-lg font-semibold leading-tight text-white">{spec.title}</h2>

      {/* Optional callout — prominent magnitude emphasis */}
      {callout && (
        <div className="rounded-lg bg-neutral-800 px-4 py-3 text-center">
          <span className="text-2xl font-bold tracking-tight text-amber-400">{callout}</span>
        </div>
      )}

      {/* Stacked / segmented horizontal bar */}
      {segments.length > 0 && (
        <div className="space-y-3">
          {/* Bar */}
          <div className="flex h-8 w-full overflow-hidden rounded-md">
            {segments.map((seg, i) => (
              <div
                key={seg.label}
                style={{
                  width: `${Math.max(seg.valuePct, 0)}%`,
                  backgroundColor: colors[i],
                }}
                title={`${seg.label}: ${seg.valuePct.toFixed(1)}%`}
              />
            ))}
          </div>

          {/* Legend */}
          <ul className="space-y-1.5">
            {segments.map((seg, i) => {
              const color = colors[i];
              return (
                <li key={seg.label} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="h-3 w-3 flex-shrink-0 rounded-sm"
                      style={{ backgroundColor: color }}
                    />
                    <span className="truncate text-sm text-neutral-200">{seg.label}</span>
                  </div>
                  <span className="flex-shrink-0 text-sm font-medium tabular-nums text-white">
                    {seg.valuePct.toFixed(1)}%
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Bottom caption: asOf + source */}
      <div className="mt-auto space-y-0.5 text-xs text-neutral-500">
        <p>As of {spec.asOf}</p>
        {spec.source?.citation && <p>{spec.source.citation}</p>}
      </div>
    </div>
  );
}
