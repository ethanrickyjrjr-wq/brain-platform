import { ZHVIAreaChart } from "@/components/viz";
import type { ZHVITrendEntry } from "@/types/viz";
import { createServiceRoleClient } from "@/utils/supabase/service-role";

export const revalidate = 3600;

export default async function ChartsPage() {
  let zhvi: ZHVITrendEntry[] = [];
  let asOf: string | undefined;
  let rowCount = 0;
  let error: string | null = null;

  try {
    const supabase = createServiceRoleClient();
    const { data, error: sbError } = await supabase
      .schema("data_lake")
      .from("zhvi_pivoted")
      .select("month, cape_coral, fort_myers, naples")
      .order("month", { ascending: true });

    if (sbError) {
      error = sbError.message;
    } else if (data) {
      rowCount = data.length;
      // Filter to non-nullable rows before passing to ZHVIAreaChart
      zhvi = data.filter(
        (
          m,
        ): m is {
          month: string;
          cape_coral: number;
          fort_myers: number;
          naples: number;
        } => m.cape_coral != null && m.fort_myers != null && m.naples != null,
      );
      // asOf = latest month in the sorted result
      if (zhvi.length > 0) {
        asOf = zhvi[zhvi.length - 1].month;
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <main
      style={{
        background: "#0A1419",
        color: "#F0EDE6",
        minHeight: "100dvh",
        padding: "32px",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: "960px",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: "24px",
        }}
      >
        <header>
          <h1
            style={{
              margin: 0,
              fontSize: 24,
              fontWeight: 700,
              color: "#F0EDE6",
            }}
          >
            SWFL Market Charts
          </h1>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 13,
              color: "#807E76",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            {rowCount > 0
              ? `${rowCount} months loaded from data_lake.zhvi_pivoted`
              : error
                ? `Data unavailable: ${error}`
                : "Loading…"}
          </p>
        </header>

        <section
          style={{
            background: "#152832",
            border: "1px solid #22414F",
            borderRadius: 12,
            padding: 24,
          }}
        >
          <header style={{ marginBottom: 16 }}>
            <h2
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 600,
                color: "#F0EDE6",
              }}
            >
              Home values across SWFL
            </h2>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 13,
                color: "#807E76",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              Zillow ZHVI · Cape Coral · Fort Myers · Naples
            </p>
          </header>
          <ZHVIAreaChart data={zhvi} loading={false} asOf={asOf} />
        </section>
      </div>
    </main>
  );
}
