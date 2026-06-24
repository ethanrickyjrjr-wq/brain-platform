export type MaterialStatus = "draft" | "needs_update" | "archived";

/** Age beyond which a material's data is flagged for refresh. */
const STALE_MS = 30 * 86_400_000;

export function getMaterialStatus(d: {
  deleted_at: string | null;
  data_as_of: string | null;
}): MaterialStatus {
  if (d.deleted_at) return "archived";
  if (d.data_as_of && Date.now() - new Date(d.data_as_of).getTime() > STALE_MS)
    return "needs_update";
  return "draft";
}

export interface FormatBadge {
  label: string;
  color: string;
  bg: string;
}

const FORMAT_BADGES: Record<string, FormatBadge> = {
  "block-canvas": { label: "email", color: "#1BB8C9", bg: "bg-[#1BB8C9]/15" },
  "client-email": { label: "email", color: "#1BB8C9", bg: "bg-[#1BB8C9]/15" },
  email: { label: "digest", color: "#f97316", bg: "bg-[#f97316]/15" },
  "market-overview": { label: "overview", color: "#f97316", bg: "bg-[#f97316]/15" },
  "one-pager": { label: "one-pager", color: "#8b5cf6", bg: "bg-[#8b5cf6]/15" },
  "bov-lite": { label: "BOV", color: "#f43f5e", bg: "bg-[#f43f5e]/15" },
  social: { label: "social", color: "#22c55e", bg: "bg-[#22c55e]/15" },
};

export function getFormatBadge(template: string): FormatBadge {
  return FORMAT_BADGES[template] ?? { label: template, color: "#ffffff", bg: "bg-white/10" };
}
