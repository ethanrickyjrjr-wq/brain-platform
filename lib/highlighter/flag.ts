/**
 * Server-side gate for the in-page Highlighter UI.
 *
 * The server engine (`/api/converse` + the usage meter) ships and runs
 * independently of this flag — it's fully tested and live-verified. This gate
 * controls ONLY whether a report page mounts the client popup / coachmark.
 *
 * Default OFF: the popup's browser layer (DOM render, text selection,
 * positioning, mobile chips) has not been driven in a real browser yet, so it
 * must never render on prod by default. Flip `HIGHLIGHTER_UI=1` in the
 * environment once the popup is browser-verified.
 */
export function highlighterUiEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const v = env.HIGHLIGHTER_UI;
  return v === "1" || v === "true";
}
