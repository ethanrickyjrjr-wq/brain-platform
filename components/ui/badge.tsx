import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** Shared pill base — exported so a link-styled chip (CitationChip) can reuse the
 *  exact look on an <a> without routing through this <span> component. */
export const BADGE_BASE =
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-none whitespace-nowrap";

export const badgeVariants = {
  /** Brand-filled — uses the incoming brand var, falls back to gulf teal. */
  default: "border-transparent bg-[var(--brand-primary,#0a8078)] text-text-on-accent",
  secondary: "border-white/10 bg-white/[0.06] text-text-secondary",
  outline: "border-white/15 bg-transparent text-text-secondary",
} as const;

export type BadgeVariant = keyof typeof badgeVariants;

export function Badge({
  className,
  variant = "secondary",
  ...props
}: ComponentProps<"span"> & { variant?: BadgeVariant }) {
  return (
    <span
      data-slot="badge"
      className={cn(BADGE_BASE, badgeVariants[variant], className)}
      {...props}
    />
  );
}
