import Link from "next/link";
import type { Category, LedgerItem } from "../lib/ledger";
import { computeRead } from "../lib/read";
import type { QueueItem } from "../lib/ledger";

export function Pill({ status }: { status: LedgerItem["status"] }) {
  return <span className={`pill ${status}`}>{status}</span>;
}

/** The fixed read: last 2 greens · next 3–6 reds · any yellows. */
export function ReadBar({
  items,
  queue,
}: {
  items: LedgerItem[];
  queue?: QueueItem[];
}) {
  const r = computeRead(items, queue ?? []);
  const names = (xs: LedgerItem[]) =>
    xs.length ? xs.map((i) => i.label).join(", ") : "—";
  return (
    <div className="read">
      <span>
        <b>Last 2 done:</b> {names(r.greens)}
      </span>
      <span>
        <b>Next up:</b> {names(r.reds)}
      </span>
      <span>
        <b>Building:</b> {names(r.yellows)}
      </span>
    </div>
  );
}

export function CategoryTable({ cat }: { cat: Category }) {
  if (cat.items.length === 0) {
    return (
      <p className="note">No items — signal unavailable (check env / PAT).</p>
    );
  }
  const dataCols = cat.columns.slice(1, -1); // first is the name, last is Status
  return (
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
          <tr key={it.id}>
            <td className="name">
              {it.link ? (
                <a href={it.link} target="_blank" rel="noreferrer">
                  {it.label}
                </a>
              ) : (
                it.label
              )}
            </td>
            {dataCols.map((c) => (
              <td key={c} className="note">
                {it.cols[c] ?? "—"}
              </td>
            ))}
            <td>
              <Pill status={it.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CategorySection({
  cat,
  queue,
}: {
  cat: Category;
  queue?: QueueItem[];
}) {
  return (
    <section className="category">
      <div className="category-header">
        <span className="cat-dot" style={{ background: cat.dot }} />
        {cat.title}
      </div>
      <ReadBar items={cat.items} queue={queue} />
      <CategoryTable cat={cat} />
    </section>
  );
}

export function tally(items: LedgerItem[]) {
  return {
    green: items.filter((i) => i.status === "green").length,
    yellow: items.filter((i) => i.status === "yellow").length,
    red: items.filter((i) => i.status === "red").length,
  };
}

export { Link };
