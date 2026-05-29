import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SWFL Data Gulf — /ops",
  description: "Live operations ledger. Status derived from real signals.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
