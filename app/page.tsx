import type { Metadata } from "next";
import InstallTabs from "./install-tabs";
import WaitlistForm from "./waitlist-form";

export const metadata: Metadata = {
  title: "Connect — SWFL Data Gulf",
  description:
    "Install the SWFL Data Gulf into your AI. One command. Analyst-grade Southwest Florida data — housing, CRE, permits, traffic, macro.",
};

export default function ConnectPage() {
  return (
    <main
      style={{
        background: "#0A1419",
        color: "#F0EDE6",
        minHeight: "100dvh",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* Nav */}
      <nav
        style={{
          borderBottom: "1px solid #152832",
          padding: "16px 32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 14,
            color: "#3DC9C0",
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          SWFL Data Gulf
        </span>
        <a
          href="/privacy"
          style={{ color: "#8BAAB8", fontSize: 13, textDecoration: "none" }}
        >
          Privacy
        </a>
      </nav>

      <div
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "64px 32px 80px",
          display: "flex",
          flexDirection: "column",
          gap: 64,
        }}
      >
        {/* Hero */}
        <section
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            textAlign: "center",
            alignItems: "center",
          }}
        >
          <h1
            style={{
              fontSize: "clamp(2.5rem, 7vw, 5.25rem)",
              fontWeight: 600,
              letterSpacing: "-0.035em",
              lineHeight: 1.04,
              margin: 0,
              color: "#F0EDE6",
              textWrap: "balance" as const,
            }}
          >
            Real <span style={{ color: "#3DC9C0" }}>data</span> Brought Together
            <br />
            With Your <span style={{ color: "#3DC9C0" }}>AI</span>.
          </h1>
          <p
            style={{
              fontSize: "clamp(1rem, 1.4vw, 1.1875rem)",
              color: "#B8CDD8",
              lineHeight: 1.55,
              margin: 0,
              maxWidth: "56ch",
              textWrap: "balance" as const,
            }}
          >
            Lee + Collier corridor data, environmental risk, freight nowcast,
            SBA franchise outcomes — every number cited, every source linked,
            delivered straight into Claude.
          </p>
        </section>

        {/* Install */}
        <section style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <h2
            style={{
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#8BAAB8",
              margin: 0,
            }}
          >
            Install
          </h2>
          <InstallTabs />
        </section>

        {/* Divider */}
        <hr
          style={{ border: "none", borderTop: "1px solid #152832", margin: 0 }}
        />

        {/* Waitlist */}
        <section style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <h2
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                margin: "0 0 6px",
                color: "#F0EDE6",
              }}
            >
              Be first in line
            </h2>
            <p style={{ color: "#8BAAB8", fontSize: 14, margin: 0 }}>
              Drop your email and pick what you want to hear about. One email
              per update.
            </p>
          </div>
          <WaitlistForm />
        </section>

        {/* Divider */}
        <hr
          style={{ border: "none", borderTop: "1px solid #152832", margin: 0 }}
        />

        {/* Support */}
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              margin: 0,
              color: "#F0EDE6",
            }}
          >
            Need help?
          </h2>
          <p
            style={{
              color: "#B8CDD8",
              fontSize: 14,
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            Stuck on install or want a walkthrough? We&apos;re async only — ping
            us in the support channel and we&apos;ll get back within a business
            day.
          </p>
          <a
            href="#"
            style={{
              display: "inline-block",
              background: "rgba(61,201,192,0.08)",
              border: "1px solid #22414F",
              color: "#3DC9C0",
              padding: "10px 20px",
              borderRadius: 6,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 13,
              textDecoration: "none",
              width: "fit-content",
            }}
          >
            Open support channel →
          </a>
        </section>
      </div>

      {/* Footer */}
      <footer
        style={{
          borderTop: "1px solid #152832",
          padding: "16px 32px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <span
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12,
            color: "#22414F",
          }}
        >
          swfldatagulf.com
        </span>
        <a
          href="/privacy"
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12,
            color: "#22414F",
            textDecoration: "none",
          }}
        >
          Privacy
        </a>
      </footer>
    </main>
  );
}
