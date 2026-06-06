import Image from "next/image";
import type { ReactNode } from "react";

/**
 * Shared chrome for every /r/ report read, so all pages render identical
 * structure, spacing, and color — only the data inside differs. Before this,
 * each page hand-rolled its own shell/header/footer and they drifted (gray vs
 * white numbers, plain-text vs badged trends, different footer sizes). These
 * are now the single source: one shell, one header, one footer, one Meta/Chip/
 * Stat/SectionTitle.
 */

/** Outer page frame — dark gulf canvas + centered column. `width="2xl"` narrows
 *  it for focused single-subject cards (the per-ZIP report); everything else
 *  uses the default 4xl. Classes are literal (not interpolated) so Tailwind's
 *  scanner emits them. */
export function ReportShell({
  children,
  width = "4xl",
}: {
  children: ReactNode;
  width?: "2xl" | "4xl";
}) {
  const main =
    width === "2xl"
      ? "mx-auto max-w-2xl px-6 py-12 sm:px-8 sm:py-16"
      : "mx-auto max-w-4xl px-6 py-12 sm:px-8 sm:py-16";
  return (
    <div className="min-h-dvh bg-navy-dark font-sans text-white">
      <main className={main}>{children}</main>
    </div>
  );
}

/** Logo eyebrow + brand + title, with the standard bottom rule. Page-specific
 *  subtitle/chips/meta go in `children`. */
export function ReportHeader({
  title,
  children,
}: {
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="border-b border-white/10 pb-6">
      <div className="flex items-center gap-2 text-gray-400">
        <Image
          src="/logo.png"
          alt="SWFL Data Gulf"
          width={28}
          height={28}
          className="h-7 w-7 rounded-lg"
        />
        <p className="text-xs uppercase tracking-wider">SWFL Data Gulf</p>
      </div>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        {title}
      </h1>
      {children}
    </header>
  );
}

/** Logo + brand + freshness token. `children` for extra footer links, `note`
 *  for a small disclaimer line (the provenance page uses it). */
export function ReportFooter({
  freshnessToken,
  note,
  children,
}: {
  freshnessToken?: string;
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <footer className="mt-12 border-t border-white/10 pt-6 text-sm text-gray-500">
      <div className="flex items-center gap-2">
        <Image
          src="/logo.png"
          alt=""
          width={16}
          height={16}
          className="h-4 w-4 rounded"
        />
        <span>
          SWFL Data Gulf
          {freshnessToken && (
            <>
              {" · "}
              <code className="text-xs text-[#00d4aa]">{freshnessToken}</code>
            </>
          )}
        </span>
      </div>
      {children && <div className="mt-2">{children}</div>}
      {note && <p className="mt-2 text-xs">{note}</p>}
    </footer>
  );
}

/** One section heading style for every report. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-xl font-semibold tracking-tight text-white">
      {children}
    </h2>
  );
}

export function Meta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-gray-400">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-white">{value}</dd>
    </div>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-xs text-gray-300">
      {children}
    </span>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.06] px-3 py-1.5 text-sm">
      <span className="text-xs text-gray-400">{label}: </span>
      <span className="font-mono text-white">{value}</span>
    </div>
  );
}
