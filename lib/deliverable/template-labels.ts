/**
 * Human-facing labels for the deliverable template ids (ids mirror
 * DELIVERABLE_TEMPLATES in lib/deliverable/assemble.ts). One source of truth so the
 * Build dropdown, the Built-lane thumbnails, and the §I seed banner never drift.
 */
export const TEMPLATE_LABELS: Record<string, string> = {
  "market-overview": "Market overview",
  "bov-lite": "Broker opinion",
  "client-email": "Client email",
  "one-pager": "One-pager",
  email: "Email digest",
  "block-canvas": "Email",
};

export function templateLabel(id: string): string {
  return TEMPLATE_LABELS[id] ?? id;
}
