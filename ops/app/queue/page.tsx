import { buildLedger } from "../../lib/ledger";
import { Pill, Link } from "../ui";

export const revalidate = 300;

export default async function QueuePage() {
  const ledger = await buildLedger();
  const q = ledger.queue;

  return (
    <main className="wrap">
      <p className="subtitle">
        <Link href="/">← /ops</Link>
      </p>
      <h1>Build queue</h1>
      <p className="subtitle">
        The one human input. Edit <code>_AUDIT_AND_ROADMAP/build-queue.md</code>{" "}
        on GitHub: priority = order, <code>[x]</code> done, <code>[~]</code>{" "}
        building, <code>[ ]</code> up next.
      </p>

      {q.length === 0 ? (
        <p className="note" style={{ marginTop: 16 }}>
          No <code>build-queue.md</code> found, or it has no checklist items
          yet.
        </p>
      ) : (
        <table style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th style={{ width: 60 }}>#</th>
              <th>Item</th>
              <th style={{ width: 90 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {q.map((item) => (
              <tr key={item.order}>
                <td className="mono note">{item.order + 1}</td>
                <td className="name" style={{ whiteSpace: "normal" }}>
                  {item.label}
                </td>
                <td>
                  <Pill status={item.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer>
        SWFL Data Gulf · /ops · build queue. Plan the next move from this page.
      </footer>
    </main>
  );
}
