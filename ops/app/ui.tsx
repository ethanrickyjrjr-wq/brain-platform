import Link from "next/link";
import type { Category, LedgerItem } from "../lib/ledger";

export function Pill({ status }: { status: LedgerItem["status"] }) {
  return <span className={`pill ${status}`}>{status}</span>;
}

// ── SVG Donut Chart ───────────────────────────────────────────────────────────
export function DonutChart({
  green: g,
  yellow: y,
  red: r,
}: {
  green: number;
  yellow: number;
  red: number;
}) {
  const total = g + y + r || 1;
  const pct = Math.round((g / total) * 100);
  const SIZE = 56,
    CX = 28,
    CY = 28,
    R = 20,
    SW = 6;
  const C = 2 * Math.PI * R;

  const segments = [
    { value: g, color: "#4ade80", start: 0 },
    { value: y, color: "#fcd34d", start: g / total },
    { value: r, color: "#f87171", start: (g + y) / total },
  ].filter((s) => s.value > 0);

  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="donut"
    >
      {/* Track */}
      <circle
        cx={CX}
        cy={CY}
        r={R}
        fill="none"
        stroke="#16252c"
        strokeWidth={SW}
      />
      {/* Coloured segments */}
      {segments.map((s, i) => {
        const arc = (s.value / total) * C;
        const startDeg = s.start * 360 - 90;
        return (
          <circle
            key={i}
            cx={CX}
            cy={CY}
            r={R}
            fill="none"
            stroke={s.color}
            strokeWidth={SW}
            strokeDasharray={`${arc} ${C - arc}`}
            strokeLinecap="butt"
            transform={`rotate(${startDeg} ${CX} ${CY})`}
          />
        );
      })}
      {/* Centre label */}
      <text
        x={CX}
        y={CY + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="9"
        fontWeight="700"
        fill="#e2eef2"
        fontFamily="IBM Plex Mono, monospace"
      >
        {pct}%
      </text>
    </svg>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────
function ProgressBar({ pct }: { pct: number }) {
  const color =
    pct >= 80 ? "var(--green)" : pct >= 50 ? "var(--yellow)" : "var(--red)";
  return (
    <div className="progress-wrap">
      <div className="progress-track">
        <div
          className="progress-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="progress-pct">{pct}%</span>
    </div>
  );
}

// ── Category Recap ────────────────────────────────────────────────────────────
function CategoryRecap({ cat }: { cat: Category }) {
  const t = tally(cat.items);
  const total = cat.items.length;
  if (total === 0) return null;
  const pct = Math.round((t.green / total) * 100);
  const today = new Date().toISOString().slice(0, 10);
  const wins = cat.items.filter(
    (i) => i.status === "green" && i.updatedAt?.slice(0, 10) === today,
  );
  const reds = cat.items.filter((i) => i.status === "red");
  const yellows = cat.items.filter((i) => i.status === "yellow");
  const allGood =
    reds.length === 0 && wins.length === 0 && yellows.length === 0;

  return (
    <div className="recap">
      <div className="recap-head">
        <span className="recap-title">Section Recap</span>
        <ProgressBar pct={pct} />
      </div>

      {allGood && <p className="note recap-ok">All signals nominal ✓</p>}

      {wins.length > 0 && (
        <div className="recap-row">
          <span className="recap-tag green">Today</span>
          <div className="recap-chips">
            {wins.map((w) => (
              <span key={w.id} className="chip chip-green">
                {w.label}
              </span>
            ))}
          </div>
        </div>
      )}
      {yellows.length > 0 && (
        <div className="recap-row">
          <span className="recap-tag yellow">In flight</span>
          <div className="recap-chips">
            {yellows.map((y) => (
              <span key={y.id} className="chip chip-yellow">
                {y.label}
              </span>
            ))}
          </div>
        </div>
      )}
      {reds.length > 0 && (
        <div className="recap-row">
          <span className="recap-tag red">Needs attention</span>
          <div className="recap-chips">
            {reds.slice(0, 6).map((r) => (
              <span key={r.id} className="chip chip-red">
                {r.label}
              </span>
            ))}
            {reds.length > 6 && (
              <span className="note">+{reds.length - 6} more</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Category table ────────────────────────────────────────────────────────────
export function CategoryTable({ cat }: { cat: Category }) {
  if (cat.items.length === 0) {
    return (
      <p className="note empty-note">
        No items — signal unavailable (check env / PAT).
      </p>
    );
  }
  const dataCols = cat.columns.slice(1, -1);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {cat.columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cat.items.map((it) => (
            <tr key={it.id} data-status={it.status}>
              <td className="name">
                {it.link ? (
                  <a href={it.link} target="_blank" rel="noreferrer">
                    {it.label}
                  </a>
                ) : (
                  it.label
                )}
                {it.note && <div className="row-note">{it.note}</div>}
              </td>
              {dataCols.map((c) => {
                const isDateCol =
                  c === "Last load" || c === "Last run" || c === "Refined at";
                const val = it.cols[c] ?? "—";
                const age =
                  isDateCol && it.status !== "green" && val !== "—"
                    ? daysAgo(val)
                    : null;
                return (
                  <td
                    key={c}
                    className={
                      isDateCol || c === "Result" ? "mono note" : "note"
                    }
                  >
                    {val}
                    {age !== null && (
                      <span
                        style={{
                          marginLeft: 5,
                          opacity: 0.65,
                          fontSize: "0.82em",
                        }}
                      >
                        {age}d ago
                      </span>
                    )}
                  </td>
                );
              })}
              <td>
                <Pill status={it.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Category section (header + table + recap) ─────────────────────────────────
export function CategorySection({
  cat,
  index = 0,
}: {
  cat: Category;
  index?: number;
}) {
  const t = tally(cat.items);
  const delay = `${0.18 + index * 0.07}s`;
  return (
    <section
      className="category"
      style={{ "--delay": delay } as React.CSSProperties}
    >
      <div className="category-header">
        <span
          className="cat-dot"
          style={{
            background: cat.dot,
            boxShadow: `0 0 8px ${cat.dot}99`,
          }}
        />
        <span className="cat-title">{cat.title}</span>
        <div className="cat-chart-wrap">
          <DonutChart green={t.green} yellow={t.yellow} red={t.red} />
          <div className="cat-stats">
            <span className="stat-num-sm" style={{ color: "var(--green)" }}>
              {t.green}
            </span>
            <span className="stat-sym">✓</span>
            <span className="stat-num-sm" style={{ color: "var(--yellow)" }}>
              {t.yellow}
            </span>
            <span className="stat-sym">~</span>
            <span className="stat-num-sm" style={{ color: "var(--red)" }}>
              {t.red}
            </span>
            <span className="stat-sym">✗</span>
          </div>
        </div>
      </div>
      <CategoryTable cat={cat} />
      <CategoryRecap cat={cat} />
    </section>
  );
}

// ── Daily Tracker ─────────────────────────────────────────────────────────────
export function DailyTracker({ categories }: { categories: Category[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const allItems = categories.flatMap((c) =>
    c.items.map((i) => ({ ...i, catTitle: c.title })),
  );
  const wins = allItems.filter(
    (i) => i.status === "green" && i.updatedAt?.slice(0, 10) === today,
  );
  const goals = allItems.filter((i) => i.status === "red").slice(0, 5);
  const inFlight = allItems.filter((i) => i.status === "yellow");

  if (wins.length === 0 && goals.length === 0 && inFlight.length === 0)
    return null;

  return (
    <div className="tracker">
      {/* Today's wins */}
      <div className="tracker-col">
        <div className="tracker-header-row">
          <span
            className="tracker-dot"
            style={{ background: "var(--green)" }}
          />
          <span className="tracker-label">Today&apos;s Wins</span>
          {wins.length > 0 && (
            <span className="tracker-count green">{wins.length}</span>
          )}
        </div>
        {wins.length === 0 ? (
          <p className="tracker-empty">None yet today</p>
        ) : (
          wins.map((w) => (
            <div key={w.id} className="tracker-item">
              <span className="tracker-sym" style={{ color: "var(--green)" }}>
                ✓
              </span>
              <span className="tracker-name">{w.label}</span>
              <span className="tracker-cat">{w.catTitle}</span>
            </div>
          ))
        )}
      </div>

      {/* In flight */}
      {inFlight.length > 0 && (
        <div className="tracker-col">
          <div className="tracker-header-row">
            <span
              className="tracker-dot"
              style={{ background: "var(--yellow)" }}
            />
            <span className="tracker-label">In Flight</span>
            <span className="tracker-count yellow">{inFlight.length}</span>
          </div>
          {inFlight.map((i) => (
            <div key={i.id} className="tracker-item">
              <span className="tracker-sym" style={{ color: "var(--yellow)" }}>
                ~
              </span>
              <span className="tracker-name">{i.label}</span>
              <span className="tracker-cat">{i.catTitle}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tomorrow's goals */}
      <div className="tracker-col">
        <div className="tracker-header-row">
          <span className="tracker-dot" style={{ background: "var(--red)" }} />
          <span className="tracker-label">Tomorrow&apos;s Goals</span>
          {goals.length > 0 && (
            <span className="tracker-count red">{goals.length}</span>
          )}
        </div>
        {goals.length === 0 ? (
          <p className="tracker-empty">All clear 🎉</p>
        ) : (
          goals.map((g) => (
            <div key={g.id} className="tracker-item">
              <span className="tracker-sym" style={{ color: "var(--red)" }}>
                →
              </span>
              <span className="tracker-name">{g.label}</span>
              <span className="tracker-cat">{g.catTitle}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function daysAgo(dateStr: string): number | null {
  const d = Date.parse(dateStr);
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d) / 86_400_000);
}

export function tally(items: LedgerItem[]) {
  return {
    green: items.filter((i) => i.status === "green").length,
    yellow: items.filter((i) => i.status === "yellow").length,
    red: items.filter((i) => i.status === "red").length,
  };
}

export { Link };
