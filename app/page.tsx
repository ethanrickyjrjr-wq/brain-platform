import type { Metadata } from "next";
import Hero from "@/components/landing/Hero";
import ComparisonSection from "@/components/landing/ComparisonSection";
import MCPInstall from "@/components/landing/MCPInstall";
import Charts from "@/components/landing/Charts";
import Waitlist from "@/components/landing/Waitlist";

export const metadata: Metadata = {
  title: "SWFL Data Gulf — AI Data Layer for Southwest Florida",
  description:
    "Real-time property, labor, permits, CRE, and market intelligence for Lee + Collier counties — cited, sourced, delivered straight into Claude.",
};

export default function Home() {
  // The nav + footer are now the global SiteShell/SiteFooter from app/layout.tsx
  // (the home variant of the shell renders the marketing bar). This page is just
  // the hero + marketing sections.
  return (
    <main className="relative">
      <Hero />
      <ComparisonSection />
      <MCPInstall />
      <Charts />
      <Waitlist />
    </main>
  );
}
