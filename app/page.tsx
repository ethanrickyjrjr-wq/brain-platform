import type { Metadata } from "next";
import Hero from "@/components/landing/Hero";
import Capabilities from "@/components/landing/Capabilities";
import Waitlist from "@/components/landing/Waitlist";
import "@/components/landing/home-explorer.css";

export const metadata: Metadata = {
  title: "SWFL Data Gulf — AI Data Layer for Southwest Florida",
  description:
    "Ask anything about Southwest Florida — an address, ZIP, city, county, or corridor — and get a cited answer in seconds: flood risk, home values, permits, and market intelligence, delivered straight into Claude.",
};

export default function Home() {
  // Approved HOMEPAGE/ demo, integrated. Nav + footer are the global
  // SiteShell/SiteFooter from app/layout.tsx; this page is the hero+map explorer,
  // the capabilities/comparison section, then the waitlist (the CTA's #waitlist
  // target). `.home-explorer` scopes home-explorer.css.
  // Parked (files kept, not imported): ComparisonSection, MCPInstall, Charts —
  // not part of the approved demo. Re-add to this list to bring any back.
  return (
    <main className="home-explorer relative">
      <Hero />
      <Capabilities />
      <div id="waitlist">
        <Waitlist />
      </div>
    </main>
  );
}
