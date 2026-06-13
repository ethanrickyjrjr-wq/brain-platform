import { COMPONENT_DEFAULTS, esc, readableText } from "./_shared";

// Section 3 (S3) Task 3B — badge. An inline-block pill <span>. Defaults to the
// ACCENT token; text color auto-picks black/white for contrast on the fill.

export function renderBadge(text: string, color?: string): string {
  const bg = color ?? COMPONENT_DEFAULTS.accent;
  const fg = readableText(bg);
  return (
    `<span style="display:inline-block;background:${esc(bg)};color:${fg};` +
    `font-family:${COMPONENT_DEFAULTS.font};font-size:11px;font-weight:bold;line-height:1;` +
    `padding:4px 10px;border-radius:999px;white-space:nowrap;">${esc(text)}</span>`
  );
}
