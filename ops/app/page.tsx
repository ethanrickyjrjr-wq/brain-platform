import { buildLedger } from "../lib/ledger";
import { ReadBar, tally, Link } from "./ui";

export const revalidate = 300;

export default async function Home() {
  const ledger = await buildLedger();
  const allItems = ledger.categories.flatMap((c) => c.items);

  return (
    <main className="wrap">
      <h1>SWFL Data Gulf — /ops</h1>
      <p className="subtitle mono">
        Live operations ledger · status derived from real signals ·{" "}
        {ledger.generatedAt.slice(0, 16).replace("T", " ")} UTC
      </p>

      {(!ledger.signals.github || !ledger.signals.supabase) && (
        <div className="banner warn">
          Signal degraded: {!ledger.signals.github && "GitHub PAT unset "}
          {!ledger.signals.supabase && "Supabase env unset"} — some rows show
          unknown until configured.
        </div>
      )}

      <ReadBar items={allItems} queue={ledger.queue} />

      <div className="cards">
        {ledger.categories.map((c) => {
          const t = tally(c.items);
          return (
            <Link
              key={c.key}
              href={`/c/${c.key}`}
              className="card"
              style={{ display: "block" }}
            >
              <h3>
                <span
                  className="cat-dot"
                  style={{
                    background: c.dot,
                    display: "inline-block",
                    marginRight: 8,
                  }}
                />
                {c.title}
              </h3>
              <div className="tally">
                <span style={{ color: "var(--green)" }}>{t.green}✓</span>
                <span style={{ color: "var(--yellow)" }}>{t.yellow}~</span>
                <span style={{ color: "var(--red)" }}>{t.red}✗</span>
              </div>
            </Link>
          );
        })}
        <Link href="/queue" className="card" style={{ display: "block" }}>
          <h3>Build queue →</h3>
          <div className="tally note">what needs built next</div>
        </Link>
      </div>

      <footer>
        SWFL Data Gulf · /ops · source of truth: live signals (GitHub Actions,
        repo files, Supabase). The goal lives in <code>docs/THE-GOAL.md</code>.
      </footer>
    </main>
  );
}
