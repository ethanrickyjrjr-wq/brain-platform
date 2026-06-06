import type { Metadata } from "next";
import Header from "@/components/landing/Header";
import Hero from "@/components/landing/Hero";
import ComparisonSection from "@/components/landing/ComparisonSection";
import MCPInstall from "@/components/landing/MCPInstall";
import Charts from "@/components/landing/Charts";
import Waitlist from "@/components/landing/Waitlist";
import Footer from "@/components/landing/Footer";

export const metadata: Metadata = {
  title: "SWFL Data Gulf — AI Data Layer for Southwest Florida",
  description:
    "Real-time property, labor, permits, CRE, and market intelligence for Lee + Collier counties — cited, sourced, delivered straight into Claude.",
};

export default function Home() {
  return (
    <main className="relative">
      <Header />
      <Hero />
      <ComparisonSection />
      <MCPInstall />
      <Charts />
      <Waitlist />
      <Footer />
    </main>
  );
}
