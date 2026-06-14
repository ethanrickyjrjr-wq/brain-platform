import { BADGE_BASE, badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { citationLink, type WelcomeMetricSource } from "@/lib/welcome/frames";

/**
 * Per-number provenance pill: "fema.gov · 2026-05". Links to the in-app provenance
 * page when the backend supplied one, else the direct source URL. Default-deny:
 * `citationLink` masks the host + drops the link if the source looks internal
 * (data_lake/supabase/etc.), so a slipped raw URL never reaches the DOM. Built on
 * the shared Badge styles + the FactChip tap/hover affordance.
 */
export function CitationChip({ source }: { source: WelcomeMetricSource }) {
  const { href, domain } = citationLink(source);
  const base = cn(BADGE_BASE, badgeVariants.outline, "max-w-full");
  const label = `Source: ${source.citation} (as of ${source.as_of})`;
  const inner = (
    <>
      <span className="truncate">{domain}</span>
      <span className="text-text-tertiary">·</span>
      <span className="tabular-nums">{source.as_of}</span>
    </>
  );

  if (!href) {
    return (
      <span className={base} title={source.citation} aria-label={label}>
        {inner}
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={source.citation}
      aria-label={label}
      className={cn(
        base,
        "cursor-pointer transition-colors hover:border-[var(--brand-primary,#0a8078)]/60 hover:text-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--brand-primary,#0a8078)]/60",
      )}
    >
      {inner}
    </a>
  );
}
