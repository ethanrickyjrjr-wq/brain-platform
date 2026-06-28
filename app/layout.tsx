import type { Metadata, Viewport } from "next";
import {
  Geist,
  Geist_Mono,
  Bricolage_Grotesque,
  IBM_Plex_Sans,
  IBM_Plex_Mono,
} from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { BriefcaseProvider } from "@/components/briefcase/BriefcaseProvider";
import { AppShell } from "@/components/briefcase/AppShell";
import { SiteShell } from "@/components/nav/SiteShell";
import { SiteFooter } from "@/components/nav/SiteFooter";
import { ResetZoomOnRouteChange } from "@/components/nav/ResetZoomOnRouteChange";
import { StandaloneBackBar } from "@/components/nav/StandaloneBackBar";
import { highlighterUiEnabled } from "@/lib/highlighter/flag";
import { HighlighterProvider } from "@/lib/highlighter/context";
import { GlobalHighlighter } from "@/components/highlighter/GlobalHighlighter";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// ── Nautical-chart type roles (additive root) ──────────────────────────────
// Declared site-wide so the tokens exist for every page, but the font FILES are
// only fetched by a browser when an element actually uses the family (today:
// the homepage). display:"swap" keeps text visible during load.
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.swfldatagulf.com"),
  title: {
    default: "SWFL Data Gulf — Southwest Florida Intelligence",
    template: "%s — SWFL Data Gulf",
  },
  description:
    "Public intelligence for Lee and Collier County operators — flood, freight, permits, rents, demographics, and macro signal, in one read.",
};

// Explicit base viewport — pinch-zoom stays enabled; ResetZoomOnRouteChange
// restores to this string after each in-app navigation's zoom reset.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Plain env read (not a dynamic API) — keeps the layout static. Gates the whole
  // highlighter root (provider + GlobalHighlighter) and tells AppShell whether a /r/*
  // bridged pill can appear (flag ON) or whether it is the /r/* standalone fallback.
  const highlighterEnabled = highlighterUiEnabled();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${bricolage.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* BriefcaseProvider owns the anonymous draft globally (A-2) so the unified
            pill + highlighter both file into it on every page, on or off /r/*. */}
        <Toaster theme="dark" position="bottom-right" richColors />
        <BriefcaseProvider>
          {/* Reset mobile pinch-zoom to fit-width on every in-app navigation. */}
          <ResetZoomOnRouteChange />
          {/* "← Back" for white-label pages (/p/*, /embed/*) that render no nav shell. */}
          <StandaloneBackBar />
          {/* B1: the ONE auth-aware nav shell — home variant on `/`, solid app bar
              everywhere else, nothing on the white-label/auth prefixes. Replaces the
              old split (Header on `/` only + GlobalNav elsewhere) that sealed home. */}
          <SiteShell />
          {/* Phase 3C — the highlighter is now the app-root, selection-triggered twin of
              the click-triggered pill. HighlighterProvider (chipFact + conversation thread)
              is LIFTED here from the 5 per-/r/* pages, so GlobalHighlighter + the bridged
              AppShell pill share ONE thread across the whole site. The flag gates the entire
              root: when OFF, no provider mounts (MetricsTable falls back to plain spans, no
              dead FactChips) and AppShell renders only its standalone fallback. */}
          {highlighterEnabled ? (
            <HighlighterProvider>
              {children}
              {/* The ONE global footer sitemap, suppressed on the white-label/auth prefixes. */}
              <SiteFooter />
              {/* The ONE highlighter — popup + coachmark + ticker only, NO pill. */}
              <GlobalHighlighter />
              {/* The ONE pill — bridged on /r/* (report context published), else standalone. */}
              <AppShell />
            </HighlighterProvider>
          ) : (
            <>
              {children}
              <SiteFooter />
              <AppShell />
            </>
          )}
        </BriefcaseProvider>
      </body>
    </html>
  );
}
