import Image from "next/image";
import { buildLedger } from "../lib/ledger";
import { CategorySection, DailyTracker, DonutChart, Link, tally } from "./ui";

export const revalidate = 300;

export default async function Home() {
  const ledger = await buildLedger();
  const allItems = ledger.categories.flatMap((c) => c.items);
  const overall = tally(allItems);
  const total = allItems.length;

  return (
    <main className="wrap">
      {/* ── Topbar ── */}
      <div className="topbar">
        <Image
          src="/logo.png"
          alt="SWFL Data Gulf"
          width={52}
          height={52}
          className="logo"
          priority
        />
        <div className="topbar-text">
          <h1>
            SWFL Data Gulf <span className="ops-badge">/ops</span>
          </h1>
          <p className="subtitle mono">
            Live operations ledger · derived from real signals ·{" "}
            <span className="ts">
              {ledger.generatedAt.slice(0, 16).replace("T", " ")} UTC
            </span>
          </p>
        </div>
        <div className="topbar-stats">
          <DonutChart
            green={overall.green}
            yellow={overall.yellow}
            red={overall.red}
          />
          <div className="top-stat">
            <span className="top-stat-num green">{overall.green}</span>
            <span className="top-stat-label">live</span>
          </div>
          <div className="top-stat">
            <span className="top-stat-num yellow">{overall.yellow}</span>
            <span className="top-stat-label">building</span>
          </div>
          <div className="top-stat">
            <span className="top-stat-num red">{overall.red}</span>
            <span className="top-stat-label">offline</span>
          </div>
          <div className="top-stat">
            <span className="top-stat-num dim">{total}</span>
            <span className="top-stat-label">total</span>
          </div>
        </div>
      </div>

      {/* ── Signal warning ── */}
      {(!ledger.signals.github || !ledger.signals.supabase) && (
        <div className="banner warn">
          Signal degraded:{" "}
          {!ledger.signals.github && <span>GitHub PAT unset </span>}
          {!ledger.signals.supabase && <span>Supabase env unset</span>} —
          affected rows show unknown until configured.
        </div>
      )}

      {/* ── Category nav ── */}
      <nav className="catnav">
        {ledger.categories.map((c) => {
          const t = tally(c.items);
          return (
            <a key={c.key} href={`#${c.key}`} className="catnav-pill">
              <span className="catnav-dot" style={{ background: c.dot }} />
              {c.title}
              <span className="catnav-counts">
                <span style={{ color: "var(--green)" }}>{t.green}✓</span>
                {t.red > 0 && (
                  <span style={{ color: "var(--red)" }}>{t.red}✗</span>
                )}
              </span>
            </a>
          );
        })}
        <Link href="/read" className="catnav-pill catnav-read">
          Fast Read ↗
        </Link>
        <Link href="/targets" className="catnav-pill catnav-targets">
          Data Targets ◎
        </Link>
        <Link href="/queue" className="catnav-pill catnav-queue">
          Build queue →
        </Link>
      </nav>

      {/* ── Daily tracker (auto-hides when nothing is on the table) ── */}
      <DailyTracker categories={ledger.categories} />

      {/* ── Category sections ── */}
      {ledger.categories.map((c, i) => (
        <div id={c.key} key={c.key}>
          <CategorySection cat={c} index={i} />
        </div>
      ))}

      <footer>
        SWFL Data Gulf · /ops · status derived live from GitHub Actions, repo
        files, and Supabase. The goal lives in <code>docs/THE-GOAL.md</code>;
        what&apos;s next lives in <Link href="/queue">the build queue</Link>.
        Claude summary at <Link href="/read">fast read</Link>.
      </footer>
    </main>
  );
}
