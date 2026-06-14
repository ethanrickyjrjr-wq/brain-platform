import { RadialConfidenceGauge } from "@/components/charts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type MasterPayload = {
  freshness_token?: string;
  confidence?: number;
  updated_at?: string;
};

async function fetchMaster(): Promise<MasterPayload | null> {
  try {
    const res = await fetch("https://www.swfldatagulf.com/api/b/master?view=speak&tier=2", {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return (await res.json()) as MasterPayload;
  } catch {
    return null;
  }
}

export default async function EmbedFooterTokenPage() {
  const master = await fetchMaster();
  const token = master?.freshness_token ?? "SWFL-7421-vX-pending";
  const confidence = typeof master?.confidence === "number" ? master.confidence : 0.78;
  const confidencePct = Math.round(confidence * 100);

  return (
    <main
      style={{
        background: "#0A1419",
        color: "#F0EDE6",
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 32,
          background: "#152832",
          border: "1px solid #22414F",
          borderRadius: 12,
          padding: "24px 32px",
        }}
      >
        <RadialConfidenceGauge confidence={confidence} />
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div
            style={{
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "#807E76",
            }}
          >
            Master brain — live
          </div>
          <div
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 14,
              color: "#0a8078",
            }}
          >
            {token}
          </div>
          <div style={{ fontSize: 14, color: "#B8B4A8" }}>
            Confidence: <span style={{ color: "#F0EDE6", fontWeight: 600 }}>{confidencePct}%</span>
          </div>
          <a
            href="https://www.swfldatagulf.com/r/master"
            style={{
              fontSize: 13,
              color: "#0a8078",
              textDecoration: "none",
              marginTop: 4,
            }}
          >
            See what we know →
          </a>
        </div>
      </div>
    </main>
  );
}
