import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { BriefcaseProvider } from "@/components/briefcase/BriefcaseProvider";
import { AppShell } from "@/components/briefcase/AppShell";
import { SiteShell } from "@/components/nav/SiteShell";
import { SiteFooter } from "@/components/nav/SiteFooter";
import { highlighterUiEnabled } from "@/lib/highlighter/flag";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Plain env read (not a dynamic API) — keeps the layout static. Passed to the
  // client AppShell so the standalone pill knows whether a per-/r/* bridged pill
  // will appear (and so suppress there) or whether it is the /r/* fallback.
  const highlighterEnabled = highlighterUiEnabled();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {/* BriefcaseProvider owns the anonymous draft globally (A-2) so the unified
            pill files into it on every page, on or off /r/*. The highlighter
            conversation thread stays per-/r/* page (HighlighterProvider). */}
        <BriefcaseProvider>
          {/* B1: the ONE auth-aware nav shell — home variant on `/`, solid app bar
              everywhere else, nothing on the white-label/auth prefixes. Replaces the
              old split (Header on `/` only + GlobalNav elsewhere) that sealed home. */}
          <SiteShell />
          {children}
          {/* B1: the ONE global footer sitemap (orphan safety-net + legal surface),
              suppressed on the same white-label/auth prefixes as the shell. */}
          <SiteFooter />
          {/* A-3: the ONE global AI+Briefcase pill (standalone mode). It suppresses
              on /r/* when the highlighter's per-page bridged pill is active, so there
              is always exactly one visible pill. */}
          <AppShell highlighterEnabled={highlighterEnabled} />
        </BriefcaseProvider>
      </body>
    </html>
  );
}
