import { buildLedger } from "../../lib/ledger";
import { DonutChart, Link, tally } from "../ui";

export const revalidate = 300;

export default async function ReadPage() {
  const ledger = await buildLedger();
  const allItems = ledger.categories.flatMap((c) => c.items);
  const overall = tally(allItems);
  const total = allItems.length;
  const pct = total > 0 ? Math.round((overall.green / total) * 100) : 0;

  const redQueue = ledger.queue.filter((q) => q.status !== "green");

  return (
    <main className="wrap read-page">
      <p className="back-link">
        <Link href="/">← /ops dashboard</Link>
      </p>

      <h1>
        Fast Read <span className="ops-badge">/ops</span>
      </h1>
      <p className="subtitle mono" style={{ marginBottom: 0 }}>
        Structured summary for Claude ·{" "}
        <span className="ts">
          {ledger.generatedAt.slice(0, 16).replace("T", " ")} UTC
        </span>{" "}
        · 5 min cache ·{" "}
        <a href="/api/ledger" target="_blank" rel="noreferrer">
          raw JSON ↗
        </a>
      </p>

      {/* ── Overall health ── */}
      <div
        className="read-section"
        style={{ "--delay": "0s" } as React.CSSProperties}
      >
        <div className="read-section-title">Overall Health</div>
        <div className="read-summary-box">
          <div style={{ flexShrink: 0 }}>
            <DonutChart
              green={overall.green}
              yellow={overall.yellow}
              red={overall.red}
            />
          </div>
          <div className="read-summary-item">
            <span
              className="read-summary-num"
              style={{ color: "var(--green)" }}
            >
              {overall.green}
            </span>
            <span className="read-summary-label">Live</span>
          </div>
          <div className="read-summary-item">
            <span
              className="read-summary-num"
              style={{ color: "var(--yellow)" }}
            >
              {overall.yellow}
            </span>
            <span className="read-summary-label">Building</span>
          </div>
          <div className="read-summary-item">
            <span className="read-summary-num" style={{ color: "var(--red)" }}>
              {overall.red}
            </span>
            <span className="read-summary-label">Offline</span>
          </div>
          <div className="read-summary-item">
            <span
              className="read-summary-num"
              style={{ color: "var(--muted)" }}
            >
              {total}
            </span>
            <span className="read-summary-label">Total</span>
          </div>
          <div className="read-summary-item">
            <span
              className="read-summary-num"
              style={{
                color:
                  pct >= 80
                    ? "var(--green)"
                    : pct >= 50
                      ? "var(--yellow)"
                      : "var(--red)",
              }}
            >
              {pct}%
            </span>
            <span className="read-summary-label">Healthy</span>
          </div>
        </div>
        <div
          className="read-stat-row"
          style={{ marginTop: 12, marginBottom: 0 }}
        >
          <span style={{ color: "var(--green)" }}>
            GitHub {ledger.signals.github ? "✓" : "✗"}
          </span>
          <span style={{ color: "var(--green)" }}>
            Supabase {ledger.signals.supabase ? "✓" : "✗"}
          </span>
        </div>
      </div>

      {/* ── Per-category breakdown ── */}
      {ledger.categories.map((c, i) => {
        const t = tally(c.items);
        const catPct =
          c.items.length > 0 ? Math.round((t.green / c.items.length) * 100) : 0;
        const greens = c.items.filter((i) => i.status === "green");
        const yellows = c.items.filter((i) => i.status === "yellow");
        const reds = c.items.filter((i) => i.status === "red");

        return (
          <div
            key={c.key}
            className="read-section"
            style={{ "--delay": `${0.06 + i * 0.06}s` } as React.CSSProperties}
          >
            <div
              className="read-section-title"
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: c.dot,
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
              {c.title}
              <span
                className="note"
                style={{
                  marginLeft: "auto",
                  fontFamily: "IBM Plex Mono, monospace",
                  fontSize: 11,
                }}
              >
                {catPct}% healthy · {c.items.length} items
              </span>
            </div>

            <div className="read-stat-row">
              <span style={{ color: "var(--green)" }}>{t.green} live</span>
              {t.yellow > 0 && (
                <span style={{ color: "var(--yellow)" }}>
                  {t.yellow} building
                </span>
              )}
              {t.red > 0 && (
                <span style={{ color: "var(--red)" }}>{t.red} offline</span>
              )}
            </div>

            {greens.length > 0 && (
              <div className="read-list">
                <span className="read-list-label green">Live</span>
                {greens.map((item) => (
                  <span key={item.id} className="read-chip">
                    {item.label}
                    {item.updatedAt && (
                      <span style={{ color: "var(--muted)", marginLeft: 4 }}>
                        {item.updatedAt.slice(0, 10)}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            )}
            {yellows.length > 0 && (
              <div className="read-list">
                <span className="read-list-label yellow">Building</span>
                {yellows.map((item) => (
                  <span key={item.id} className="read-chip">
                    {item.label}
                  </span>
                ))}
              </div>
            )}
            {reds.length > 0 && (
              <div className="read-list">
                <span className="read-list-label red">Offline</span>
                {reds.map((item) => (
                  <span key={item.id} className="read-chip">
                    {item.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* ── Build queue actions ── */}
      {redQueue.length > 0 && (
        <div
          className="read-section"
          style={
            {
              "--delay": `${0.06 + ledger.categories.length * 0.06}s`,
            } as React.CSSProperties
          }
        >
          <div className="read-section-title">Next Actions — Build Queue</div>
          {redQueue.slice(0, 8).map((q) => (
            <div key={q.order} className="read-queue-item">
              <span className={`pill ${q.status}`}>{q.status}</span>
              <span>{q.label}</span>
            </div>
          ))}
          {redQueue.length > 8 && (
            <p
              className="note"
              style={{
                paddingTop: 8,
                borderTop: "1px solid var(--border)",
                marginTop: 4,
              }}
            >
              +{redQueue.length - 8} more in{" "}
              <Link href="/queue">build queue</Link>
            </p>
          )}
        </div>
      )}

      <footer>
        SWFL Data Gulf · /ops/read · structured for Claude ·{" "}
        <Link href="/">dashboard</Link> · <Link href="/queue">build queue</Link>{" "}
        ·{" "}
        <a href="/api/ledger" target="_blank" rel="noreferrer">
          raw JSON
        </a>
      </footer>
    </main>
  );
}
