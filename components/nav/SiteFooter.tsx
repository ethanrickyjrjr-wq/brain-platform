"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import DigestSubscribe from "@/components/email/DigestSubscribe";
import { isHiddenPath } from "./nav-config";

/**
 * The ONE global footer — a real sitemap ("doormat navigation"), mounted once in the
 * root layout and shown on every page EXCEPT SHELL_HIDDEN_PREFIXES (so `/p/*`+`/embed/*`
 * stay white-label clean and the auth screens stay focused). Before B1 the footer lived
 * only on home, so every app page had zero privacy/terms link (a compliance gap) and the
 * long-tail pages (`/map`,`/showcase`,`/support`,`/demo`,`/ask`) had no inbound chrome
 * link at all (Root-cause R3). This footer is the orphan safety-net + the legal surface.
 *
 * Internal-only pages (`/data-intel`, `/ops/*`) are intentionally omitted (B6).
 */

const FOOTER_COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Explore",
    links: [
      { label: "Search", href: "/r" },
      { label: "Maps", href: "/map" },
      { label: "Charts", href: "/charts" },
      // /r/zip-report has no index route (dynamic-only) — send people to the search entry.
      { label: "ZIP Reports", href: "/r/search" },
      { label: "Showcase", href: "/showcase" },
      { label: "Demo", href: "/demo" },
      { label: "Projects", href: "/project" },
      { label: "Alerts", href: "/alerts" },
      { label: "Ask AI", href: "/ask" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Support", href: "/support" },
      // Marketing anchors live on home — prefix with "/" so they work from any page.
      { label: "Install MCP", href: "/#install" },
      { label: "API Reference", href: "/api/b/master" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
];

export function SiteFooter() {
  const pathname = usePathname();
  if (isHiddenPath(pathname)) return null;

  return (
    <footer className="relative z-10 border-t border-white/5 bg-navy-dark">
      <div className="mx-auto max-w-7xl px-6 py-16 md:px-8 md:py-20">
        <div className="mb-12 grid gap-12 md:grid-cols-4">
          {/* Brand blurb */}
          <div>
            <div className="mb-4 flex items-center gap-3">
              <Image src="/logo.png" alt="" width={40} height={40} className="rounded-lg" />
              <span className="text-lg font-semibold tracking-tight text-white">
                SWFL Data Gulf
              </span>
            </div>
            <p className="text-sm leading-relaxed text-gray-400">
              AI-ready data layer for Southwest Florida. Property, labor, permits, CRE, and tourism
              intelligence — every number cited, every source linked.
            </p>
          </div>

          {/* Sitemap columns (doormat navigation) */}
          <nav aria-label="Footer" className="grid gap-12 sm:grid-cols-3 md:col-span-3">
            {FOOTER_COLUMNS.map((col) => (
              <div key={col.title}>
                <h2 className="mb-4 font-semibold text-white">{col.title}</h2>
                <ul className="space-y-3">
                  {col.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="text-sm text-gray-400 transition-colors hover:text-teal-primary"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* Customer-engagement block (NN/g validated footer element). */}
        <div className="mb-12 max-w-2xl">
          <DigestSubscribe source="footer" />
        </div>

        <div className="flex flex-col items-center justify-between gap-6 border-t border-white/5 pt-8 md:flex-row">
          <div className="text-sm text-gray-500">
            {/* suppressHydrationWarning: the year is wall-clock; a CDN response cached
                across a New-Year boundary would otherwise warn on the 1-year mismatch. */}
            <p suppressHydrationWarning>
              © {new Date().getFullYear()} SWFL Data Gulf. All rights reserved.
            </p>
            <p className="mt-1 text-xs">Lee + Collier county data. Every number cited.</p>
          </div>
          <div className="glass-card-modern flex items-center gap-2 rounded-full border border-white/10 px-4 py-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-teal-primary" />
            <span className="text-xs text-gray-400">Systems Operational</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
